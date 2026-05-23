import { Card } from '../../core/models/card.model';
import { isCommanderCandidate } from './commander-candidate';

describe('isCommanderCandidate', () => {
  it('accepts legendary creatures', () => {
    expect(isCommanderCandidate(card('Legendary Creature - Angel', null))).toBe(true);
  });

  it('accepts cards with explicit commander exception text', () => {
    expect(isCommanderCandidate(card('Planeswalker - Teferi', 'Teferi can be your commander.'))).toBe(true);
  });

  it('rejects cards that are not valid commanders', () => {
    expect(isCommanderCandidate(card('Sorcery', null))).toBe(false);
  });
});

function card(typeLine: string | null, oracleText: string | null): Card {
  return {
    id: 'card-id',
    scryfallId: 'scryfall-id',
    name: 'Card',
    manaCost: null,
    typeLine,
    oracleText,
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
