import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameControlPlaneState, GameSnapshot, MercureGameEvent } from '../../../../core/models/game.model';
import { BootstrapV2 } from '../../../../core/models/game-v2.model';
import { GameTableGameRealtimeService, GameTableRealtimeHandlers } from './game-table-game-realtime.service';
import { GameTableGameplayV2FlagsService } from './game-table-gameplay-v2-flags.service';
import { GameTableSessionContext, GameTableSessionService } from './game-table-session.service';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';

const gameRealtime = {
  subscribe: vi.fn(),
  stop: vi.fn(),
  seedControlPlaneRevision: vi.fn(),
  acceptControlPlaneState: vi.fn(() => true),
};

describe('GameTableSessionService', () => {
  let service: GameTableSessionService;
  let normalizedV2Store: GameTableNormalizedV2Store;
  const gamesApi = {
    snapshot: vi.fn(),
    bootstrapV2: vi.fn(),
    controlPlane: vi.fn(),
  };
  const gameplayV2Flags = {
    enabled: vi.fn(() => false),
  };
  let websocketStatus: ReturnType<typeof signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>>;
  const websocket = {
    status: signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>('stopped'),
    start: vi.fn(),
    stop: vi.fn(),
  };
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    websocketStatus = signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>('stopped');
    websocket.status = websocketStatus;
    gamesApi.snapshot.mockReset();
    gamesApi.bootstrapV2.mockReset();
    gamesApi.controlPlane.mockReset();
    gameplayV2Flags.enabled.mockReset();
    gameplayV2Flags.enabled.mockReturnValue(false);
    gameRealtime.subscribe.mockReset();
    gameRealtime.stop.mockReset();
    gameRealtime.seedControlPlaneRevision.mockReset();
    gameRealtime.acceptControlPlaneState.mockReset().mockReturnValue(true);
    websocket.start.mockReset();
    websocket.stop.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableSessionService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: GameTableGameRealtimeService, useValue: gameRealtime },
        { provide: GameTableWebsocketGameplayService, useValue: websocket },
        GameTableNormalizedV2Store,
        { provide: GameTableGameplayV2FlagsService, useValue: gameplayV2Flags },
      ],
    });
    service = TestBed.inject(GameTableSessionService);
    normalizedV2Store = TestBed.inject(GameTableNormalizedV2Store);
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  it('applies same-version snapshots when projected deck names changed', async () => {
    const current = snapshot({ deckName: null });
    const next = snapshot({ deckName: 'Food and Fellowship' });
    const setSnapshot = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: next } }));

    await service.refetch(context(current, setSnapshot));

    expect(setSnapshot).toHaveBeenCalledWith(next);
  });

  it('applies same-version snapshots when a player presence changed', async () => {
    const current = snapshot();
    const next = snapshot();
    next.players['player-1'] = { ...next.players['player-1']!, isOnline: false };
    const setSnapshot = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: next } }));

    await service.refetch(context(current, setSnapshot));

    expect(setSnapshot).toHaveBeenCalledWith(next);
  });

  it('ignores same-version snapshots when projection metadata did not change', async () => {
    const current = snapshot({ deckName: 'Food and Fellowship' });
    const next = snapshot({ deckName: 'Food and Fellowship' });
    const setSnapshot = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: next } }));

    await service.refetch(context(current, setSnapshot));

    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it('loads one initial snapshot, starts websocket, and subscribes to game events', async () => {
    const current = snapshot();
    const navigateToWaitingRoom = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn(), navigateToWaitingRoom));

    const handlers = gameRealtimeHandlers();
    handlers.onRematchCreated('room-1');

    expect(navigateToWaitingRoom).toHaveBeenCalledWith('room-1');
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
    expect(websocket.start).toHaveBeenCalledWith(expect.any(Object), 'game-1');
    expect(gameRealtime.subscribe).toHaveBeenCalledWith('game-1', expect.objectContaining({
      onSnapshotInvalidated: expect.any(Function),
      onRematchCreated: expect.any(Function),
      onRoomDeleted: expect.any(Function),
    }));
  });

  it('forwards library reveal callbacks from the live websocket session', async () => {
    const current = snapshot();
    const onLibraryRevealed = vi.fn();
    const onLibraryTopRevealed = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn(), vi.fn(), vi.fn(), vi.fn(), {
      onLibraryRevealed,
      onLibraryTopRevealed,
    }));

    const websocketContext = websocket.start.mock.calls[0]?.[0] as {
      onLibraryRevealed?(playerId: string, recipients?: readonly string[]): void;
      onLibraryTopRevealed?(playerId: string, count: number): void;
    };
    websocketContext.onLibraryRevealed?.('player-2', ['player-1']);
    websocketContext.onLibraryTopRevealed?.('player-2', 3);

    expect(onLibraryRevealed).toHaveBeenCalledWith('player-2', ['player-1']);
    expect(onLibraryTopRevealed).toHaveBeenCalledWith('player-2', 3);
  });

  it('stops live transports and leaves the table on a terminal room-deleted event', async () => {
    const current = snapshot();
    const navigateToRooms = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'finished', snapshot: current } }));

    await service.load(context(current, vi.fn(), vi.fn(), vi.fn(), vi.fn(), { navigateToRooms }));
    gameRealtimeHandlers().onRoomDeleted();

    expect(websocket.stop).toHaveBeenCalledOnce();
    expect(gameRealtime.stop).toHaveBeenCalledOnce();
    expect(navigateToRooms).toHaveBeenCalledOnce();
  });

  it('loads bootstrap v2 when the frontend v2 flag is enabled', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValue(of(bootstrapV2()));

    await service.load(context(snapshot(), setSnapshot));

    expect(gamesApi.snapshot).not.toHaveBeenCalled();
    expect(gamesApi.bootstrapV2).toHaveBeenCalledWith('game-1', []);
    expect(setSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      version: 6,
      players: expect.objectContaining({
        'player-1': expect.objectContaining({ life: 38 }),
      }),
    }));
    expect(consoleInfoSpy).toHaveBeenCalledWith('[CommanderZone gameplay sync]', expect.objectContaining({
      source: 'bootstrap',
      reason: 'initial_load',
      result: 'applied',
      currentVersion: 6,
    }));
  });

  it('labels websocket-requested bootstrap refetch separately from initial load', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValue(of({
      ...bootstrapV2(),
      game: { ...bootstrapV2().game, version: 7 },
    }));

    await service.refetch(context(snapshot(), setSnapshot), true, 'websocket.request_resync');

    expect(consoleInfoSpy).toHaveBeenCalledWith('[CommanderZone gameplay sync]', expect.objectContaining({
      source: 'bootstrap',
      reason: 'websocket.request_resync',
      result: 'applied',
      currentVersion: 7,
    }));
  });

  it('sends known static catalog keys and hydrates omitted static cards from cache', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const setSnapshot = vi.fn();
    const firstBootstrap = bootstrapV2();
    const secondBootstrap = {
      ...bootstrapV2(),
      game: { ...bootstrapV2().game, version: 7 },
      staticCards: {},
    };
    gamesApi.bootstrapV2
      .mockReturnValueOnce(of(firstBootstrap))
      .mockReturnValueOnce(of(secondBootstrap));

    await service.refetch(context(snapshot(), setSnapshot), true);
    await service.refetch(context(snapshot(), setSnapshot), true);

    expect(gamesApi.bootstrapV2).toHaveBeenNthCalledWith(1, 'game-1', []);
    expect(gamesApi.bootstrapV2).toHaveBeenNthCalledWith(2, 'game-1', expect.arrayContaining([
      'card-3|s3|legacy-snapshot-v1|en|public',
    ]));
    expect(setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      players: expect.objectContaining({
        'player-1': expect.objectContaining({
          zones: expect.objectContaining({
            battlefield: expect.arrayContaining([
              expect.objectContaining({ name: 'Board Card' }),
            ]),
          }),
        }),
      }),
    }));
  });

  it('refreshes viewer control access after the session loading state is lifted', async () => {
    const current = snapshot();
    const order: string[] = [];
    const refreshViewerControlAccess = vi.fn(async () => {
      order.push('refresh');
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn(), vi.fn(), vi.fn(), vi.fn(), {
      setLoading: (loading) => order.push(loading ? 'loading-on' : 'loading-off'),
      refreshViewerControlAccess,
    }));

    expect(order).toEqual(['loading-off', 'refresh']);
    expect(refreshViewerControlAccess).toHaveBeenCalledTimes(1);
  });

  it('refetches the snapshot when a non-rematch game event arrives from Mercure', async () => {
    const current = snapshot();
    const next = snapshot({ status: 'conceded', concededAt: '2026-01-01T00:00:10.000Z' });
    next.version = current.version + 1;
    const setSnapshot = vi.fn();
    gamesApi.snapshot
      .mockReturnValueOnce(of({ game: { id: 'game-1', status: 'active', snapshot: current } }))
      .mockReturnValueOnce(of({ game: { id: 'game-1', status: 'active', snapshot: next } }));

    await service.load(context(current, setSnapshot));
    gameRealtimeHandlers().onSnapshotInvalidated(gameEvent('game.concede', next.version));
    await Promise.resolve();

    expect(gamesApi.snapshot).toHaveBeenCalledTimes(2);
    expect(setSnapshot).toHaveBeenLastCalledWith(next);
  });

  it('does not let Mercure bootstrap race connected patch.v2 delivery', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    websocketStatus.set('connected');
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValue(of(bootstrapV2()));

    await service.load(context(snapshot(), setSnapshot));
    gameRealtimeHandlers().onSnapshotInvalidated(gameEvent('card.moved', bootstrapV2().game.version + 1));
    await Promise.resolve();

    expect(gamesApi.bootstrapV2).toHaveBeenCalledTimes(1);
    expect(setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('applies rematch control-plane state without refetching the gameplay stream', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    websocketStatus.set('connected');
    const initial = bootstrapV2();
    const projection = controlPlane(2, {
      'player-1': {
        playerId: 'player-1',
        displayName: 'Player 1',
        vote: 'play_again',
        votedAt: '2026-01-01T00:00:10.000Z',
      },
    });
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValueOnce(of(initial));

    await service.load(context(snapshot(), setSnapshot));
    gameRealtimeHandlers().onControlPlaneState?.(projection, gameEvent('room.rematch.vote', initial.game.version));
    await Promise.resolve();

    expect(gamesApi.bootstrapV2).toHaveBeenCalledTimes(1);
    expect(setSnapshot).toHaveBeenCalledTimes(2);
    expect(setSnapshot.mock.calls[1]?.[0].rematch?.votes['player-1']?.vote).toBe('play_again');
  });

  it('applies a Mercure lifecycle projection to the normalized V2 source without refetching', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValueOnce(of(bootstrapV2()));

    await service.load(context(snapshot(), setSnapshot));
    gameRealtimeHandlers().onControlPlaneState?.(controlPlane(), gameEvent('game.finished', bootstrapV2().game.version));

    expect(gamesApi.bootstrapV2).toHaveBeenCalledTimes(1);
    expect(setSnapshot.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      status: 'finished',
      winnerPlayerId: 'player-1',
      ownerId: 'player-2',
    }));
    expect(normalizedV2Store.state()?.lastAppliedVersion).toBe(bootstrapV2().game.version);
  });

  it('uses one compact endpoint recovery after a real Mercure reconnect', async () => {
    const setSnapshot = vi.fn();
    const current = snapshot();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));
    gamesApi.controlPlane.mockReturnValue(of({ controlPlane: controlPlane(3) }));

    await service.load(context(current, setSnapshot));
    gameRealtimeHandlers().onControlPlaneReconnect?.(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(gamesApi.controlPlane).toHaveBeenCalledWith('game-1', 2);
    expect(gameRealtime.acceptControlPlaneState).toHaveBeenCalledWith(expect.objectContaining({ controlPlaneRevision: 3 }));
    expect(setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ controlPlaneRevision: 3 }));
  });

  it('seeds rematch idempotency from the initial compact control-plane snapshot', async () => {
    const initial = snapshot();
    const projection = controlPlane(4, {
      'player-1': {
        playerId: 'player-1',
        displayName: 'Player',
        vote: 'play_again',
        votedAt: '2026-01-01T00:00:10.000Z',
        clientActionId: 'accepted-vote-1',
      },
    });
    const onControlPlaneAccepted = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({
      game: { id: 'game-1', status: 'finished', snapshot: initial, controlPlane: projection },
    }));

    await service.load(context(initial, vi.fn(), vi.fn(), vi.fn(), vi.fn(), { onControlPlaneAccepted }));

    expect(onControlPlaneAccepted).toHaveBeenCalledWith(expect.objectContaining({
      controlPlaneRevision: 4,
      rematch: expect.objectContaining({
        votes: expect.objectContaining({
          'player-1': expect.objectContaining({ clientActionId: 'accepted-vote-1' }),
        }),
      }),
    }));
  });

  it('hydrates the full compact projection from a V2 bootstrap', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const projection = controlPlane(5, {
      'player-1': {
        playerId: 'player-1',
        displayName: 'Player',
        vote: 'play_again',
        votedAt: '2026-01-01T00:00:10.000Z',
        clientActionId: 'accepted-vote-v2',
      },
    });
    const setSnapshot = vi.fn();
    gamesApi.bootstrapV2.mockReturnValue(of({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        status: 'active',
        ownerId: 'player-1',
        controlPlaneRevision: 1,
        controlPlane: projection,
      },
    }));

    await service.load(context(snapshot(), setSnapshot));

    expect(setSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      controlPlaneRevision: 5,
      status: 'finished',
      ownerId: 'player-2',
      rematch: expect.objectContaining({
        votes: expect.objectContaining({
          'player-1': expect.objectContaining({ clientActionId: 'accepted-vote-v2' }),
        }),
      }),
    }));
  });

  it('preserves a newer control-plane projection when a gameplay snapshot is older', async () => {
    const current = snapshot();
    current.version = 4;
    current.controlPlaneRevision = 7;
    current.status = 'finished';
    current.winnerPlayerId = 'player-1';
    current.rematch = { votes: {}, deadlineAt: '2026-01-01T00:01:10.000Z' };
    const staleGameplaySnapshot = snapshot();
    staleGameplaySnapshot.version = 5;
    staleGameplaySnapshot.controlPlaneRevision = 6;
    staleGameplaySnapshot.status = 'active';
    staleGameplaySnapshot.rematch = { votes: {}, deadlineAt: null };
    const setSnapshot = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: staleGameplaySnapshot } }));

    await service.refetch(context(current, setSnapshot));

    expect(setSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      version: 5,
      controlPlaneRevision: 7,
      status: 'finished',
      winnerPlayerId: 'player-1',
    }));
  });

  it('does not refetch when the current snapshot is already at the realtime event version', async () => {
    const current = snapshot();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn()));
    gameRealtimeHandlers().onSnapshotInvalidated(gameEvent('game.concede', current.version));
    await Promise.resolve();

    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
  });

  it('maps realtime status from the gameplay websocket connection', () => {
    websocketStatus.set('connected');
    expect(service.realtimeStatus()).toBe('live');

    websocketStatus.set('error');
    expect(service.realtimeStatus()).toBe('degraded');

    websocketStatus.set('disconnected');
    expect(service.realtimeStatus()).toBe('connecting');
  });

  it('navigates back to rooms with a user-facing toast when the initial game load fails', async () => {
    const current = snapshot();
    const navigateToRoomsWithLoadError = vi.fn();
    const setError = vi.fn();
    gamesApi.snapshot.mockReturnValue(throwError(() => new Error('not found')));

    await service.load(context(current, vi.fn(), vi.fn(), navigateToRoomsWithLoadError, setError));

    expect(navigateToRoomsWithLoadError).toHaveBeenCalledTimes(1);
    expect(setError).not.toHaveBeenCalledWith('Could not load game snapshot.');
  });

  it('navigates silently to rooms when an initial snapshot load returns 404', async () => {
    const current = snapshot();
    const navigateToRooms = vi.fn();
    const navigateToRoomsWithLoadError = vi.fn();
    gamesApi.snapshot.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    await service.load(context(current, vi.fn(), vi.fn(), navigateToRoomsWithLoadError, vi.fn(), { navigateToRooms }));

    expect(navigateToRooms).toHaveBeenCalledTimes(1);
    expect(navigateToRoomsWithLoadError).not.toHaveBeenCalled();
  });
});

