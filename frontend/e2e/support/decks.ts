import { expect, type APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

const SEARCH_PAGE_SIZE = 50;
const MAX_RANDOM_ATTEMPTS_MULTIPLIER = 40;

type DeckSection = 'commander' | 'main';

interface CardSearchItem {
  id: string;
  scryfallId: string;
  name: string;
  setCode?: string | null;
  collectorNumber?: string | null;
  typeLine?: string | null;
  colorIdentity?: string[];
  legalities?: Record<string, string>;
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
  setCode?: string;
  collectorNumber?: string;
}

export interface RandomDeckFromDatabaseResult {
  deckId: string;
  seed: string;
  commanderCardId?: string;
  cardIds: string[];
  cards: RandomDeckCardResult[];
}

export interface CommanderValidationIssue {
  code: string;
  title: string;
  detail: string;
  cards: string[];
}

export interface CommanderValidationPayload {
  valid: boolean;
  format: string;
  counts: {
    total: number;
    commander: number;
    main: number;
    sideboard: number;
    maybeboard: number;
  };
  commander: {
    mode: 'single' | 'pair' | 'invalid';
    names: string[];
    colorIdentity: string[];
  };
  errors: CommanderValidationIssue[];
  warnings: CommanderValidationIssue[];
}

export interface CreateValidCommanderDeckFromDatabaseOptions {
  ownerToken: string;
  name: string;
  seed?: string;
}

export interface ValidCommanderDeckFromDatabaseResult {
  deckId: string;
  seed: string;
  commander: {
    id: string;
    scryfallId: string;
    name: string;
    colorIdentity: string[];
  };
  cards: RandomDeckCardResult[];
  validation: CommanderValidationPayload;
  decklist: string;
}

type SearchFilter = {
  commanderLegal?: boolean;
};

export async function createRandomDeckFromDatabase(
  request: APIRequestContext,
  options: CreateRandomDeckFromDatabaseOptions,
): Promise<RandomDeckFromDatabaseResult> {
  // Technical helper for random stress/smoke scenarios.
  // It is intentionally not guaranteed to be Commander-valid.
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
      setCode: deckCard.card.setCode ?? undefined,
      collectorNumber: deckCard.card.collectorNumber ?? undefined,
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

export async function createValidCommanderDeckFromDatabase(
  request: APIRequestContext,
  options: CreateValidCommanderDeckFromDatabaseOptions,
): Promise<ValidCommanderDeckFromDatabaseResult> {
  const seed = normalizeSeed(options.seed);
  const random = mulberry32(hashStringToUint32(seed));
  const cache = new Map<string, CardSearchItem[]>();
  const commanderLegalCatalog = await fetchCommanderLegalCatalog(request, cache, 30);
  if (commanderLegalCatalog.length < 100) {
    throw new Error(
      `createValidCommanderDeckFromDatabase requires at least 100 commander-legal cards, found ${commanderLegalCatalog.length}.`,
    );
  }

  const commander = pickCommanderCandidateFromCatalog(commanderLegalCatalog, random);
  const mainboard = pickCommanderCompatibleMainboardFromCatalog(commanderLegalCatalog, commander, random, 99);

  const quickBuildPayload = {
    name: options.name,
    cards: [
      toQuickBuildInput(commander, 'commander'),
      ...mainboard.map((entry) => ({
        scryfallId: entry.card.scryfallId,
        quantity: entry.quantity,
        section: 'main' as const,
      })),
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
      `createValidCommanderDeckFromDatabase failed to resolve cards from local DB. Missing: ${firstMissing?.name ?? 'unknown'}`,
    );
  }

  const validationResponse = await request.post(`${API_BASE_URL}/decks/${quickBuild.deck.id}/validate-commander`, {
    headers: {
      Authorization: `Bearer ${options.ownerToken}`,
    },
  });
  expect(validationResponse.ok()).toBeTruthy();
  const validation = normalizeCommanderValidation(
    (await validationResponse.json()) as Record<string, unknown>,
    quickBuild.deck.cards,
    commander,
  );
  if (!validation.valid) {
    const firstError = validation.errors[0];
    throw new Error(
      `createValidCommanderDeckFromDatabase produced an invalid deck (${firstError?.code ?? 'unknown_error'}). Seed=${seed}`,
    );
  }

  const cardResults: RandomDeckCardResult[] = quickBuild.deck.cards
    .filter((deckCard) => deckCard.section === 'commander' || deckCard.section === 'main')
    .map((deckCard) => ({
      id: deckCard.card.id,
      name: deckCard.card.name,
      quantity: deckCard.quantity,
      role: deckCard.section === 'commander' ? 'commander' : 'mainboard',
      setCode: deckCard.card.setCode ?? undefined,
      collectorNumber: deckCard.card.collectorNumber ?? undefined,
    }));

  return {
    deckId: quickBuild.deck.id,
    seed,
    commander: {
      id: commander.id,
      scryfallId: commander.scryfallId,
      name: commander.name,
      colorIdentity: commander.colorIdentity ?? [],
    },
    cards: cardResults,
    validation,
    decklist: buildDecklist(cardResults),
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

function isCommanderCandidate(card: CardSearchItem): boolean {
  if (card.commanderLegal !== true) {
    return false;
  }

  const commanderLegality = (card.legalities?.['commander'] ?? '').toLowerCase();
  if (commanderLegality !== '' && commanderLegality !== 'legal') {
    return false;
  }

  return (card.typeLine ?? '').toLowerCase().includes('legendary');
}

async function fetchCommanderLegalCatalog(
  request: APIRequestContext,
  cache: Map<string, CardSearchItem[]>,
  maxPages: number,
): Promise<CardSearchItem[]> {
  const cards: CardSearchItem[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const pageCards = await fetchPage(request, { commanderLegal: true }, page, cache);
    if (pageCards.length === 0) {
      break;
    }

    cards.push(...pageCards);
    if (pageCards.length < SEARCH_PAGE_SIZE) {
      break;
    }
  }

  return cards;
}

function pickCommanderCandidateFromCatalog(cards: CardSearchItem[], random: () => number): CardSearchItem {
  const commanders = cards.filter((card) => isCommanderCandidate(card));
  if (commanders.length === 0) {
    throw new Error('createValidCommanderDeckFromDatabase could not find a legendary commander candidate.');
  }

  const sorted = commanders
    .slice()
    .sort((left, right) => (right.colorIdentity?.length ?? 0) - (left.colorIdentity?.length ?? 0));
  const topWindow = sorted.slice(0, Math.min(20, sorted.length));
  return topWindow[Math.floor(random() * topWindow.length)]!;
}

function pickCommanderCompatibleMainboardFromCatalog(
  cards: CardSearchItem[],
  commander: CardSearchItem,
  random: () => number,
  targetCount: number,
): Array<{ card: CardSearchItem; quantity: number }> {
  const commanderColors = new Set(commander.colorIdentity ?? []);
  const compatible = cards.filter((card) => isCommanderMainboardCompatible(card, commander, commanderColors));
  const shuffled = stableShuffle(compatible, random);
  const selected = new Map<string, { card: CardSearchItem; quantity: number }>();
  const selectedNames = new Set<string>([normalizeCardName(commander.name)]);
  let fallbackBasic: CardSearchItem | null = null;

  for (const candidate of shuffled) {
    if (totalQuantity(selected) >= targetCount) {
      break;
    }

    const nameKey = normalizeCardName(candidate.name);
    const isBasic = isBasicLand(candidate);
    if (!isBasic && selectedNames.has(nameKey)) {
      continue;
    }

    if (selected.has(candidate.scryfallId)) {
      if (!isBasic) {
        continue;
      }
      const existing = selected.get(candidate.scryfallId);
      if (existing) {
        existing.quantity += 1;
      }
      fallbackBasic = candidate;
      continue;
    }

    selected.set(candidate.scryfallId, { card: candidate, quantity: 1 });
    selectedNames.add(nameKey);
    if (isBasic) {
      fallbackBasic = candidate;
    }
  }

  const missing = targetCount - totalQuantity(selected);
  if (missing > 0) {
    if (!fallbackBasic) {
      throw new Error(
        `createValidCommanderDeckFromDatabase could not complete mainboard: missing ${missing} cards and no compatible basic land found.`,
      );
    }

    const existing = selected.get(fallbackBasic.scryfallId);
    if (existing) {
      existing.quantity += missing;
    } else {
      selected.set(fallbackBasic.scryfallId, { card: fallbackBasic, quantity: missing });
    }
  }

  if (totalQuantity(selected) !== targetCount) {
    throw new Error(`createValidCommanderDeckFromDatabase failed to build a ${targetCount}-card mainboard.`);
  }

  return [...selected.values()];
}

function isCommanderMainboardCompatible(
  card: CardSearchItem,
  commander: CardSearchItem,
  commanderColors: Set<string>,
): boolean {
  if (card.scryfallId === commander.scryfallId) {
    return false;
  }
  if (card.commanderLegal !== true) {
    return false;
  }

  const commanderLegality = (card.legalities?.['commander'] ?? '').toLowerCase();
  if (commanderLegality !== '' && commanderLegality !== 'legal') {
    return false;
  }

  const cardColors = card.colorIdentity ?? [];
  if (commanderColors.size === 0) {
    return cardColors.length === 0;
  }

  return cardColors.every((color) => commanderColors.has(color));
}

function isBasicLand(card: CardSearchItem): boolean {
  return (card.typeLine ?? '').toLowerCase().includes('basic');
}

function normalizeCardName(name: string): string {
  return name.trim().toLowerCase();
}

function totalQuantity(entries: Map<string, { card: CardSearchItem; quantity: number }>): number {
  let total = 0;
  for (const entry of entries.values()) {
    total += entry.quantity;
  }

  return total;
}

function buildDecklist(cards: RandomDeckCardResult[]): string {
  const commanders = cards
    .filter((card) => card.role === 'commander')
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const mainboard = cards
    .filter((card) => card.role === 'mainboard')
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const lines: string[] = [];

  if (commanders.length > 0) {
    lines.push('Commander');
    lines.push(...commanders.map((card) => decklistLine(card)));
    lines.push('');
  }

  lines.push('Deck');
  lines.push(...mainboard.map((card) => decklistLine(card)));

  return lines.join('\n').trim();
}

function decklistLine(card: RandomDeckCardResult): string {
  const print = card.setCode && card.collectorNumber
    ? ` (${card.setCode.toUpperCase()}) ${card.collectorNumber}`
    : '';

  return `${card.quantity} ${card.name}${print}`;
}

function stableShuffle<T>(items: T[], random: () => number): T[] {
  const clone = items.slice();
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = clone[index];
    clone[index] = clone[swapIndex]!;
    clone[swapIndex] = current!;
  }

  return clone;
}

function normalizeCommanderValidation(
  raw: Record<string, unknown>,
  quickBuildCards: QuickBuildDeckCardPayload[],
  commander: CardSearchItem,
): CommanderValidationPayload {
  const valid = raw['valid'] === true;
  const typedCounts = raw['counts'];
  const counts = (
    typeof typedCounts === 'object'
    && typedCounts !== null
    && typeof (typedCounts as Record<string, unknown>)['total'] === 'number'
  )
    ? typedCounts as CommanderValidationPayload['counts']
    : deriveCountsFromQuickBuild(quickBuildCards);

  const typedCommander = raw['commander'];
  const commanderInfo = (
    typeof typedCommander === 'object'
    && typedCommander !== null
    && Array.isArray((typedCommander as Record<string, unknown>)['names'])
  )
    ? typedCommander as CommanderValidationPayload['commander']
    : {
      mode: 'single' as const,
      names: [commander.name],
      colorIdentity: commander.colorIdentity ?? [],
    };

  const errors = Array.isArray(raw['errors']) ? raw['errors'] : [];
  const warnings = Array.isArray(raw['warnings']) ? raw['warnings'] : [];

  return {
    valid,
    format: typeof raw['format'] === 'string' ? raw['format'] : 'commander',
    counts,
    commander: commanderInfo,
    errors: errors.filter(isValidationIssueLike).map(toValidationIssue),
    warnings: warnings.filter(isValidationIssueLike).map(toValidationIssue),
  };
}

function isValidationIssueLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['title'] === 'string';
}

function toValidationIssue(value: Record<string, unknown>): CommanderValidationIssue {
  return {
    code: typeof value['code'] === 'string' ? value['code'] : 'unknown',
    title: typeof value['title'] === 'string' ? value['title'] : 'Unknown validation issue',
    detail: typeof value['detail'] === 'string' ? value['detail'] : '',
    cards: Array.isArray(value['cards']) ? value['cards'].filter((card): card is string => typeof card === 'string') : [],
  };
}

function deriveCountsFromQuickBuild(cards: QuickBuildDeckCardPayload[]): CommanderValidationPayload['counts'] {
  let commander = 0;
  let main = 0;
  let sideboard = 0;
  let maybeboard = 0;

  for (const card of cards) {
    const quantity = Number.isFinite(card.quantity) ? card.quantity : 1;
    if (card.section === 'commander') {
      commander += quantity;
      continue;
    }
    if (card.section === 'main') {
      main += quantity;
      continue;
    }
    if (card.section === 'sideboard') {
      sideboard += quantity;
      continue;
    }
    if (card.section === 'maybeboard') {
      maybeboard += quantity;
    }
  }

  return {
    total: commander + main,
    commander,
    main,
    sideboard,
    maybeboard,
  };
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
