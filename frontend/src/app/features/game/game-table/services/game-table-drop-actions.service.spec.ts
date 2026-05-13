import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableDragService } from './game-table-drag.service';
import { GameTableDropActionContext, GameTableDropActionsService } from './game-table-drop-actions.service';

describe('GameTableDropActionsService', () => {
  let service: GameTableDropActionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameTableDropActionsService, GameTableDragService],
    });
    service = TestBed.inject(GameTableDropActionsService);
  });

  it('keeps the previewed hand insertion position when a card comes from another zone', async () => {
    const moved = card('moved', 'Cultivate', 'battlefield');
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [moved],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'card.moved') {
          snapshot = moveCardToHand(snapshot, 'player-1', 'battlefield', payload['instanceId'] as string);
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
    );

    await service.dropOnHand(context, dragEvent({ playerId: 'player-1', zone: 'battlefield', instanceId: 'moved' }), 'player-1');

    expect(commands[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        targetPlayerId: 'player-1',
        instanceId: 'moved',
      },
    });
    expect(commands[1]?.type).toBe('zone.changed');
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'hand-2']);
  });

  it('keeps the previewed hand insertion position when multiple dragged cards come from another zone', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [
        card('moved', 'Cultivate', 'battlefield'),
        card('selected-2', 'Kodama Reach', 'battlefield'),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'cards.moved') {
          snapshot = moveCardsToHand(snapshot, 'player-1', 'battlefield', payload['instanceIds'] as string[]);
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
    );

    await service.dropOnHand(context, dragEvent({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'moved',
      instanceIds: ['moved', 'selected-2'],
    }), 'player-1');

    expect(commands[0]).toEqual({
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        targetPlayerId: 'player-1',
        instanceIds: ['moved', 'selected-2'],
      },
    });
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'selected-2', 'hand-2']);
  });

  it.each(['graveyard', 'exile', 'command'] as const)('allows moving a card from %s to hand', async (fromZone) => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand')],
      [fromZone]: [card('moved', 'Returned Card', fromZone)],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const markPendingTransfer = vi.fn();
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'card.moved') {
          snapshot = moveCardToHand(snapshot, 'player-1', fromZone, payload['instanceId'] as string);
        }
      },
      { markPendingTransfer },
    );

    await service.dropOnHand(context, dragEvent({ playerId: 'player-1', zone: fromZone, instanceId: 'moved' }), 'player-1');

    expect(commands[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone,
        toZone: 'hand',
        targetPlayerId: 'player-1',
        instanceId: 'moved',
      },
    });
    expect(markPendingTransfer).toHaveBeenCalledWith('player-1', fromZone, ['moved']);
  });

  it('allows moving multiple cards from graveyard to hand', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand')],
      graveyard: [
        card('moved', 'Returned Card', 'graveyard'),
        card('selected-2', 'Second Returned Card', 'graveyard'),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'cards.moved') {
          snapshot = moveCardsToHand(snapshot, 'player-1', 'graveyard', payload['instanceIds'] as string[]);
        }
      },
    );

    await service.dropOnHand(context, dragEvent({
      playerId: 'player-1',
      zone: 'graveyard',
      instanceId: 'moved',
      instanceIds: ['moved', 'selected-2'],
    }), 'player-1');

    expect(commands[0]).toEqual({
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'graveyard',
        toZone: 'hand',
        targetPlayerId: 'player-1',
        instanceIds: ['moved', 'selected-2'],
      },
    });
  });

  it('opens a pending library placement instead of moving immediately when dropping on library', async () => {
    const moved = card('moved', 'Cultivate', 'battlefield');
    const snapshot = snapshotWith({ battlefield: [moved] });
    const command = vi.fn();
    const setPendingLibraryMove = vi.fn();
    const markPendingTransfer = vi.fn();
    const context = dropContext(
      () => snapshot,
      command,
      { setPendingLibraryMove, markPendingTransfer },
    );

    await service.dropOnZone(context, dragEvent({ playerId: 'player-1', zone: 'battlefield', instanceId: 'moved' }), 'player-1', 'library');

    expect(command).not.toHaveBeenCalled();
    expect(markPendingTransfer).toHaveBeenCalledWith('player-1', 'battlefield', ['moved'], { expires: false });
    expect(setPendingLibraryMove).toHaveBeenCalledWith({
      cardName: 'Cultivate',
      commandType: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'library',
        targetPlayerId: 'player-1',
        instanceId: 'moved',
      },
    });
  });

  it('keeps multiple cards on the same y when dropped on the mana row', async () => {
    const first = card('moved', 'Cultivate', 'hand');
    const second = card('selected-2', 'Kodama Reach', 'hand');
    const snapshot = snapshotWith({ hand: [first, second] });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
    );

    await service.dropOnZone(context, dragEvent({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'moved',
      instanceIds: ['moved', 'selected-2'],
    }, 'mana', { clientY: 282 }), 'player-1', 'battlefield');

    expect(commands.map((entry) => entry.payload['position'])).toEqual([
      { x: 122, y: 190 },
      { x: 122, y: 190 },
    ]);
  });

  it('keeps the exact previewed battlefield position for every selected card when no vertical snap is active', async () => {
    const first = card('moved', 'Cultivate', 'hand');
    const second = card('selected-2', 'Kodama Reach', 'hand');
    const snapshot = snapshotWith({ hand: [first, second] });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = dropContext(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
    );

    await service.dropOnZone(context, dragEvent({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'moved',
      instanceIds: ['moved', 'selected-2'],
    }, 'battlefield'), 'player-1', 'battlefield');

    expect(commands.map((entry) => entry.payload['position'])).toEqual([
      { x: 122, y: 158 },
      { x: 122, y: 158 },
    ]);
  });
});

