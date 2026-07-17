import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from '../../services/game-table-library-actions.service';
import { GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameplayCommandRejectedError } from '../../services/game-table-websocket-gameplay.service';
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
  const moveSelection = vi.fn();
  const playTopFaceDown = vi.fn();
  const openFixedZone = vi.fn();
  const replaceZoneModalCards = vi.fn();
  const closeZoneModal = vi.fn();
  const markLibraryViewStale = vi.fn();
  const setLoading = vi.fn();
  const markLibraryViewError = vi.fn();
  const setLoaded = vi.fn();
  const bindLibraryWindow = vi.fn();
  const reconcileLibraryView = vi.fn();
  const setMutationPending = vi.fn();
  const setMutationError = vi.fn();

  beforeEach(() => {
    snapshotSignal.set(snapshot([card('card-1'), card('card-2', true), card('card-3')]));
    errorSignal.set(null);
    zoneModalSignal.set(null);
    view.mockResolvedValue(undefined);
    view.mockClear();
    reorderTop.mockResolvedValue(undefined);
    moveSelection.mockResolvedValue(undefined);
    playTopFaceDown.mockResolvedValue(undefined);
    openFixedZone.mockClear();
    replaceZoneModalCards.mockClear();
    closeZoneModal.mockClear();
    markLibraryViewStale.mockClear();
    setLoading.mockClear();
    markLibraryViewError.mockClear();
    setLoaded.mockClear();
    bindLibraryWindow.mockClear();
    reconcileLibraryView.mockClear();
    setMutationPending.mockClear();
    setMutationError.mockClear();

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
          useValue: { view, reorderTop, moveSelection, playTopFaceDown } satisfies Pick<GameTableLibraryActionsService, 'view' | 'reorderTop' | 'moveSelection' | 'playTopFaceDown'>,
        },
        {
          provide: GameTablePlayersStore,
          useValue: { playerName: (playerId: string) => playerId } satisfies Pick<GameTablePlayersStore, 'playerName'>,
        },
        {
          provide: GameTableZoneActionsService,
          useValue: { openFixedZone, replaceZoneModalCards, closeZoneModal } satisfies Pick<GameTableZoneActionsService, 'openFixedZone' | 'replaceZoneModalCards' | 'closeZoneModal'>,
        },
        {
          provide: GameTableZoneModalState,
          useValue: {
            zoneModal: zoneModalSignal,
            markLibraryViewStale,
            setLoading,
            markLibraryViewError,
            setLoaded,
            bindLibraryWindow,
            reconcileLibraryView,
            setMutationPending,
            setMutationError,
          } satisfies Pick<GameTableZoneModalState, 'zoneModal' | 'markLibraryViewStale' | 'setLoading' | 'markLibraryViewError' | 'setLoaded' | 'bindLibraryWindow' | 'reconcileLibraryView' | 'setMutationPending' | 'setMutationError'>,
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
    openFixedZone.mockImplementationOnce(() => {
      zoneModalSignal.set({ ...zoneModal([]), selectionRevision: 'opening-view' });
    });
    await state.viewTopLibrary('player-1', 2.9);

    expect(view).toHaveBeenCalledWith(expect.anything(), 'player-1', 2);
    expect(openFixedZone).toHaveBeenCalledWith(
      'player-1',
      'library',
      'player-1 top 2 library cards',
      [],
      null,
      false,
      {
        allowReorder: true,
        drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO'],
        viewTopCount: 2,
        localMultiSelect: true,
      },
    );
    expect(setLoaded).toHaveBeenCalledWith([card('card-1'), card('card-3')], 2);
    expect(bindLibraryWindow).toHaveBeenCalledWith(expect.objectContaining({ windowId: 'lw-test', status: 'active' }));
    expect(reconcileLibraryView).toHaveBeenCalledWith(snapshotSignal());
  });

  it('opens the entire authorized library as a transient local view without a zone fetch', async () => {
    await state.viewLibrary('player-1');

    expect(view).toHaveBeenCalledWith(expect.anything(), 'player-1');
    expect(openFixedZone).toHaveBeenCalledWith(
      'player-1',
      'library',
      'player-1 library',
      [],
      null,
      false,
      { viewTopCount: null, localMultiSelect: true },
    );
  });

  it('fails closed when the authoritative view command is rejected', async () => {
    openFixedZone.mockImplementationOnce((_playerId, _zone, _title, cards: GameCardInstance[]) => {
      zoneModalSignal.set({ ...zoneModal(cards), selectionRevision: 'pending-view' });
    });
    view.mockRejectedValueOnce(new Error('command rejected'));

    await expect(state.viewTopLibrary('player-1', 2)).rejects.toThrow('command rejected');

    expect(setLoading).toHaveBeenCalledOnce();
    expect(markLibraryViewError).toHaveBeenCalledOnce();
    expect(setLoaded).not.toHaveBeenCalled();
  });

  it('reorders top library cards only from an open reorderable library modal', async () => {
    const cards = [card('card-3'), card('card-1')];
    zoneModalSignal.set(zoneModal(cards));

    await state.reorderTopLibraryCards(cards);

    expect(replaceZoneModalCards).toHaveBeenCalledWith(cards);
    expect(reorderTop).toHaveBeenCalledWith(expect.anything(), 'player-1', ['card-3', 'card-1']);
    expect(markLibraryViewStale).toHaveBeenCalledOnce();
  });

  it('keeps the current draw order labels', () => {
    expect(state.drawOrderLabels(4)).toEqual(['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO', 'ROBO 4']);
  });

  it('submits one authoritative selected batch and closes only after its ack', async () => {
    zoneModalSignal.set(zoneModal([card('card-3'), card('card-1')]));

    await state.moveSelected({ action: 'battlefield-face-down', orderedInstanceIds: ['card-1', 'card-3'] });

    expect(moveSelection).toHaveBeenCalledWith(
      expect.anything(),
      'player-1',
      'lw-test',
      3,
      ['card-1', 'card-3'],
      'battlefield',
      { faceDown: true },
    );
    expect(setMutationPending).toHaveBeenNthCalledWith(1, true);
    expect(closeZoneModal).toHaveBeenCalledOnce();
  });

  it('fails closed on a stale-window rejection without mutating the modal optimistically', async () => {
    zoneModalSignal.set(zoneModal([card('card-3'), card('card-1')]));
    moveSelection.mockRejectedValueOnce(new GameplayCommandRejectedError({
      code: 'LIBRARY_WINDOW_STALE',
      message: 'stale',
      retryable: false,
      windowId: 'lw-test',
      expectedEpoch: 3,
      currentEpoch: 3,
    }));

    await state.moveSelected({ action: 'hand', orderedInstanceIds: ['card-3'] });

    expect(markLibraryViewStale).toHaveBeenCalledOnce();
    expect(closeZoneModal).not.toHaveBeenCalled();
    expect(replaceZoneModalCards).not.toHaveBeenCalled();
  });

  it('submits top X as a distinct count intent without selected IDs', async () => {
    zoneModalSignal.set(zoneModal([card('card-3'), card('card-1')]));

    await state.playTopFaceDown({ count: 2 });

    expect(playTopFaceDown).toHaveBeenCalledWith(expect.anything(), 'player-1', 'lw-test', 2, 3);
    expect(closeZoneModal).toHaveBeenCalledOnce();
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
    libraryVisibilityEpoch: 3,
    libraryWindow: { windowId: 'lw-test', expectedEpoch: 3, openedAtVersion: 1, status: 'active' },
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
    filterSourceCards: null,
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
    lifecycle: 'ready',
    statusMessageKey: null,
    localMultiSelect: true,
    selectionRevision: 'view-1',
    libraryWindow: { windowId: 'lw-test', expectedEpoch: 3, openedAtVersion: 1, status: 'active' },
    mutationPending: false,
    mutationErrorKey: null,
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
