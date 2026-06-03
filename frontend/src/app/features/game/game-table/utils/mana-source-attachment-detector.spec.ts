import { GameCardInstance } from '../../../../core/models/game.model';
import {
  automaticTapOnlyManaSourceSuggestionWithAttachments,
  detectManaSourceWithAttachments,
} from './mana-source-attachment-detector';

describe('mana source attachment detector', () => {
  it('turns fixed land mana with an additional fixed aura into a manual amount overlay', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Forest', 'Basic Land - Forest', ''),
      [card('Wild Growth', 'Enchantment - Aura', 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds an additional {G}.')],
    );

    expect(suggestion.kind).toBe('variable');
    expect(suggestion.summary).toBe('Add {G}');
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.colors).toEqual(['G']);
    expect(suggestion.amount).toBe(1);
    expect(suggestion.productionParts).toEqual([
      {
        id: 'base',
        kind: 'fixed',
        label: 'Forest',
        additions: [{ color: 'G', amount: 1 }],
      },
      {
        id: 'attachment-Wild Growth',
        kind: 'fixed',
        label: 'Wild Growth',
        additions: [{ color: 'G', amount: 1 }],
      },
    ]);
  });

  it('keeps multicolor land choices when any-color attached mana is too ambiguous to merge', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity."),
      [card('Fertile Ground', 'Enchantment - Aura', 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds one mana of any color.')],
      { colorIdentity: ['U', 'G'] },
    );

    expect(suggestion.kind).toBe('variable');
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.colors).toEqual(['U', 'G']);
    expect(suggestion.productionParts).toBeUndefined();
  });

  it('keeps only fixed attached extra mana when the base land is multicolor', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Hinterland Harbor', 'Land', '{T}: Add {G} or {U}.'),
      [card('Overgrowth', 'Enchantment - Aura', 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds an additional {G}{G}.')],
    );

    expect(suggestion.kind).toBe('variable');
    expect(suggestion.colors).toEqual(['U', 'G']);
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.productionParts).toEqual([
      {
        id: 'attachment-Overgrowth',
        kind: 'fixed',
        label: 'Overgrowth',
        additions: [{ color: 'G', amount: 2 }],
      },
      {
        id: 'base',
        kind: 'variable',
        label: 'Hinterland Harbor',
        amount: 1,
        colors: ['U', 'G'],
      },
    ]);
  });

  it('ignores unknown chosen-color attached effects', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Forest', 'Basic Land - Forest', ''),
      [card('Utopia Sprawl', 'Enchantment - Aura', 'Enchant Forest / As Utopia Sprawl enters, choose a color. Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.')],
    );

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'G', amount: 1 }]);
    expect(suggestion.productionParts).toBeUndefined();
  });

  it('ignores attachments that do not affect mana', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Forest', 'Basic Land - Forest', ''),
      [card('Squirrel Nest', 'Enchantment - Aura', 'Enchant land / Enchanted land has "{T}: Create a 1/1 green Squirrel creature token."')],
    );

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'G', amount: 1 }]);
  });

  it('uses the active face of attached cards', () => {
    const suggestion = detectManaSourceWithAttachments(
      card('Forest', 'Basic Land - Forest', ''),
      [doubleFacedAttachment(1)],
    );

    expect(suggestion.kind).toBe('fixed');
    expect(suggestion.additions).toEqual([{ color: 'G', amount: 1 }]);
  });

  it('opens manual automatic-tap suggestions for lands with relevant attachments', () => {
    const suggestion = automaticTapOnlyManaSourceSuggestionWithAttachments(
      card('Forest', 'Basic Land - Forest', ''),
      [card('Wild Growth', 'Enchantment - Aura', 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds an additional {G}.')],
    );

    expect(suggestion.kind).toBe('variable');
    expect(suggestion.additions).toEqual([]);
    expect(suggestion.colors).toEqual(['G']);
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

function doubleFacedAttachment(activeFaceIndex: number): GameCardInstance {
  return {
    instanceId: 'dfc-aura',
    name: 'Mana Face // Quiet Face',
    typeLine: 'Enchantment - Aura',
    oracleText: 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds an additional {U}.',
    activeFaceIndex,
    cardFaces: [
      {
        name: 'Mana Face',
        manaCost: null,
        typeLine: 'Enchantment - Aura',
        oracleText: 'Enchant land / Whenever enchanted land is tapped for mana, its controller adds an additional {U}.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: {},
      },
      {
        name: 'Quiet Face',
        manaCost: null,
        typeLine: 'Enchantment',
        oracleText: 'Creatures you control get +1/+1.',
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
