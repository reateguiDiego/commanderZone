import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableDebouncedValueCommandContext, GameTableDebouncedValueCommandsService } from '../../services/game-table-debounced-value-commands.service';
import { GameTableInteractionContext } from '../../services/game-table-interaction-actions.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { PlayerView } from '../core/game-table-snapshot-selectors';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameContextMenu, GameTableUiState } from '../core/game-table-ui.state';
import { GameTableCardCounterContext, GameTableCardsState } from './game-table-cards.state';
import { GameTableCountersState } from './game-table-counters.state';

const snapshotSignal = signal<GameSnapshot | null>(null);
const errorSignal = signal<string | null>(null);
const playerViewsSignal = signal<PlayerView[]>([]);

describe('GameTableCountersState', () => {
  let state: GameTableCountersState;
  const queueCounter = vi.fn();
  const queueCardCounter = vi.fn();
  const closeContextMenu = vi.fn();
  const canControlPlayer = vi.fn();
  const canAddCardCounter = vi.fn();
  const cardCounterValue = vi.fn();

  beforeEach(() => {
    snapshotSignal.set(snapshot(card()));
    playerViewsSignal.set([playerView()]);
    errorSignal.set(null);
    queueCounter.mockClear();
    queueCardCounter.mockClear();
    closeContextMenu.mockClear();
    canControlPlayer.mockReturnValue(true);
    canAddCardCounter.mockReturnValue(true);
    cardCounterValue.mockReturnValue(1);

    TestBed.configureTestingModule({
      providers: [
        GameTableCountersState,
        {
          provide: GameTableCardsState,
          useValue: {
            canAddCardCounter,
            cardCounterValue,
            queueCardCounter,
          } satisfies Pick<GameTableCardsState, 'canAddCardCounter' | 'cardCounterValue' | 'queueCardCounter'>,
        },
        {
          provide: GameTableContextStore,
          useValue: {
            debouncedValueCommand: () => debouncedValueCommandContext(),
            cardCounter: () => cardCounterContext(),
            interaction: () => interactionContext(),
          } satisfies Pick<GameTableContextStore, 'debouncedValueCommand' | 'cardCounter' | 'interaction'>,
        },
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal, error: errorSignal } satisfies Pick<GameTableCoreState, 'snapshot' | 'error'>,
        },
        {
          provide: GameTableDebouncedValueCommandsService,
          useValue: {
            counterValue: (_scope: string, _key: string, fallback: number) => fallback,
            queueCounter,
          } satisfies Pick<GameTableDebouncedValueCommandsService, 'counterValue' | 'queueCounter'>,
        },
        {
          provide: GameTablePlayersStore,
          useValue: {
            players: playerViewsSignal,
            canControlPlayer,
            commanderCastCount: () => 1,
          } satisfies Pick<GameTablePlayersStore, 'players' | 'canControlPlayer' | 'commanderCastCount'>,
        },
        {
          provide: GameTableUiState,
          useValue: { closeContextMenu } satisfies Pick<GameTableUiState, 'closeContextMenu'>,
        },
      ],
    });

    state = TestBed.inject(GameTableCountersState);
  });

  it('queues player counter changes through the debounced command service', async () => {
    await state.changePlayerCounter('player-1', 'poison', 1);

    expect(queueCounter).toHaveBeenCalledWith(expect.anything(), {
      scope: 'player:player-1',
      key: 'poison',
      value: 3,
    });
  });

  it('does not queue player counters below zero', async () => {
    snapshotSignal.set(snapshot(card(), { poison: 0 }));

    await state.changePlayerCounter('player-1', 'poison', -1);

    expect(queueCounter).not.toHaveBeenCalled();
  });

  it('queues card counter changes and closes the context menu', async () => {
    await state.setCardCounter(menu(card()), '+1/+1', 4);

    expect(queueCardCounter).toHaveBeenCalledWith(expect.anything(), {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      key: '+1/+1',
      value: 4,
    });
    expect(closeContextMenu).toHaveBeenCalled();
  });

  it('keeps card counter limits and error messages unchanged', async () => {
    canAddCardCounter.mockReturnValue(false);

    await state.changeCardCounterForCard('player-1', 'battlefield', card(), 'shield', 1);

    expect(errorSignal()).toBe('Maximum 5 different counters per card.');
    expect(queueCardCounter).not.toHaveBeenCalled();
  });

  it('skips card counter commands when the value does not change', async () => {
    cardCounterValue.mockReturnValue(0);

    await state.changeCardCounterForCard('player-1', 'battlefield', card(), '+1/+1', -1);

    expect(queueCardCounter).not.toHaveBeenCalled();
  });
});

function snapshot(card: GameCardInstance, counters: Record<string, number> = { poison: 2 }): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player(card, counters),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(card: GameCardInstance, counters: Record<string, number>): GamePlayerState {
  return {
    user: user('player-1'),
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield: [card],
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters,
  };
}

function card(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Counter Test',
    tapped: false,
    counters: { '+1/+1': 1 },
  };
}

function menu(card: GameCardInstance): GameContextMenu {
  return {
    kind: 'card',
    playerId: 'player-1',
    zone: 'battlefield',
    card,
    x: 0,
    y: 0,
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

function playerView(): PlayerView {
  return {
    id: 'player-1',
    state: player(card(), { poison: 2 }),
  };
}

function debouncedValueCommandContext(): GameTableDebouncedValueCommandContext {
  return {
    gameId: () => 'game-1',
    pending: () => false,
    setPending: vi.fn(),
    setError: vi.fn(),
    send: vi.fn().mockResolvedValue(snapshot(card())),
    snapshot: () => snapshotSignal(),
    setSnapshot: (next) => snapshotSignal.set(next),
    refetch: vi.fn().mockResolvedValue(undefined),
    errorMessage: () => 'Action failed.',
  };
}

function cardCounterContext(): GameTableCardCounterContext {
  return {
    setSnapshot: (next) => snapshotSignal.set(next),
    errorMessage: () => 'Action failed.',
    refetch: vi.fn().mockResolvedValue(undefined),
  };
}

function interactionContext(): GameTableInteractionContext {
  return {
    currentPlayer: () => null,
    focusedPlayer: () => null,
    zoneCardCount: () => 0,
    setError: vi.fn(),
    playCard: vi.fn().mockResolvedValue(undefined),
  };
}
