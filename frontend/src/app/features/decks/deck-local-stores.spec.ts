import { TestBed } from '@angular/core/testing';
import { Card } from '../../core/models/card.model';
import { Deck } from '../../core/models/deck.model';
import { DeckHistoryStore } from './deck-history.store';
import { MissingCardsStore } from './missing-cards.store';

describe('deck local stores', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('stores deck history entries with a restorable decklist', () => {
    const store = TestBed.inject(DeckHistoryStore);
    const deck = sampleDeck('Deck', 1);

    store.record(deck, 'Import plain');

    const entries = store.list(deck.id);
    expect(entries.length).toBe(1);
    expect(entries[0].decklist).toContain('1 Sol Ring');
  });

  it('stores and ignores missing card watchlist entries', () => {
    const store = TestBed.inject(MissingCardsStore);

    store.add('Unknown Card', 'deck-1');
    store.ignoreForSession('Ignored Card');

    expect(store.isWatched('unknown card')).toBe(true);
    expect(store.isIgnored('ignored card')).toBe(true);
    expect(store.watchlist()[0].name).toBe('Unknown Card');
  });
});

function sampleDeck(name: string, quantity: number): Deck {
  return {
    id: 'deck-1',
    name,
    format: 'commander',
    cards: [{ id: 'dc-1', quantity, section: 'main', card: card('Sol Ring') }],
  };
}

function card(name: string): Card {
  return {
    id: name,
    scryfallId: name,
    name,
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: 'Add one mana of any color.',
    colors: [],
    colorIdentity: [],
    legalities: { commander: 'legal' },
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
