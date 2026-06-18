import { GameAttachment, GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { buildCardPreviewAttachmentInfo, buildCardPreviewCardStateInfo, resolveCardPreviewCard } from './card-preview-attachment-info';

describe('buildCardPreviewAttachmentInfo', () => {
  it('reports cards attached to the previewed target', () => {
    const target = card('target', 'Kor Duelist');
    const sword = card('sword', 'Sword of Fire and Ice');
    const aura = card('aura', 'Ethereal Armor');
    const snapshot = gameSnapshot([target, sword, aura], [
      attachment('attachment-1', 'sword', 'target'),
      attachment('attachment-2', 'aura', 'target'),
    ]);

    expect(buildCardPreviewAttachmentInfo(snapshot, target)).toEqual({
      attachedTo: null,
      attachedCards: [
        { instanceId: 'sword', name: 'Sword of Fire and Ice' },
        { instanceId: 'aura', name: 'Ethereal Armor' },
      ],
    });
  });

  it('reports the card a previewed attachment is attached to', () => {
    const target = card('target', 'Kor Duelist');
    const sword = card('sword', 'Sword of Fire and Ice');
    const snapshot = gameSnapshot([target, sword], [
      attachment('attachment-1', 'sword', 'target'),
    ]);

    expect(buildCardPreviewAttachmentInfo(snapshot, sword)).toEqual({
      attachedTo: { instanceId: 'target', name: 'Kor Duelist' },
      attachedCards: [],
    });
  });

  it('returns null when the previewed card has no attachment relation', () => {
    const looseCard = card('loose-card', 'Sol Ring');

    expect(buildCardPreviewAttachmentInfo(gameSnapshot([looseCard], []), looseCard)).toBeNull();
  });

  it('reports every attached card name without collapsing the list', () => {
    const target = card('target', 'Kor Duelist');
    const attachedCards = Array.from({ length: 5 }, (_, index) => card(`equipment-${index}`, `Equipment ${index + 1}`));
    const snapshot = gameSnapshot([target, ...attachedCards], attachedCards.map((attachedCard, index) =>
      attachment(`attachment-${index}`, attachedCard.instanceId, target.instanceId),
    ));

    expect(buildCardPreviewAttachmentInfo(snapshot, target)?.attachedCards.map((attachedCard) => attachedCard.name)).toEqual([
      'Equipment 1',
      'Equipment 2',
      'Equipment 3',
      'Equipment 4',
      'Equipment 5',
    ]);
  });

  it('uses the active face name for double-faced attachment labels', () => {
    const target = doubleFacedCard('target', 'Ludevic, Necrogenius // Olag, Ludevic\'s Hubris', 1);
    const equipment = doubleFacedCard('equipment', 'Bala Ged Recovery // Bala Ged Sanctuary', 1);
    const snapshot = gameSnapshot([target, equipment], [
      attachment('attachment-1', 'equipment', 'target'),
    ]);

    expect(buildCardPreviewAttachmentInfo(snapshot, target)?.attachedCards).toEqual([
      { instanceId: 'equipment', name: 'Bala Ged Sanctuary' },
    ]);
    expect(buildCardPreviewAttachmentInfo(snapshot, equipment)?.attachedTo).toEqual({
      instanceId: 'target',
      name: 'Olag, Ludevic\'s Hubris',
    });
  });
});

describe('buildCardPreviewCardStateInfo', () => {
  it('reports modified power and toughness', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('creature', 'Kor Duelist'),
      power: 4,
      toughness: 5,
      defaultPower: 1,
      defaultToughness: 1,
    })).toEqual({
      powerToughness: { power: 4, toughness: 5 },
      battle: null,
      saga: null,
      loyalty: null,
      counters: [],
    });
  });

  it('does not report power and toughness when they match defaults', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('creature', 'Kor Duelist'),
      power: 1,
      toughness: 1,
      defaultPower: 1,
      defaultToughness: 1,
    })).toBeNull();
  });

  it('reports existing card counters', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('artifact', 'Everflowing Chalice'),
      counters: { charge: 3, red: 1 },
    })).toEqual({
      powerToughness: null,
      battle: null,
      saga: null,
      loyalty: null,
      counters: [
        { key: 'charge', value: 3 },
        { key: 'red', value: 1 },
      ],
    });
  });

  it('reports loyalty in the same card state info', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('planeswalker', 'Jace'),
      loyalty: 5,
      defaultLoyalty: 3,
    })).toEqual({
      powerToughness: null,
      battle: null,
      saga: null,
      loyalty: 5,
      counters: [],
    });
  });

  it('does not report loyalty when it matches the default value', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('planeswalker', 'Jace'),
      loyalty: 3,
      defaultLoyalty: 3,
    })).toBeNull();
  });

  it('reports battle defense in the same card state info', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('battle', 'Invasion of Zendikar'),
      typeLine: 'Battle - Siege',
      defense: 6,
    })).toEqual({
      powerToughness: null,
      battle: 6,
      saga: null,
      loyalty: null,
      counters: [],
    });
  });

  it('falls back to the default battle defense in preview state', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('battle', 'Invasion of Zendikar'),
      typeLine: 'Battle - Siege',
      defense: null,
      defaultDefense: 5,
    })).toEqual({
      powerToughness: null,
      battle: 5,
      saga: null,
      loyalty: null,
      counters: [],
    });
  });

  it('uses the current battle defense from the root card state when the battle face is active', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('battle-dfc', 'Invasion of Ikoria // Zilortha, Apex of Ikoria'),
      typeLine: 'Battle - Siege // Legendary Creature - Dinosaur',
      activeFaceIndex: 0,
      cardFaces: [
        {
          name: 'Invasion of Ikoria',
          manaCost: null,
          typeLine: 'Battle - Siege',
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          defense: '6',
          colors: [],
          imageUris: {},
        },
        {
          name: 'Zilortha, Apex of Ikoria',
          manaCost: null,
          typeLine: 'Legendary Creature - Dinosaur',
          oracleText: null,
          power: '8',
          toughness: '8',
          loyalty: null,
          defense: null,
          colors: [],
          imageUris: {},
        },
      ],
      defense: 16,
      defaultDefense: 6,
      tapped: false,
    })).toEqual({
      powerToughness: null,
      battle: 16,
      saga: null,
      loyalty: null,
      counters: [],
    });
  });

  it('uses the active double-faced card stats and loyalty', () => {
    expect(buildCardPreviewCardStateInfo({
      ...doubleFacedCreature(),
      activeFaceIndex: 0,
      loyalty: 5,
      defaultLoyalty: 3,
      defaultPower: 1,
      defaultToughness: 1,
    })).toEqual({
      powerToughness: { power: 2, toughness: 3 },
      battle: null,
      saga: null,
      loyalty: 4,
      counters: [],
    });
  });

  it('ignores inactive face power or loyalty values when the active face has none', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('dfc-creature', 'Front Face // Back Face'),
      activeFaceIndex: 1,
      cardFaces: [
        {
          name: 'Front Face',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: '4',
          toughness: '5',
          loyalty: null,
          colors: [],
          imageUris: {},
        },
        {
          name: 'Back Face',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          imageUris: {},
        },
      ],
      power: 4,
      toughness: 5,
      loyalty: 6,
      defaultPower: 1,
      defaultToughness: 1,
      defaultLoyalty: 3,
      tapped: false,
    })).toBeNull();
  });

  it('reports saga chapters as one in preview state', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('dfc-saga', 'Front // Saga'),
      zone: 'battlefield',
      activeFaceIndex: 1,
      cardFaces: [
        {
          name: 'Front',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          imageUris: {},
        },
        {
          name: 'Saga',
          manaCost: null,
          typeLine: 'Enchantment - Saga',
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          imageUris: {},
        },
      ],
      tapped: false,
    })).toEqual({
      powerToughness: null,
      battle: null,
      saga: 1,
      loyalty: null,
      counters: [],
    });
  });

  it('ignores inactive face defense values when the active face has none', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('dfc-battle', 'Invasion of Zendikar // Awakened Skyclave'),
      typeLine: 'Battle - Siege',
      activeFaceIndex: 1,
      cardFaces: [
        {
          name: 'Invasion of Zendikar',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          defense: '5',
          colors: [],
          imageUris: {},
        },
        {
          name: 'Awakened Skyclave',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          defense: null,
          colors: [],
          imageUris: {},
        },
      ],
      defense: 5,
      defaultDefense: 5,
      tapped: false,
    })).toBeNull();
  });

  it('does not report inactive face 0/0 power and toughness in preview state', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('dfc-preview', 'Inactive // Active'),
      tapped: false,
      activeFaceIndex: 1,
      cardFaces: [
        {
          name: 'Inactive',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: '0',
          toughness: '0',
          loyalty: null,
          colors: [],
          imageUris: {},
        },
        {
          name: 'Active',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          imageUris: {},
        },
      ],
      power: 4,
      toughness: 5,
      defaultPower: 1,
      defaultToughness: 1,
    })).toBeNull();
  });

  it('does not report inactive face loyalty 0 in preview state', () => {
    expect(buildCardPreviewCardStateInfo({
      ...card('dfc-preview-loyalty', 'Planeswalker // Sidekick'),
      tapped: false,
      activeFaceIndex: 1,
      cardFaces: [
        {
          name: 'Planeswalker',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: '0',
          colors: [],
          imageUris: {},
        },
        {
          name: 'Sidekick',
          manaCost: null,
          typeLine: null,
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          imageUris: {},
        },
      ],
      loyalty: 0,
      defaultLoyalty: 2,
      defaultPower: null,
      defaultToughness: null,
    })).toBeNull();
  });
});

