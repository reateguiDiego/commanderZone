import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { RuntimeLanguageSelectorService } from '../../../../../core/localization/runtime-language-selector.service';
import { SupportedLanguageCode } from '../../../../../core/localization/language-preferences';
import { GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableChatLogState } from './game-table-chat-log.state';
import { GameTableChatStore } from './game-table-chat.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';

const EVENT_LOG_MEMO_STORAGE_KEY = 'cz_perf_event_log_memo';

describe('GameTableChatStore', () => {
  afterEach(() => {
    window.localStorage.removeItem(EVENT_LOG_MEMO_STORAGE_KEY);
  });

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

  it('excludes conceded players from private chat recipients', () => {
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
    const state = snapshot();
    state.players['user-2']!.status = 'conceded';
    state.players['user-3'] = player('user-3', 'Alive opponent');
    core.snapshot.set(state);

    const store = TestBed.inject(GameTableChatStore);

    expect(store.chatRecipients()).toEqual([
      { playerId: null, labelKey: 'game.chat.allPlayers' },
      { playerId: 'user-3', label: 'Alive opponent' },
    ]);
  });

  it('keeps rebuilding the event log after a card position update when the memo experiment is off', () => {
    const { core, chatLogState, store } = configureChatStore();
    const initial = snapshotWithLoggedBattlefieldCard();
    core.snapshot.set(initial);
    const eventLogView = vi.spyOn(chatLogState, 'eventLogView');

    store.eventLog();
    core.snapshot.set(snapshotWithCardPosition(initial, { x: 220, y: 140 }));
    store.eventLog();

    expect(eventLogView).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild the expensive event log view for a card position update when enabled', () => {
    window.localStorage.setItem(EVENT_LOG_MEMO_STORAGE_KEY, '1');
    const { core, chatLogState, store } = configureChatStore();
    const initial = snapshotWithLoggedBattlefieldCard();
    core.snapshot.set(initial);
    const eventLogView = vi.spyOn(chatLogState, 'eventLogView');

    store.eventLog();
    core.snapshot.set(snapshotWithCardPosition(initial, { x: 220, y: 140 }));
    store.eventLog();

    expect(eventLogView).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the event log view when its entries change with the memo experiment enabled', () => {
    window.localStorage.setItem(EVENT_LOG_MEMO_STORAGE_KEY, '1');
    const { core, chatLogState, store } = configureChatStore();
    const initial = snapshotWithLoggedBattlefieldCard();
    core.snapshot.set(initial);
    const eventLogView = vi.spyOn(chatLogState, 'eventLogView');

    store.eventLog();
    core.snapshot.set({
      ...initial,
      eventLog: [
        ...initial.eventLog,
        {
          id: 'event-2',
          type: 'library.draw',
          message: 'User drew a card.',
          actorId: 'user-1',
          createdAt: '2026-10-01T12:01:00Z',
        },
      ],
    });
    store.eventLog();

    expect(eventLogView).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the event log view when the runtime language changes with the memo experiment enabled', () => {
    window.localStorage.setItem(EVENT_LOG_MEMO_STORAGE_KEY, '1');
    const language = signal<SupportedLanguageCode>('en');
    const { core, chatLogState, store } = configureChatStore(language);
    core.snapshot.set(snapshotWithLoggedBattlefieldCard());
    const eventLogView = vi.spyOn(chatLogState, 'eventLogView');

    store.eventLog();
    language.set('es');
    store.eventLog();

    expect(eventLogView).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the event log view when a card change affects a visible entry with the memo experiment enabled', () => {
    window.localStorage.setItem(EVENT_LOG_MEMO_STORAGE_KEY, '1');
    const { core, chatLogState, store } = configureChatStore();
    const initial = snapshotWithLoggedBattlefieldCard();
    core.snapshot.set(initial);
    const eventLogView = vi.spyOn(chatLogState, 'eventLogView');

    expect(store.eventLog()[0]?.card?.name).toBe('Forest');
    core.snapshot.set(snapshotWithCardName(initial, 'Island'));

    expect(store.eventLog()[0]?.card).toBeNull();
    expect(eventLogView).toHaveBeenCalledTimes(2);
  });
});

function configureChatStore(language?: WritableSignal<SupportedLanguageCode>): {
  readonly core: GameTableCoreState;
  readonly chatLogState: GameTableChatLogState;
  readonly store: GameTableChatStore;
} {
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
      ...(language ? [{
        provide: RuntimeLanguageSelectorService,
        useValue: { selectedLanguage: language.asReadonly() } satisfies Pick<RuntimeLanguageSelectorService, 'selectedLanguage'>,
      }] : []),
    ],
  });

  return {
    core: TestBed.inject(GameTableCoreState),
    chatLogState: TestBed.inject(GameTableChatLogState),
    store: TestBed.inject(GameTableChatStore),
  };
}

function snapshotWithLoggedBattlefieldCard(): GameSnapshot {
  const value = snapshot();
  value.players['user-1']!.zones.battlefield = [{
    instanceId: 'forest-1',
    name: 'Forest',
    tapped: false,
    position: { x: 120, y: 80 },
  }];
  value.eventLog = [{
    id: 'event-1',
    type: 'card.moved',
    message: 'User moved Forest.',
    actorId: 'user-1',
    createdAt: '2026-10-01T12:00:00Z',
  }];

  return value;
}

function snapshotWithCardPosition(
  value: GameSnapshot,
  position: { x: number; y: number },
): GameSnapshot {
  const player = value.players['user-1']!;
  const card = player.zones.battlefield[0]!;

  return {
    ...value,
    players: {
      ...value.players,
      'user-1': {
        ...player,
        zones: {
          ...player.zones,
          battlefield: [{ ...card, position }],
        },
      },
    },
  };
}

function snapshotWithCardName(value: GameSnapshot, name: string): GameSnapshot {
  const player = value.players['user-1']!;
  const card = player.zones.battlefield[0]!;

  return {
    ...value,
    players: {
      ...value.players,
      'user-1': {
        ...player,
        zones: {
          ...player.zones,
          battlefield: [{ ...card, name }],
        },
      },
    },
  };
}

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
