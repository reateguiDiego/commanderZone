import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameControlPlaneState } from '../../../../core/models/game.model';
import { GameTableRematchVoteService } from './game-table-rematch-vote.service';

describe('GameTableRematchVoteService', () => {
  const gamesApi = {
    rematchVote: vi.fn(),
  };

  let service: GameTableRematchVoteService;

  beforeEach(() => {
    gamesApi.rematchVote.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableRematchVoteService,
        { provide: GamesApi, useValue: gamesApi },
      ],
    });
    service = TestBed.inject(GameTableRematchVoteService);
  });

  it('uses the accepted action as previousActionId for a later vote', async () => {
    gamesApi.rematchVote
      .mockReturnValueOnce(of({ status: 'waiting_for_votes', clientActionId: 'accepted-1' }))
      .mockReturnValueOnce(of({ status: 'waiting_for_votes', clientActionId: 'accepted-2' }));

    await service.submit('game-1', 'play_again');
    await service.submit('game-1', 'leave_room');

    expect(gamesApi.rematchVote.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      vote: 'play_again',
      clientActionId: expect.any(String),
      previousActionId: null,
    }));
    expect(gamesApi.rematchVote.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      vote: 'leave_room',
      previousActionId: 'accepted-1',
    }));
  });

  it('reuses the same client action id for a network retry', async () => {
    gamesApi.rematchVote
      .mockReturnValueOnce(throwError(() => new Error('network unavailable')))
      .mockReturnValueOnce(of({ status: 'waiting_for_votes', clientActionId: 'accepted-1' }));

    await expect(service.submit('game-1', 'play_again')).rejects.toThrow('network unavailable');
    await service.submit('game-1', 'play_again');

    expect(gamesApi.rematchVote.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      clientActionId: gamesApi.rematchVote.mock.calls[0]?.[1].clientActionId,
    }));
  });

  it('extracts the authoritative projection from a stale semantic conflict and clears the retry', async () => {
    const projection = controlPlane(4, 'server-current-action');
    const conflict = new HttpErrorResponse({ status: 409, error: { controlPlane: projection } });
    gamesApi.rematchVote
      .mockReturnValueOnce(throwError(() => conflict))
      .mockReturnValueOnce(of({ status: 'waiting_for_votes', clientActionId: 'accepted-2' }))
      .mockReturnValueOnce(of({ status: 'waiting_for_votes', clientActionId: 'accepted-3' }));

    await expect(service.submit('game-1', 'play_again')).rejects.toBe(conflict);
    expect(service.controlPlaneFromError(conflict)).toEqual(projection);

    await service.submit('game-1', 'play_again');
    expect(gamesApi.rematchVote.mock.calls[1]?.[1].clientActionId)
      .not.toBe(gamesApi.rematchVote.mock.calls[0]?.[1].clientActionId);

    service.acceptControlPlane('game-1', 'player-1', projection);
    await service.submit('game-1', 'leave_room');
    expect(gamesApi.rematchVote.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      previousActionId: 'server-current-action',
    }));
  });
});

function controlPlane(controlPlaneRevision: number, clientActionId: string | null = null): GameControlPlaneState {
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
      votes: clientActionId === null ? {} : {
        'player-1': {
          playerId: 'player-1',
          displayName: 'Player 1',
          vote: 'play_again',
          votedAt: '2026-01-01T00:00:00.000Z',
          clientActionId,
        },
      },
      deadlineAt: '2026-01-01T00:01:00.000Z',
    },
  };
}