function gameRealtimeHandlers(): GameTableRealtimeHandlers {
  return gameRealtime.subscribe.mock.calls[0]?.[1] as GameTableRealtimeHandlers;
}

function gameEvent(type: string, version: number): MercureGameEvent {
  return {
    gameId: 'game-1',
    version,
    event: {
      id: 'event-1',
      type,
      payload: {},
      createdBy: 'player-1',
      createdAt: '2026-01-01T00:00:10.000Z',
    },
  };
}

function controlPlane(
  controlPlaneRevision = 1,
  votes: GameControlPlaneState['rematch']['votes'] = {},
): GameControlPlaneState {
  return {
    controlPlaneRevision,
    status: 'finished',
    winnerPlayerId: 'player-1',
    finishedAt: '2026-01-01T00:00:10.000Z',
    finishReason: 'last_player_standing',
    allDisconnectedSince: null,
    nextLifecycleAt: '2026-01-01T00:01:10.000Z',
    ownerId: 'player-2',
    rematch: { votes, deadlineAt: '2026-01-01T00:01:10.000Z' },
  };
}

function context(
  currentSnapshot: GameSnapshot,
  setSnapshot: (snapshot: GameSnapshot) => void,
  navigateToWaitingRoom = vi.fn(),
  navigateToRoomsWithLoadError = vi.fn(),
  setError = vi.fn(),
  overrides: Partial<Pick<
    GameTableSessionContext,
    'setLoading' | 'refreshViewerControlAccess' | 'onControlPlaneAccepted' | 'onLibraryRevealed' | 'onLibraryTopRevealed' | 'navigateToRooms'
  >> = {},
): GameTableSessionContext {
  return {
    gameId: () => 'game-1',
    snapshot: () => currentSnapshot,
    setSnapshot,
    focusedPlayerId: () => 'player-1',
    setFocusedPlayerId: vi.fn(),
    ownPlayerId: () => 'player-1',
    hasActivePointerDrag: () => false,
    isPending: () => false,
    setLoading: overrides.setLoading ?? vi.fn(),
    setError,
    onControlPlaneAccepted: overrides.onControlPlaneAccepted,
    onLibraryRevealed: overrides.onLibraryRevealed,
    onLibraryTopRevealed: overrides.onLibraryTopRevealed,
    refreshViewerControlAccess: overrides.refreshViewerControlAccess,
    navigateToRooms: overrides.navigateToRooms ?? vi.fn(),
    navigateToRoomsWithLoadError,
    navigateToWaitingRoom,
  };
}

