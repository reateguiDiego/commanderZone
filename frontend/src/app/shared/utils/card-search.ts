import { Card } from '../../core/models/card.model';

const NON_LETTER_PATTERN = /[^a-zA-ZÀ-ÿ\s]/gu;
const DIACRITIC_PATTERN = /\p{Diacritic}/gu;

export function sanitizeCardSearchQuery(value: string): string {
  return value
    .replace(NON_LETTER_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trimStart();
}

export function normalizeCardSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITIC_PATTERN, '')
    .toLowerCase()
    .trim();
}

export function filterDistinctCardsByQuery(cards: Card[], query: string): Card[] {
  const normalizedQuery = normalizeCardSearch(query);
  const seen = new Set<string>();

  return cards
    .filter((card) => {
      if (!isSearchableCardResult(card)) {
        return false;
      }

      const haystack = normalizeCardSearch([
        card.name,
        card.printedName ?? '',
        card.flavorName ?? '',
      ].join(' '));
      if (!haystack.includes(normalizedQuery)) {
        return false;
      }

      const key = distinctCardKey(card);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => searchRank(left, normalizedQuery) - searchRank(right, normalizedQuery)
      || left.name.localeCompare(right.name));
}

export function distinctCardKey(card: Card): string {
  return normalizeCardSearch(card.name);
}

function isSearchableCardResult(card: Card): boolean {
  const typeLine = normalizeCardSearch(card.typeLine ?? '');

  return typeLine !== ''
    && typeLine !== 'other'
    && typeLine !== 'otros'
    && !/(^|\s)card(\s|$)/.test(typeLine);
}

function searchRank(card: Card, normalizedQuery: string): number {
  const normalizedName = normalizeCardSearch(card.name);

  return normalizedName.startsWith(normalizedQuery) ? 0 : 1;
}
