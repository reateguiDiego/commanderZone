import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableRematchRealtimeService } from './game-table-rematch-realtime.service';
import { GameTableSessionContext, GameTableSessionService } from './game-table-session.service';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';

describe('GameTableSessionService', () => {
  let service: GameTableSessionService;
  const gamesApi = {
    snapshot: vi.fn(),
  };
  let websocketStatus: ReturnType<typeof signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>>;
  const rematchRealtime = {
    subscribeToRematchCreated: vi.fn(),
    stop: vi.fn(),
  };
  const websocket = {
    status: signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>('stopped'),
    start: vi.fn(),
    stop: vi.fn(),
  };

  beforeEach(() => {
    websocketStatus = signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>('stopped');
    websocket.status = websocketStatus;
    gamesApi.snapshot.mockReset();
    rematchRealtime.subscribeToRematchCreated.mockReset();
    rematchRealtime.stop.mockReset();
    websocket.start.mockReset();
    websocket.stop.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableSessionService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: GameTableRematchRealtimeService, useValue: rematchRealtime },
        { provide: GameTableWebsocketGameplayService, useValue: websocket },
      ],
    });
    service = TestBed.inject(GameTableSessionService);
  });

  it('applies same-version snapshots when projected deck names changed', async () => {
    const current = snapshot({ deckName: null });
    const next = snapshot({ deckName: 'Food and Fellowship' });
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

  it('loads one initial snapshot, starts websocket, and subscribes only to rematch transition events', async () => {
    const current = snapshot();
    const navigateToWaitingRoom = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn(), navigateToWaitingRoom));

    const onRematchCreated = rematchRealtime.subscribeToRematchCreated.mock.calls[0]?.[1] as ((roomId: string) => void) | undefined;
    onRematchCreated?.('room-1');

    expect(navigateToWaitingRoom).toHaveBeenCalledWith('room-1');
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
    expect(websocket.start).toHaveBeenCalledWith(expect.any(Object), 'game-1');
    expect(rematchRealtime.subscribeToRematchCreated).toHaveBeenCalledWith('game-1', expect.any(Function));
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
});

function context(
  currentSnapshot: GameSnapshot,
  setSnapshot: (snapshot: GameSnapshot) => void,
  navigateToWaitingRoom = vi.fn(),
  navigateToRoomsWithLoadError = vi.fn(),
  setError = vi.fn(),
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
    setLoading: vi.fn(),
    setError,
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
