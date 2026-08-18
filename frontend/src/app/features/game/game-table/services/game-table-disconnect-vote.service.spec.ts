import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableStore } from '../game-table.store';
import { GameTableContextStore } from '../state/core/game-table-context.store';
import { GameTableDisconnectVoteService } from './game-table-disconnect-vote.service';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';

describe('GameTableDisconnectVoteService', () => {
  const snapshot = signal<GameSnapshot | null>(disconnectVotesSnapshot());
  const playerOnlineByPlayerId = signal<Record<string, boolean>>({});

  beforeEach(() => {
    snapshot.set(disconnectVotesSnapshot());
    playerOnlineByPlayerId.set({});
    TestBed.configureTestingModule({
      providers: [
        GameTableDisconnectVoteService,
        {
          provide: GameTableStore,
          useValue: {
            snapshot,
            currentPlayer: () => ({ id: 'player-1' }),
            gameId: () => 'game-1',
          },
        },
        {
          provide: GameTableContextStore,
          useValue: { command: () => ({ websocket: () => ({}) }) },
        },
        {
          provide: GameTableWebsocketGameplayService,
          useValue: { sendCommand: vi.fn(async () => true) },
        },
        {
          provide: GameTableWebsocketTransportService,
          useValue: { messages$: new Subject(), playerOnlineByPlayerId },
        },
      ],
    });
  });

  it('queues simultaneous eligible disconnect votes without reopening a dismissed modal', () => {
    const service = TestBed.inject(GameTableDisconnectVoteService);

    expect(service.targetPlayerId()).toBe('player-2');
    service.closeModal();
    expect(service.targetPlayerId()).toBe('player-3');
    service.closeModal();

    expect(service.targetPlayerId()).toBeNull();
  });

  it('shows synchronized votes passively to a conceded spectator without granting a vote action', () => {
    const spectatorSnapshot = disconnectVotesSnapshot();
    spectatorSnapshot.players['player-1'] = {
      ...spectatorSnapshot.players['player-1']!,
      status: 'conceded',
    };
    spectatorSnapshot.disconnectVotes!['player-2']!.votes['player-1'] = {
      playerId: 'player-1',
      displayName: 'Player 1',
      vote: 'wait',
      votedAt: '2026-01-01T00:00:03.000Z',
    };
    snapshot.set(spectatorSnapshot);

    const service = TestBed.inject(GameTableDisconnectVoteService);

    expect(service.canVote()).toBe(false);
    expect(service.isPassive()).toBe(true);
    expect(service.players()).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'player-1', vote: 'wait' }),
    ]));
  });

  it('refreshes the visible disconnect countdown once per second', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const service = TestBed.inject(GameTableDisconnectVoteService);

    TestBed.flushEffects();
    expect(service.countdownSeconds()).toBeGreaterThan(0);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    service.ngOnDestroy();
    setIntervalSpy.mockRestore();
  });

  it('stops client voting when the visible deadline has elapsed', () => {
    snapshot.set(disconnectVotesSnapshot(new Date(Date.now() - 1_000).toISOString()));
    const service = TestBed.inject(GameTableDisconnectVoteService);

    expect(service.countdownSeconds()).toBe(0);
    expect(service.voteFinished()).toBe(true);
    expect(service.canVote()).toBe(false);
  });

  it('projects websocket presence into the matching player snapshot entry', () => {
    const messages = TestBed.inject(GameTableWebsocketTransportService).messages$ as Subject<unknown>;
    const service = TestBed.inject(GameTableDisconnectVoteService);

    expect(service.isPlayerOffline('player-2')).toBe(true);
    expect(service.isPlayerOffline('player-1')).toBe(false);

    messages.next({ kind: 'player_presence_changed', playerId: 'player-2', status: 'offline' });

    expect(snapshot()?.players['player-2']?.isOnline).toBe(false);
    expect(service.isPlayerOffline('player-2')).toBe(true);

    messages.next({ kind: 'player_presence_changed', playerId: 'player-2', status: 'online' });

    expect(snapshot()?.players['player-2']?.isOnline).toBe(true);
    expect(service.isPlayerOffline('player-2')).toBe(false);
  });

  it('does not retain offline presence after the persisted transition is cancelled', () => {
    const cancelledSnapshot = disconnectVotesSnapshot();
    cancelledSnapshot.disconnectVotes!['player-2'] = {
      ...cancelledSnapshot.disconnectVotes!['player-2']!,
      status: 'cancelled',
    };
    snapshot.set(cancelledSnapshot);
    const service = TestBed.inject(GameTableDisconnectVoteService);

    expect(service.isPlayerOffline('player-2')).toBe(false);
  });

  it('shows a clear message instead of a technical error when a reconnect closes the vote', async () => {
    const websocket = TestBed.inject(GameTableWebsocketGameplayService) as unknown as {
      sendCommand: ReturnType<typeof vi.fn>;
    };
    websocket.sendCommand.mockRejectedValueOnce(new Error('invalid payload field: disconnectVote'));
    const service = TestBed.inject(GameTableDisconnectVoteService);

    await service.vote('wait');

    expect(service.error()).toBe('La votacion ya no esta disponible porque el jugador se ha reconectado.');
  });
});

function disconnectVotesSnapshot(deadlineAt = new Date(Date.now() + 60_000).toISOString()): GameSnapshot {
  return {
    version: 8,
    players: {
      'player-1': player('Player 1'),
      'player-2': player('Player 2'),
      'player-3': player('Player 3'),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    disconnectVotes: {
      'player-2': vote('player-2', '2026-01-01T00:00:00.000Z', deadlineAt),
      'player-3': vote('player-3', '2026-01-01T00:00:01.000Z', deadlineAt),
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function player(displayName: string) {
  return {
    user: { id: displayName, email: `${displayName}@test`, displayName, roles: [] },
    status: 'active' as const,
    life: 40,
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
    commanderDamage: {},
    counters: {},
  };
}

function vote(targetPlayerId: string, openedAt: string, deadlineAt: string) {
  return {
    targetPlayerId,
    status: 'open' as const,
    openedAt,
    deadlineAt,
    cooldownUntil: null,
    eligible: ['player-1'],
    votes: {},
  };
}
