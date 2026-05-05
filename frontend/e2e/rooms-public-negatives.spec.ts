import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test('public room negatives: no deck join denied, invalid deck join denied, non-owner start denied, valid join allowed', async ({ request }) => {
  test.setTimeout(180_000);

  const owner = await createRealUserSession(request, 'public-neg-owner');
  const invalidJoiner = await createRealUserSession(request, 'public-neg-invalid');
  const validJoiner = await createRealUserSession(request, 'public-neg-valid');

  const ownerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Public Neg Owner ${Date.now()}`,
    seed: 'e2e-public-neg-owner-seed',
  });
  const validJoinerDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: validJoiner.token,
    name: `Public Neg Valid ${Date.now()}`,
    seed: 'e2e-public-neg-valid-seed',
  });
  const invalidJoinerDeckId = await createInvalidDeckWithoutCommander(request, invalidJoiner.token, 'public-neg-invalid-seed');

  const roomId = await createRoom(request, owner.token, ownerDeck.deckId);

  const joinWithoutDeckResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${invalidJoiner.token}`,
    },
    data: {},
  });
  expect(joinWithoutDeckResponse.status()).toBe(400);

  const joinWithInvalidDeckResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${invalidJoiner.token}`,
    },
    data: {
      deckId: invalidJoinerDeckId,
    },
  });
  expect(joinWithInvalidDeckResponse.status()).toBe(400);
  const invalidJoinPayload = (await joinWithInvalidDeckResponse.json()) as { error: string };
  expect(invalidJoinPayload.error).toContain('Commander-valid');

  const joinWithValidDeckResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${validJoiner.token}`,
    },
    data: {
      deckId: validJoinerDeck.deckId,
    },
  });
  expect(joinWithValidDeckResponse.ok()).toBeTruthy();

  const nonOwnerStartResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${validJoiner.token}`,
    },
  });
  expect(nonOwnerStartResponse.status()).toBe(403);
}
);

async function createInvalidDeckWithoutCommander(
  request: APIRequestContext,
  token: string,
  seed: string,
): Promise<string> {
  const source = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: token,
    name: `Invalid Source ${Date.now()}`,
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
      name: `Invalid Deck ${Date.now()}`,
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

async function createRoom(
  request: APIRequestContext,
  token: string,
  deckId: string,
): Promise<string> {
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
