import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('invited friend cannot accept private room invite with an invalid deck', async ({ request }) => {
  test.setTimeout(180_000);

  const owner = await createRealUserSession(request, 'private-accept-invalid-owner');
  const invited = await createRealUserSession(request, 'private-accept-invalid-invited');

  const ownerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Private Invalid Owner ${Date.now()}`,
    seed: 'e2e-private-invalid-owner-seed',
  });
  const invitedInvalidDeckId = await createInvalidDeckWithoutCommander(request, invited.token, 'e2e-private-invalid-invited-seed');

  await createAcceptedFriendship(request, owner.token, invited.token, invited.user.id);
  const roomId = await createRoom(request, owner.token, ownerDeck.deckId, 'private');
  const inviteId = await inviteFriendToRoom(request, owner.token, roomId, invited.user.id);

  const acceptResponse = await request.post(`${API_BASE_URL}/rooms/invites/${inviteId}/accept`, {
    headers: {
      Authorization: `Bearer ${invited.token}`,
    },
    data: {
      deckId: invitedInvalidDeckId,
    },
  });
  expect(acceptResponse.status()).toBe(400);
  const payload = (await acceptResponse.json()) as { error?: string };
  expect(String(payload.error ?? '')).toContain('Commander-valid');
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

async function createInvalidDeckWithoutCommander(
  request: APIRequestContext,
  token: string,
  seed: string,
): Promise<string> {
  const source = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: token,
    name: `Invalid Accept Source ${Date.now()}`,
    seed,
  });
  const exportResponse = await request.get(`${API_BASE_URL}/decks/${source.deckId}/export?format=moxfield`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exportPayload = (await exportResponse.json()) as { content?: string };
  const invalidDecklist = removeCommanderSection(String(exportPayload.content ?? ''));

  const createResponse = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      name: `Invalid Accept Deck ${Date.now()}`,
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as { deck: { id: string } };

  const importResponse = await request.post(`${API_BASE_URL}/decks/${createPayload.deck.id}/import`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      decklist: invalidDecklist,
    },
  });
  expect(importResponse.ok()).toBeTruthy();

  return createPayload.deck.id;
}

function removeCommanderSection(decklist: string): string {
  const lines = decklist.split(/\r?\n/);
  const output: string[] = [];
  let droppingCommanderBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = line.toLowerCase().replace(/:$/, '');

    if (normalized === 'commander' || normalized === 'commanders' || normalized === 'command zone') {
      droppingCommanderBlock = true;
      continue;
    }
    if (normalized === 'deck' || normalized === 'mainboard' || normalized === 'main') {
      droppingCommanderBlock = false;
      output.push('Deck');
      continue;
    }
    if (droppingCommanderBlock) {
      continue;
    }
    output.push(rawLine);
  }

  return output.join('\n').trim();
}
