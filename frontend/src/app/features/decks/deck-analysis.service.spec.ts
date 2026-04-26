import { TestBed } from '@angular/core/testing';
import { Card } from '../../core/models/card.model';
import { Deck } from '../../core/models/deck.model';
import { DeckAnalysisService } from './deck-analysis.service';

describe('DeckAnalysisService', () => {
  let service: DeckAnalysisService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeckAnalysisService);
  });

  it('calculates curve, pips, lands and role heuristics', () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Deck',
      format: 'commander',
      folderId: null,
      cards: [
        entry(1, 'commander', card('Commander', 'Legendary Creature', '{1}{G}', 'Draw a card.')),
        entry(10, 'main', card('Forest', 'Basic Land - Forest', null, null)),
        entry(1, 'main', card('Command Tower', 'Land', null, 'Add one mana of any color.')),
        entry(1, 'main', card('Cultivate', 'Sorcery', '{2}{G}', 'Search your library for a basic land card.')),
        entry(1, 'main', card('Swords to Plowshares', 'Instant', '{W}', 'Exile target creature.')),
        entry(1, 'main', card('Wrath of God', 'Sorcery', '{2}{W}{W}', 'Destroy all creatures.')),
      ],
    };

    const analysis = service.analyze(deck);

    expect(analysis.mainDeckCards).toBe(14);
    expect(analysis.landCount).toBe(11);
    expect(analysis.landTypes.find((land) => land.label === 'Forest')?.count).toBe(10);
    expect(analysis.colorPips['G']).toBe(1);
    expect(analysis.colorPips['W']).toBe(3);
    expect(analysis.manaCurve.find((bucket) => bucket.manaValue === 3)?.spells).toBe(1);
    expect(analysis.ramp.cards).toContain('Cultivate');
    expect(analysis.ramp.cards).not.toContain('Command Tower');
    expect(analysis.draw.cards).toHaveLength(0);
    expect(analysis.removal.cards).toContain('Swords to Plowshares');
    expect(analysis.wipes.cards).toContain('Wrath of God');
    expect(analysis.creatures.cards).toHaveLength(0);
    expect(analysis.instants.cards).toContain('Swords to Plowshares');
  });
});

function entry(quantity: number, section: 'main' | 'commander', cardValue: Card) {
  return { id: `${cardValue.name}-${section}`, quantity, section, card: cardValue };
}

function card(name: string, typeLine: string, manaCost: string | null, oracleText: string | null): Card {
  return {
    id: name,
    scryfallId: name,
    name,
    manaCost,
    typeLine,
    oracleText,
    colors: [],
    colorIdentity: manaCost?.includes('G') ? ['G'] : manaCost?.includes('W') ? ['W'] : [],
    legalities: { commander: 'legal' },
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
