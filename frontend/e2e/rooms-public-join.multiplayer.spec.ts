import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('public room is listed, second user joins, owner starts, both can open game', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const playerA = await createRealUserSession(request, 'owner-public-room');
  const playerB = await createRealUserSession(request, 'guest-public-room');
  const roomName = `Plaza ${Date.now().toString(36)}`;
  const deckAName = `Public Room A ${Date.now()}`;
  const deckBName = `Public Room B ${Date.now()}`;
  const deckA = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: deckAName,
    seed: 'e2e-public-room-a-seed',
  });
  const deckB = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: deckBName,
    seed: 'e2e-public-room-b-seed',
  });
  expect(deckA.validation.valid).toBeTruthy();
  expect(deckB.validation.valid).toBeTruthy();

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

    await pageA.goto('/rooms');
    const createPanel = pageA.locator('app-room-create-panel');
    await createPanel.getByRole('button', { name: 'Create room' }).click();
    const createModal = pageA.locator('app-room-setup-modal .modal-panel');
    await expect(createModal).toBeVisible();
    await createModal.locator('input[formcontrolname="roomName"]').fill(roomName);
    await createModal.locator('app-game-setup-seats-control').getByRole('tab', { name: '2' }).click();
    await createModal.locator('.visibility-choice__button--public').click();
    await createModal.locator('footer .primary-button').click();

    await expect(pageA).toHaveURL(/\/rooms\/.+\/waiting$/);
    await selectWaitingRoomDeck(pageA, deckA.deckId);
    await rollD20(pageA);

    const currentRoomLabel = pageA.getByRole('heading', { name: roomName });
    await expect(currentRoomLabel).toHaveText(roomName);
    const roomId = await getRoomIdByName(request, playerA.token, roomName);
    expect(roomId.length).toBeGreaterThan(0);

    await pageB.goto('/rooms');
    await expect(pageB.locator('.list-row strong', { hasText: roomName }).first()).toBeVisible();
    await pageB.locator('.list-row', { has: pageB.locator('strong', { hasText: roomName }) }).first()
      .getByRole('button', { name: 'Join' })
      .click();

    await expect(pageB).toHaveURL(/\/rooms\/.+\/waiting$/);
    await selectWaitingRoomDeck(pageB, deckB.deckId);
    await rollD20(pageB);

    await expect(pageB.getByRole('heading', { name: roomName })).toBeVisible();

    await expect.poll(async () => {
      const room = await getRoom(request, playerA.token, roomId);
      return room.players.length >= 2 && room.players.every((player) => player.deckId !== null && player.turnRoll !== null);
    }).toBeTruthy();

    await pageA.reload();
    const startButton = pageA.locator('.start-button');
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(pageA).toHaveURL(/\/games\/.+$/);

    await expect.poll(async () => {
      const room = await getRoom(request, playerB.token, roomId);
      return room.gameId ?? '';
    }).not.toBe('');
    const roomAfterStart = await getRoom(request, playerB.token, roomId);
    const gameId = roomAfterStart.gameId;
    if (!gameId) {
      throw new Error('Game id is missing after room start.');
    }

    const gamePath = `/games/${gameId}`;
    await pageB.goto(gamePath);

    await expect(pageA.locator('.game-screen')).toBeVisible();
    await expect(pageB.locator('.game-screen')).toBeVisible();
  } finally {
    await contextA.close().catch(() => {});
    await contextB.close().catch(() => {});
  }
});

async function getRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<{ id: string; name: string; players: Array<{ id: string; deckId: string | null; turnRoll: number | null }>; gameId: string | null }> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { id: string; name: string; players: Array<{ id: string; deckId: string | null; turnRoll: number | null }>; gameId: string | null } };

  return payload.room;
}

async function rollD20(page: Page): Promise<void> {
  const rollButton = page.getByRole('button', { name: 'Roll dice' });
  await expect(rollButton).toBeEnabled();
  await rollButton.click();
  const modal = page.locator('app-roll-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.primary-action').click();
  await expect(page.locator('.roll-badge .roll-value strong').first()).toHaveText(/\d+/);
}

async function selectWaitingRoomDeck(page: Page, deckId: string): Promise<void> {
  const selector = page.locator('app-waiting-room-deck-selector');
  const nativeOption = selector.locator(`select[name="waitingDeckId"] option[value="${deckId}"]`);
  const deckName = (await nativeOption.textContent())?.trim();
  if (!deckName) {
    throw new Error(`Deck ${deckId} is not available in the waiting-room selector.`);
  }

  await selector.locator('.deck-select-trigger').click();
  await selector.getByRole('option').filter({ hasText: deckName }).click();
  await expect(selector.locator('.deck-select-trigger')).toContainText(deckName);
}

async function getRoomIdByName(
  request: APIRequestContext,
  token: string,
  roomName: string,
): Promise<string> {
  const response = await request.get(`${API_BASE_URL}/rooms?status=all`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { data: Array<{ id: string; name: string }> };
  const match = payload.data.find((room) => room.name === roomName);
  if (!match) {
    throw new Error(`Room not found for name "${roomName}".`);
  }

  return match.id;
}
