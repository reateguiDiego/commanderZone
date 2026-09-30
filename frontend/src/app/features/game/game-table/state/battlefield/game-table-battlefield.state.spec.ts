import { TestBed } from '@angular/core/testing';
import { GameBattlefieldStack, GameCardInstance, GameCardPosition, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';
import { GameTableLayoutState } from '../../game-table-layout/game-table-layout-state';
import { GameTableBattlefieldContext, GameTableBattlefieldState } from './game-table-battlefield.state';

const GEOMETRY_FRAME_CACHE_STORAGE_KEY = 'cz_perf_geometry_cache';

describe('GameTableBattlefieldState', () => {
  let state: GameTableBattlefieldState;
  let currentSnapshot: GameSnapshot | null;

  beforeEach(() => {
    window.localStorage.removeItem(GEOMETRY_FRAME_CACHE_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [
        GameTableBattlefieldState,
        GameTableLayoutState,
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
    window.localStorage.removeItem(GEOMETRY_FRAME_CACHE_STORAGE_KEY);
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

  it('uses the existing feedback-tracked snapshot path for regular local battlefield updates', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('card-1', 'Card', { x: 0.1, y: 0.2, unit: 'ratio' })],
    });
    const setSnapshot = vi.fn((next: GameSnapshot | null) => {
      currentSnapshot = next;
    });

    state.updateLocalCardPosition({ ...context(), setSnapshot }, 'player-1', 'card-1', { x: 180, y: 220 });

    expect(setSnapshot).toHaveBeenCalledOnce();
    expect(setSnapshot.mock.calls[0]).toHaveLength(1);
    expect(currentSnapshot?.players['player-1']?.zones.battlefield[0]?.position).toMatchObject({ unit: 'ratio' });
  });

  it('skips drop feedback only for an explicitly transient pointer update while publishing the snapshot', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('card-1', 'Card', { x: 0.1, y: 0.2, unit: 'ratio' })],
    });
    const previousSnapshot = currentSnapshot;
    const setSnapshot = vi.fn((next: GameSnapshot | null) => {
      currentSnapshot = next;
    });

    state.updateLocalCardPosition(
      { ...context(), setSnapshot },
      'player-1',
      'card-1',
      { x: 180, y: 220 },
      { transientPointerDrag: true },
    );

    expect(setSnapshot).toHaveBeenCalledWith(expect.any(Object), { trackDropFeedback: false });
    expect(currentSnapshot).not.toBe(previousSnapshot);
    expect(currentSnapshot?.players['player-1']?.zones.battlefield[0]?.position).toMatchObject({ unit: 'ratio' });
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

  it('clamps legacy positions per Grid cell without rewriting the snapshot or Square geometry', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [card('legacy', 'Legacy', { x: 900, y: 800 })],
    });
    const layout = TestBed.inject(GameTableLayoutState);
    const players = [{ id: 'player-1', state: currentSnapshot.players['player-1']! }];
    layout.connect({ gameId: () => 'game-1', players: () => players, currentPlayer: () => players[0] });
    TestBed.tick();
    state.setLayoutSize({ width: 1200, height: 900 });
    layout.select('grid');
    const legacy = currentSnapshot.players['player-1']!.zones.battlefield[0]!;
    document.body.innerHTML =
      '<section class="battlefield" data-player-id="player-1"><div data-testid="game-card" data-card-instance-id="legacy"></div></section>';
    const element = document.querySelector<HTMLElement>('[data-card-instance-id="legacy"]')!;
    Object.defineProperty(element, 'offsetWidth', { value: 100 });
    Object.defineProperty(element, 'offsetHeight', { value: 140 });
    layout.recordSize({
      playerId: 'player-1',
      rect: { width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 },
    });
    expect(state.cardPosition(legacy)).toEqual({ x: 184, y: 38 });
    layout.recordSize({
      playerId: 'player-1',
      rect: { width: 240, height: 180, left: 0, top: 0, right: 240, bottom: 180 },
    });
    expect(state.cardPosition(legacy)).toEqual({ x: 124, y: 18 });
    const before = structuredClone(currentSnapshot);
    state.reflowBattlefieldCardPositions(context());
    expect(currentSnapshot).toEqual(before);
    expect(TestBed.inject(GameTableCommandService).send).not.toHaveBeenCalled();
    expect(state.layoutSize()).toEqual({ width: 1200, height: 900 });
    layout.select('square');
    expect(state.cardPosition(legacy)).toEqual({ x: 900, y: 800 });
  });

  it('does not rewrite land stack positions during reflow because the view clamps the stack as one group', () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [
        { ...card('top', 'Forest', { x: 100, y: 198 }), typeLine: 'Basic Land - Forest' },
        { ...card('middle', 'Island', { x: 110, y: 184 }), typeLine: 'Basic Land - Island' },
        { ...card('bottom', 'Swamp', { x: 120, y: 170 }), typeLine: 'Basic Land - Swamp' },
      ],
      battlefieldStacks: [
        stack('stack-middle', 'middle', 'top'),
        stack('stack-bottom', 'bottom', 'top'),
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

    expect(state.cardPosition(currentSnapshot.players['player-1']!.zones.battlefield[0]!)).toEqual({ x: 184, y: 38 });
  });

  it('keeps the original geometry measurements when the local flag is disabled', () => {
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    const battlefieldBounds = vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 800,
    } as DOMRect);
    const cardBounds = vi.spyOn(cardElement, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 200,
    } as DOMRect);
    const battlefieldElements = vi.spyOn(document, 'querySelectorAll');
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame');

    try {
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      window.localStorage.setItem(GEOMETRY_FRAME_CACHE_STORAGE_KEY, '1');
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });

      expect(battlefieldBounds).toHaveBeenCalledTimes(2);
      expect(cardBounds).toHaveBeenCalledTimes(2);
      expect(battlefieldElements).toHaveBeenCalledTimes(4);
      expect(animationFrame).not.toHaveBeenCalled();
    } finally {
      animationFrame.mockRestore();
      battlefieldElements.mockRestore();
      cardBounds.mockRestore();
      battlefieldBounds.mockRestore();
    }
  });

  it('reuses measured geometry in one animation frame and keeps the connected battlefield element cached', () => {
    state = createStateWithGeometryFrameCache(true);
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    const battlefieldBounds = vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 800,
    } as DOMRect);
    const cardBounds = vi.spyOn(cardElement, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 200,
    } as DOMRect);
    const battlefieldElements = vi.spyOn(document, 'querySelectorAll');
    const animationFrames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    try {
      const first = state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      const second = state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });

      expect(first).toEqual({ x: 0.5, y: 0.5, unit: 'ratio' });
      expect(second).toEqual(first);
      expect(battlefieldBounds).toHaveBeenCalledTimes(1);
      expect(cardBounds).toHaveBeenCalledTimes(1);
      expect(battlefieldElements).toHaveBeenCalledTimes(1);
      expect(animationFrames).toHaveLength(1);

      animationFrames[0]?.(0);
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });

      expect(battlefieldBounds).toHaveBeenCalledTimes(2);
      expect(cardBounds).toHaveBeenCalledTimes(2);
      expect(battlefieldElements).toHaveBeenCalledTimes(1);
    } finally {
      animationFrame.mockRestore();
      battlefieldElements.mockRestore();
      cardBounds.mockRestore();
      battlefieldBounds.mockRestore();
    }
  });

  it('replaces a disconnected cached battlefield element', () => {
    state = createStateWithGeometryFrameCache(true);
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const firstBattlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const firstCard = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    const firstBounds = vi.spyOn(firstBattlefield, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 800,
    } as DOMRect);
    const firstCardBounds = vi.spyOn(firstCard, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 200,
    } as DOMRect);
    const battlefieldElements = vi.spyOn(document, 'querySelectorAll');
    const animationFrames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    try {
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      firstBattlefield.remove();
      document.body.insertAdjacentHTML('beforeend', `
        <section class="battlefield" data-player-id="player-1">
          <div data-testid="game-card" data-card-instance-id="card-1"></div>
        </section>
      `);
      const replacementBattlefield = document.querySelector<HTMLElement>('.battlefield')!;
      const replacementCard = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
      const replacementBounds = vi.spyOn(replacementBattlefield, 'getBoundingClientRect').mockReturnValue({
        width: 900,
        height: 700,
      } as DOMRect);
      const replacementCardBounds = vi.spyOn(replacementCard, 'getBoundingClientRect').mockReturnValue({
        width: 90,
        height: 180,
      } as DOMRect);

      try {
        animationFrames[0]?.(0);
        state.ratioPositionForBattlefield('player-1', 'card-1', { x: 405, y: 260 });

        expect(firstBounds).toHaveBeenCalledTimes(1);
        expect(firstCardBounds).toHaveBeenCalledTimes(1);
        expect(replacementBounds).toHaveBeenCalledTimes(1);
        expect(replacementCardBounds).toHaveBeenCalledTimes(1);
        expect(battlefieldElements).toHaveBeenCalledTimes(2);
      } finally {
        replacementCardBounds.mockRestore();
        replacementBounds.mockRestore();
      }
    } finally {
      animationFrame.mockRestore();
      battlefieldElements.mockRestore();
      firstCardBounds.mockRestore();
      firstBounds.mockRestore();
    }
  });

  it('keeps frame geometry caches independent for each player', () => {
    state = createStateWithGeometryFrameCache(true);
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
      <section class="battlefield" data-player-id="player-2">
        <div data-testid="game-card" data-card-instance-id="card-2"></div>
      </section>
    `;
    const battlefields = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card-instance-id]'));
    const firstBattlefieldBounds = vi.spyOn(battlefields[0]!, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 800,
    } as DOMRect);
    const secondBattlefieldBounds = vi.spyOn(battlefields[1]!, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
    } as DOMRect);
    const firstCardBounds = vi.spyOn(cards[0]!, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 200,
    } as DOMRect);
    const secondCardBounds = vi.spyOn(cards[1]!, 'getBoundingClientRect').mockReturnValue({
      width: 160,
      height: 240,
    } as DOMRect);
    const battlefieldElements = vi.spyOn(document, 'querySelectorAll');
    const animationFrames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    try {
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      state.ratioPositionForBattlefield('player-2', 'card-2', { x: 320, y: 180 });
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      state.ratioPositionForBattlefield('player-2', 'card-2', { x: 320, y: 180 });

      expect(firstBattlefieldBounds).toHaveBeenCalledTimes(1);
      expect(secondBattlefieldBounds).toHaveBeenCalledTimes(1);
      expect(firstCardBounds).toHaveBeenCalledTimes(1);
      expect(secondCardBounds).toHaveBeenCalledTimes(1);
      expect(battlefieldElements).toHaveBeenCalledTimes(2);
      expect(animationFrames).toHaveLength(1);
    } finally {
      animationFrame.mockRestore();
      battlefieldElements.mockRestore();
      secondCardBounds.mockRestore();
      firstCardBounds.mockRestore();
      secondBattlefieldBounds.mockRestore();
      firstBattlefieldBounds.mockRestore();
    }
  });

  it('rearms the geometry cache after a synchronous animation-frame callback', () => {
    state = createStateWithGeometryFrameCache(true);
    document.body.innerHTML = `
      <section class="battlefield" data-player-id="player-1">
        <div data-testid="game-card" data-card-instance-id="card-1"></div>
      </section>
    `;
    const battlefield = document.querySelector<HTMLElement>('.battlefield')!;
    const cardElement = document.querySelector<HTMLElement>('[data-card-instance-id="card-1"]')!;
    const battlefieldBounds = vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 800,
    } as DOMRect);
    const cardBounds = vi.spyOn(cardElement, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 200,
    } as DOMRect);
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });
      state.ratioPositionForBattlefield('player-1', 'card-1', { x: 450, y: 300 });

      expect(animationFrame).toHaveBeenCalledTimes(4);
      expect(battlefieldBounds).toHaveBeenCalledTimes(2);
      expect(cardBounds).toHaveBeenCalledTimes(2);
    } finally {
      animationFrame.mockRestore();
      cardBounds.mockRestore();
      battlefieldBounds.mockRestore();
    }
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

  it('queues batch battlefield positions and keeps all optimistic ratio positions local', async () => {
    currentSnapshot = snapshot({
      hand: [],
      battlefield: [
        card('card-1', 'First', { x: 0.1, y: 0.2, unit: 'ratio' }),
        card('card-2', 'Second', { x: 0.2, y: 0.3, unit: 'ratio' }),
      ],
    });
    const persist = vi.fn(async () => undefined);
    const payload = {
      playerId: 'player-1',
      zone: 'battlefield',
      positions: [
        { instanceId: 'card-1', position: { x: 0.35, y: 0.45, unit: 'ratio' } },
        { instanceId: 'card-2', position: { x: 0.55, y: 0.65, unit: 'ratio' } },
      ],
    };

    const queued = state.tryQueueBattlefieldPositionCommand(context(), 'game-1', payload, persist);
    const optimistic = state.applyOptimisticBattlefieldPositions(currentSnapshot);
    await Promise.resolve();
    await Promise.resolve();

    expect(queued).toBe(true);
    expect(optimistic?.players['player-1']?.zones.battlefield.map((item) => item.position)).toEqual([
      { x: 0.35, y: 0.45, unit: 'ratio' },
      { x: 0.55, y: 0.65, unit: 'ratio' },
    ]);
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

    expect(position).toEqual({ x: 0.50905, y: 0.470219, unit: 'ratio' });
    expect(JSON.stringify(payload)).not.toContain('zoomPercent');
  });

  function context(): GameTableBattlefieldContext {
    return {
      snapshot: () => currentSnapshot,
      setSnapshot: (next) => {
        currentSnapshot = next;
      },
      setViewportReflowSnapshot: (next) => {
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
        battlefieldCardSize: () => ({ width: 120, height: 168 }),
        updateLocalCardPosition: () => undefined,
      }),
      alignmentGuideFor: () => null,
    };
  }
});

function createStateWithGeometryFrameCache(enabled: boolean): GameTableBattlefieldState {
  if (enabled) {
    window.localStorage.setItem(GEOMETRY_FRAME_CACHE_STORAGE_KEY, '1');
  } else {
    window.localStorage.removeItem(GEOMETRY_FRAME_CACHE_STORAGE_KEY);
  }

  return TestBed.runInInjectionContext(() => new GameTableBattlefieldState());
}

function snapshot(options: {
  hand: GameCardInstance[];
  battlefield: GameCardInstance[];
  battlefieldStacks?: GameBattlefieldStack[];
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
    battlefieldStacks: options.battlefieldStacks ?? [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function stack(id: string, stackedInstanceId: string, stackTopInstanceId: string): GameBattlefieldStack {
  return {
    id,
    stackedInstanceId,
    stackTopInstanceId,
    createdAt: '2026-09-08T10:00:00+00:00',
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
