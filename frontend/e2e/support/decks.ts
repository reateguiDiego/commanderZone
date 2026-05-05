import { expect, type APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

const SEARCH_PAGE_SIZE = 50;
const MAX_RANDOM_ATTEMPTS_MULTIPLIER = 40;

type DeckSection = 'commander' | 'main';

interface CardSearchItem {
  id: string;
  scryfallId: string;
  name: string;
  commanderLegal?: boolean;
}

interface CardSearchResponse {
  data: CardSearchItem[];
  page: number;
  limit: number;
}

interface QuickBuildDeckCardPayload {
  id: string;
  quantity: number;
  section: string;
  card: CardSearchItem;
}

interface QuickBuildResponse {
  deck: {
    id: string;
    cards: QuickBuildDeckCardPayload[];
  };
  missingCards?: Array<{ name: string; reason?: string }>;
}

export interface CreateRandomDeckFromDatabaseOptions {
  ownerToken: string;
  name: string;
  size?: number;
  seed?: string;
}

export interface RandomDeckCardResult {
  id: string;
  name: string;
  quantity: number;
  role: 'commander' | 'mainboard';
}

export interface RandomDeckFromDatabaseResult {
  deckId: string;
  seed: string;
  commanderCardId?: string;
  cardIds: string[];
  cards: RandomDeckCardResult[];
}

type SearchFilter = {
  commanderLegal?: boolean;
};

export async function createRandomDeckFromDatabase(
  request: APIRequestContext,
  options: CreateRandomDeckFromDatabaseOptions,
): Promise<RandomDeckFromDatabaseResult> {
  const size = options.size ?? 100;
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`createRandomDeckFromDatabase requires size >= 2, received: ${String(size)}`);
  }

  const seed = normalizeSeed(options.seed);
  const random = mulberry32(hashStringToUint32(seed));
  const cache = new Map<string, CardSearchItem[]>();

  const commanderLegalCount = await countCards(request, { commanderLegal: true }, cache);
  const commander = await pickSingleCard({
    request,
    random,
    cache,
    filter: commanderLegalCount > 0 ? { commanderLegal: true } : {},
  });

  const mainCards = await pickUniqueCards({
    request,
    random,
    cache,
    filter: {},
    count: size - 1,
    excludeCardIds: new Set([commander.id]),
  });

  const quickBuildPayload = {
    name: options.name,
    cards: [
      toQuickBuildInput(commander, 'commander'),
      ...mainCards.map((card) => toQuickBuildInput(card, 'main')),
    ],
  };

  const quickBuildResponse = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: {
      Authorization: `Bearer ${options.ownerToken}`,
    },
    data: quickBuildPayload,
  });
  expect(quickBuildResponse.ok()).toBeTruthy();

  const quickBuild = (await quickBuildResponse.json()) as QuickBuildResponse;
  const missing = quickBuild.missingCards ?? [];
  if (missing.length > 0) {
    const firstMissing = missing[0];
    throw new Error(
      `createRandomDeckFromDatabase failed to resolve cards from local DB. Missing: ${firstMissing?.name ?? 'unknown'}`,
    );
  }

  const deckCards = quickBuild.deck.cards;
  const cardResults: RandomDeckCardResult[] = deckCards
    .filter((deckCard) => deckCard.section === 'commander' || deckCard.section === 'main')
    .map((deckCard) => ({
      id: deckCard.card.id,
      name: deckCard.card.name,
      quantity: deckCard.quantity,
      role: deckCard.section === 'commander' ? 'commander' : 'mainboard',
    }));

  const commanderResult = cardResults.find((card) => card.role === 'commander');

  return {
    deckId: quickBuild.deck.id,
    seed,
    commanderCardId: commanderResult?.id,
    cardIds: cardResults.map((card) => card.id),
    cards: cardResults,
  };
}

function toQuickBuildInput(card: CardSearchItem, section: DeckSection): { scryfallId: string; quantity: number; section: DeckSection } {
  return {
    scryfallId: card.scryfallId,
    quantity: 1,
    section,
  };
}

