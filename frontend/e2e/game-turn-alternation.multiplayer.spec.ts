import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test.setTimeout(180000);

const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

test('two players can alternate manual turn controls and stay synchronized', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'turn-a',
    playerBPrefix: 'turn-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.token, playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.token, playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    await advancePhase(pageA, 4);
    await expect.poll(async () => readPhase(pageA)).toBe('combat');
    await expect.poll(async () => readPhase(pageB)).toBe('combat');

    await advancePhase(pageB, 3);
    await expect.poll(async () => readActivePlayer(pageA)).toBe(playerB.user.displayName);
    await expect.poll(async () => readActivePlayer(pageB)).toBe('Your Turn');
    await expect.poll(async () => readPhase(pageA)).toBe('untap');
    await expect.poll(async () => readPhase(pageB)).toBe('untap');
    await expect.poll(async () => readTurnNumber(pageA)).toBe('Turn 2');
    await expect.poll(async () => readTurnNumber(pageB)).toBe('Turn 2');

    await advancePhase(pageB, 7);
    await expect.poll(async () => readActivePlayer(pageA)).toBe('Your Turn');
    await expect.poll(async () => readActivePlayer(pageB)).toBe(playerA.user.displayName);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function readActivePlayer(page: import('@playwright/test').Page): Promise<string> {
  return (await page.getByTestId('turn-active-player').textContent())?.trim() ?? '';
}

async function readPhase(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('[data-testid="phase-step"][aria-current="step"]').getAttribute('data-phase')) ?? '';
}

async function readTurnNumber(page: import('@playwright/test').Page): Promise<string> {
  return (await page.getByTestId('turn-number').textContent())?.trim() ?? '';
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
