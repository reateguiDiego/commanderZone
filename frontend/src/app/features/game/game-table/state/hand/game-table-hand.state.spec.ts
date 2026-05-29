import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCommandType, GamePlayerState, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { PendingBattlefieldMove, PendingLibraryMove } from '../../services/game-table-drop-actions.service';
import { GameTableBattlefieldDragState } from '../drag-drop/game-table-battlefield-drag.state';
import { GameTableHandContext, GameTableHandState } from './game-table-hand.state';

describe('GameTableHandState', () => {
  let state: GameTableHandState;
  let currentSnapshot: GameSnapshot | null;
  let selectedInstanceIds: string[];
  let commandCalls: Array<{ type: GameCommandType; payload: Record<string, unknown> }>;
  let pendingLibraryMove: PendingLibraryMove | null;
  let pendingBattlefieldMove: PendingBattlefieldMove | null;
  let clearedSelection: boolean;
  let visualPositions: Record<string, { x: number; y: number }>;
  let localBattlefieldMove:
    | { playerId: string; targetPlayerId: string; movedInstanceIds: readonly string[]; position?: unknown }
    | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableHandState,
        GameTableBattlefieldDragState,
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: { updateActiveDropTarget: vi.fn() },
        },
        {
          provide: GameTableDragService,
          useValue: { allowDrop: vi.fn(), dragPayload: vi.fn() },
        },
      ],
    });

    state = TestBed.inject(GameTableHandState);
    currentSnapshot = snapshot([card('a'), card('b'), card('c'), card('d')]);
    selectedInstanceIds = [];
    commandCalls = [];
    pendingLibraryMove = null;
    pendingBattlefieldMove = null;
    clearedSelection = false;
    visualPositions = {};
    localBattlefieldMove = null;
  });

  it('reorders multiple selected hand cards around the target card', async () => {
    selectedInstanceIds = ['b', 'd'];

    await state.reorderHandCard(context(), 'player-1', 'b', 'a', 'after');

    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0]?.type).toBe('zone.changed');
    expect((commandCalls[0]?.payload['cards'] as GameCardInstance[]).map((item) => item.instanceId)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('creates a pending library move instead of sending the command immediately', async () => {
    selectedInstanceIds = ['a', 'c'];

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'a', 'library');

    expect(commandCalls).toEqual([]);
    expect(pendingLibraryMove).toEqual({
      cardName: '2 cards',
      commandType: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'hand',
        toZone: 'library',
        instanceIds: ['a', 'c'],
      },
    });
    expect(clearedSelection).toBe(true);
  });

  it('moves multiple selected hand cards to battlefield with one aggregate command', async () => {
    selectedInstanceIds = ['a', 'c'];

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'a', 'battlefield', { x: 120, y: 180 });

    expect(localBattlefieldMove).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceIds: ['a', 'c'],
      position: { x: 120, y: 180, unit: 'ratio' },
    });
    expect(commandCalls).toEqual([{
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        targetPlayerId: 'player-1',
        instanceIds: ['a', 'c'],
        position: { x: 120, y: 180, unit: 'ratio' },
      },
    }]);
    expect(clearedSelection).toBe(true);
  });

  it('stacks a land from hand directly onto a battlefield land', async () => {
    currentSnapshot = snapshot([land('hand-land')], [land('battlefield-land', { x: 0.3, y: 0.4 })]);
    visualPositions = { 'battlefield-land': { x: 100, y: 200 } };

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'hand-land', 'battlefield', { x: 104, y: 202 });

    expect(localBattlefieldMove).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceIds: ['hand-land'],
      position: { x: 110, y: 182, unit: 'ratio' },
    });
    expect(commandCalls[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        targetPlayerId: 'player-1',
        instanceId: 'hand-land',
        position: { x: 110, y: 182, unit: 'ratio' },
      },
    });
  });

  it('adds a land from hand directly as the third card of a battlefield stack', async () => {
    currentSnapshot = snapshot(
      [land('hand-land')],
      [
        land('stack-top', { x: 100, y: 200 }),
        land('stack-under', { x: 100, y: 182 }),
      ],
    );

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'hand-land', 'battlefield', { x: 100, y: 200 });

    expect(localBattlefieldMove).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceIds: ['hand-land'],
      position: { x: 120, y: 164, unit: 'ratio' },
    });
    expect(commandCalls[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        targetPlayerId: 'player-1',
        instanceId: 'hand-land',
        position: { x: 120, y: 164, unit: 'ratio' },
      },
    });
  });

  it('adds a hand land to the stack top relation when hovering the exposed second stack card', async () => {
    currentSnapshot = snapshot(
      [land('hand-land')],
      [
        land('stack-top', { x: 100, y: 200 }),
        land('stack-under', { x: 100, y: 182 }),
      ],
    );

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'hand-land', 'battlefield', { x: 106, y: 196 });

    expect(localBattlefieldMove).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceIds: ['hand-land'],
      position: { x: 120, y: 164, unit: 'ratio' },
    });
  });

  it('attaches a non-land card from hand directly onto a battlefield permanent', async () => {
    currentSnapshot = snapshot([card('hand-equipment')], [{
      ...card('target-card'),
      typeLine: 'Creature - Bear',
      position: { x: 100, y: 200 },
    }]);

    await state.moveHandCardByPointer(context(), 'player-1', 'player-1', 'hand-equipment', 'battlefield', { x: 104, y: 202 });

    expect(localBattlefieldMove).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceIds: ['hand-equipment'],
      position: { x: 110, y: 182, unit: 'ratio' },
    });
    expect(commandCalls).toEqual([
      {
        type: 'card.moved',
        payload: {
          playerId: 'player-1',
          fromZone: 'hand',
          toZone: 'battlefield',
          targetPlayerId: 'player-1',
          instanceId: 'hand-equipment',
          position: { x: 110, y: 182, unit: 'ratio' },
        },
      },
      {
        type: 'attachment.created',
        payload: {
          equipmentInstanceId: 'hand-equipment',
          attachedToInstanceId: 'target-card',
        },
      },
    ]);
  });

  function context(): GameTableHandContext {
    return {
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      snapshot: () => currentSnapshot,
      selectedDragInstanceIds: (_playerId, _zone, instanceId) => selectedInstanceIds.length > 0 ? selectedInstanceIds : [instanceId],
      findCard: (playerId, zone, instanceId) =>
        currentSnapshot?.players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
      canControlOwnedCard: () => true,
      playerName: (playerId) => playerId,
      battlefieldDragContext: () => ({
        zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
        snapshot: () => currentSnapshot,
        selectedCards: () => [],
        findCard: () => null,
        cardPosition: (card) => visualPositions[card.instanceId] ?? card.position ?? null,
        updateLocalCardPosition: () => undefined,
      }),
      snapBattlefieldPosition: (_playerId, _instanceId, position) => ({ ...position, unit: 'ratio' }),
      moveLocalCardsFromHandToBattlefield: (playerId, targetPlayerId, movedInstanceIds, position) => {
        localBattlefieldMove = { playerId, targetPlayerId, movedInstanceIds, position };

        return true;
      },
      markPendingManaDrop: () => undefined,
      markPendingBattlefieldEntry: () => undefined,
      markPendingTransfer: () => undefined,
      setPendingBattlefieldMove: (move) => {
        pendingBattlefieldMove = move;
      },
      setPendingLibraryMove: (move) => {
        pendingLibraryMove = move;
      },
      clearSelectedCards: () => {
        clearedSelection = true;
      },
      setError: () => undefined,
      command: async (type, payload) => {
        commandCalls.push({ type, payload });
      },
      recordCommanderCastIfNeeded: async () => undefined,
    };
  }
});

function snapshot(hand: GameCardInstance[], battlefield: GameCardInstance[] = []): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player(hand, battlefield),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(hand: GameCardInstance[], battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: user('player-1'),
    life: 40,
    zones: {
      library: [],
      hand,
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: `Card ${instanceId}`,
    tapped: false,
  };
}

function land(instanceId: string, position?: { x: number; y: number }): GameCardInstance {
  return {
    ...card(instanceId),
    typeLine: 'Basic Land - Forest',
    ...(position ? { position } : {}),
  };
}

function user(id: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName: id,
    roles: [],
  };
}
