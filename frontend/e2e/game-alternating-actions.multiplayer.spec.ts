import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { drawMine, focusPlayer, openChat, readTableLife as readSidebarLife, readTableZoneCounts as readSidebarZoneCounts } from './support/game-table';

test.setTimeout(120_000);
const POLL_TIMEOUT = 15_000;

test('multiplayer alternating actions stay synchronized', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'alt-a',
    playerBPrefix: 'alt-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    const aBeforeDraw = await readSidebarZoneCounts(pageA, playerA.user.displayName);
    await focusPlayer(pageA, playerA.user.displayName);
    await drawMine(pageA);
    await expect.poll(async () => readSidebarZoneCounts(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
      hand: aBeforeDraw.hand + 1,
      library: aBeforeDraw.library - 1,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
      hand: aBeforeDraw.hand + 1,
      library: aBeforeDraw.library - 1,
    });

    const bBeforeDraw = await readSidebarZoneCounts(pageB, playerB.user.displayName);
    await focusPlayer(pageB, playerB.user.displayName);
    await drawMine(pageB);
    await expect.poll(async () => readSidebarZoneCounts(pageB, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
      hand: bBeforeDraw.hand + 1,
      library: bBeforeDraw.library - 1,
    });
    await expect.poll(async () => readSidebarZoneCounts(pageA, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toEqual({
      hand: bBeforeDraw.hand + 1,
      library: bBeforeDraw.library - 1,
    });

    await focusPlayer(pageA, playerA.user.displayName);
    const movedByA = await moveFirstHandCardToBattlefield(pageA, playerA.user.id);
    await focusPlayer(pageB, playerA.user.displayName);
    await expect.poll(async () => cardVisibleOnBattlefield(pageB, playerA.user.id, movedByA), { timeout: POLL_TIMEOUT }).toBe(true);

    await focusPlayer(pageB, playerB.user.displayName);
    const movedByB = await moveFirstHandCardToBattlefield(pageB, playerB.user.id);
    await focusPlayer(pageA, playerB.user.displayName);
    await expect.poll(async () => cardVisibleOnBattlefield(pageA, playerB.user.id, movedByB), { timeout: POLL_TIMEOUT }).toBe(true);

    await focusPlayer(pageA, playerA.user.displayName);
    await pageA.locator('.focused-board [data-testid="life-value"]').click({ button: 'right' });
    await expect.poll(async () => readSidebarLife(pageA, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(39);
    await expect.poll(async () => readSidebarLife(pageB, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe(39);

    await openChat(pageA);
    await openChat(pageB);
    const messageFromB = `alt-b-${Date.now()}`;
    await sendChatMessage(pageB, messageFromB);
    await expect.poll(async () => hasChatMessage(pageB, playerB.user.displayName, messageFromB), { timeout: POLL_TIMEOUT }).toBe(true);
    await expect.poll(async () => hasChatMessage(pageA, playerB.user.displayName, messageFromB), { timeout: POLL_TIMEOUT }).toBe(true);
    await minimizeFloatingPanel(pageA);
    await minimizeFloatingPanel(pageB);

    await focusPlayer(pageA, playerA.user.displayName);
    const tappedCard = pageA.locator(`[data-testid="battlefield-zone"][data-player-id="${playerA.user.id}"] [data-card-instance-id="${movedByA}"]`);
    await tappedCard.dblclick({ timeout: 5000 });
    await expect(tappedCard).toHaveClass(/tapped/, { timeout: 5000 });

    await focusPlayer(pageB, playerB.user.displayName);
    await openZoneModalByClick(pageB, playerB.user.id, 'graveyard');
    await closeZoneModal(pageB);

  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function moveFirstHandCardToBattlefield(page: Page, playerId: string): Promise<string> {
  const handCard = page
    .locator(`[data-testid="hand-zone"][data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`)
    .nth(3);
  await expect(handCard).toBeVisible();
  const instanceId = await handCard.getAttribute('data-card-instance-id');
  if (!instanceId) {
    throw new Error(`Missing hand card instance id for ${playerId}`);
  }
  await handCard.dblclick();
  await expect(page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`)).toBeVisible();

  return instanceId;
}

async function cardVisibleOnBattlefield(page: Page, playerId: string, instanceId: string): Promise<boolean> {
  const card = page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"] [data-card-instance-id="${instanceId}"]`);
  return (await card.count()) > 0;
}

async function sendChatMessage(page: Page, message: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.fill(message);
  await input.press('Enter');
}

async function minimizeFloatingPanel(page: Page): Promise<void> {
  const button = page.locator('.floating-panel button').filter({ hasText: /^-$/ }).first();
  if ((await button.count()) === 0) {
    return;
  }
  await button.click({ timeout: 5000 });
}

async function hasChatMessage(page: Page, displayName: string, message: string): Promise<boolean> {
  const row = page.getByTestId('chat-message').filter({ hasText: displayName }).filter({ hasText: message });
  return (await row.count()) > 0;
}

async function openZoneModalByClick(page: Page, playerId: string, zone: 'graveyard' | 'exile'): Promise<void> {
  await page.locator(`[data-testid="drop-zone"][data-player-id="${playerId}"][data-zone="${zone}"]`).click({ timeout: 5000 });
  await expect(page.locator('.zone-modal')).toBeVisible({ timeout: 5000 });
}

async function closeZoneModal(page: Page): Promise<void> {
  const modal = page.locator('.zone-modal');
  if ((await modal.count()) === 0) {
    return;
  }
  await page.locator('.zone-modal-backdrop').first().click({ position: { x: 5, y: 5 }, force: true, timeout: 5000 });
  try {
    await expect(modal).toHaveCount(0, { timeout: 5000 });
    return;
  } catch {
    const closeButton = modal.locator('header button').first();
    if (await closeButton.isVisible({ timeout: 1000 })) {
      await closeButton.click({ force: true, timeout: 5000 });
    }
  }
  await expect(modal).toHaveCount(0, { timeout: 10000 });
}
