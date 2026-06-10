import { Card } from '../../core/models/card.model';
import { filterDistinctCardsByQuery } from './card-search';

describe('card-search utilities', () => {
  it('keeps only one autocomplete result when name, type and mana cost match', () => {
    const results = filterDistinctCardsByQuery([
      card('Sol Ring', 'cmm', '400', 'Artifact', '{1}'),
      card('Sol Ring', 'ltc', '300', 'Artifact', '{1}'),
      card('Sol Talisman', 'mh2', '234', 'Artifact', '{2}'),
    ], 'sol');

    expect(results.map((result) => result.name)).toEqual(['Sol Ring', 'Sol Talisman']);
  });

  it('keeps cards with same name when type or mana cost differs', () => {
    const results = filterDistinctCardsByQuery([
      card('Spark Echo', 'set-a', '1', 'Instant', '{1}{R}'),
      card('Spark Echo', 'set-b', '2', 'Sorcery', '{1}{R}'),
      card('Spark Echo', 'set-c', '3', 'Instant', '{2}{R}'),
    ], 'spark');

    expect(results).toHaveLength(3);
  });

  it('keeps case-insensitive contains matches without requiring starts-with', () => {
    const results = filterDistinctCardsByQuery([
      card('The Liliana Contract', 'stx', '83'),
      card('Liliana of the Veil', 'dmu', '97'),
      card("Liliana's Triumph", 'war', '98'),
      card('Oath of Liliana', 'war', '96'),
    ], 'LiLiAnA');

    expect(results.map((result) => result.name)).toContain('The Liliana Contract');
    expect(results.map((result) => result.name)).toContain('Oath of Liliana');
    expect(results.map((result) => result.name)).toContain('Liliana of the Veil');
  });

  it('keeps backend-approved localized results even when the visible name does not contain the raw query', () => {
    const results = filterDistinctCardsByQuery([
      card('Anillo solar', 'tst', '1', 'Artifact', '{1}', 'Anillo solar'),
    ], 'sol ring');

    expect(results.map((result) => result.name)).toEqual(['Anillo solar']);
  });

  it('filters generic card type results from autocomplete', () => {
    const results = filterDistinctCardsByQuery([
      card('Checklist Card', 'tst', '1', 'Card'),
      card('Liliana of the Veil', 'dmu', '97', 'Legendary Planeswalker - Liliana'),
    ], 'liliana');

    expect(results.map((result) => result.name)).toEqual(['Liliana of the Veil']);
  });
});

function card(name: string, set: string, collectorNumber: string, typeLine = 'Artifact', manaCost: string | null = null, printedName: string | null = null): Card {
  return {
    id: `${name}-${set}`,
    scryfallId: `${name}-${set}-scryfall-id`,
    name,
    manaCost,
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
    printedName,
  };
}
