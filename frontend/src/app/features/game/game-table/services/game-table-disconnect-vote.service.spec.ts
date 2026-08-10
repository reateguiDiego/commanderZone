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

  beforeEach(() => {
    snapshot.set(disconnectVotesSnapshot());
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
          useValue: { messages$: new Subject() },
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
});

function disconnectVotesSnapshot(): GameSnapshot {
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
      'player-2': vote('player-2', '2026-01-01T00:00:00.000Z'),
      'player-3': vote('player-3', '2026-01-01T00:00:01.000Z'),
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

function vote(targetPlayerId: string, openedAt: string) {
  return {
    targetPlayerId,
    status: 'open' as const,
    openedAt,
    deadlineAt: '2026-01-01T00:01:00.000Z',
    cooldownUntil: null,
    eligible: ['player-1'],
    votes: {},
  };
}
