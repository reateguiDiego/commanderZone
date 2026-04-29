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

  return cards.filter((card) => {
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
  });
}

export function distinctCardKey(card: Card): string {
  return [
    normalizeCardSearch(card.name),
    normalizeCardSearch(card.typeLine ?? ''),
    normalizeCardSearch(card.manaCost ?? ''),
    card.set ?? '',
    card.collectorNumber ?? '',
  ].join('|');
}
