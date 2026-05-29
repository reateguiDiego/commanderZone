import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCardPosition, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';
import { GameTableBattlefieldContext, GameTableBattlefieldState } from './game-table-battlefield.state';

describe('GameTableBattlefieldState', () => {
  let state: GameTableBattlefieldState;
  let currentSnapshot: GameSnapshot | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableBattlefieldState,
        GameTableSnapshotSelectors,
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: { positionWithAlignmentGuide: vi.fn((_context, _playerId, _instanceId, position) => position) },
        },
        {
          provide: GameTableCommandService,
          useValue: { send: vi.fn() },
        },
      ],
    });

    state = TestBed.inject(GameTableBattlefieldState);
    currentSnapshot = null;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves local hand cards to battlefield and keeps zone counts in sync', () => {
    currentSnapshot = snapshot({
      hand: [
        card('card-1', 'First'),
        card('card-2', 'Second'),
      ],
      battlefield: [],
      zoneCounts: { hand: 2, battlefield: 0 },
    });

    const moved = state.moveLocalCardsFromHandToBattlefield(context(), 'player-1', 'player-1', ['card-1'], { x: 0.25, y: 0.5, unit: 'ratio' });

    expect(moved).toBe(true);
    expect(currentSnapshot?.players['player-1']?.zones.hand.map((item) => item.instanceId)).toEqual(['card-2']);
    expect(currentSnapshot?.players['player-1']?.zones.battlefield.map((item) => item.instanceId)).toEqual(['card-1']);
    expect(currentSnapshot?.players['player-1']?.zones.battlefield[0]?.position).toEqual({ x: 0.25, y: 0.5, unit: 'ratio' });
    expect(currentSnapshot?.players['player-1']?.zoneCounts?.hand).toBe(1);
    expect(currentSnapshot?.players['player-1']?.zoneCounts?.battlefield).toBe(1);
  });

  it('clamps legacy pixel positions to the visible battlefield viewport during reflow', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('card-1', 'Edge Card', { x: 280, y: 180 })],
    });
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(cardElement, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(cardElement, 'offsetHeight', { configurable: true, value: 140 });

    state.reflowBattlefieldCardPositions(context());

    expect(currentSnapshot?.players['player-1']?.zones.battlefield[0]?.position).toEqual({ x: 200, y: 60 });
  });

  it('does not rewrite land stack positions during reflow because the view clamps the stack as one group', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [
        { ...card('top', 'Forest', { x: 100, y: 198 }), typeLine: 'Basic Land - Forest' },
        { ...card('middle', 'Island', { x: 110, y: 184 }), typeLine: 'Basic Land - Island' },
        { ...card('bottom', 'Swamp', { x: 120, y: 170 }), typeLine: 'Basic Land - Swamp' },
      ],
    });
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="top"></div>
        <div data-testid="game-card" data-card-instance-id="middle"></div>
        <div data-testid="game-card" data-card-instance-id="bottom"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 500 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 360 });
    for (const cardElement of document.querySelectorAll<HTMLElement>('[data-card-instance-id]')) {
      Object.defineProperty(cardElement, 'offsetWidth', { configurable: true, value: 116 });
      Object.defineProperty(cardElement, 'offsetHeight', { configurable: true, value: 202 });
    }

    state.reflowBattlefieldCardPositions(context());

    expect(currentSnapshot?.players['player-1']?.zones.battlefield.map((item) => ({
      id: item.instanceId,
      position: item.position,
    }))).toEqual([
      { id: 'top', position: { x: 100, y: 198 } },
      { id: 'middle', position: { x: 110, y: 184 } },
      { id: 'bottom', position: { x: 120, y: 170 } },
    ]);
  });

  it('uses measured card size for ratio positions so zoomed edge cards remain visible', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('card-1', 'Edge Card', { x: 1, y: 1, unit: 'ratio' })],
    });
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(cardElement, 'offsetWidth', { configurable: true, value: 120 });
    Object.defineProperty(cardElement, 'offsetHeight', { configurable: true, value: 180 });

    state.setLayoutSize({ width: 300, height: 200 });

    expect(state.cardPosition(currentSnapshot.players['player-1']!.zones.battlefield[0]!)).toEqual({ x: 180, y: 20 });
  });

  it('queues the final battlefield position persist callback and keeps the optimistic ratio position local', async () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('card-1', 'Edge Card', { x: 0.1, y: 0.2, unit: 'ratio' })],
    });
    const persist = vi.fn(async () => undefined);
    const payload = {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      position: { x: 0.35, y: 0.45, unit: 'ratio' },
    };

    const queued = state.tryQueueBattlefieldPositionCommand(context(), 'game-1', payload, persist);
    const optimistic = state.applyOptimisticBattlefieldPositions(currentSnapshot);
    await Promise.resolve();
    await Promise.resolve();

    expect(queued).toBe(true);
    expect(optimistic?.players['player-1']?.zones.battlefield[0]?.position).toEqual({ x: 0.35, y: 0.45, unit: 'ratio' });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('normalizes local drag pixels to ratio without carrying zoom state into the command payload', () => {
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 800 });
    Object.defineProperty(cardElement, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(cardElement, 'offsetHeight', { configurable: true, value: 200 });

    const position = state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
    const payload = {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      position,
    };

    expect(position).toEqual({ x: 0.5, y: 0.5, unit: 'ratio' });
    expect(JSON.stringify(payload)).not.toContain('zoomPercent');
  });

  function context(): GameTableBattlefieldContext {
    return {
      snapshot: () => currentSnapshot,
      setSnapshot: (next) => {
        currentSnapshot = next;
      },
      setError: vi.fn(),
      errorMessage: () => 'error',
      battlefieldDragContext: () => ({
        zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
        snapshot: () => currentSnapshot,
        selectedCards: () => [],
        findCard: () => null,
        cardPosition: () => null,
        updateLocalCardPosition: () => undefined,
      }),
      alignmentGuideFor: () => null,
    };
  }
});

function snapshot(options: {
  hand: GameCardInstance[];
  battlefield: GameCardInstance[];
  zoneCounts?: Partial<Record<'hand' | 'battlefield', number>>;
}): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player(options),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(options: {
  hand: GameCardInstance[];
  battlefield: GameCardInstance[];
  zoneCounts?: Partial<Record<'hand' | 'battlefield', number>>;
}): GamePlayerState {
  return {
    user: user('player-1'),
    life: 40,
    zones: {
      library: [],
      hand: options.hand,
      battlefield: options.battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    zoneCounts: {
      library: 0,
      hand: options.hand.length,
      battlefield: options.battlefield.length,
      graveyard: 0,
      exile: 0,
      command: 0,
      ...options.zoneCounts,
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string, name: string, position?: GameCardPosition): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name,
    tapped: false,
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
