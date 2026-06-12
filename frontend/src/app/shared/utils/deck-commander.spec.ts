import { Card } from '../../core/models/card.model';
import { Deck } from '../../core/models/deck.model';
import { commanderColorIdentityUnion, commanderNames, deckCommanders, primaryCommander, secondaryCommander } from './deck-commander';

describe('deck commander helpers', () => {
  it('resolves the primary commander from the commanders array', () => {
    const deck = deckFixture({
      commanders: [
        cardFixture('commander-1', 'First Commander', ['W']),
        cardFixture('commander-2', 'Second Commander', ['U']),
      ],
    });

    expect(primaryCommander(deck)?.scryfallId).toBe('commander-1');
  });

  it('returns commander names in order', () => {
    const deck = deckFixture({
      commanders: [
        cardFixture('commander-1', 'First Commander', ['W']),
        cardFixture('commander-2', 'Second Commander', ['U']),
      ],
    });

    expect(commanderNames(deck)).toEqual(['First Commander', 'Second Commander']);
  });

  it('returns both commanders and exposes the secondary commander', () => {
    const deck = deckFixture({
      commanders: [
        cardFixture('commander-1', 'First Commander', ['W']),
        cardFixture('commander-2', 'Second Commander', ['U']),
      ],
    });

    expect(deckCommanders(deck).map((card) => card.scryfallId)).toEqual(['commander-1', 'commander-2']);
    expect(secondaryCommander(deck)?.scryfallId).toBe('commander-2');
  });

  it('falls back to commander cards inside deck.cards when commanders is absent', () => {
    const firstCommander = cardFixture('commander-1', 'First Commander', ['W']);
    const secondCommander = cardFixture('commander-2', 'Second Commander', ['U']);
    const deck = deckFixture({
      cards: [
        { id: 'line-1', quantity: 1, section: 'commander', card: firstCommander },
        { id: 'line-2', quantity: 1, section: 'commander', card: secondCommander },
      ],
    });

    expect(deckCommanders(deck).map((card) => card.scryfallId)).toEqual(['commander-1', 'commander-2']);
    expect(primaryCommander(deck)?.scryfallId).toBe('commander-1');
    expect(secondaryCommander(deck)?.scryfallId).toBe('commander-2');
  });

  it('returns the combined commander color identity in canonical order', () => {
    const deck = deckFixture({
      commanders: [
        cardFixture('commander-1', 'First Commander', ['G', 'W']),
        cardFixture('commander-2', 'Second Commander', ['B', 'U']),
      ],
    });

    expect(commanderColorIdentityUnion(deck)).toEqual(['W', 'U', 'B', 'G']);
  });

  it('returns an empty color identity when the deck has no commanders', () => {
    expect(commanderColorIdentityUnion(deckFixture())).toEqual([]);
    expect(commanderNames(deckFixture())).toEqual([]);
    expect(primaryCommander(deckFixture())).toBeNull();
  });
});

function deckFixture(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    folderId: null,
    commanders: [],
    ...overrides,
  };
}

function cardFixture(scryfallId: string, name: string, colorIdentity: string[]): Card {
  return {
    id: `card-${scryfallId}`,
    scryfallId,
    name,
    imageUris: {},
    colors: [],
    colorIdentity,
    manaCost: null,
    typeLine: '',
    oracleText: '',
    legalities: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
