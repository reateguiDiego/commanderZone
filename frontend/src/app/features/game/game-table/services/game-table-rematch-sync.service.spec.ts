import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { RoomsApi } from '../../../../core/api/rooms.api';
import { GameControlPlaneState } from '../../../../core/models/game.model';
import { CurrentRoomSummary } from '../../../../core/models/room.model';
import { GameTableRematchSyncService } from './game-table-rematch-sync.service';

describe('GameTableRematchSyncService', () => {
  const gamesApi = { controlPlane: vi.fn() };
  const roomsApi = { current: vi.fn() };
  let service: GameTableRematchSyncService;

  beforeEach(() => {
    gamesApi.controlPlane.mockReset();
    roomsApi.current.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableRematchSyncService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: RoomsApi, useValue: roomsApi },
      ],
    });
    service = TestBed.inject(GameTableRematchSyncService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies remote votes and navigates when all players return the room to waiting', async () => {
    vi.useFakeTimers();
    const activeRoom = room({ status: 'started', gameId: 'game-1' });
    const waitingRoom = room({ status: 'waiting', gameId: null });
    const firstProjection = controlPlane(4, ['player-1']);
    const finalProjection = controlPlane(5, ['player-1', 'player-2']);
    const handlers = {
      applyControlPlane: vi.fn(),
      navigateToRooms: vi.fn(),
      navigateToWaitingRoom: vi.fn(),
    };
    roomsApi.current
      .mockReturnValueOnce(of({ room: activeRoom, player: null, turn: null, viewerRole: null }))
      .mockReturnValueOnce(of({ room: waitingRoom, player: null, turn: null, viewerRole: null }));
    gamesApi.controlPlane
      .mockReturnValueOnce(of({ controlPlane: firstProjection }))
      .mockReturnValueOnce(of({ controlPlane: finalProjection }));

    const stop = service.watch('game-1', ['player-1', 'player-2'], 3, handlers);
    await flushPromises();

    expect(handlers.applyControlPlane).toHaveBeenCalledWith(firstProjection);
    expect(handlers.navigateToWaitingRoom).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    await flushPromises();

    expect(gamesApi.controlPlane).toHaveBeenNthCalledWith(2, 'game-1', 4);
    expect(handlers.applyControlPlane).toHaveBeenLastCalledWith(finalProjection);
    expect(handlers.navigateToWaitingRoom).toHaveBeenCalledOnce();
    expect(handlers.navigateToWaitingRoom).toHaveBeenCalledWith(activeRoom.id);
    expect(handlers.navigateToRooms).not.toHaveBeenCalled();

    stop();
  });
});

function room(overrides: Pick<CurrentRoomSummary, 'status' | 'gameId'>): CurrentRoomSummary {
  return {
    id: 'room-1',
    name: 'Room 1',
    status: overrides.status,
    visibility: 'public',
    format: 'commander',
    maxPlayers: 4,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
    playerCount: 2,
    gameId: overrides.gameId,
  };
}

function controlPlane(controlPlaneRevision: number, voterIds: readonly string[]): GameControlPlaneState {
  return {
    controlPlaneRevision,
    status: 'finished',
    winnerPlayerId: 'player-1',
    finishedAt: '2026-01-01T00:00:00.000Z',
    finishReason: 'last_player_standing',
    allDisconnectedSince: null,
    nextLifecycleAt: '2026-01-01T00:01:00.000Z',
    ownerId: 'player-1',
    rematch: {
      votes: Object.fromEntries(voterIds.map((playerId) => [playerId, {
        playerId,
        displayName: playerId,
        vote: 'play_again',
        votedAt: '2026-01-01T00:00:00.000Z',
        clientActionId: `action-${playerId}`,
      }])),
      deadlineAt: '2026-01-01T00:01:00.000Z',
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
