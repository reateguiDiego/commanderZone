import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { drawMine, focusPlayer, readTableZoneCounts as readSidebarZoneCounts } from './support/game-table';

test.setTimeout(240000);

test('drag and drop moves a card to battlefield and syncs to opponent', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `drag-drop-${Date.now()}`,
    deckSize: 100,
  });

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
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
    if (sidebarBefore.hand === 0) {
      await drawMine(pageA);
      await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).not.toEqual(sidebarBefore);
      sidebarBefore = await readSidebarZoneCounts(pageA, setup.playerA.user.displayName);
    }

    const battlefieldBefore = await battlefieldCount(pageA, setup.playerA.user.id);

    const source = pageA
      .locator(`[data-testid="hand-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .first();
    const target = pageA.locator(`[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"]`).first();
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const instanceId = await source.getAttribute('data-card-instance-id');
    if (!instanceId) {
      throw new Error('Expected dragged card instance id.');
    }

    await dragWithDataTransfer(pageA, source, target);

    await expect.poll(async () => battlefieldCount(pageA, setup.playerA.user.id)).toBe(battlefieldBefore + 1);
    await expect.poll(async () => battlefieldCount(pageB, setup.playerA.user.id)).toBe(battlefieldBefore + 1);

    await expect.poll(async () => readSidebarZoneCounts(pageA, setup.playerA.user.displayName)).toEqual({
      hand: sidebarBefore.hand - 1,
      library: sidebarBefore.library,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageB, setup.playerA.user.displayName)).toEqual({
      hand: sidebarBefore.hand - 1,
      library: sidebarBefore.library,
    });

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

async function dragWithDataTransfer(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}


async function battlefieldCount(page: Page, playerId: string): Promise<number> {
  return page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`)
    .count();
}

