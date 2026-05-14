import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot } from '../../../../core/models/game.model';
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
    startPolling: vi.fn(),
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
});

function context(currentSnapshot: GameSnapshot, setSnapshot: (snapshot: GameSnapshot) => void): GameTableSessionContext {
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
    setError: vi.fn(),
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