function snapshot(overrides: Partial<GameSnapshot['players'][string]> = {}): GameSnapshot {
  return {
    version: 4,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        deckName: null,
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        commanderDamage: {},
        counters: {},
        ...overrides,
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function bootstrapV2(): BootstrapV2 {
  return {
    game: {
      id: 'game-1',
      status: 'active',
      version: 6,
      viewerId: 'player-1',
      ownerId: 'player-1',
      gamePhase: 'PLAYING',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    },
    players: {
      'player-1': {
        playerId: 'player-1',
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        displayName: 'Player',
        life: 38,
        status: 'active',
        handCount: 1,
        zoneIds: ['player-1:library', 'player-1:hand', 'player-1:battlefield', 'player-1:graveyard', 'player-1:exile', 'player-1:command'],
        zoneCounts: { library: 98, hand: 1, battlefield: 1, graveyard: 0, exile: 0, command: 0 },
        commanderDamage: {},
        counters: {},
        deckName: 'V2 Deck',
      },
    },
    zones: {
      'player-1:library': { zoneId: 'player-1:library', playerId: 'player-1', name: 'library', instanceIds: ['library-1'] },
      'player-1:hand': { zoneId: 'player-1:hand', playerId: 'player-1', name: 'hand', instanceIds: ['hand-1'] },
      'player-1:battlefield': { zoneId: 'player-1:battlefield', playerId: 'player-1', name: 'battlefield', instanceIds: ['battlefield-1'] },
      'player-1:graveyard': { zoneId: 'player-1:graveyard', playerId: 'player-1', name: 'graveyard', instanceIds: [] },
      'player-1:exile': { zoneId: 'player-1:exile', playerId: 'player-1', name: 'exile', instanceIds: [] },
      'player-1:command': { zoneId: 'player-1:command', playerId: 'player-1', name: 'command', instanceIds: [] },
    },
    instances: {
      'library-1': { instanceId: 'library-1', cardRef: 'card-1', cardKey: 'card-1', printId: 's1', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1', tapped: false },
      'hand-1': { instanceId: 'hand-1', cardRef: 'card-2', cardKey: 'card-2', printId: 's2', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', zoneId: 'player-1:hand', ownerId: 'player-1', controllerId: 'player-1', tapped: false },
      'battlefield-1': { instanceId: 'battlefield-1', cardRef: 'card-3', cardKey: 'card-3', printId: 's3', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', zoneId: 'player-1:battlefield', ownerId: 'player-1', controllerId: 'player-1', tapped: true },
    },
    zoneCounts: {
      'player-1:library': 98,
      'player-1:hand': 1,
      'player-1:battlefield': 1,
      'player-1:graveyard': 0,
      'player-1:exile': 0,
      'player-1:command': 0,
    },
    relations: {
      stack: [],
      arrows: [],
      attachments: [],
      specialEntities: [],
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 2 },
    staticCards: {
      'card-1': { cardRef: 'card-1', cardKey: 'card-1', printId: 's1', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', scryfallId: 's1', name: 'Top Card', imageUris: null, cardFaces: [], typeLine: 'Land', manaCost: null, colorIdentity: [] },
      'card-2': { cardRef: 'card-2', cardKey: 'card-2', printId: 's2', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', scryfallId: 's2', name: 'Hand Card', imageUris: null, cardFaces: [], typeLine: 'Creature', manaCost: null, colorIdentity: [] },
      'card-3': { cardRef: 'card-3', cardKey: 'card-3', printId: 's3', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', scryfallId: 's3', name: 'Board Card', imageUris: null, cardFaces: [], typeLine: 'Artifact', manaCost: null, colorIdentity: [] },
    },
    chatCursor: null,
    logCursor: null,
  };
}
