import { Card } from '../../core/models/card.model';
import { Deck } from '../../core/models/deck.model';

const COMMANDER_COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

export function primaryCommander(deck: Deck | null | undefined): Card | null {
  return deckCommanders(deck)[0] ?? null;
}

export function secondaryCommander(deck: Deck | null | undefined): Card | null {
  return deckCommanders(deck)[1] ?? null;
}

export function commanderNames(deck: Deck | null | undefined): string[] {
  return deckCommanders(deck)
    .map((card) => card.name.trim())
    .filter((name) => name.length > 0);
}

export function commanderColorIdentityUnion(deck: Deck | null | undefined): string[] {
  const seen = new Set<string>();

  for (const commander of deckCommanders(deck)) {
    for (const color of commander.colorIdentity ?? []) {
      const normalizedColor = typeof color === 'string' ? color.trim().toUpperCase() : '';
      if (normalizedColor !== '') {
        seen.add(normalizedColor);
      }
    }
  }

  const orderedColors = COMMANDER_COLOR_ORDER.filter((color) => seen.has(color));
  const extraColors = Array.from(seen)
    .filter((color) => !COMMANDER_COLOR_ORDER.includes(color as typeof COMMANDER_COLOR_ORDER[number]))
    .sort();

  return [...orderedColors, ...extraColors];
}

export function deckCommanders(deck: Deck | null | undefined): Card[] {
  if (!deck) {
    return [];
  }

  const commanders = (deck.commanders ?? []).filter(isDeckCardPayload);
  if (commanders.length > 0) {
    return commanders;
  }

  if (Array.isArray(deck.cards) && deck.cards.length > 0) {
    const commandersFromCards = deck.cards
      .filter((entry) => entry.section === 'commander')
      .map((entry) => entry.card)
      .filter(isDeckCardPayload);

    if (commandersFromCards.length > 0) {
      return commandersFromCards;
    }
  }

  return [];
}

function isDeckCardPayload(card: Card | null | undefined): card is Card {
  return !!card && typeof card.name === 'string' && typeof card.scryfallId === 'string';
}
