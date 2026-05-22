import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot, MercureGameEvent } from '../../../../core/models/game.model';
import { GameTableRealtimeService } from './game-table-realtime.service';
import { GameTableSessionContext, GameTableSessionService } from './game-table-session.service';

describe('GameTableSessionService', () => {
  let service: GameTableSessionService;
  const gamesApi = {
    snapshot: vi.fn(),
  };
  const realtime = {
    status: vi.fn(),
    subscribeToGame: vi.fn(),
    stop: vi.fn(),
  };

  beforeEach(() => {
    gamesApi.snapshot.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableSessionService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: GameTableRealtimeService, useValue: realtime },
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

  it('navigates to the waiting room when the game realtime stream announces rematch creation', async () => {
    const current = snapshot();
    const navigateToWaitingRoom = vi.fn();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: current } }));

    await service.load(context(current, vi.fn(), navigateToWaitingRoom));

    const onEvent = realtime.subscribeToGame.mock.calls[0]?.[1] as ((event: MercureGameEvent) => void) | undefined;
    onEvent?.({
      gameId: 'game-1',
      version: current.version,
      event: {
        id: 'event-1',
        type: 'room.rematch.created',
        payload: { roomId: 'room-1' },
        createdBy: 'player-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(navigateToWaitingRoom).toHaveBeenCalledWith('room-1');
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
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
    handleRealtimeEvent: vi.fn(),
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
