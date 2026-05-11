import { importProvidersFrom } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { LucideAngularModule, Menu } from 'lucide-angular';
import { EMPTY, of } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameSnapshot } from '../../../core/models/game.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { GameTableComponent } from './game-table.component';
import { GameTableChatLogState } from './state/game-table-chat-log.state';

describe('GameTableComponent', () => {
  const gamesApi = {
    snapshot: vi.fn(),
    command: vi.fn(),
    zone: vi.fn(),
  };
  const authStore = {
    user: vi.fn(),
  };
  const routeParams: Record<string, string> = {};

  beforeEach(async () => {
    routeParams['id'] = '';
    gamesApi.snapshot.mockReset();
    gamesApi.command.mockReset();
    gamesApi.zone.mockReset();
    authStore.user.mockReset().mockReturnValue(null);

    await TestBed.configureTestingModule({
      imports: [GameTableComponent],
      providers: [
        { provide: GamesApi, useValue: gamesApi },
        { provide: AuthStore, useValue: authStore },
        { provide: MercureService, useValue: { gameEvents: vi.fn().mockReturnValue(EMPTY) } },
        importProvidersFrom(LucideAngularModule.pick({ Menu })),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: (key: string) => convertToParamMap(routeParams).get(key) } } },
        },
      ],
    }).compileComponents();
  });

  it('shows a missing game id error without a route id', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.error()).toBe('Missing game id.');
  });

  it('dismisses table errors after showing the toast', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.store.loading.set(false);
    fixture.componentInstance.store.snapshot.set(snapshotWithStatus('active'));
    fixture.componentInstance.store.error.set(null);
    fixture.detectChanges();

    vi.useFakeTimers();
    try {
      fixture.componentInstance.store.error.set('Could not apply game action.');
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.table-error')?.textContent).toContain('Could not apply game action.');

      vi.advanceTimersByTime(2999);
      fixture.detectChanges();
      expect(fixture.componentInstance.store.error()).toBe('Could not apply game action.');

      vi.advanceTimersByTime(1);
      fixture.detectChanges();

      expect(fixture.componentInstance.store.error()).toBeNull();
      expect(fixture.nativeElement.querySelector('.table-error')).toBeNull();
    } finally {
      vi.useRealTimers();
      fixture.destroy();
    }
  });

  it('concedes through a dedicated game command even if another action is pending', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    const concededSnapshot = snapshotWithStatus('conceded');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gamesApi.command.mockReturnValue(of({ event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' }, snapshot: concededSnapshot }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.concedeGame();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(fixture.componentInstance.store.snapshot()?.players['user-1'].status).toBe('conceded');
  });

  it('keeps a clicked battlefield card as the active shortcut card', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0];
    expect(card).toBeTruthy();
    fixture.componentInstance.store.selectedCards.set([{ playerId: 'user-1', zone: 'battlefield', card: card! }]);
    const event = {
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent;
    fixture.componentInstance.store.handleBattlefieldCardClick(event, 'user-1', card!);

    expect(fixture.componentInstance.store.activeKeyboardCard()?.card.instanceId).toBe('card-1');
  });

  it('clears selected cards when drag ends', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0];
    expect(card).toBeTruthy();
    fixture.componentInstance.store.selectedCards.set([{ playerId: 'user-1', zone: 'battlefield', card: card! }]);

    fixture.componentInstance.store.dragEnd();

    expect(fixture.componentInstance.store.selectedCards()).toEqual([]);
  });

  it('does not open the library on left click', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const openZone = vi.spyOn(fixture.componentInstance.store, 'openZone');

    const libraryButton = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.zone-stack'))
      .find((element) => element.textContent?.includes('Library'));
    libraryButton?.click();

    expect(openZone).not.toHaveBeenCalledWith('user-1', 'library');
  });

  it('loads zone cards into the zone modal', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const libraryCard = snapshot.players['user-1'].zones.library[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.zone.mockReturnValue(of({
      gameId: 'game-1',
      playerId: 'user-1',
      zone: 'library',
      total: 1,
      data: [libraryCard],
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.openZone('user-1', 'library');

    expect(gamesApi.zone).toHaveBeenCalledWith('game-1', 'user-1', 'library', {
      type: '',
      search: '',
      limit: 200,
    });
    expect(fixture.componentInstance.store.zoneModal()?.title).toBe('User Library');
    expect(fixture.componentInstance.store.zoneModal()?.cards).toEqual([libraryCard]);
    expect(fixture.componentInstance.store.zoneModal()?.selectedCard).toBe(libraryCard);
  });

  it('does not allow dragging cards out of the library pile', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const player = fixture.componentInstance.store.players()[0];
    const setData = vi.fn();
    const event = {
      dataTransfer: { setData, effectAllowed: '' },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    fixture.componentInstance.store.dragTopZoneCard(event, player, 'library');

    expect(setData).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.store.draggingCardInstanceId()).toBeNull();
  });

  it('defers remote refetch snapshots while pointer drag is active and applies them after drag ends', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const base = snapshotWithStatus('active');
    const remote = snapshotWithStatus('active');
    remote.version = 2;
    remote.players['user-1']!.life = 39;
    gamesApi.snapshot
      .mockReturnValueOnce(of({ game: { id: 'game-1', status: 'active', snapshot: base } }))
      .mockReturnValueOnce(of({ game: { id: 'game-1', status: 'active', snapshot: remote } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const store = fixture.componentInstance.store;
    const card = store.snapshot()?.players['user-1']?.zones.battlefield[0];
    expect(card).toBeTruthy();

    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    const cardElement = document.createElement('button');
    battlefield.appendChild(cardElement);

    const rect = {
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      top: 0,
      left: 0,
      right: 120,
      bottom: 120,
      toJSON: () => ({}),
    } as DOMRect;
    cardElement.getBoundingClientRect = () => rect;
    battlefield.getBoundingClientRect = () => rect;

    store.startBattlefieldPointerDrag({
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: cardElement,
      clientX: 20,
      clientY: 20,
    } as unknown as PointerEvent, 'user-1', card!);

    await store.refetch(false);
    expect(store.snapshot()?.version).toBe(1);
    expect(store.snapshot()?.players['user-1']?.life).toBe(40);

    await store.endCardPointerDrag();
    expect(store.snapshot()?.version).toBe(2);
    expect(store.snapshot()?.players['user-1']?.life).toBe(39);
  });

  it('only lets the active turn player advance phases from the table', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      ...snapshot.players['user-1'],
      user: { id: 'user-2', email: 'guest@test', displayName: 'Guest', roles: [] },
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    };
    snapshot.turn.activePlayerId = 'user-2';
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.advanceTurnPhase();

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('Only the active turn player can advance the turn.');
  });

  it('opens a close confirmation before sending the close game command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'closeGame' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'game',
    });

    expect(fixture.componentInstance.closeGameDialogOpen()).toBe(true);
    expect(gamesApi.command).not.toHaveBeenCalled();
  });

  it('shows the table sync status and prioritizes pending actions', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    expect(fixture.componentInstance.store.syncStatus()).toBe('connecting');
    expect(fixture.nativeElement.textContent).toContain('Connecting');

    fixture.componentInstance.store.pending.set(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.syncStatus()).toBe('pending');
    expect(fixture.nativeElement.textContent).toContain('Applying action');
  });

  it('uses the number dialog value when changing a card counter', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-counter', type: 'card.counter.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'changeCounter', counter: '+1/+1' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });
    fixture.componentInstance.confirmNumberAction(-2);

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.counter.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        key: '+1/+1',
        delta: -2,
      },
    }), 'game-1');
  });

  it('draws the requested number of top library cards from the library menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-draw', type: 'library.draw', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'drawPrompt' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'library',
      kind: 'zone',
    });
    fixture.componentInstance.confirmNumberAction(3);

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledTimes(3));
    expect(gamesApi.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'library.draw',
      payload: {
        playerId: 'user-1',
        count: 1,
      },
    }), 'game-1');
    expect(gamesApi.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'library.draw',
      payload: {
        playerId: 'user-1',
        count: 1,
      },
    }), 'game-1');
    expect(gamesApi.command).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'library.draw',
      payload: {
        playerId: 'user-1',
        count: 1,
      },
    }), 'game-1');
  });

  it('explains when a table action is blocked by another pending action', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.command('life.changed', { playerId: 'user-1', delta: -1 });

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('Wait for the current table action to finish.');
  });

  it('blocks changing another player life total', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      ...snapshot.players['user-1'],
      user: { id: 'user-2', email: 'guest@test', displayName: 'Guest', roles: [] },
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.changeLife('user-2', -1);
    await fixture.componentInstance.store.setLife('user-2', 35);

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('You can only change your own life total.');
  });

  it('explains why opponent battlefield cards cannot be selected', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      ...snapshot.players['user-1'],
      user: { id: 'user-2', email: 'guest@test', displayName: 'Guest', roles: [] },
      zones: {
        ...snapshot.players['user-1'].zones,
        battlefield: [{
          ...snapshot.players['user-1'].zones.battlefield[0]!,
          instanceId: 'opponent-card',
          ownerId: 'user-2',
          controllerId: 'user-2',
        }],
      },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.handleBattlefieldCardClick({
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent, 'user-2', snapshot.players['user-2'].zones.battlefield[0]!);

    expect(fixture.componentInstance.store.selectedCards()).toEqual([]);
    expect(fixture.componentInstance.store.error()).toBe('You can only select cards on your own battlefield.');
  });

  it('explains why opponent battlefield card menus cannot be opened', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      ...snapshot.players['user-1'],
      user: { id: 'user-2', email: 'guest@test', displayName: 'Guest', roles: [] },
      zones: {
        ...snapshot.players['user-1'].zones,
        battlefield: [{
          ...snapshot.players['user-1'].zones.battlefield[0]!,
          instanceId: 'opponent-card',
          ownerId: 'user-2',
          controllerId: 'user-2',
        }],
      },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCardMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent, 'user-2', 'battlefield', snapshot.players['user-2'].zones.battlefield[0]!);

    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
    expect(fixture.componentInstance.store.error()).toBe('You can only open card actions for your own battlefield.');
  });

  it('plays a hand card on double click', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const handCard = {
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      instanceId: 'hand-card',
      name: 'Arcane Signet',
    };
    snapshot.players['user-1'].zones.hand = [handCard];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-play', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.handleHandCardClick({
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      currentTarget: document.createElement('button'),
      detail: 2,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent, 'user-1', handCard);

    await fixture.whenStable();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId: 'hand-card',
      },
    }), 'game-1');
  });

  it('keeps the exact previewed battlefield position when pointer-moving selected hand cards', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const handCards = [
      { ...snapshot.players['user-1'].zones.battlefield[0]!, instanceId: 'hand-1', name: 'Arcane Signet' },
      { ...snapshot.players['user-1'].zones.battlefield[0]!, instanceId: 'hand-2', name: 'Mind Stone' },
    ];
    snapshot.players['user-1'].zones.hand = handCards;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-play', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.selectedCards.set([
      { playerId: 'user-1', zone: 'hand', card: handCards[0]! },
      { playerId: 'user-1', zone: 'hand', card: handCards[1]! },
    ]);
    await fixture.componentInstance.store.moveHandCardByPointer(
      'user-1',
      'user-1',
      'hand-1',
      'battlefield',
      { x: 111, y: 222 },
    );

    const payloads = gamesApi.command.mock.calls.map(([command]) => command.payload);
    expect(payloads.map((payload) => payload.position)).toEqual([
      { x: 111, y: 222 },
      { x: 111, y: 222 },
    ]);
  });

  it('marks turn changes with the phase log appearance', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [gameLogEntry('event-phase', 'turn.changed', 'Fase combat.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.store.eventLog()[0]?.appearance).toBe('phase');
  });
});

