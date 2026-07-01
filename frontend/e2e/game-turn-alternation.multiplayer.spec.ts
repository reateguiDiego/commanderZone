import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';

test.setTimeout(180000);

const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

test('two players can alternate manual turn controls and stay synchronized', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithBasicDecks(request, {
    playerAPrefix: 'turn-a',
    playerBPrefix: 'turn-b',
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

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
    await expect(pageA.getByTestId('mulligan-overlay')).toBeHidden();
    await expect(pageB.getByTestId('mulligan-overlay')).toBeHidden();

    const firstActive = await activeTurnPage(pageA, pageB);
    const firstNonActive = firstActive === pageA ? pageB : pageA;

    await advancePhase(firstActive, 4);
    await expect.poll(async () => readPhase(pageA)).toBe('combat');
    await expect.poll(async () => readPhase(pageB)).toBe('combat');

    await advancePhase(firstActive, 3);
    await expect.poll(async () => firstActive.getByTestId('pass-turn').isVisible().catch(() => false)).toBe(false);
    await expect.poll(async () => firstNonActive.getByTestId('pass-turn').isVisible().catch(() => false)).toBe(true);
    await expect.poll(async () => readPhase(pageA)).toBe('untap');
    await expect.poll(async () => readPhase(pageB)).toBe('untap');
    await expect.poll(async () => readTurnNumber(pageA)).toBe('Turno 1');
    await expect.poll(async () => readTurnNumber(pageB)).toBe('Turno 1');

    await advancePhase(firstNonActive, 7);
    await expect.poll(async () => firstActive.getByTestId('pass-turn').isVisible().catch(() => false)).toBe(true);
    await expect.poll(async () => firstNonActive.getByTestId('pass-turn').isVisible().catch(() => false)).toBe(false);
    await expect.poll(async () => readTurnNumber(pageA)).toBe('Turno 2');
    await expect.poll(async () => readTurnNumber(pageB)).toBe('Turno 2');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function readActivePlayer(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('[data-testid="player-order-card"].active .player-order-name').textContent())?.trim() ?? '';
}

async function readPhase(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('[data-testid="phase-step"][aria-current="step"]').getAttribute('data-phase')) ?? '';
}

async function readTurnNumber(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('[data-testid="player-order-card"].active .player-order-step').textContent())?.trim() ?? '';
}

async function advancePhase(page: import('@playwright/test').Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const currentPhase = await readPhase(page);
    const currentIndex = PHASES.indexOf(currentPhase);
    const expectedPhase = PHASES[currentIndex + 1] ?? PHASES[0];
    await page.getByTestId('advance-phase').click();
    await expect.poll(async () => readPhase(page)).toBe(expectedPhase);
  }
}

async function activeTurnPage(
  pageA: import('@playwright/test').Page,
  pageB: import('@playwright/test').Page,
): Promise<import('@playwright/test').Page> {
  await expect.poll(async () =>
    await pageA.getByTestId('pass-turn').isVisible().catch(() => false)
      || await pageB.getByTestId('pass-turn').isVisible().catch(() => false),
  ).toBe(true);

  return await pageA.getByTestId('pass-turn').isVisible().catch(() => false) ? pageA : pageB;
}
