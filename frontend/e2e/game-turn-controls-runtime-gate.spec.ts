import { expect, test, type Page, type WebSocket } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

test.setTimeout(180_000);

const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

test('active player alternates turn controls through runtime websocket patches only', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'turn-controls-a',
    playerBPrefix: 'turn-controls-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const frames: Array<{ direction: 'sent' | 'received'; page: 'A' | 'B'; payload: unknown }> = [];
    const audit = createBrowserAudit(gameId);
    collectBrowserAudit(pageA, 'A', frames, audit);
    collectBrowserAudit(pageB, 'B', frames, audit);

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('mulligan-overlay')).toBeHidden();
    await expect(pageB.getByTestId('mulligan-overlay')).toBeHidden();

    const firstActive = await activeTurnSession(pageA, pageB);
    await expect(firstActive.page.getByTestId('pass-turn')).toBeVisible({ timeout: 10_000 });
    await expect(firstActive.page.getByTestId('advance-phase')).toBeVisible({ timeout: 10_000 });
    await expect(firstActive.page.getByTestId('pass-turn')).toBeEnabled();
    await expect(firstActive.page.getByTestId('advance-phase')).toBeEnabled();
    await expect(firstActive.inactivePage.getByTestId('pass-turn')).toHaveCount(0);
    await expect(firstActive.inactivePage.getByTestId('advance-phase')).toHaveCount(0);

    const nextPhase = nextPhaseAfter(await readPhase(firstActive.page));
    await firstActive.page.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(pageA)).toBe(nextPhase);
    await expect.poll(async () => readPhase(pageB)).toBe(nextPhase);

    const firstActiveName = await readActivePlayer(firstActive.page);
    await firstActive.page.getByTestId('pass-turn').click();
    try {
      await expect.poll(async () => readActivePlayer(firstActive.page), { timeout: 10_000 }).not.toBe(firstActiveName);
      await expect.poll(async () => firstActive.page.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => firstActive.inactivePage.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(true);
    } catch (error) {
      throw new Error(`${String(error)}

Frames:
${JSON.stringify(frames.slice(-40), null, 2)}

Page A DOM:
${await pageA.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}

Page B DOM:
${await pageB.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}`);
    }

    const secondActive = await activeTurnSession(pageA, pageB);
    expect(secondActive.label).not.toBe(firstActive.label);
    const secondNextPhase = nextPhaseAfter(await readPhase(secondActive.page));
    await secondActive.page.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(pageA)).toBe(secondNextPhase);
    await expect.poll(async () => readPhase(pageB)).toBe(secondNextPhase);

    const secondActiveName = await readActivePlayer(secondActive.page);
    await secondActive.page.getByTestId('pass-turn').click();
    await expect.poll(async () => readActivePlayer(secondActive.page), { timeout: 10_000 }).not.toBe(secondActiveName);
    await expect.poll(async () => secondActive.page.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => secondActive.inactivePage.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => readPhase(pageA)).toBe('untap');
    await expect.poll(async () => readPhase(pageB)).toBe('untap');

    await expect.poll(() => audit.websocketTicketRoutes.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    assertRuntimeOnlyTurnFlow(frames, audit);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function readActivePlayer(page: Page): Promise<string> {
  return (await page.locator('[data-testid="player-order-card"].active .player-order-name').textContent({ timeout: 5000 }))?.trim() ?? '';
}

async function readPhase(page: Page): Promise<string> {
  return (await page.locator('[data-testid="phase-step"][aria-current="step"]').getAttribute('data-phase')) ?? '';
}

function nextPhaseAfter(phase: string): string {
  const index = PHASES.indexOf(phase);
  return PHASES[index + 1] ?? PHASES[0];
}

interface ActiveTurnSession {
  label: 'A' | 'B';
  page: Page;
  inactivePage: Page;
}

async function activeTurnSession(pageA: Page, pageB: Page): Promise<ActiveTurnSession> {
  await expect.poll(async () => activeTurnLabel(pageA, pageB), { timeout: 10_000 }).not.toBe('');
  const label = await activeTurnLabel(pageA, pageB);

  return label === 'A'
    ? { label: 'A', page: pageA, inactivePage: pageB }
    : { label: 'B', page: pageB, inactivePage: pageA };
}

async function activeTurnLabel(pageA: Page, pageB: Page): Promise<'A' | 'B' | ''> {
  if (await pageA.getByTestId('pass-turn').isVisible().catch(() => false)) {
    return 'A';
  }
  if (await pageB.getByTestId('pass-turn').isVisible().catch(() => false)) {
    return 'B';
  }
  return '';
}

interface BrowserAudit {
  readonly websocketTicketRoutes: string[];
  readonly fallbackCommandRequests: string[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly resyncSignals: string[];
  readonly websocketCloses: string[];
  readonly websocketErrors: string[];
}

function createBrowserAudit(_gameId: string): BrowserAudit {
  return {
    websocketTicketRoutes: [],
    fallbackCommandRequests: [],
    consoleErrors: [],
    pageErrors: [],
    resyncSignals: [],
    websocketCloses: [],
    websocketErrors: [],
  };
}

function collectBrowserAudit(
  page: Page,
  pageLabel: 'A' | 'B',
  frames: Array<{ direction: 'sent' | 'received'; page: 'A' | 'B'; payload: unknown }>,
  audit: BrowserAudit,
): void {
  collectWebSocketFrames(page, pageLabel, frames, audit);
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && /\/games\/[^/]+\/commands$/.test(url)) {
      audit.fallbackCommandRequests.push(`${pageLabel} ${url}`);
    }
  });
  page.on('response', (response) => {
    if (!response.url().includes('/websocket-ticket')) {
      return;
    }
    void response.json().then((payload: { route?: unknown }) => {
      audit.websocketTicketRoutes.push(String(payload.route ?? ''));
    }).catch(() => undefined);
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') {
      audit.consoleErrors.push(`${pageLabel} ${text}`);
    }
    if (/resync_required|refetch_started|snapshot_reload|fallback HTTP/i.test(text)) {
      audit.resyncSignals.push(`${pageLabel} ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(`${pageLabel} ${error.message}`);
  });
}

function collectWebSocketFrames(
  page: Page,
  pageLabel: 'A' | 'B',
  frames: Array<{ direction: 'sent' | 'received'; page: 'A' | 'B'; payload: unknown }>,
  audit: BrowserAudit,
): void {
  page.on('websocket', (socket: WebSocket) => {
    if (!isRuntimeWebSocket(socket.url())) {
      return;
    }

    socket.on('framesent', (event) => frames.push({ direction: 'sent', page: pageLabel, payload: parsePayload(event.payload) }));
    socket.on('framereceived', (event) => frames.push({ direction: 'received', page: pageLabel, payload: parsePayload(event.payload) }));
    socket.on('close', () => audit.websocketCloses.push(`${pageLabel} ${socket.url()}`));
    socket.on('socketerror', (error) => audit.websocketErrors.push(`${pageLabel} ${String(error)}`));
  });
}

function isRuntimeWebSocket(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/ws' || parsed.pathname.endsWith('/ws');
  } catch {
    return url.includes('/ws?');
  }
}

function parsePayload(payload: string | Buffer): unknown {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertRuntimeOnlyTurnFlow(
  frames: Array<{ direction: 'sent' | 'received'; page: 'A' | 'B'; payload: unknown }>,
  audit: BrowserAudit,
): void {
  const sentTurnCommands = frames.filter((frame) =>
    frame.direction === 'sent'
    && isRecord(frame.payload)
    && frame.payload['kind'] === 'command.v2'
    && frame.payload['type'] === 'turn.changed',
  );
  const turnPatches = frames.filter((frame) =>
    frame.direction === 'received'
    && isRecord(frame.payload)
    && frame.payload['kind'] === 'patch.v2'
    && Array.isArray(frame.payload['ops'])
    && frame.payload['ops'].some((operation) => isRecord(operation) && operation['op'] === 'turn.set'),
  );
  const resyncFrames = frames.filter((frame) =>
    isRecord(frame.payload) && frame.payload['kind'] === 'resync_required',
  );

  expect(sentTurnCommands.length, `turn.changed command frames:\n${JSON.stringify(frames.slice(-40), null, 2)}`).toBeGreaterThanOrEqual(4);
  expect(turnPatches.length, `turn.set patches:\n${JSON.stringify(frames.slice(-40), null, 2)}`).toBeGreaterThanOrEqual(8);
  expect(audit.websocketTicketRoutes.length, 'runtime websocket tickets observed').toBeGreaterThanOrEqual(2);
  expect(audit.websocketTicketRoutes.every((route) => route === 'runtime_ws')).toBeTruthy();
  expect(audit.fallbackCommandRequests, 'unexpected POST /games/{id}/commands fallback requests').toEqual([]);
  expect(audit.resyncSignals, 'unexpected resync/refetch/fallback console signals').toEqual([]);
  expect(resyncFrames, 'unexpected resync_required websocket frames').toEqual([]);
  expect(audit.consoleErrors, 'unexpected console errors').toEqual([]);
  expect(audit.pageErrors, 'unexpected page errors').toEqual([]);
  expect(audit.websocketErrors, 'unexpected websocket errors').toEqual([]);
  expect(audit.websocketCloses, 'websocket closed before test cleanup').toEqual([]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
