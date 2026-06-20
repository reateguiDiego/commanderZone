import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';
import { GameTableCardsState } from './game-table-cards.state';

describe('GameTableCardsState', () => {
  let state: GameTableCardsState;
  let core: GameTableCoreState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableCardsState,
        GameTableCoreState,
        GameTableSnapshotSelectors,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'game-1']]) } },
        },
      ],
    });

    state = TestBed.inject(GameTableCardsState);
    core = TestBed.inject(GameTableCoreState);
  });

  afterEach(() => {
    state.clearCardCounterFlushTimers();
    vi.useRealTimers();
  });

  it('allows existing counters but blocks a sixth distinct counter', () => {
    const card = cardWithCounters({
      charge: 1,
      shield: 1,
      stun: 1,
      finality: 1,
      '+1/+1': 1,
    });

    expect(state.canAddCardCounter(card, '+1/+1')).toBe(true);
    expect(state.canAddCardCounter(card, 'new-counter')).toBe(false);
  });

  it('updates the local snapshot optimistically when a counter is queued', () => {
    vi.useFakeTimers();
    core.snapshot.set(snapshot([cardWithCounters({ '+1/+1': 1 })]));

    state.queueCardCounter({
      setSnapshot: (next) => core.snapshot.set(next),
      errorMessage: () => 'error',
      refetch: vi.fn(),
      command: vi.fn(),
    }, {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      key: '+1/+1',
      value: 2,
    });

    const updated = core.snapshot()?.players['player-1']?.zones.battlefield[0];

    expect(updated?.counters?.['+1/+1']).toBe(2);
    expect(updated?.power).toBe(3);
    expect(updated?.toughness).toBe(3);
  });

  it('keeps a zero-value card counter marker when initialized from the context menu', () => {
    vi.useFakeTimers();
    core.snapshot.set(snapshot([cardWithCounters({})]));

    state.queueCardCounter({
      setSnapshot: (next) => core.snapshot.set(next),
      errorMessage: () => 'error',
      refetch: vi.fn(),
      command: vi.fn(),
    }, {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      key: '+1/+1',
      value: 0,
    });

    const updated = core.snapshot()?.players['player-1']?.zones.battlefield[0];

    expect(updated?.counters).toEqual({ '+1/+1': 0 });
    expect(updated?.power).toBe(2);
    expect(updated?.toughness).toBe(2);
  });

  it('removes a card counter only when the queued value is null', () => {
    vi.useFakeTimers();
    core.snapshot.set(snapshot([{ ...cardWithCounters({ '+1/+1': 2 }), power: 4, toughness: 4 }]));

    state.queueCardCounter({
      setSnapshot: (next) => core.snapshot.set(next),
      errorMessage: () => 'error',
      refetch: vi.fn(),
      command: vi.fn(),
    }, {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      key: '+1/+1',
      value: null,
    });

    const updated = core.snapshot()?.players['player-1']?.zones.battlefield[0];

    expect(updated?.counters).toEqual({});
    expect(updated?.power).toBe(2);
    expect(updated?.toughness).toBe(2);
  });

  it('caps The Ring level counter between one and four', () => {
    vi.useFakeTimers();
    core.snapshot.set(snapshot([theRingWithLevel(2)]));

    state.queueCardCounter(cardCounterContext(), {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'the-ring',
      key: 'Level',
      value: 8,
    });

    expect(core.snapshot()?.players['player-1']?.zones.battlefield[0]?.counters?.['Level']).toBe(4);

    state.queueCardCounter(cardCounterContext(), {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'the-ring',
      key: 'Level',
      value: 0,
    });

    expect(core.snapshot()?.players['player-1']?.zones.battlefield[0]?.counters?.['Level']).toBe(1);
  });

  it('keeps The Ring level counter at one when removal is requested', () => {
    vi.useFakeTimers();
    core.snapshot.set(snapshot([theRingWithLevel(2)]));

    state.queueCardCounter(cardCounterContext(), {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'the-ring',
      key: 'Level',
      value: null,
    });

    expect(core.snapshot()?.players['player-1']?.zones.battlefield[0]?.counters).toEqual({ Level: 1 });
  });
});

function cardCounterContext() {
  return {
    setSnapshot: (next: GameSnapshot | null) => TestBed.inject(GameTableCoreState).snapshot.set(next),
    errorMessage: () => 'error',
    refetch: vi.fn(),
    command: vi.fn(),
  };
}

function cardWithCounters(counters: Record<string, number>): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Test Bear',
    tapped: false,
    power: 2,
    toughness: 2,
    defaultPower: 2,
    defaultToughness: 2,
    counters,
  };
}

function theRingWithLevel(level: number): GameCardInstance {
  return {
    instanceId: 'the-ring',
    scryfallId: '7215460e-8c06-47d0-94e5-d1832d0218af',
    name: 'The Ring // The Ring Tempts You',
    typeLine: 'Emblem // Card',
    layout: 'double_faced_token',
    tapped: false,
    counters: { Level: level },
  };
}

function snapshot(battlefield: GameCardInstance[]): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player(battlefield),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: user('player-1'),
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

function user(id: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName: id,
    roles: [],
  };
}
