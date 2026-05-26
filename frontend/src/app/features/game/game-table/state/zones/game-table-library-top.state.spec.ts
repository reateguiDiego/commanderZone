import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from '../../services/game-table-library-actions.service';
import { GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableZoneModalState, ZoneModalState } from './game-table-zone-modal.state';
import { GameTableZonePilesState } from './game-table-zone-piles.state';
import { GameTableLibraryTopState } from './game-table-library-top.state';

describe('GameTableLibraryTopState', () => {
  let state: GameTableLibraryTopState;
  const snapshotSignal = signal<GameSnapshot | null>(null);
  const errorSignal = signal<string | null>(null);
  const zoneModalSignal = signal<ZoneModalState | null>(null);
  const view = vi.fn();
  const reorderTop = vi.fn();
  const openFixedZone = vi.fn();
  const replaceZoneModalCards = vi.fn();

  beforeEach(() => {
    snapshotSignal.set(snapshot([card('card-1'), card('card-2', true), card('card-3')]));
    errorSignal.set(null);
    zoneModalSignal.set(null);
    view.mockResolvedValue(undefined);
    reorderTop.mockResolvedValue(undefined);
    openFixedZone.mockClear();
    replaceZoneModalCards.mockClear();

    TestBed.configureTestingModule({
      providers: [
        GameTableLibraryTopState,
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal, error: errorSignal } satisfies Pick<GameTableCoreState, 'snapshot' | 'error'>,
        },
        {
          provide: GameTableContextStore,
          useValue: { libraryAction: () => libraryActionContext() } satisfies Pick<GameTableContextStore, 'libraryAction'>,
        },
        {
          provide: GameTableLibraryActionsService,
          useValue: { view, reorderTop } satisfies Pick<GameTableLibraryActionsService, 'view' | 'reorderTop'>,
        },
        {
          provide: GameTablePlayersStore,
          useValue: { playerName: (playerId: string) => playerId } satisfies Pick<GameTablePlayersStore, 'playerName'>,
        },
        {
          provide: GameTableZoneActionsService,
          useValue: { openFixedZone, replaceZoneModalCards } satisfies Pick<GameTableZoneActionsService, 'openFixedZone' | 'replaceZoneModalCards'>,
        },
        {
          provide: GameTableZoneModalState,
          useValue: { zoneModal: zoneModalSignal } satisfies Pick<GameTableZoneModalState, 'zoneModal'>,
        },
        {
          provide: GameTableZonePilesState,
          useValue: { zoneTitle: () => 'Library' } satisfies Pick<GameTableZonePilesState, 'zoneTitle'>,
        },
      ],
    });

    state = TestBed.inject(GameTableLibraryTopState);
  });

  it('views sanitized top library cards without exposing hidden cards', async () => {
    await state.viewTopLibrary('player-1', 2.9);

    expect(view).toHaveBeenCalledWith(expect.anything(), 'player-1', 2);
    expect(openFixedZone).toHaveBeenCalledWith(
      'player-1',
      'library',
      'player-1 top 2 library cards',
      [card('card-1'), card('card-3')],
      'card-1',
      false,
      {
        allowReorder: true,
        drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO'],
        viewTopCount: 2,
      },
    );
  });

  it('reorders top library cards only from an open reorderable library modal', async () => {
    const cards = [card('card-3'), card('card-1')];
    zoneModalSignal.set(zoneModal(cards));

    await state.reorderTopLibraryCards(cards);

    expect(replaceZoneModalCards).toHaveBeenCalledWith(cards);
    expect(reorderTop).toHaveBeenCalledWith(expect.anything(), 'player-1', ['card-3', 'card-1']);
  });

  it('keeps the current draw order labels', () => {
    expect(state.drawOrderLabels(4)).toEqual(['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO', 'ROBO 4']);
  });
});

function snapshot(library: GameCardInstance[]): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player(library),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}

function player(library: GameCardInstance[]): GamePlayerState {
  return {
    user: user('player-1'),
    life: 40,
    zones: {
      library,
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

function card(instanceId: string, hidden = false): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
    hidden,
  };
}

function zoneModal(cards: GameCardInstance[]): ZoneModalState {
  return {
    playerId: 'player-1',
    zone: 'library',
    title: 'player-1 top 2 library cards',
    selectedCardId: 'card-3',
    cards,
    total: cards.length,
    type: '',
    search: '',
    showFilters: false,
    readOnly: false,
    allowRandomSelect: false,
    allowReorder: true,
    drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO'],
    viewTopCount: 2,
    selectedCard: cards[0] ?? null,
    loading: false,
  };
}

function user(id: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName: id,
    roles: [],
  };
}

function libraryActionContext(): GameTableLibraryActionContext {
  return {
    isCurrentPlayer: () => true,
    currentPlayer: () => null,
    focusedPlayer: () => null,
    focusPlayer: vi.fn(),
    setError: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
  };
}
