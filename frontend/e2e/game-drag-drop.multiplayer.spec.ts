import { expect, test, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithRandomDecks } from './support/commander-game';

test.setTimeout(240000);

test('drag and drop moves a card to battlefield and syncs to opponent', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithRandomDecks(request, {
    runId: `drag-drop-${Date.now()}`,
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
    if (sidebarBefore.hand === 0) {
      await pageA.getByRole('button', { name: 'Draw mine' }).click();
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

    const movedWithDragTo = await tryNativeDragTo(source, target);
    if (!movedWithDragTo) {
      await dragWithDataTransfer(pageA, source, target);
    }

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

async function tryNativeDragTo(source: Locator, target: Locator): Promise<boolean> {
  try {
    await source.dragTo(target);
    return true;
  } catch {
    return false;
  }
}

async function dragWithDataTransfer(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}

async function focusPlayer(page: Page, displayName: string): Promise<void> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('.focused-board h1')).toHaveText(displayName);
}

async function readSidebarZoneCounts(page: Page, displayName: string): Promise<{ hand: number; library: number }> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  const text = await thumb.locator('small').innerText();
  const match = /(\d+)\s+hand\s+·\s+(\d+)\s+library/.exec(text.trim());
  if (!match) {
    throw new Error(`Could not parse sidebar counts for ${displayName}: "${text}"`);
  }

  return {
    hand: Number.parseInt(match[1] ?? '', 10),
    library: Number.parseInt(match[2] ?? '', 10),
  };
}

async function battlefieldCount(page: Page, playerId: string): Promise<number> {
  return page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`)
    .count();
}