describe('resolveCardPreviewCard', () => {
  it('prefers the current snapshot card over a stale preview event card', () => {
    const stalePreviewCard = card('creature', 'Kor Duelist');
    const currentSnapshotCard: GameCardInstance = {
      ...stalePreviewCard,
      power: 4,
      toughness: 5,
      defaultPower: 1,
      defaultToughness: 1,
      counters: { charge: 2 },
    };
    const snapshot = gameSnapshot([currentSnapshotCard], []);

    expect(resolveCardPreviewCard(snapshot, {
      card: stalePreviewCard,
      playerId: 'player-1',
      zone: 'battlefield',
      sourceRect: null,
    })).toBe(currentSnapshotCard);
  });
});

function card(instanceId: string, name: string): GameCardInstance {
  return { instanceId, name, tapped: false };
}

function doubleFacedCreature(): GameCardInstance {
  return {
    ...card('dfc-creature', 'Front Face // Back Face'),
    defaultPower: 1,
    defaultToughness: 1,
    cardFaces: [
      {
        name: 'Front Face',
        manaCost: null,
        typeLine: null,
        oracleText: null,
        power: '2',
        toughness: '3',
        loyalty: '4',
        colors: [],
        imageUris: {},
      },
      {
        name: 'Back Face',
        manaCost: null,
        typeLine: null,
        oracleText: null,
        power: '4',
        toughness: '5',
        loyalty: null,
        colors: [],
        imageUris: {},
      },
    ],
  };
}

function doubleFacedCard(instanceId: string, name: string, activeFaceIndex: number): GameCardInstance {
  return {
    ...card(instanceId, name),
    activeFaceIndex,
    cardFaces: name.split(' // ').map((faceName) => ({
      name: faceName,
      manaCost: null,
      typeLine: null,
      oracleText: null,
      power: null,
      toughness: null,
      loyalty: null,
      colors: [],
      imageUris: {},
    })),
  };
}

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-05-29T00:00:00+00:00',
  };
}

function gameSnapshot(
  battlefield: readonly GameCardInstance[],
  attachments: NonNullable<GameSnapshot['attachments']>,
): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@example.com', displayName: 'Player', roles: [] },
        life: 40,
        commanderDamage: {},
        counters: {},
        zones: {
          library: [],
          hand: [],
          battlefield: [...battlefield],
          graveyard: [],
          exile: [],
          command: [],
        },
      },
    },
    turn: { activePlayerId: null, phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    attachments,
    chat: [],
    eventLog: [],
    createdAt: '2026-05-29T00:00:00+00:00',
  };
}
