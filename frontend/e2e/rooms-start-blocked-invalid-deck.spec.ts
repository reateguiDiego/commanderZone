import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';
import { createValidCommanderDeckFromDatabase } from './support/decks';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

interface RoomStartErrorPayload {
  error: string;
  invalidDecks?: Array<{
    playerId: string;
    deckId: string | null;
    validation?: {
      valid: boolean;
      errors?: Array<{ code?: string; title?: string; detail?: string }>;
    };
  }>;
}

test('room start is blocked when any participant deck is Commander-invalid', async ({ request }) => {
  test.setTimeout(120_000);

  const owner = await createRealUserSession(request, 'rooms-start-blocked-owner');
  const guest = await createRealUserSession(request, 'rooms-start-blocked-guest');

  const ownerValidSource = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: owner.token,
    name: `Start Block Source ${Date.now()}`,
    seed: 'e2e-rooms-start-blocked-source-seed',
  });
  expect(ownerValidSource.validation.valid).toBeTruthy();

  const exportResponse = await request.get(`${API_BASE_URL}/decks/${ownerValidSource.deckId}/export?format=moxfield`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exportPayload = (await exportResponse.json()) as { content?: string };
  const invalidDecklist = removeCommanderSection(String(exportPayload.content ?? ''));
  expect(invalidDecklist.toLowerCase()).not.toContain('commander');

  const ownerInvalidDeckId = await createDeckAndImportDecklist(
    request,
    owner.token,
    `Owner Invalid ${Date.now()}`,
    invalidDecklist,
  );

  const ownerValidationResponse = await request.post(`${API_BASE_URL}/decks/${ownerInvalidDeckId}/validate-commander`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(ownerValidationResponse.ok()).toBeTruthy();
  const ownerValidation = (await ownerValidationResponse.json()) as { valid: boolean };
  expect(ownerValidation.valid).toBeFalsy();

  const guestValidDeck = await createValidCommanderDeckFromDatabase(request, {
    ownerToken: guest.token,
    name: `Guest Valid ${Date.now()}`,
    seed: 'e2e-rooms-start-blocked-guest-seed',
  });
  expect(guestValidDeck.validation.valid).toBeTruthy();

  const roomId = await createRoom(request, owner.token, ownerInvalidDeckId);
  await joinRoom(request, guest.token, roomId, guestValidDeck.deckId);

  const startResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(startResponse.status()).toBe(400);

  const startPayload = (await startResponse.json()) as RoomStartErrorPayload;
  expect(startPayload.invalidDecks?.length ?? 0).toBeGreaterThan(0);
  expect(startPayload.invalidDecks?.some((entry) => entry.deckId === ownerInvalidDeckId)).toBeTruthy();
});

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

async function createDeckAndImportDecklist(
  request: APIRequestContext,
  token: string,
  name: string,
  decklist: string,
): Promise<string> {
  const createResponse = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      name,
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as { deck: { id: string } };

  const importResponse = await request.post(`${API_BASE_URL}/decks/${createPayload.deck.id}/import`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      decklist,
    },
  });
  expect(importResponse.ok()).toBeTruthy();

  return createPayload.deck.id;
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

async function joinRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
  deckId: string,
): Promise<void> {
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
