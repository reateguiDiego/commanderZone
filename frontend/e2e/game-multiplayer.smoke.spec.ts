import { expect, test, type APIRequestContext } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('player A and player B can open the same game in isolated contexts', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const playerA = await createRealUserSession(request, 'multi-a');
  const playerB = await createRealUserSession(request, 'multi-b');

  const deckAId = await createDeck(request, playerA.token, `Deck ${playerA.user.displayName}`);
  const deckBId = await createDeck(request, playerB.token, `Deck ${playerB.user.displayName}`);
  const roomId = await createRoom(request, playerA.token, deckAId);

  await joinRoom(request, playerB.token, roomId, deckBId);
  const gameId = await startRoom(request, playerA.token, roomId);

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

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await expect(pageA.locator('.game-screen')).toBeVisible();
    await expect(pageB.locator('.game-screen')).toBeVisible();

    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageA.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerA.user.displayName })).toBeVisible();
    await expect(pageB.locator('.player-sidebar .player-thumb strong', { hasText: playerB.user.displayName })).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function createDeck(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/decks`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      name,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { deck: { id: string } };

  return payload.deck.id;
}

async function createRoom(request: APIRequestContext, token: string, deckId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
      visibility: 'public',
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { id: string } };

  return payload.room.id;
}

async function joinRoom(request: APIRequestContext, token: string, roomId: string, deckId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function startRoom(request: APIRequestContext, token: string, roomId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game: { id: string } };

  return payload.game.id;
}
