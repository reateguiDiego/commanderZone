import { expect, test, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks, resolveGameToPlaying } from './support/commander-game';
import { focusPlayer, readTableZoneCounts } from './support/game-table';

test.setTimeout(240_000);

for (const layout of ['square', 'grid'] as const) {
test(`drags the top card from a default-sleeve library to battlefield in ${layout} and syncs both players`, async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `library-default-sleeve-${Date.now()}`,
    deckSize: 100,
  });
  await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.user, setup.playerA.refreshToken),
    viewport: { width: 1600, height: 1000 },
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerB.user, setup.playerB.refreshToken),
    viewport: { width: 1600, height: 1000 },
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await Promise.all([pageA.goto(`/games/${setup.gameId}`), pageB.goto(`/games/${setup.gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: 15_000 });
    await Promise.all([
      selectBattlefieldLayout(pageA, layout),
      selectBattlefieldLayout(pageB, layout),
    ]);
    await focusPlayer(pageA, setup.playerA.user.displayName);
    await focusPlayer(pageB, setup.playerA.user.displayName);

    const before = await readTableZoneCounts(pageA, setup.playerA.user.displayName);
    const battlefieldBefore = await battlefieldCount(pageA, setup.playerA.user.id);
    const library = pageA.locator(`[data-testid="drop-zone"][data-player-id="${setup.playerA.user.id}"][data-zone="library"]`);
    const battlefield = pageA.locator(`[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"]`);
    await expect(library).toBeVisible();
    await expect(library.locator('img[alt="Library"]').first()).toHaveAttribute('src', /facedown_card\.jpg/);
    await expect(battlefield).toBeVisible();

    await dragWithPointer(pageA, library, battlefield);

    await expect.poll(async () => battlefieldCount(pageA, setup.playerA.user.id)).toBe(battlefieldBefore + 1);
    await expect.poll(async () => battlefieldCount(pageB, setup.playerA.user.id)).toBe(battlefieldBefore + 1);
    await expect.poll(async () => readTableZoneCounts(pageA, setup.playerA.user.displayName)).toEqual({
      hand: before.hand,
      library: before.library - 1,
    });
    await expect.poll(async () => readTableZoneCounts(pageB, setup.playerA.user.displayName)).toEqual({
      hand: before.hand,
      library: before.library - 1,
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
}

async function selectBattlefieldLayout(page: Page, layout: 'square' | 'grid'): Promise<void> {
  await page.locator('.zoom-toggle-button').click();
  await page.getByTestId(`battlefield-zoom-${layout}-button`).click();

  if (layout === 'grid') {
    await expect(page.getByTestId('game-table-grid')).toBeVisible();
    return;
  }

  await expect(page.locator('.player-sidebar')).toBeVisible();
}

async function dragWithPointer(page: Page, source: Locator, target: Locator): Promise<void> {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) {
    throw new Error('Expected visible source and target bounds for pointer drag.');
  }

  const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x, sourcePoint.y - 24);
  await expect(page.locator('.zone-floating-card')).toBeVisible();
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 8 });
  await expect(target).toHaveClass(/drop-target-active/);
  await page.mouse.up();
}

async function battlefieldCount(page: Page, playerId: string): Promise<number> {
  return page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`).count();
}
