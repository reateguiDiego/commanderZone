import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('private room denies outsider visibility and join', async ({ request }) => {
  test.setTimeout(180_000);

  const owner = await createRealUserSession(request, 'private-deny-owner');
  const invited = await createRealUserSession(request, 'private-deny-invited');
  const outsider = await createRealUserSession(request, 'private-deny-outsider');

  const ownerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Private Deny Owner ${Date.now()}`,
    seed: 'e2e-private-deny-owner-seed',
  });
  const invitedDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: invited.token,
    name: `Private Deny Invited ${Date.now()}`,
    seed: 'e2e-private-deny-invited-seed',
  });
  const outsiderDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: outsider.token,
    name: `Private Deny Outsider ${Date.now()}`,
    seed: 'e2e-private-deny-outsider-seed',
  });

  await createAcceptedFriendship(request, owner.token, invited.token, invited.user.id);

  const createRoomResponse = await request.post(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
    data: {
      deckId: ownerDeck.deckId,
      visibility: 'private',
    },
  });
  expect(createRoomResponse.ok()).toBeTruthy();
  const createRoomPayload = (await createRoomResponse.json()) as { room: { id: string } };
  const roomId = createRoomPayload.room.id;

  const listAsOutsiderResponse = await request.get(`${API_BASE_URL}/rooms`, {
    headers: {
      Authorization: `Bearer ${outsider.token}`,
    },
  });
  expect(listAsOutsiderResponse.ok()).toBeTruthy();
  const listAsOutsiderPayload = (await listAsOutsiderResponse.json()) as { data: Array<{ id: string }> };
  expect(listAsOutsiderPayload.data.some((room) => room.id === roomId)).toBeFalsy();

  const showAsOutsiderResponse = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${outsider.token}`,
    },
  });
  expect(showAsOutsiderResponse.status()).toBe(403);

  const joinAsOutsiderResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${outsider.token}`,
    },
    data: {
      deckId: outsiderDeck.deckId,
    },
  });
  expect(joinAsOutsiderResponse.status()).toBe(403);

  const inviteResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/invites`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
    data: {
      userId: invited.user.id,
    },
  });
  expect(inviteResponse.ok()).toBeTruthy();
  const invitePayload = (await inviteResponse.json()) as { invite: { id: string } };

  const acceptAsInvitedResponse = await request.post(`${API_BASE_URL}/rooms/invites/${invitePayload.invite.id}/accept`, {
    headers: {
      Authorization: `Bearer ${invited.token}`,
    },
    data: {
      deckId: invitedDeck.deckId,
    },
  });
  expect(acceptAsInvitedResponse.ok()).toBeTruthy();
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
