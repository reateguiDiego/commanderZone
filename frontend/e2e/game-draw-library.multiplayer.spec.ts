import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { drawMine, focusPlayer, readTableZoneCounts as readSidebarZoneCounts } from './support/game-table';

test.setTimeout(240000);

test('drawing from library updates library and hand for both players in real time', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `draw-library-${Date.now()}`,
    deckSize: 100,
  });

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.token, setup.playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.token, setup.playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${setup.gameId}`),
      pageB.goto(`/games/${setup.gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    const initialA = await readSidebarZoneCounts(pageA, setup.playerA.user.displayName);
    await drawMine(pageA);

    await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).toEqual({
      hand: initialA.hand + 1,
      library: initialA.library - 1,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageB, setup.playerA.user.displayName), { timeout: 15000 }).toEqual({
      hand: initialA.hand + 1,
      library: initialA.library - 1,
    });

    await focusPlayer(pageA, setup.playerA.user.displayName);

    const visibleHandCardsForA = await pageA
      .locator(`[data-testid="hand-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .count();
    expect(visibleHandCardsForA).toBe(initialA.hand + 1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});


