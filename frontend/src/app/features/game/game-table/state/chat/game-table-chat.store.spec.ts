import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableChatLogState } from './game-table-chat-log.state';
import { GameTableChatStore } from './game-table-chat.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';

describe('GameTableChatStore', () => {
  it('defaults to the opponent in two-player private chat', () => {
    TestBed.configureTestingModule({
      providers: [
        GameTableChatStore,
        GameTableChatLogState,
        GameTableCoreState,
        GameTableSnapshotSelectors,
        {
          provide: AuthStore,
          useValue: { user: signal<User | null>(user('user-1', 'User')).asReadonly() } satisfies Pick<AuthStore, 'user'>,
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'game-1']]) } },
        },
      ],
    });

    const core = TestBed.inject(GameTableCoreState);
    core.snapshot.set(snapshot());

    const store = TestBed.inject(GameTableChatStore);

    expect(store.chatRecipients()).toEqual([{ playerId: 'user-2', label: 'Opponent' }]);
    expect(store.shouldShowChatRecipientSelect()).toBe(false);
    expect(store.selectedChatTargetPlayerId()).toBe('user-2');
    expect(store.selectedChatTargetValue()).toBe('user-2');
  });
});

function snapshot(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'user-1',
    players: {
      'user-1': player('user-1', 'User'),
      'user-2': player('user-2', 'Opponent'),
    },
    turn: { activePlayerId: 'user-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(id: string, displayName: string): GamePlayerState {
  return {
    user: user(id, displayName),
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
  };
}

function user(id: string, displayName: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName,
    roles: [],
  };
}