describe('GameTableChatLogState', () => {
  it('compacts consecutive life changes for the same player', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'life.changed', 'Set User life to 39.'),
      gameLogEntry('event-2', 'life.changed', 'Set User life to 38.'),
      gameLogEntry('event-3', 'life.changed', 'Set User life to 37.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'User lost 3 life (40 -> 37).',
    ]);
  });

  it('does not merge life changes when the direction changes', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'life.changed', 'Set User life to 39.'),
      gameLogEntry('event-2', 'life.changed', 'Set User life to 38.'),
      gameLogEntry('event-3', 'life.changed', 'Set User life to 39.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'User lost 2 life (40 -> 38).',
      'Set User life to 39.',
    ]);
  });

  it('compacts commander return and cast count into one log entry', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'card.moved', 'Moved Sméagol, Helpful Guide from battlefield to command.'),
      gameLogEntry('event-2', 'card.moved', 'Moved Sméagol, Helpful Guide from command to battlefield.'),
      gameLogEntry('event-3', 'counter.changed', 'Set commander:user-1 counter casts to 2.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Moved Sméagol, Helpful Guide from battlefield to command. Commander cast count increased from 1 to 2.',
    ]);
  });
});

function snapshotWithStatus(status: 'active' | 'conceded'): GameSnapshot {
  return {
    version: status === 'active' ? 1 : 2,
    ownerId: 'user-1',
    players: {
      'user-1': {
        user: { id: 'user-1', email: 'user@test', displayName: 'User', roles: [] },
        status,
        concededAt: status === 'conceded' ? '2026-04-30T20:00:00+00:00' : null,
        colorIdentity: ['W'],
        life: 40,
        zones: {
          library: [{
            instanceId: 'library-card',
            ownerId: 'user-1',
            controllerId: 'user-1',
            name: 'Plains',
            typeLine: 'Basic Land — Plains',
            tapped: false,
            counters: {},
          }],
          hand: [],
          battlefield: [{
            instanceId: 'card-1',
            ownerId: 'user-1',
            controllerId: 'user-1',
            name: 'Sol Ring',
            typeLine: 'Artifact',
            tapped: false,
            counters: {},
          }],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 1,
          hand: 0,
          battlefield: 1,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'user-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-04-30T20:00:00+00:00',
    updatedAt: '2026-04-30T20:00:00+00:00',
  };
}

function gameLogEntry(id: string, type: string, message: string): GameSnapshot['eventLog'][number] {
  return {
    id,
    type,
    message,
    actorId: 'user-1',
    displayName: 'User',
    createdAt: '2026-04-30T20:00:00+00:00',
  };
}
