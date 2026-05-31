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
