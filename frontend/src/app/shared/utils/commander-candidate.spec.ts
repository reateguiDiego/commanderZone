import { Card } from '../../core/models/card.model';
import { isCommanderCandidate } from './commander-candidate';

describe('isCommanderCandidate', () => {
  it('accepts legendary creatures', () => {
    expect(isCommanderCandidate(card('Legendary Creature - Angel', null))).toBe(true);
  });

  it('accepts cards with explicit commander exception text', () => {
    expect(isCommanderCandidate(card('Planeswalker - Teferi', 'Teferi can be your commander.'))).toBe(true);
  });

  it('accepts Hearthhull and legendary Vehicles, but not ineligible artifacts', () => {
    const spacecraft = { ...card('Legendary Artifact - Spacecraft', null), name: 'Hearthhull, the Worldseed', power: '6', toughness: '7' };
    expect(isCommanderCandidate(spacecraft)).toBe(true);
    expect(isCommanderCandidate(card('Legendary Artifact - Vehicle', null))).toBe(true);
    expect(isCommanderCandidate({ ...spacecraft, power: '0', toughness: '*' })).toBe(true);
    expect(isCommanderCandidate({ ...spacecraft, power: null })).toBe(false);
    expect(isCommanderCandidate({ ...spacecraft, toughness: null })).toBe(false);
    expect(isCommanderCandidate({ ...spacecraft, typeLine: 'Artifact - Spacecraft' })).toBe(false);
    expect(isCommanderCandidate({ ...spacecraft, typeLine: 'Legendary Artifact' })).toBe(false);
    expect(isCommanderCandidate(card('Legendary Planeswalker - Jace', null))).toBe(false);
    expect(isCommanderCandidate({ ...spacecraft, typeLine: 'Artifact // Legendary Artifact - Spacecraft', cardFaces: [
      { ...face(), name: 'Front', typeLine: 'Artifact' }, { ...face(), name: 'Back', typeLine: 'Legendary Artifact - Spacecraft', power: '6', toughness: '7' },
    ] })).toBe(false);
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

function face() {
  return { name: null, manaCost: null, typeLine: null, oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: {} };
}
