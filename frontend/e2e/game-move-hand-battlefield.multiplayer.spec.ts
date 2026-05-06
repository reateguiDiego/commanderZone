import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { drawMine, focusPlayer, readTableZoneCounts as readSidebarZoneCounts } from './support/game-table';

test.setTimeout(240000);

test('player can move a hand card to battlefield with manual fallback and sync to opponent', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `move-hand-${Date.now()}`,
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

    await focusPlayer(pageA, setup.playerA.user.displayName);
    await focusPlayer(pageB, setup.playerA.user.displayName);

    let sidebarBefore = await readSidebarZoneCounts(pageA, setup.playerA.user.displayName);
    let handBefore = sidebarBefore.hand;
    if (handBefore === 0) {
      await drawMine(pageA);
      await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).not.toEqual(sidebarBefore);
      sidebarBefore = await readSidebarZoneCounts(pageA, setup.playerA.user.displayName);
      handBefore = sidebarBefore.hand;
    }

    const battlefieldBefore = await pageA
      .locator(`[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"]`)
      .count();

    const handCard = pageA
      .locator(`[data-testid="hand-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .nth(3);
    await expect(handCard).toBeVisible();
    const instanceId = await handCard.getAttribute('data-card-instance-id');
    if (!instanceId) {
      throw new Error('Hand card instance id is required for move assertion.');
    }

    // Manual fallback interaction: double click hand card.
    await handCard.dblclick();

    await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).toEqual({
      hand: handBefore - 1,
      library: sidebarBefore.library,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageB, setup.playerA.user.displayName)).toEqual({
      hand: handBefore - 1,
      library: sidebarBefore.library,
    });

    await expect.poll(async () =>
      pageA
        .locator(`[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"]`)
        .count(),
    ).toBe(battlefieldBefore + 1);
    await expect.poll(async () =>
      pageB
        .locator(`[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"]`)
        .count(),
    ).toBe(battlefieldBefore + 1);

    await expect(pageA.locator(`[data-testid="game-card"][data-zone="hand"][data-card-instance-id="${instanceId}"]`)).toHaveCount(0);
    await expect.poll(async () =>
      pageA.locator(
        `[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${instanceId}"]`,
      ).count(),
    ).toBe(1);
    await expect.poll(async () =>
      pageB.locator(
        `[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${instanceId}"]`,
      ).count(),
    ).toBe(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});


