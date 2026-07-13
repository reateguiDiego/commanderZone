import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableStore } from '../game-table.store';
import { GameTableContextStore } from '../state/core/game-table-context.store';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';
import { GameTableDisconnectVoteService } from './game-table-disconnect-vote.service';

describe('GameTableDisconnectVoteService', () => {
	const snapshot = signal<GameSnapshot | null>(null);
	const currentPlayer = signal<{ id: string } | null>({ id: 'p1' });
	const messages = new Subject<never>();
	const sendCommand = vi.fn().mockResolvedValue(true);

	beforeEach(() => {
		snapshot.set(disconnectSnapshot());
		currentPlayer.set({ id: 'p1' });
		sendCommand.mockClear();
		TestBed.configureTestingModule({
			providers: [
				GameTableDisconnectVoteService,
				{ provide: GameTableStore, useValue: { snapshot, currentPlayer, gameId: () => 'game-1' } },
				{ provide: GameTableContextStore, useValue: { command: () => ({ websocket: () => ({}) }) } },
				{ provide: GameTableWebsocketGameplayService, useValue: { sendCommand } },
				{ provide: GameTableWebsocketTransportService, useValue: { messages$: messages.asObservable() } },
			],
		});
	});

	afterEach(() => TestBed.inject(GameTableDisconnectVoteService).ngOnDestroy());

	it('uses frozen eligibility, authoritative own vote and quorum', () => {
		const service = TestBed.inject(GameTableDisconnectVoteService);

		expect(service.canVote()).toBe(true);
		expect(service.currentVote()).toBe('expel');
		expect(service.requiredVotes()).toBe(2);
		expect(service.expelVotes()).toBe(1);
		expect(service.countdownSeconds()).toBeGreaterThan(0);
	});

	it('casts voteId and decision without HTTP fallback or refetch', async () => {
		const service = TestBed.inject(GameTableDisconnectVoteService);

		await service.vote('wait');

		expect(sendCommand).toHaveBeenCalledWith({}, 'disconnect.vote', {
			targetPlayerId: 'p2',
			voteId: 'vote-1',
			decision: 'wait',
		});
	});

	it('blocks eliminated or non-eligible viewers and reads canonical presence', () => {
		const value = disconnectSnapshot();
		value.players['p1'].status = 'defeated';
		value.presence = { p2: { playerId: 'p2', connected: true, activeConnectionCount: 1 } };
		snapshot.set(value);
		const service = TestBed.inject(GameTableDisconnectVoteService);

		expect(service.canVote()).toBe(false);
		expect(service.targetIsOnline()).toBe(true);
	});

	it('tolerates a legacy vote projection without vote maps', () => {
		const value = disconnectSnapshot();
		value.disconnectVote = { ...value.disconnectVote!, votes: undefined as never, votesByPlayerId: undefined };
		snapshot.set(value);
		const service = TestBed.inject(GameTableDisconnectVoteService);

		expect(service.currentVote()).toBeNull();
		expect(service.players()).toHaveLength(2);
	});
});

function disconnectSnapshot(): GameSnapshot {
	const player = (id: string) => ({
		user: { id, email: `${id}@example.test`, displayName: id, roles: [] },
		status: 'active' as const,
		life: 40,
		zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
		zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
		commanderDamage: {}, counters: {}, backgroundName: 'G_1', sleevesName: 'default',
	});
	return {
		version: 4, ownerId: 'p1', players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
		turn: { activePlayerId: 'p1', phase: 'main-1', number: 1 }, stack: [], arrows: [], chat: [], eventLog: [],
		createdAt: '2026-07-13T12:00:00Z',
		presence: { p1: { playerId: 'p1', connected: true, activeConnectionCount: 1 }, p2: { playerId: 'p2', connected: false, activeConnectionCount: 0 } },
		disconnectVote: {
			voteId: 'vote-1', targetPlayerId: 'p2', openedByPlayerId: 'p1', status: 'open',
			eligibleVoterIds: ['p1', 'p3'], requiredVotes: 2, openedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 60_000).toISOString(), deadlineAt: new Date(Date.now() + 60_000).toISOString(),
			resolvedAt: null, cooldownUntil: null, resolution: null,
			votes: { p1: { playerId: 'p1', displayName: 'p1', vote: 'expel', decision: 'expel', votedAt: new Date().toISOString() } },
			votesByPlayerId: { p1: { playerId: 'p1', displayName: 'p1', vote: 'expel', decision: 'expel', votedAt: new Date().toISOString() } },
		},
	};
}