function dropContext(
  snapshot: () => GameSnapshot,
  command: (type: GameCommandType, payload: Record<string, unknown>) => Promise<void>,
  overrides: Partial<GameTableDropActionContext> = {},
): GameTableDropActionContext {
  return {
    zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
    snapshot,
    handDropPreview: () => ({ playerId: 'player-1', targetInstanceId: 'hand-2', placement: 'before' }),
    findCard: (playerId, zone, instanceId) =>
      snapshot().players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
    canControlPlayer: (playerId) => playerId === 'player-1',
    canControlOwnedCard: () => true,
    playerName: (playerId) => playerId,
    setPendingBattlefieldMove: vi.fn(),
    setPendingLibraryMove: vi.fn(),
    endCardDrag: vi.fn(),
    clearHandDropPreview: vi.fn(),
    clearSelectedCards: vi.fn(),
    suppressCardPreview: vi.fn(),
    setError: vi.fn(),
    snapBattlefieldPosition: (_playerId, _instanceId, position) => position,
    markPendingManaDrop: vi.fn(),
    markPendingTransfer: vi.fn(),
    command,
    recordCommanderCastIfNeeded: vi.fn(async () => undefined),
    ...overrides,
  };
}

function dragEvent(
  payload: { playerId: string; zone: GameZoneName; instanceId: string; instanceIds?: string[] },
  rawZone?: string,
  pointer: { clientX?: number; clientY?: number } = {},
): DragEvent {
  const battlefield = document.createElement('div');
  battlefield.classList.add('battlefield');
  battlefield.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect);
  const target = document.createElement('div');
  target.dataset['gameDropZone'] = rawZone ?? payload.zone;
  target.dataset['zone'] = rawZone ?? payload.zone;
  target.dataset['playerId'] = payload.playerId;
  if (rawZone === 'mana') {
    target.dataset['manaLane'] = '';
  }
  target.getBoundingClientRect = () => ({ left: 0, top: 200, right: 800, bottom: 360, width: 800, height: 160 } as DOMRect);
  battlefield.appendChild(target);

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientX: pointer.clientX ?? 180,
    clientY: pointer.clientY ?? 240,
    target,
    currentTarget: target,
    dataTransfer: {
      getData: (type: string) => type === 'application/json' ? JSON.stringify(payload) : '',
    },
  } as unknown as DragEvent;
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
          graveyard: zones.graveyard ?? [],
          exile: zones.exile ?? [],
          command: zones.command ?? [],
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

function moveCardToHand(snapshot: GameSnapshot, playerId: string, fromZone: GameZoneName, instanceId: string): GameSnapshot {
  const player = snapshot.players[playerId]!;
  const moved = player.zones[fromZone].find((candidate) => candidate.instanceId === instanceId)!;

  return {
    ...snapshot,
    players: {
      ...snapshot.players,
      [playerId]: {
        ...player,
        zones: {
          ...player.zones,
          [fromZone]: player.zones[fromZone].filter((candidate) => candidate.instanceId !== instanceId),
          hand: [...player.zones.hand, { ...moved, zone: 'hand', position: { x: 0, y: 0 } }],
        },
      },
    },
  };
}

function moveCardsToHand(snapshot: GameSnapshot, playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]): GameSnapshot {
  let next = snapshot;
  for (const instanceId of instanceIds) {
    next = moveCardToHand(next, playerId, fromZone, instanceId);
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
