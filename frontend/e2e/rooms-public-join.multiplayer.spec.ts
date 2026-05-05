import { expect, test, type APIRequestContext } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('public room is listed, second user joins, owner starts, both can open game', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const playerA = await createRealUserSession(request, 'public-room-a');
  const playerB = await createRealUserSession(request, 'public-room-b');
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
    storageState: authStorageState(baseURL, playerA.token, playerA.user),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.token, playerB.user),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/rooms');
    await pageA.locator('select[name="deckId"]').selectOption(deckA.deckId);
    await pageA.locator('select[name="visibility"]').selectOption('public');
    await pageA.getByRole('button', { name: 'Create room' }).click();

    const currentRoomId = pageA.locator('.room-header strong');
    await expect(currentRoomId).toBeVisible();
    const roomId = (await currentRoomId.innerText()).trim();
    expect(roomId.length).toBeGreaterThan(0);

    await pageB.goto('/rooms');
    await pageB.locator('select[name="deckId"]').selectOption(deckB.deckId);
    await expect(pageB.locator('.list-row strong', { hasText: roomId }).first()).toBeVisible();
    await pageB.locator('.list-row', { has: pageB.locator('strong', { hasText: roomId }) }).first()
      .getByRole('button', { name: 'Join' })
      .click();

    await expect(pageB.locator('.room-header strong')).toHaveText(roomId);

    await expect.poll(async () => {
      const room = await getRoom(request, playerA.token, roomId);
      return room.players.length;
    }).toBeGreaterThanOrEqual(2);

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
): Promise<{ id: string; players: Array<{ id: string }>; gameId: string | null }> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { id: string; players: Array<{ id: string }>; gameId: string | null } };

  return payload.room;
}
