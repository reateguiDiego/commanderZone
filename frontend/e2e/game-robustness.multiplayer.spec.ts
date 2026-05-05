import { expect, test, type Locator, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';

test.setTimeout(360000);

test('basic robustness with two full decks does not break UI or duplicate cards', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    runId: `robust-${Date.now()}`,
    deckSize: 100,
  });

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, setup.playerA.token, setup.playerA.user),
  });

  try {
    const page = await context.newPage();
    await page.goto(`/games/${setup.gameId}`);

    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.locator('.table-error')).toHaveCount(0);

    await expect(page.locator('.player-sidebar .player-thumb strong', { hasText: setup.playerA.user.displayName })).toBeVisible();
    await expect(page.locator('.player-sidebar .player-thumb strong', { hasText: setup.playerB.user.displayName })).toBeVisible();

    await focusPlayer(page, setup.playerA.user.displayName);
    await assertRequiredZones(page, setup.playerA.user.id);

    const baseline = await readSidebarZoneCounts(page, setup.playerA.user.displayName);
    expect(baseline.hand + baseline.library).toBe(99);

    await triggerLibraryViewAction(page, setup.playerA.user.id);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.locator('.table-error')).toHaveCount(0);
    await closeZoneModal(page);

    await openZoneModalByClick(page, setup.playerA.user.id, 'graveyard');
    await closeZoneModal(page);

    await openZoneModalByClick(page, setup.playerA.user.id, 'exile');
    await closeZoneModal(page);

    await drawCardsUntilDelta(page, setup.playerA.user.displayName, baseline, 3);

    const handIds = await handInstanceIds(page, setup.playerA.user.id);
    expect(new Set(handIds).size).toBe(handIds.length);

    const cardToMove = page
      .locator(`[data-testid="hand-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="hand"]`)
      .first();
    await expect(cardToMove).toBeVisible();
    const movedId = await cardToMove.getAttribute('data-card-instance-id');
    if (!movedId) {
      throw new Error('Expected hand card instance id for move assertion.');
    }

    await moveHandCardToBattlefieldWithRetry(page, cardToMove, movedId);

    await expect.poll(async () =>
      page.locator(
        `[data-testid="battlefield-zone"][data-player-id="${setup.playerA.user.id}"] [data-testid="game-card"][data-zone="battlefield"][data-card-instance-id="${movedId}"]`,
      ).count(),
    ).toBe(1);

    const battlefieldIds = await battlefieldInstanceIds(page, setup.playerA.user.id);
    expect(new Set(battlefieldIds).size).toBe(battlefieldIds.length);
  } finally {
    await context.close();
  }
});

async function focusPlayer(page: Page, displayName: string): Promise<void> {
  const thumb = page.locator('.player-sidebar .player-thumb').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('.focused-board h1')).toHaveText(displayName);
}

async function assertRequiredZones(page: Page, playerId: string): Promise<void> {
  await expect(page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="hand-zone"][data-player-id="${playerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="library"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="graveyard"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="exile"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="zone"][data-player-id="${playerId}"][data-zone="command"]`)).toBeVisible();
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

async function triggerLibraryViewAction(page: Page, playerId: string): Promise<void> {
  const libraryZone = page.locator(`[data-testid="drop-zone"][data-player-id="${playerId}"][data-zone="library"]`).first();
  await libraryZone.click({ button: 'right', timeout: 5000 });
  const viewButton = page.locator('nav.context-menu button').filter({ hasText: /^View$/ }).first();
  await expect(viewButton).toBeVisible();
  await viewButton.click({ force: true, timeout: 5000 });
  await page.getByTestId('game-screen').click({ timeout: 5000 });
}

async function openZoneModalByClick(page: Page, playerId: string, zone: 'graveyard' | 'exile'): Promise<void> {
  await page.locator(`[data-testid="drop-zone"][data-player-id="${playerId}"][data-zone="${zone}"]`).click({ timeout: 5000 });
  await expect(page.locator('.zone-modal')).toBeVisible();
}

async function closeZoneModal(page: Page): Promise<void> {
  if ((await page.locator('.zone-modal').count()) === 0) {
    return;
  }

  await page.locator('.zone-modal-backdrop').first().click({ position: { x: 5, y: 5 }, force: true, timeout: 5000 });
  if ((await page.locator('.zone-modal').count()) > 0) {
    try {
      await page.locator('.zone-modal header button').first().click({ force: true, timeout: 5000 });
    } catch {
      // The modal may detach between the visibility check and click; fallback to keyboard close below.
    }
  }
  if ((await page.locator('.zone-modal').count()) > 0) {
    await page.keyboard.press('Escape');
  }
  await expect.poll(async () => page.locator('.zone-modal').count(), { timeout: 10000 }).toBe(0);
}

async function drawCardsUntilDelta(
  page: Page,
  displayName: string,
  baseline: { hand: number; library: number },
  draws: number,
): Promise<void> {
  const target = {
    hand: baseline.hand + draws,
    library: baseline.library - draws,
  };
  const drawMine = page.getByRole('button', { name: 'Draw mine' });
  await expect(drawMine).toBeVisible();

  for (let attempt = 0; attempt < draws * 3; attempt += 1) {
    const counts = await readSidebarZoneCounts(page, displayName);
    if (counts.hand === target.hand && counts.library === target.library) {
      break;
    }

    await drawMine.click({ timeout: 5000 });
  }

  await expect.poll(async () => readSidebarZoneCounts(page, displayName)).toEqual(target);
}

async function handInstanceIds(page: Page, playerId: string): Promise<string[]> {
  const cards = page.locator(
    `[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`,
  );
  const count = await cards.count();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = await cards.nth(index).getAttribute('data-card-instance-id');
    if (value) {
      ids.push(value);
    }
  }

  return ids;
}

async function battlefieldInstanceIds(page: Page, playerId: string): Promise<string[]> {
  const cards = page.locator(
    `[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="battlefield"]`,
  );
  const count = await cards.count();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = await cards.nth(index).getAttribute('data-card-instance-id');
    if (value) {
      ids.push(value);
    }
  }

  return ids;
}

async function moveHandCardToBattlefieldWithRetry(page: Page, card: Locator, instanceId: string): Promise<void> {
  const handCard = page.locator(`[data-testid="game-card"][data-zone="hand"][data-card-instance-id="${instanceId}"]`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await card.dblclick({ timeout: 5000 });
    try {
      await expect(handCard).toHaveCount(0, { timeout: 3000 });
      return;
    } catch {
      // keep retrying while the card is still in hand
    }
  }

  await expect(handCard).toHaveCount(0);
}

