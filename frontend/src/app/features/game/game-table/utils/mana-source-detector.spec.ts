import { GameCardInstance } from '../../../../core/models/game.model';
import { automaticTapOnlyManaSourceSuggestion, detectManaSource } from './mana-source-detector';

describe('detectManaSource', () => {
  it('detects fixed colorless mana from Sol Ring', () => {
    const suggestion = detectManaSource(card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.'));

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'C', amount: 2 }]);
  });

  it('detects fixed green mana from Llanowar Elves', () => {
    const suggestion = detectManaSource(card('Llanowar Elves', 'Creature - Elf Druid', '{T}: Add {G}.'));

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'G', amount: 1 }]);
  });

  it('limits commander identity choices when oracle text references commander identity', () => {
    const suggestion = detectManaSource(
      card('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity."),
      { colorIdentity: ['U', 'R'] },
    );

    expect(suggestion.kind).toBe('choice');
    expect(suggestion.colors).toEqual(['U', 'R']);
    expect(suggestion.amount).toBe(1);
  });

  it('detects explicit color choices from signets', () => {
    const suggestion = detectManaSource(card('Rakdos Signet', 'Artifact', '{1}, {T}: Add {B}{R}.'));

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'B', amount: 1 }, { color: 'R', amount: 1 }]);
  });

  it('detects multicolor lands with explicit or text as color choices', () => {
    const suggestion = detectManaSource(card(
      'Hinterland Harbor',
      'Land',
      '{T}: Add {G} or {U}.',
    ));

    expect(suggestion.kind).toBe('choice');
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.colors).toEqual(['U', 'G']);
    expect(suggestion.amount).toBe(1);
  });

  it('detects lands with multiple basic land types as color choices', () => {
    const suggestion = detectManaSource(card(
      'Breeding Pool',
      'Land - Forest Island',
      '',
    ));

    expect(suggestion.kind).toBe('choice');
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.colors).toEqual(['U', 'G']);
  });

  it('marks restricted mana sources without enforcing the restriction', () => {
    const suggestion = detectManaSource(card(
      'Delighted Halfling',
      'Creature - Halfling Citizen',
      "{T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.",
    ));

    expect(suggestion.kind).toBe('restricted');
    expect(suggestion.restriction).toContain('Spend this mana only');
  });

  it('treats devotion and board-count mana as variable', () => {
    const nykthos = detectManaSource(card(
      'Nykthos, Shrine to Nyx',
      'Legendary Land',
      '{T}: Add {C}. / {2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
    ));
    const cradle = detectManaSource(card("Gaea's Cradle", 'Legendary Land', '{T}: Add {G} for each creature you control.'));

    expect(nykthos.kind).toBe('variable');
    expect(cradle.kind).toBe('variable');
  });

  it('treats treasure creation and global modifiers as manual-only help', () => {
    const treasure = detectManaSource(card('Big Score', 'Instant', 'Draw two cards and create two Treasure tokens.'));
    const highTide = detectManaSource(card('High Tide', 'Instant', 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.'));
    const lantern = detectManaSource(card('Chromatic Lantern', 'Artifact', 'Lands you control have "{T}: Add one mana of any color." / {T}: Add one mana of any color.'));

    expect(treasure.kind).toBe('tokenSource');
    expect(treasure.manualOnly).toBe(true);
    expect(highTide.kind).toBe('modifier');
    expect(lantern.kind).toBe('modifier');
  });

  it('treats granted mana abilities as manual-only help', () => {
    const suggestion = detectManaSource(card('Paradise Mantle', 'Artifact - Equipment', 'Equipped creature has "{T}: Add one mana of any color." / Equip {1}'));

    expect(suggestion.kind).toBe('grantsAbility');
    expect(suggestion.manualOnly).toBe(true);
  });

  it('uses the active face for double-faced cards instead of root card text', () => {
    const activeManaFace = detectManaSource(doubleFacedCard(0));
    const inactiveManaFace = detectManaSource(doubleFacedCard(1));

    expect(activeManaFace.kind).toBe('fixed');
    expect(activeManaFace.additions).toEqual([{ color: 'G', amount: 1 }]);
    expect(inactiveManaFace.kind).toBe('none');
  });

  it('can detect mana on the back face only when that face is active', () => {
    const frontFace = detectManaSource(backManaDoubleFacedCard(0));
    const backFace = detectManaSource(backManaDoubleFacedCard(1));

    expect(frontFace.kind).toBe('none');
    expect(backFace.kind).toBe('fixed');
    expect(backFace.additions).toEqual([{ color: 'U', amount: 1 }]);
  });

  it('does not suggest mana for face-down cards', () => {
    const suggestion = detectManaSource({ ...doubleFacedCard(0), faceDown: true });

    expect(suggestion.kind).toBe('none');
  });

  it('returns automatic tap mana suggestions only for active lands or artifacts with a single tap-only mana ability', () => {
    expect(automaticTapOnlyManaSourceSuggestion(card('Forest', 'Basic Land - Forest', '')).additions).toEqual([{ color: 'G', amount: 1 }]);
    expect(automaticTapOnlyManaSourceSuggestion(card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.')).additions).toEqual([{ color: 'C', amount: 2 }]);
    expect(automaticTapOnlyManaSourceSuggestion(card('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity."), { colorIdentity: ['U', 'R'] }).colors).toEqual(['U', 'R']);
    expect(automaticTapOnlyManaSourceSuggestion(card('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity."), { colorIdentity: ['G'] }).additions).toEqual([{ color: 'G', amount: 1 }]);
    expect(automaticTapOnlyManaSourceSuggestion(card('Hinterland Harbor', 'Land', 'Hinterland Harbor enters the battlefield tapped unless you control a Forest or an Island. {T}: Add {G} or {U}.')).colors).toEqual(['U', 'G']);
    expect(automaticTapOnlyManaSourceSuggestion(card("Gaea's Cradle", 'Legendary Land', '{T}: Add {G} for each creature you control.')).kind).toBe('variable');
    expect(automaticTapOnlyManaSourceSuggestion(card('Llanowar Elves', 'Creature - Elf Druid', '{T}: Add {G}.')).kind).toBe('none');
    expect(automaticTapOnlyManaSourceSuggestion(card('Rakdos Signet', 'Artifact', '{1}, {T}: Add {B}{R}.')).kind).toBe('none');
    expect(automaticTapOnlyManaSourceSuggestion(card('Ancient Tomb', 'Land', '{T}: Add {C}{C}. Ancient Tomb deals 2 damage to you.')).kind).toBe('none');
    expect(automaticTapOnlyManaSourceSuggestion(card('Temple of the False God', 'Land', '{T}: Add {C}{C}. Activate only if you control five or more lands.')).kind).toBe('none');
  });

  it('uses the active face when checking automatic tap-only land mana', () => {
    expect(automaticTapOnlyManaSourceSuggestion(doubleFacedLand(0)).additions).toEqual([{ color: 'R', amount: 1 }]);
    expect(automaticTapOnlyManaSourceSuggestion(doubleFacedLand(1)).kind).toBe('none');
  });
});

function card(name: string, typeLine: string, oracleText: string): GameCardInstance {
  return {
    instanceId: name,
    name,
    typeLine,
    oracleText,
    tapped: false,
  };
}

function doubleFacedCard(activeFaceIndex: number): GameCardInstance {
  return {
    instanceId: `dfc-${activeFaceIndex}`,
    name: 'Mana Front // Quiet Back',
    typeLine: 'Artifact',
    oracleText: '{T}: Add {G}.',
    activeFaceIndex,
    cardFaces: [
      {
        name: 'Mana Front',
        manaCost: null,
        typeLine: 'Artifact',
        oracleText: '{T}: Add {G}.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
      {
        name: 'Quiet Back',
        manaCost: null,
        typeLine: 'Creature - Human',
        oracleText: 'Whenever Quiet Back attacks, surveil 1.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
    ],
    tapped: false,
  };
}

function backManaDoubleFacedCard(activeFaceIndex: number): GameCardInstance {
  return {
    instanceId: `back-mana-dfc-${activeFaceIndex}`,
    name: 'Quiet Front // Mana Back',
    typeLine: 'Creature - Human',
    oracleText: 'Whenever Quiet Front attacks, surveil 1.',
    activeFaceIndex,
    cardFaces: [
      {
        name: 'Quiet Front',
        manaCost: null,
        typeLine: 'Creature - Human',
        oracleText: 'Whenever Quiet Front attacks, surveil 1.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
      {
        name: 'Mana Back',
        manaCost: null,
        typeLine: 'Artifact',
        oracleText: '{T}: Add {U}.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
    ],
    tapped: false,
  };
}

function doubleFacedLand(activeFaceIndex: number): GameCardInstance {
  return {
    instanceId: `land-dfc-${activeFaceIndex}`,
    name: 'Mana Land // Quiet Back',
    typeLine: 'Land',
    oracleText: '{T}: Add {R}.',
    activeFaceIndex,
    cardFaces: [
      {
        name: 'Mana Land',
        manaCost: null,
        typeLine: 'Land',
        oracleText: '{T}: Add {R}.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
      {
        name: 'Quiet Back',
        manaCost: null,
        typeLine: 'Creature - Human',
        oracleText: 'Whenever Quiet Back attacks, surveil 1.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
    ],
    tapped: false,
  };
}
