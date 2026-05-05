import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test('player A and player B can open the same game in isolated contexts', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'multi-a',
    playerBPrefix: 'multi-b',
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

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await expect(pageA.locator('.game-screen')).toBeVisible();
    await expect(pageB.locator('.game-screen')).toBeVisible();

    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
