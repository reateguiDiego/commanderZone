import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableBattlefieldState } from '../battlefield/game-table-battlefield.state';
import { GameTableCoreState } from '../core/game-table-core.state';
import { PlayerView } from '../core/game-table-snapshot-selectors';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableOpponentTargetsState } from './game-table-opponent-targets.state';

describe('GameTableOpponentTargetsState', () => {
  let state: GameTableOpponentTargetsState;
  let snapshotSignal: ReturnType<typeof signal<GameSnapshot | null>>;
  let positionByInstanceId: Map<string, { x: number; y: number }>;

  beforeEach(() => {
    snapshotSignal = signal<GameSnapshot | null>(null);
    positionByInstanceId = new Map();
    const players = computed<PlayerView[]>(() =>
      Object.entries(snapshotSignal()?.players ?? {}).map(([id, playerState]) => ({ id, state: playerState })),
    );
    const currentPlayer = computed<PlayerView | null>(() => players().find((player) => player.id === 'player-1') ?? null);

    TestBed.configureTestingModule({
      providers: [
        GameTableOpponentTargetsState,
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal } satisfies Pick<GameTableCoreState, 'snapshot'>,
        },
        {
          provide: GameTablePlayersStore,
          useValue: {
            players,
            currentPlayer,
            deckLabel: (player: PlayerView | null) => player?.state.deckName ?? '',
          } satisfies Pick<GameTablePlayersStore, 'players' | 'currentPlayer' | 'deckLabel'>,
        },
        {
          provide: GameTableBattlefieldState,
          useValue: {
            cardPosition: (card: GameCardInstance) => positionByInstanceId.get(card.instanceId) ?? null,
          } satisfies Pick<GameTableBattlefieldState, 'cardPosition'>,
        },
      ],
    });

    state = TestBed.inject(GameTableOpponentTargetsState);
  });

  it('builds an outgoing pill when the current player targets an opponent battlefield', () => {
    snapshotSignal.set(snapshot({
      arrows: [arrow('arrow-1', 'current-source', 'opponent-target')],
    }));

    expect(state.opponentTargetingPills().get('player-2')).toEqual({
      direction: 'outgoing',
      text: 'Objetivo: Opponent Deck',
      title: 'Opponent Deck es el objetivo de una de tus flechas.',
    });
  });

  it('builds an incoming pill when an opponent targets the current player battlefield', () => {
    snapshotSignal.set(snapshot({
      arrows: [arrow('arrow-1', 'opponent-source', 'current-target')],
    }));

    expect(state.opponentTargetingPills().get('player-2')).toEqual({
      direction: 'incoming',
      text: 'Objetivo de Opponent Deck',
      title: 'Una de tus cartas es objetivo de Opponent Deck.',
    });
  });

  it('uses the multiple label for multiple outgoing targets on the same opponent', () => {
    snapshotSignal.set(snapshot({
      player1Battlefield: [card('current-source'), card('current-second-source')],
      player2Battlefield: [card('opponent-target'), card('opponent-second-target')],
      arrows: [
        arrow('arrow-1', 'current-source', 'opponent-target'),
        arrow('arrow-2', 'current-second-source', 'opponent-second-target'),
      ],
    }));

    expect(state.opponentTargetingPills().get('player-2')).toEqual({
      direction: 'outgoing',
      text: 'Objetivo: multiple',
      title: 'Tienes multiples objetivos en este battlefield.',
    });
  });

  it('marks opponent card target roles as source, target and both', () => {
    snapshotSignal.set(snapshot({
      player1Battlefield: [card('current-source'), card('current-target'), card('current-both')],
      player2Battlefield: [card('opponent-target'), card('opponent-source'), card('opponent-both')],
      arrows: [
        arrow('arrow-1', 'current-source', 'opponent-target'),
        arrow('arrow-2', 'opponent-source', 'current-target'),
        arrow('arrow-3', 'current-both', 'opponent-both'),
        arrow('arrow-4', 'opponent-both', 'current-both'),
      ],
    }));

    const currentRoles = rolesByInstanceId(state.opponentCardsTargetCards().get('player-1') ?? []);
    const opponentRoles = rolesByInstanceId(state.opponentCardsTargetCards().get('player-2') ?? []);

    expect(currentRoles).toEqual(new Map([
      ['current-source', 'source'],
      ['current-target', 'target'],
      ['current-both', 'both'],
    ]));
    expect(opponentRoles).toEqual(new Map([
      ['opponent-target', 'target'],
      ['opponent-source', 'source'],
      ['opponent-both', 'both'],
    ]));
  });

  it('sorts target cards by the counterpart card position', () => {
    snapshotSignal.set(snapshot({
      player1Battlefield: [card('current-left'), card('current-right')],
      player2Battlefield: [card('opponent-linked-to-right'), card('opponent-linked-to-left')],
      arrows: [
        arrow('arrow-1', 'current-right', 'opponent-linked-to-right'),
        arrow('arrow-2', 'current-left', 'opponent-linked-to-left'),
      ],
    }));
    positionByInstanceId.set('current-left', { x: 10, y: 0 });
    positionByInstanceId.set('current-right', { x: 200, y: 0 });

    expect(state.opponentCardsTargetCards().get('player-2')?.map((entry) => entry.card.instanceId)).toEqual([
      'opponent-linked-to-left',
      'opponent-linked-to-right',
    ]);
  });
});

function rolesByInstanceId(cards: readonly { card: GameCardInstance; role: string }[]): Map<string, string> {
  return new Map(cards.map((entry) => [entry.card.instanceId, entry.role]));
}

function snapshot(options: {
  player1Battlefield?: GameCardInstance[];
  player2Battlefield?: GameCardInstance[];
  arrows: GameSnapshot['arrows'];
}): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player('player-1', 'Current Player', 'Current Deck', options.player1Battlefield ?? [card('current-source'), card('current-target')]),
      'player-2': player('player-2', 'Opponent Player', 'Opponent Deck', options.player2Battlefield ?? [card('opponent-source'), card('opponent-target')]),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: options.arrows,
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(id: string, displayName: string, deckName: string, battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: user(id, displayName),
    deckName,
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

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
  };
}

function arrow(id: string, fromInstanceId: string, toInstanceId: string): GameSnapshot['arrows'][number] {
  return {
    id,
    fromInstanceId,
    toInstanceId,
    color: 'yellow',
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function user(id: string, displayName: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName,
    roles: [],
  };
}
