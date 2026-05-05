import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test.setTimeout(180000);

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

    await pageA.selectOption('select[name="activePlayer"]', playerB.user.id);
    await expect.poll(async () => readActivePlayer(pageA)).toBe(playerB.user.id);
    await expect.poll(async () => readActivePlayer(pageB)).toBe(playerB.user.id);

    await pageB.selectOption('select[name="phase"]', 'combat');
    await expect.poll(async () => readPhase(pageA)).toBe('combat');
    await expect.poll(async () => readPhase(pageB)).toBe('combat');

    await pageB.getByRole('spinbutton', { name: 'Turn number' }).fill('2');
    await pageB.getByRole('spinbutton', { name: 'Turn number' }).blur();
    await expect.poll(async () => readTurnNumber(pageA)).toBe('2');
    await expect.poll(async () => readTurnNumber(pageB)).toBe('2');

    await pageB.selectOption('select[name="activePlayer"]', playerA.user.id);
    await expect.poll(async () => readActivePlayer(pageA)).toBe(playerA.user.id);
    await expect.poll(async () => readActivePlayer(pageB)).toBe(playerA.user.id);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function readActivePlayer(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('select[name="activePlayer"]').inputValue();
}

async function readPhase(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('select[name="phase"]').inputValue();
}

async function readTurnNumber(page: import('@playwright/test').Page): Promise<string> {
  return page.getByRole('spinbutton', { name: 'Turn number' }).inputValue();
}
