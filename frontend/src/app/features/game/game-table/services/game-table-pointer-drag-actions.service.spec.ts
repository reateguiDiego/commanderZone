import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { GameTablePointerDragActionContext, GameTablePointerDragActionsService } from './game-table-pointer-drag-actions.service';

describe('GameTablePointerDragActionsService', () => {
  let service: GameTablePointerDragActionsService;
  let dragService: { endCardPointerDrag: ReturnType<typeof vi.fn> };
  let battlefieldDragService: {
    playerDropTargetAt: ReturnType<typeof vi.fn>;
    isPointerInsidePlayerBattlefield: ReturnType<typeof vi.fn>;
    positionWithAlignmentGuide: ReturnType<typeof vi.fn>;
    positionWithManaLane: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    dragService = {
      endCardPointerDrag: vi.fn(() => ({
        playerId: 'player-1',
        instanceId: 'moved',
        moved: true,
        position: { x: 0, y: 0 },
        dropZone: 'hand',
        battlefield: document.createElement('div'),
      })),
    };
    battlefieldDragService = {
      playerDropTargetAt: vi.fn(() => null),
      isPointerInsidePlayerBattlefield: vi.fn(() => false),
      positionWithAlignmentGuide: vi.fn((_context, _playerId, _instanceId, position) => position),
      positionWithManaLane: vi.fn((_playerId, position) => ({ ...position, y: 208 })),
    };

    TestBed.configureTestingModule({
      providers: [
        GameTablePointerDragActionsService,
        { provide: GameTableDragService, useValue: dragService },
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: battlefieldDragService,
        },
      ],
    });

    service = TestBed.inject(GameTablePointerDragActionsService);
  });

  it('applies the previewed hand position when a battlefield pointer drag drops into hand', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [card('moved', 'Cultivate', 'battlefield')],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'card.moved') {
          snapshot = moveCardToHand(snapshot, payload['instanceId'] as string);
        }
        if (type === 'zone.changed') {
          snapshot = {
            ...snapshot,
            players: {
              ...snapshot.players,
              'player-1': {
                ...snapshot.players['player-1']!,
                zones: {
                  ...snapshot.players['player-1']!.zones,
                  hand: payload['cards'] as GameCardInstance[],
                },
              },
            },
          };
        }
      },
      [],
    ), { clientX: 120, clientY: 90 } as PointerEvent);

    expect(commands[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceId: 'moved',
      },
    });
    expect(commands[1]?.type).toBe('zone.changed');
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'hand-2']);
  });

  it('moves every selected battlefield card when a selected card is dragged to hand', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [
        card('moved', 'Cultivate', 'battlefield'),
        card('selected-2', 'Kodama Reach', 'battlefield'),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'cards.moved') {
          snapshot = moveCardsToHand(snapshot, payload['instanceIds'] as string[]);
        }
        if (type === 'zone.changed') {
          snapshot = {
            ...snapshot,
            players: {
              ...snapshot.players,
              'player-1': {
                ...snapshot.players['player-1']!,
                zones: {
                  ...snapshot.players['player-1']!.zones,
                  hand: payload['cards'] as GameCardInstance[],
                },
              },
            },
          };
        }
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[0]! },
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[1]! },
      ],
    ), { clientX: 120, clientY: 90 } as PointerEvent);

    expect(commands[0]).toEqual({
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceIds: ['moved', 'selected-2'],
      },
    });
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'selected-2', 'hand-2']);
  });

  it('anchors a battlefield card to the mana row height when the mana lane is highlighted', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'moved',
      moved: true,
      position: { x: 44, y: 320 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [{ ...card('moved', 'Cultivate', 'battlefield'), position: { x: 10, y: 110 } }],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      () => true,
    ), { clientX: 120, clientY: 280 } as PointerEvent);

    expect(battlefieldDragService.positionWithManaLane).toHaveBeenCalledWith('player-1', { x: 44, y: 320 });
    expect(battlefieldDragService.positionWithAlignmentGuide).not.toHaveBeenCalled();
    expect(commands).toEqual([{
      type: 'card.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'moved',
        position: { x: 44, y: 208 },
      },
    }]);
  });
});

function context(
  snapshot: () => GameSnapshot,
  command: (type: GameCommandType, payload: Record<string, unknown>) => Promise<void>,
  selectedCards: readonly { playerId: string; zone: GameZoneName; card: GameCardInstance }[] = [],
  isManaLaneHighlighted: (playerId: string) => boolean = () => false,
): GameTablePointerDragActionContext {
  return {
    zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
    snapshot,
    handDropPreview: () => ({ playerId: 'player-1', targetInstanceId: 'hand-2', placement: 'before' }),
    selectedCards: () => selectedCards,
    battlefieldDragContext: () => ({
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      snapshot,
      selectedCards: () => [],
      findCard: (playerId, zone, instanceId) =>
        snapshot().players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
      updateLocalCardPosition: vi.fn(),
    }),
    alignmentGuideY: () => null,
    isManaLaneHighlighted,
    findCard: (playerId, zone, instanceId) =>
      snapshot().players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
    canControlPlayer: () => true,
    canControlOwnedCard: () => true,
    playerName: (playerId) => playerId,
    updateLocalCardPosition: vi.fn(),
    setPendingBattlefieldMove: vi.fn(),
    setPendingLibraryMove: vi.fn(),
    endCardDrag: vi.fn(),
    clearSelectedCards: vi.fn(),
    suppressCardPreview: vi.fn(),
    applyDeferredRemoteSnapshot: vi.fn(),
    refetch: vi.fn(async () => undefined),
    command,
  };
}

function snapshotWith(zones: Partial<Record<GameZoneName, GameCardInstance[]>>): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        life: 40,
        zones: {
          library: [],
          hand: zones.hand ?? [],
          battlefield: zones.battlefield ?? [],
          graveyard: [],
          exile: [],
          command: [],
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '',
  };
}

function moveCardToHand(snapshot: GameSnapshot, instanceId: string): GameSnapshot {
  const player = snapshot.players['player-1']!;
  const moved = player.zones.battlefield.find((candidate) => candidate.instanceId === instanceId)!;

  return {
    ...snapshot,
    players: {
      ...snapshot.players,
      'player-1': {
        ...player,
        zones: {
          ...player.zones,
          battlefield: player.zones.battlefield.filter((candidate) => candidate.instanceId !== instanceId),
          hand: [...player.zones.hand, { ...moved, zone: 'hand' }],
        },
      },
    },
  };
}

function moveCardsToHand(snapshot: GameSnapshot, instanceIds: readonly string[]): GameSnapshot {
  let next = snapshot;
  for (const instanceId of instanceIds) {
    next = moveCardToHand(next, instanceId);
  }

  return next;
}

function card(instanceId: string, name: string, zone: GameZoneName): GameCardInstance {
  return {
    instanceId,
    name,
    tapped: false,
    zone,
  };
}
