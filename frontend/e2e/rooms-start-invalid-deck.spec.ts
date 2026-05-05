import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRealUserSession } from './support/auth';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const SEARCH_PAGE_LIMIT = 50;

interface CardPayload {
  scryfallId: string;
  name: string;
  typeLine: string | null;
  colorIdentity: string[];
}

interface DeckValidationPayload {
  valid: boolean;
}

test('room start is blocked when one player deck is Commander-invalid', async ({ request }) => {
  test.setTimeout(120_000);

  const owner = await createRealUserSession(request, 'start-gate-owner');
  const guest = await createRealUserSession(request, 'start-gate-guest');
  const commanderLegalCards = await fetchCommanderLegalCards(request);

  const validOwnerDeckId = await createDeterministicValidCommanderDeck(
    request,
    commanderLegalCards,
    owner.token,
    `Owner Valid ${Date.now()}`,
  );
  const invalidGuestDeckId = await createIntentionallyInvalidDeck(
    commanderLegalCards,
    request,
    guest.token,
    `Guest Invalid ${Date.now()}`,
  );

  const roomId = await createRoom(request, owner.token, validOwnerDeckId);
  const invalidJoinResponse = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, {
    headers: {
      Authorization: `Bearer ${guest.token}`,
    },
    data: {
      deckId: invalidGuestDeckId,
    },
  });
  expect(invalidJoinResponse.ok()).toBeFalsy();
  expect(invalidJoinResponse.status()).toBe(400);
  const startAttempt = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(startAttempt.ok()).toBeFalsy();
  expect(startAttempt.status()).toBe(400);

  const roomAfterStartAttempt = await getRoom(request, owner.token, roomId);
  expect(roomAfterStartAttempt.room.status).toBe('waiting');
  expect(roomAfterStartAttempt.room.gameId ?? null).toBeNull();
});

async function createDeterministicValidCommanderDeck(
  request: APIRequestContext,
  commanderLegalCards: CardPayload[],
  ownerToken: string,
  name: string,
): Promise<string> {
  const commander = pickCommanderCandidate(commanderLegalCards);
  const mainboard = pickMainboardCards(commanderLegalCards, commander, 99);
  const deckId = await quickBuildDeck(request, ownerToken, name, [
    { scryfallId: commander.scryfallId, quantity: 1, section: 'commander' },
    ...mainboard.map((card) => ({ scryfallId: card.scryfallId, quantity: 1, section: 'main' as const })),
  ]);

  const validationResponse = await request.post(`${API_BASE_URL}/decks/${deckId}/validate-commander`, {
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
  });
  expect(validationResponse.ok()).toBeTruthy();
  const validation = (await validationResponse.json()) as DeckValidationPayload;
  expect(validation.valid).toBeTruthy();

  return deckId;
}

async function createIntentionallyInvalidDeck(
  commanderLegalCards: CardPayload[],
  request: APIRequestContext,
  ownerToken: string,
  name: string,
): Promise<string> {
  const fallback = commanderLegalCards[0];
  if (!fallback) {
    throw new Error('Could not load any cards from the local card database.');
  }

  return quickBuildDeck(request, ownerToken, name, [
    { scryfallId: fallback.scryfallId, quantity: 1, section: 'main' },
  ]);
}

async function fetchCommanderLegalCards(request: APIRequestContext): Promise<CardPayload[]> {
  const cards: CardPayload[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await request.get(`${API_BASE_URL}/cards/search?${new URLSearchParams({
      commanderLegal: 'true',
      page: String(page),
      limit: String(SEARCH_PAGE_LIMIT),
    }).toString()}`);
    expect(response.ok()).toBeTruthy();

    const payload = (await response.json()) as { data: CardPayload[] };
    const pageCards = payload.data ?? [];
    if (pageCards.length === 0) {
      break;
    }
    cards.push(...pageCards);
    if (pageCards.length < SEARCH_PAGE_LIMIT) {
      break;
    }
  }

  return cards;
}

function pickCommanderCandidate(cards: CardPayload[]): CardPayload {
  const legendaryCards = cards.filter((card) => (card.typeLine ?? '').toLowerCase().includes('legendary'));
  if (legendaryCards.length === 0) {
    throw new Error('Could not find any legendary commander candidate in local card data.');
  }

  const fiveColor = legendaryCards.find((card) => card.colorIdentity.length === 5);
  if (fiveColor) {
    return fiveColor;
  }

  return legendaryCards.sort((left, right) => right.colorIdentity.length - left.colorIdentity.length)[0]!;
}

function pickMainboardCards(cards: CardPayload[], commander: CardPayload, count: number): CardPayload[] {
  const allowedColors = new Set(commander.colorIdentity);
  const selected: CardPayload[] = [];
  const seenNames = new Set<string>([commander.name.trim().toLowerCase()]);

  for (const card of cards) {
    if (card.scryfallId === commander.scryfallId) {
      continue;
    }
    const nameKey = card.name.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    if (!card.colorIdentity.every((color) => allowedColors.has(color))) {
      continue;
    }

    selected.push(card);
    seenNames.add(nameKey);
    if (selected.length === count) {
      return selected;
    }
  }

  throw new Error(`Could not collect ${count} unique mainboard cards compatible with selected commander identity.`);
}

async function quickBuildDeck(
  request: APIRequestContext,
  ownerToken: string,
  name: string,
  cards: Array<{ scryfallId: string; quantity: number; section: 'commander' | 'main' }>,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
    data: {
      name,
      cards,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { deck: { id: string } };

  return payload.deck.id;
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

async function getRoom(
  request: APIRequestContext,
  token: string,
  roomId: string,
): Promise<{ room: { status: string; gameId: string | null } }> {
  const response = await request.get(`${API_BASE_URL}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { room: { status: string; gameId: string | null } };
}
