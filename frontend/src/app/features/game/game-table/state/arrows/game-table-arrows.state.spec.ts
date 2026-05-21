import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePermanentRelationService } from '../../services/game-table-permanent-relation.service';
import { GameTableArrowInteractionContext, GameTableArrowsState } from './game-table-arrows.state';

describe('GameTableArrowsState', () => {
  let state: GameTableArrowsState;
  let snapshotSignal: ReturnType<typeof signal<GameSnapshot | null>>;

  beforeEach(() => {
    snapshotSignal = signal<GameSnapshot | null>(null);

    TestBed.configureTestingModule({
      providers: [
        GameTableArrowsState,
        GameTablePermanentRelationService,
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal } satisfies Pick<GameTableCoreState, 'snapshot'>,
        },
      ],
    });

    state = TestBed.inject(GameTableArrowsState);
  });

  it('uses the first color identity color and falls back to yellow', () => {
    expect(state.arrowColorForCard(card('card-1', ['U', 'R']))).toBe('blue');
    expect(state.arrowColorForCard(card('card-2', []))).toBe('yellow');
    expect(state.arrowColorForCard(card('card-3'))).toBe('yellow');
  });

  it('counts owned arrows from ownedArrowIds', () => {
    snapshotSignal.set(snapshot());

    expect(state.ownedArrowIds('player-1')).toEqual(['arrow-owned', 'arrow-source-owned']);
    expect(state.ownedArrowCount('player-1')).toBe(2);
  });

  it('starts arrow targeting from a controllable battlefield card', () => {
    const context = arrowContext();

    state.startArrowFrom(context, { kind: 'card', playerId: 'player-1', zone: 'battlefield', card: card('source-card'), x: 0, y: 0 }, 2);

    expect(state.pendingArrowSource()).toEqual({
      instanceId: 'source-card',
      cardName: 'source-card',
      color: 'yellow',
      targetCount: 2,
      selectedTargetInstanceIds: [],
    });
    expect(context.showArrowTargetProgressToast).toHaveBeenCalledWith(2);
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('cancels pending arrow targeting when the source card is clicked', () => {
    const context = arrowContext();
    state.pendingArrowSource.set({
      instanceId: 'source-card',
      cardName: 'source-card',
      color: 'yellow',
      targetCount: 1,
      selectedTargetInstanceIds: [],
    });
    const event = mouseEvent();

    const handled = state.handleBattlefieldCardClick(context, event, card('source-card'));

    expect(handled).toBe(true);
    expect(state.pendingArrowSource()).toBeNull();
    expect(context.showTargetToast).toHaveBeenCalledWith('Target selection cancelled.');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('keeps multi-target arrow selection pending until all targets are selected', async () => {
    const context = arrowContext();
    state.pendingArrowSource.set({
      instanceId: 'source-card',
      cardName: 'source-card',
      color: 'yellow',
      targetCount: 2,
      selectedTargetInstanceIds: [],
    });

    state.handleBattlefieldCardClick(context, mouseEvent(), card('target-a'));
    await Promise.resolve();

    expect(state.pendingArrowSource()?.selectedTargetInstanceIds).toEqual(['target-a']);
    expect(context.command).toHaveBeenCalledWith('arrow.created', {
      fromInstanceId: 'source-card',
      toInstanceId: 'target-a',
      color: 'yellow',
    });
    expect(context.showArrowTargetProgressToast).toHaveBeenCalledWith(1);

    state.handleBattlefieldCardClick(context, mouseEvent(), card('target-b'));
    await Promise.resolve();

    expect(state.pendingArrowSource()).toBeNull();
    expect(context.clearTargetToast).toHaveBeenCalled();
  });
});

function snapshot(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player('player-1', [card('source-card')]),
      'player-2': player('player-2', [card('target-card')]),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [
      {
        id: 'arrow-owned',
        ownerId: 'player-1',
        fromInstanceId: 'external-source',
        toInstanceId: 'target-card',
        color: 'yellow',
        createdAt: '2026-05-19T00:00:00+00:00',
      },
      {
        id: 'arrow-source-owned',
        fromInstanceId: 'source-card',
        toInstanceId: 'target-card',
        color: 'yellow',
        createdAt: '2026-05-19T00:00:00+00:00',
      },
      {
        id: 'arrow-other',
        ownerId: 'player-2',
        fromInstanceId: 'target-card',
        toInstanceId: 'source-card',
        color: 'yellow',
        createdAt: '2026-05-19T00:00:00+00:00',
      },
    ],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(id: string, battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: user(id),
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string, colorIdentity?: string[]): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    colorIdentity,
    tapped: false,
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

function arrowContext(): GameTableArrowInteractionContext {
  return {
    canControlOwnedCard: vi.fn(() => true),
    setError: vi.fn(),
    closeContextMenu: vi.fn(),
    showArrowTargetProgressToast: vi.fn(),
    showTargetToast: vi.fn(),
    clearTargetToast: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
  };
}

function mouseEvent(): MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}
