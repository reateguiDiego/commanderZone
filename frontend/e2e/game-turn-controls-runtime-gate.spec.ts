import { expect, test, type Page, type WebSocket } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks } from './support/commander-game';

test.setTimeout(180_000);

const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

test('active player owns turn controls after mulligan, patches and refresh', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'turn-controls-a',
    playerBPrefix: 'turn-controls-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;

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
    collectWebSocketFrames(pageA, 'A', frames);
    collectWebSocketFrames(pageB, 'B', frames);

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await keepOpeningHand(pageA);
    await keepOpeningHand(pageB);
    await expect(pageA.getByTestId('mulligan-overlay')).toBeHidden();
    await expect(pageB.getByTestId('mulligan-overlay')).toBeHidden();

    const active = await activeTurnPage(pageA, pageB);
    const nonActive = active === pageA ? pageB : pageA;
    await expect(active.getByTestId('pass-turn')).toBeVisible();
    await expect(active.getByTestId('advance-phase')).toBeVisible();
    await expect(active.getByTestId('pass-turn')).toBeEnabled();
    await expect(active.getByTestId('advance-phase')).toBeEnabled();
    await expect(nonActive.getByTestId('pass-turn')).toHaveCount(0);
    await expect(nonActive.getByTestId('advance-phase')).toHaveCount(0);

    const nextPhase = nextPhaseAfter(await readPhase(active));
    await active.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(active)).toBe(nextPhase);
    await expect.poll(async () => readPhase(nonActive)).toBe(nextPhase);

    const beforePassActiveLabel = await readActivePlayer(active);
    await active.getByTestId('pass-turn').click();
    try {
      await expect.poll(async () => readActivePlayer(active), { timeout: 10_000 }).not.toBe(beforePassActiveLabel);
      await expect.poll(async () => active.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => nonActive.getByTestId('pass-turn').isVisible().catch(() => false), { timeout: 10_000 }).toBe(true);
    } catch (error) {
      throw new Error(`${String(error)}

Frames:
${JSON.stringify(frames.slice(-40), null, 2)}

Active DOM:
${await active.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}

Non-active DOM:
${await nonActive.getByTestId('turn-panel').innerText().catch(() => '<missing turn-panel>')}`);
    }

    await Promise.all([pageA.reload(), pageB.reload()]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await expect.poll(async () => {
      const visibleA = await pageA.getByTestId('pass-turn').isVisible().catch(() => false);
      const visibleB = await pageB.getByTestId('pass-turn').isVisible().catch(() => false);

      return visibleA || visibleB;
    }).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function keepOpeningHand(page: Page): Promise<void> {
  await expect(page.getByTestId('mulligan-overlay')).toBeVisible();
  await expect(page.getByTestId('mulligan-keep')).toBeEnabled();
  await page.getByTestId('mulligan-keep').click();
}

async function activeTurnPage(pageA: Page, pageB: Page): Promise<Page> {
  await expect.poll(async () =>
    await pageA.getByTestId('pass-turn').isVisible().catch(() => false)
      || await pageB.getByTestId('pass-turn').isVisible().catch(() => false),
  ).toBe(true);

  return await pageA.getByTestId('pass-turn').isVisible().catch(() => false) ? pageA : pageB;
}

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

function collectWebSocketFrames(
  page: Page,
  pageLabel: 'A' | 'B',
  frames: Array<{ direction: 'sent' | 'received'; page: 'A' | 'B'; payload: unknown }>,
): void {
  page.on('websocket', (socket: WebSocket) => {
    socket.on('framesent', (event) => frames.push({ direction: 'sent', page: pageLabel, payload: parsePayload(event.payload) }));
    socket.on('framereceived', (event) => frames.push({ direction: 'received', page: pageLabel, payload: parsePayload(event.payload) }));
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
