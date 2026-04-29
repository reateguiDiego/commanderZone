import { TestBed } from '@angular/core/testing';
import { Card } from '../../../core/models/card.model';
import { Deck } from '../../../core/models/deck.model';
import { DeckHistoryStore } from './deck-history.store';

describe('DeckHistoryStore', () => {
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

  it('keeps only the latest twenty history entries', () => {
    const store = TestBed.inject(DeckHistoryStore);

    for (let index = 1; index <= 21; index += 1) {
      store.record(sampleDeck('Deck', index), `Snapshot ${index}`);
    }

    const entries = store.list('deck-1');
    expect(entries.length).toBe(20);
    expect(entries[0].source).toBe('Snapshot 21');
    expect(entries.at(-1)?.source).toBe('Snapshot 2');
  });
});

function sampleDeck(name: string, quantity: number): Deck {
  return {
    id: 'deck-1',
    name,
    format: 'commander',
    folderId: null,
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
