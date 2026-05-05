import { expect, test, type APIRequestContext } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('private room invite flow: accepted friend joins, owner starts, both open game', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);

  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const owner = await createRealUserSession(request, 'private-room-owner');
  const invited = await createRealUserSession(request, 'private-room-invited');
  const ownerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Private Owner ${Date.now()}`,
    seed: 'e2e-private-owner-seed',
  });
  const invitedDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: invited.token,
    name: `Private Invited ${Date.now()}`,
    seed: 'e2e-private-invited-seed',
  });

  await createAcceptedFriendship(request, owner.token, invited.token, invited.user.id);

  const roomId = await createRoom(request, owner.token, ownerDeck.deckId, 'private');
  const inviteId = await inviteFriendToRoom(request, owner.token, roomId, invited.user.id);
  await acceptInvite(request, invited.token, inviteId, invitedDeck.deckId);

  await expect.poll(async () => {
    const room = await getRoom(request, owner.token, roomId);
    return room.players.length;
  }).toBeGreaterThanOrEqual(2);

  const gameId = await startRoom(request, owner.token, roomId);

  const contextOwner = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, owner.token, owner.user),
  });
  const contextInvited = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, invited.token, invited.user),
  });

  try {
    const ownerPage = await contextOwner.newPage();
    const invitedPage = await contextInvited.newPage();
    const gamePath = `/games/${gameId}`;

    await ownerPage.goto(gamePath);
    await invitedPage.goto(gamePath);

    await expect(ownerPage.locator('.game-screen')).toBeVisible();
    await expect(invitedPage.locator('.game-screen')).toBeVisible();
    await expect(ownerPage.locator('.player-sidebar .player-thumb strong', { hasText: owner.user.displayName })).toBeVisible();
    await expect(ownerPage.locator('.player-sidebar .player-thumb strong', { hasText: invited.user.displayName })).toBeVisible();
    await expect(invitedPage.locator('.player-sidebar .player-thumb strong', { hasText: owner.user.displayName })).toBeVisible();
    await expect(invitedPage.locator('.player-sidebar .player-thumb strong', { hasText: invited.user.displayName })).toBeVisible();
  } finally {
    await contextOwner.close().catch(() => {});
    await contextInvited.close().catch(() => {});
  }
});

async function createAcceptedFriendship(
  request: APIRequestContext,
  requesterToken: string,
  recipientToken: string,
  recipientUserId: string,
): Promise<void> {
  const requestResponse = await request.post(`${API_BASE_URL}/friends/requests`, {
    headers: {
      Authorization: `Bearer ${requesterToken}`,
    },
    data: {
      userId: recipientUserId,
    },
  });
  expect(requestResponse.ok()).toBeTruthy();
  const requestPayload = (await requestResponse.json()) as { friendship: { id: string } };

  const acceptResponse = await request.post(`${API_BASE_URL}/friends/requests/${requestPayload.friendship.id}/accept`, {
    headers: {
      Authorization: `Bearer ${recipientToken}`,
    },
  });
  expect(acceptResponse.ok()).toBeTruthy();
}

async function createRoom(
  request: APIRequestContext,
  token: string,
  deckId: string,
  visibility: 'public' | 'private',
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
      visibility,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { id: string } };

  return payload.room.id;
}

async function inviteFriendToRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
  userId: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/invites`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      userId,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { invite: { id: string } };

  return payload.invite.id;
}

async function acceptInvite(
  request: APIRequestContext,
  token: string,
  inviteId: string,
  deckId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/rooms/invites/${inviteId}/accept`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      deckId,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function getRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<{ players: Array<{ id: string }> }> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { room: { players: Array<{ id: string }> } };

  return payload.room;
}

async function startRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { game: { id: string } };

  return payload.game.id;
}