async function pickSingleCard(params: {
  request: APIRequestContext;
  random: () => number;
  cache: Map<string, CardSearchItem[]>;
  filter: SearchFilter;
}): Promise<CardSearchItem> {
  const total = await countCards(params.request, params.filter, params.cache);
  if (total < 1) {
    throw new Error('createRandomDeckFromDatabase cannot continue: no cards available in local database for commander selection.');
  }

  const index = Math.floor(params.random() * total);
  return fetchCardAtIndex(params.request, params.filter, index, params.cache);
}

async function pickUniqueCards(params: {
  request: APIRequestContext;
  random: () => number;
  cache: Map<string, CardSearchItem[]>;
  filter: SearchFilter;
  count: number;
  excludeCardIds: Set<string>;
}): Promise<CardSearchItem[]> {
  const total = await countCards(params.request, params.filter, params.cache);
  if (total < params.count + params.excludeCardIds.size) {
    throw new Error(
      `createRandomDeckFromDatabase requires at least ${params.count + params.excludeCardIds.size} cards but only found ${total}.`,
    );
  }

  const picked = new Map<string, CardSearchItem>();
  const maxAttempts = Math.max(200, params.count * MAX_RANDOM_ATTEMPTS_MULTIPLIER);

  for (let attempts = 0; attempts < maxAttempts && picked.size < params.count; attempts += 1) {
    const randomIndex = Math.floor(params.random() * total);
    const candidate = await fetchCardAtIndex(params.request, params.filter, randomIndex, params.cache);
    if (params.excludeCardIds.has(candidate.id)) {
      continue;
    }

    picked.set(candidate.id, candidate);
  }

  if (picked.size < params.count) {
    throw new Error(
      `createRandomDeckFromDatabase could not collect ${params.count} unique cards after ${maxAttempts} attempts (picked ${picked.size}).`,
    );
  }

  return [...picked.values()];
}

async function fetchCardAtIndex(
  request: APIRequestContext,
  filter: SearchFilter,
  index: number,
  cache: Map<string, CardSearchItem[]>,
): Promise<CardSearchItem> {
  const page = Math.floor(index / SEARCH_PAGE_SIZE) + 1;
  const indexInPage = index % SEARCH_PAGE_SIZE;
  const cards = await fetchPage(request, filter, page, cache);
  const card = cards[indexInPage];

  if (!card) {
    throw new Error(`Card index ${index} (page ${page}, slot ${indexInPage}) is out of bounds.`);
  }

  return card;
}

async function countCards(
  request: APIRequestContext,
  filter: SearchFilter,
  cache: Map<string, CardSearchItem[]>,
): Promise<number> {
  const firstPage = await fetchPage(request, filter, 1, cache);
  if (firstPage.length === 0) {
    return 0;
  }

  let low = 1;
  let high = 1;
  while (true) {
    const cards = await fetchPage(request, filter, high, cache);
    if (cards.length === 0) {
      break;
    }

    low = high;
    high *= 2;
  }

  let left = low;
  let right = high - 1;
  while (left < right) {
    const mid = Math.floor((left + right + 1) / 2);
    const cards = await fetchPage(request, filter, mid, cache);
    if (cards.length > 0) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  const lastPageCards = await fetchPage(request, filter, left, cache);
  return (left - 1) * SEARCH_PAGE_SIZE + lastPageCards.length;
}

async function fetchPage(
  request: APIRequestContext,
  filter: SearchFilter,
  page: number,
  cache: Map<string, CardSearchItem[]>,
): Promise<CardSearchItem[]> {
  const cacheKey = `${filter.commanderLegal === true ? 'commander' : 'all'}:${page}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    page: String(page),
    limit: String(SEARCH_PAGE_SIZE),
  });
  if (filter.commanderLegal === true) {
    params.set('commanderLegal', 'true');
  }

  const response = await request.get(`${API_BASE_URL}/cards/search?${params.toString()}`);
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as CardSearchResponse;
  const cards = payload.data ?? [];
  cache.set(cacheKey, cards);

  return cards;
}

function normalizeSeed(inputSeed?: string): string {
  if (typeof inputSeed === 'string' && inputSeed.trim() !== '') {
    return inputSeed.trim();
  }

  return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashStringToUint32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
