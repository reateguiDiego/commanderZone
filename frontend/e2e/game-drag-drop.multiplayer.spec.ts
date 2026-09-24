import { expect, test, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks, resolveGameToPlaying } from './support/commander-game';
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
  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

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

    await dragWithPointer(pageA, source, target);

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

async function dragWithPointer(page: Page, source: Locator, target: Locator): Promise<void> {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) {
    throw new Error('Expected visible source and target bounds for pointer drag.');
  }

  const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await source.dispatchEvent('pointerdown', {
    clientX: sourcePoint.x,
    clientY: sourcePoint.y,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
  });
  await dispatchPointerMove(page, { x: sourcePoint.x, y: sourcePoint.y - 24 });
  await expect(page.locator('.hand-floating-card')).toBeVisible();
  await dispatchPointerMove(page, targetPoint);
  await expect(target).toHaveClass(/drop-target-active/);
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
  })), targetPoint);
}

async function dispatchPointerMove(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
  })), point);
}


async function battlefieldCount(page: Page, playerId: string): Promise<number> {
  return page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`)
    .count();
}

