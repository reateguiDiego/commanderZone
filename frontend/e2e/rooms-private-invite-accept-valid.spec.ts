import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('invited friend can accept private room invite with a Commander-valid deck', async ({ request }) => {
  test.setTimeout(180_000);

  const owner = await createRealUserSession(request, 'private-accept-owner');
  const invited = await createRealUserSession(request, 'private-accept-invited');

  const ownerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Private Accept Owner ${Date.now()}`,
    seed: 'e2e-private-accept-owner-seed',
  });
  const invitedDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: invited.token,
    name: `Private Accept Invited ${Date.now()}`,
    seed: 'e2e-private-accept-invited-seed',
  });

  await createAcceptedFriendship(request, owner.token, invited.token, invited.user.id);

  const roomId = await createRoom(request, owner.token, ownerDeck.deckId, 'private');
  const inviteId = await inviteFriendToRoom(request, owner.token, roomId, invited.user.id);

  const incomingBeforeAccept = await request.get(`${API_BASE_URL}/rooms/invites/incoming`, {
    headers: {
      Authorization: `Bearer ${invited.token}`,
    },
  });
  expect(incomingBeforeAccept.ok()).toBeTruthy();
  const incomingPayload = (await incomingBeforeAccept.json()) as { data: Array<{ id: string }> };
  expect(incomingPayload.data.some((invite) => invite.id === inviteId)).toBeTruthy();

  const acceptResponse = await request.post(`${API_BASE_URL}/rooms/invites/${inviteId}/accept`, {
    headers: {
      Authorization: `Bearer ${invited.token}`,
    },
    data: {
      deckId: invitedDeck.deckId,
    },
  });
  expect(acceptResponse.ok()).toBeTruthy();
  const acceptPayload = (await acceptResponse.json()) as {
    invite: { status: string };
    room: { players: Array<{ user: { id: string }; deckId: string | null }> };
  };
  expect(acceptPayload.invite.status).toBe('accepted');
  expect(acceptPayload.room.players.some((player) => player.user.id === invited.user.id && player.deckId === invitedDeck.deckId)).toBeTruthy();

  const incomingAfterAccept = await request.get(`${API_BASE_URL}/rooms/invites/incoming`, {
    headers: {
      Authorization: `Bearer ${invited.token}`,
    },
  });
  expect(incomingAfterAccept.ok()).toBeTruthy();
  const incomingAfterPayload = (await incomingAfterAccept.json()) as { data: Array<{ id: string }> };
  expect(incomingAfterPayload.data.some((invite) => invite.id === inviteId)).toBeFalsy();
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
