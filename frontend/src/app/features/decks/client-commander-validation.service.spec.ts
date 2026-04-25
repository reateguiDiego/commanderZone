import { TestBed } from '@angular/core/testing';
import { Card } from '../../core/models/card.model';
import { Deck } from '../../core/models/deck.model';
import { ClientCommanderValidationService } from './client-commander-validation.service';

describe('ClientCommanderValidationService', () => {
  let service: ClientCommanderValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClientCommanderValidationService);
  });

  it('reports supplemental Commander issues from available card data', () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Deck',
      format: 'commander',
      cards: [
        entry(1, 'commander', card('Commander A', 'Legendary Creature', ['G'], 'Partner')),
        entry(1, 'commander', card('Commander B', 'Legendary Creature', ['U'], 'Partner')),
        entry(2, 'main', card('Sol Ring', 'Artifact', [], null)),
        entry(1, 'main', card('Counterspell', 'Instant', ['U'], 'Counter target spell.')),
        entry(1, 'main', card('Banned Card', 'Sorcery', [], null, { commanderLegal: false, legalities: { commander: 'banned' } })),
        entry(1, 'main', card('MDFC Card // Land', 'Sorcery', ['G'], null, { layout: 'modal_dfc' })),
      ],
    };

    const issues = service.validate(deck);

    expect(issues.some((issue) => issue.title === 'Singleton violation' && issue.cards.includes('Sol Ring'))).toBe(true);
    expect(issues.some((issue) => issue.title === 'Commander legality issue' && issue.cards.includes('Banned Card'))).toBe(true);
    expect(issues.some((issue) => issue.title === 'MDFC/layout review' && issue.cards.includes('MDFC Card // Land'))).toBe(true);
    expect(issues.some((issue) => issue.title === 'Color identity issue' && issue.cards.includes('Counterspell'))).toBe(false);
  });
});

function entry(quantity: number, section: 'main' | 'commander', cardValue: Card) {
  return { id: `${cardValue.name}-${section}`, quantity, section, card: cardValue };
}

function card(name: string, typeLine: string, colorIdentity: string[], oracleText: string | null, overrides: Partial<Card> = {}): Card {
  return {
    id: name,
    scryfallId: name,
    name,
    manaCost: null,
    typeLine,
    oracleText,
    colors: colorIdentity,
    colorIdentity,
    legalities: { commander: 'legal' },
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
    ...overrides,
  };
}
