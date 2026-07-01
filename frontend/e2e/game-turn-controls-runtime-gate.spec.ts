import { expect, test, type Page, type WebSocket } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand } from './support/runtime-websocket';

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
  await ensureActivePlayer(request, gameId, playerA, playerB);

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
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await expect(pageA.getByTestId('mulligan-overlay')).toBeHidden();
    await expect(pageB.getByTestId('mulligan-overlay')).toBeHidden();

    await expect(pageA.getByTestId('pass-turn')).toBeVisible();
    await expect(pageA.getByTestId('advance-phase')).toBeVisible();
    await expect(pageA.getByTestId('pass-turn')).toBeEnabled();
    await expect(pageA.getByTestId('advance-phase')).toBeEnabled();
    await expect(pageB.getByTestId('pass-turn')).toHaveCount(0);
    await expect(pageB.getByTestId('advance-phase')).toHaveCount(0);

    const nextPhase = nextPhaseAfter(await readPhase(pageA));
    await pageA.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(pageA)).toBe(nextPhase);
    await expect.poll(async () => readPhase(pageB)).toBe(nextPhase);

    const activeAName = await readActivePlayer(pageA);
    await pageA.getByTestId('pass-turn').click();
    try {
      await expect.poll(async () => readActivePlayer(pageA), { timeout: 10_000 }).not.toBe(activeAName);
      await expect.poll(async () => pageA.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => pageB.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(true);
    } catch (error) {
      throw new Error(`${String(error)}

Frames:
${JSON.stringify(frames.slice(-40), null, 2)}

Page A DOM:
${await pageA.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}

Page B DOM:
${await pageB.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}`);
    }

    const bNextPhase = nextPhaseAfter(await readPhase(pageB));
    await pageB.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(pageA)).toBe(bNextPhase);
    await expect.poll(async () => readPhase(pageB)).toBe(bNextPhase);

    const activeBName = await readActivePlayer(pageB);
    await pageB.getByTestId('pass-turn').click();
    await expect.poll(async () => readActivePlayer(pageB), { timeout: 10_000 }).not.toBe(activeBName);
    await expect.poll(async () => pageB.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => pageA.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(true);
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

interface RuntimeSetupPlayer {
  token: string;
  user: { id: string };
}

async function ensureActivePlayer(
  request: Parameters<typeof resolveGameToPlaying>[0],
  gameId: string,
  playerA: RuntimeSetupPlayer,
  playerB: RuntimeSetupPlayer,
): Promise<void> {
  const snapshot = await loadSnapshot(request, gameId, playerA.token);
  const playerAId = playerIdForUser(snapshot, playerA.user.id);
  if (!playerAId) {
    throw new Error(`Could not find player A in game ${gameId}.`);
  }
  if (snapshot.turn?.activePlayerId === playerAId) {
    return;
  }

  const activePlayerId = String(snapshot.turn?.activePlayerId ?? '');
  const activeToken = playerIdForUser(snapshot, playerB.user.id) === activePlayerId ? playerB.token : playerA.token;
  await sendRuntimeCommand(request, {
    gameId,
    token: activeToken,
    baseVersion: Math.max(1, Number(snapshot.version ?? 1)),
    type: 'turn.changed',
    payload: {
      activePlayerId: playerAId,
      phase: snapshot.turn?.phase ?? 'untap',
      number: snapshot.turn?.number ?? 1,
    },
  });
}

async function loadSnapshot(
  request: Parameters<typeof resolveGameToPlaying>[0],
  gameId: string,
  token: string,
): Promise<{
  version?: number;
  turn?: { activePlayerId?: string | null; phase?: string; number?: number };
  players?: Record<string, { user?: { id?: string } }>;
}> {
  const response = await request.get(`http://127.0.0.1:8000/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as {
    game?: { snapshot?: {
      version?: number;
      turn?: { activePlayerId?: string | null; phase?: string; number?: number };
      players?: Record<string, { user?: { id?: string } }>;
    } };
  };

  return payload.game?.snapshot ?? {};
}

function playerIdForUser(snapshot: { players?: Record<string, { user?: { id?: string } }> }, userId: string): string | null {
  return Object.entries(snapshot.players ?? {}).find(([, player]) => player.user?.id === userId)?.[0] ?? null;
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
    socket.on('framesent', (event) => frames.push({ direction: 'sent', page: pageLabel, payload: parsePayload(event.payload) }));
    socket.on('framereceived', (event) => frames.push({ direction: 'received', page: pageLabel, payload: parsePayload(event.payload) }));
    socket.on('close', () => audit.websocketCloses.push(`${pageLabel} ${socket.url()}`));
    socket.on('socketerror', (error) => audit.websocketErrors.push(`${pageLabel} ${String(error)}`));
  });
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
