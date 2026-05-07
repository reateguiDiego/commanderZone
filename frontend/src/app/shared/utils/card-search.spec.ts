import { Card } from '../../core/models/card.model';
import { filterDistinctCardsByQuery } from './card-search';

describe('card-search utilities', () => {
  it('keeps only one autocomplete result per card name', () => {
    const results = filterDistinctCardsByQuery([
      card('Sol Ring', 'cmm', '400'),
      card('Sol Ring', 'ltc', '300'),
      card('Sol Talisman', 'mh2', '234'),
    ], 'sol');

    expect(results.map((result) => result.name)).toEqual(['Sol Ring', 'Sol Talisman']);
  });

  it('prioritizes names starting with the query before names that only contain it', () => {
    const results = filterDistinctCardsByQuery([
      card('The Liliana Contract', 'stx', '83'),
      card('Liliana of the Veil', 'dmu', '97'),
      card("Liliana's Triumph", 'war', '98'),
    ], 'liliana');

    expect(results.map((result) => result.name)).toEqual([
      'Liliana of the Veil',
      "Liliana's Triumph",
      'The Liliana Contract',
    ]);
  });

  it('filters generic card type results from autocomplete', () => {
    const results = filterDistinctCardsByQuery([
      card('Checklist Card', 'tst', '1', 'Card'),
      card('Liliana of the Veil', 'dmu', '97', 'Legendary Planeswalker - Liliana'),
    ], 'liliana');

    expect(results.map((result) => result.name)).toEqual(['Liliana of the Veil']);
  });
});

function card(name: string, set: string, collectorNumber: string, typeLine = 'Artifact'): Card {
  return {
    id: `${name}-${set}`,
    scryfallId: `${name}-${set}-scryfall-id`,
    name,
    manaCost: null,
    typeLine,
    oracleText: null,
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set,
    collectorNumber,
  };
}
