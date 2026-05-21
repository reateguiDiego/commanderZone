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
  const roomName = `Plaza del Relampago ${Date.now()}`;
  const deckA = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerA.token,
    name: `Public Room A ${Date.now()}`,
    seed: 'e2e-public-room-a-seed',
  });
  const deckB = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: playerB.token,
    name: `Public Room B ${Date.now()}`,
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
    const createPanel = pageA.locator('.rooms-create-panel');
    await createPanel.getByPlaceholder('Ej. La taberna del comandante').fill(roomName);
    await createPanel.getByRole('button', { name: '2 players' }).click();
    await createPanel.getByRole('button', { name: /Public/i }).click();
    await createPanel.getByRole('button', { name: 'Create room' }).click();

    await expect(pageA).toHaveURL(/\/rooms\/.+\/waiting$/);
    await pageA.locator('select[name="waitingDeckId"]').selectOption(deckA.deckId);
    await pageA.getByRole('button', { name: 'Update deck for this room' }).click();
    await rollD20(pageA);

    const currentRoomLabel = pageA.locator('.waiting-hero h2');
    await expect(currentRoomLabel).toHaveText(roomName);
    const roomId = await getRoomIdByName(request, playerA.token, roomName);
    expect(roomId.length).toBeGreaterThan(0);

    await pageB.goto('/rooms');
    await expect(pageB.locator('.list-row strong', { hasText: roomName }).first()).toBeVisible();
    await pageB.locator('.list-row', { has: pageB.locator('strong', { hasText: roomName }) }).first()
      .getByRole('button', { name: 'Join' })
      .click();

    await expect(pageB).toHaveURL(/\/rooms\/.+\/waiting$/);
    await pageB.locator('select[name="waitingDeckId"]').selectOption(deckB.deckId);
    await pageB.getByRole('button', { name: 'Update deck for this room' }).click();
    await rollD20(pageB);

    await expect(pageB.locator('.waiting-hero h2')).toHaveText(roomName);

    await expect.poll(async () => {
      const room = await getRoom(request, playerA.token, roomId);
      return room.players.length >= 2 && room.players.every((player) => player.deckId !== null && player.turnRoll !== null);
    }).toBeTruthy();

    await pageA.getByRole('button', { name: 'Start game' }).click();
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
  await expect(page.getByRole('button', { name: 'Roll d20' })).toBeEnabled();
  await page.getByRole('button', { name: 'Roll d20' }).click();
  const modal = page.locator('app-modal').filter({ hasText: 'This roll sets your turn order' });
  await modal.getByRole('button', { name: 'Roll d20' }).click();
  await expect(page.locator('.roll-badge').first()).toContainText(/D20 roll\s*\d+/);
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
