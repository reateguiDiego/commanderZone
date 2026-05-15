import { importProvidersFrom } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import {
  ArrowLeft,
  Ban,
  BarChart3,
  Bell,
  Building2,
  BookmarkPlus,
  Camera,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  CircleUserRound,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Folder,
  FolderPlus,
  Globe,
  History,
  KeyRound,
  Layers3,
  Library,
  Lock,
  LogIn,
  LogOut,
  LucideAngularModule,
  Maximize2,
  Menu,
  MessageSquare,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  SearchX,
  Send,
  Settings,
  ShieldCheck,
  Swords,
  TabletSmartphone,
  Trash,
  Trash2,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-angular';
import { EMPTY, Subject, of } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommandResponse } from '../../../core/models/api-responses.model';
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
    logout: vi.fn(),
  };
  const mercureService = {
    gameEvents: vi.fn(),
  };
  const routeParams: Record<string, string> = {};

  beforeEach(async () => {
    routeParams['id'] = '';
    gamesApi.snapshot.mockReset();
    gamesApi.command.mockReset();
    gamesApi.zone.mockReset();
    authStore.user.mockReset().mockReturnValue(null);
    authStore.logout.mockReset().mockResolvedValue(undefined);
    mercureService.gameEvents.mockReset().mockReturnValue(EMPTY);

    await TestBed.configureTestingModule({
      imports: [GameTableComponent],
      providers: [
        { provide: GamesApi, useValue: gamesApi },
        { provide: AuthStore, useValue: authStore },
        { provide: MercureService, useValue: mercureService },
        importProvidersFrom(LucideAngularModule.pick({
          ArrowLeft,
          Ban,
          BarChart3,
          Bell,
          Building2,
          BookmarkPlus,
          Camera,
          ChevronDown,
          ChevronRight,
          Check,
          CheckCircle2,
          CircleUserRound,
          Copy,
          DoorOpen,
          Eye,
          EyeOff,
          FileDown,
          FileUp,
          Folder,
          FolderPlus,
          Globe,
          History,
          KeyRound,
          Layers3,
          Library,
          Lock,
          LogIn,
          LogOut,
          Maximize2,
          Menu,
          MessageSquare,
          MoreVertical,
          Pencil,
          Play,
          Plus,
          RefreshCcw,
          RotateCcw,
          RotateCw,
          Save,
          Search,
          SearchX,
          Send,
          Settings,
          ShieldCheck,
          Swords,
          TabletSmartphone,
          Trash,
          Trash2,
          TriangleAlert,
          Upload,
          UserPlus,
          Users,
          X,
        })),
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

  it('resolves the current player deck visuals for the table background and card sleeves', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.backgroundName = 'back_5';
    snapshot.players['user-1']!.sleevesName = 'facedown_card';
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const gameScreen = fixture.nativeElement.querySelector('[data-testid="game-screen"]') as HTMLElement;
    const faceDownCard = {
      instanceId: 'face-down-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Face-down card',
      tapped: false,
      faceDown: true,
    };

    expect(gameScreen.style.getPropertyValue('--game-wallpaper-image')).toContain('/assets/images/backgrounds/back_5.png');
    expect(fixture.componentInstance.store.cardImage(faceDownCard)).toBe('/assets/images/facedown_card.jpg');
    expect(fixture.componentInstance.store.zonePreviewImage(fixture.componentInstance.store.currentPlayer()!, 'library'))
      .toBe('/assets/images/facedown_card.jpg');
  });

  it('targets the opponent directly in two-player chat rooms', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      ...structuredClone(snapshot.players['user-1']!),
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
      zoneCounts: {
        library: 0,
        hand: 0,
        battlefield: 0,
        graveyard: 0,
        exile: 0,
        command: 0,
      },
    };
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.chat = [{
      userId: 'user-1',
      displayName: 'User',
      message: 'secret',
      targetPlayerId: 'user-2',
      targetDisplayName: 'Opponent',
      createdAt: '2026-04-30T20:02:00+00:00',
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-chat', type: 'chat.message', payload: { private: true }, createdBy: 'user-1', createdAt: '' },
      snapshot: nextSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const recipients = fixture.componentInstance.store.chatRecipients();
    expect(recipients).toEqual([{ playerId: 'user-2', label: 'Opponent' }]);
    expect(fixture.componentInstance.store.shouldShowChatRecipientSelect()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="chat-recipient"]')).toBeNull();

    fixture.componentInstance.store.setChatMessage('secret');
    await fixture.componentInstance.store.sendChat();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat.message',
      payload: { message: 'secret', targetPlayerId: 'user-2' },
    }), 'game-1');
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

  it('drags only one card when the current selection contains a single card', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const selectedCard = snapshot.players['user-1']!.zones.battlefield[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const setData = vi.fn();
    fixture.componentInstance.store.selectedCards.set([{ playerId: 'user-1', zone: 'battlefield', card: selectedCard }]);
    fixture.componentInstance.store.dragStart({
      dataTransfer: { setData, effectAllowed: '' },
      preventDefault: vi.fn(),
      target: document.createElement('button'),
    } as unknown as DragEvent, 'user-1', 'battlefield', selectedCard);

    const payloadCall = setData.mock.calls.find(([format]) => format === 'application/json');
    expect(payloadCall).toBeTruthy();
    expect(JSON.parse(payloadCall?.[1] as string)).toEqual(expect.objectContaining({
      instanceId: 'card-1',
      instanceIds: ['card-1'],
    }));
  });

  it('optimistically moves a hand card to the battlefield before the command resolves', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.hand = [{
      instanceId: 'hand-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      tapped: false,
      counters: {},
    }];
    snapshot.players['user-1']!.zones.battlefield = [];
    snapshot.players['user-1']!.zoneCounts = {
      library: 1,
      hand: 1,
      battlefield: 0,
      graveyard: 0,
      exile: 0,
      command: 0,
    };
    const commandResponse = new Subject<CommandResponse>();
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(commandResponse.asObservable());

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const movePromise = fixture.componentInstance.store.moveHandCardByPointer(
      'user-1',
      'user-1',
      'hand-card',
      'battlefield',
      { x: 24, y: 36 },
    );

    const optimisticSnapshot = fixture.componentInstance.store.snapshot();
    expect(optimisticSnapshot?.players['user-1']?.zones.hand).toEqual([]);
    expect(optimisticSnapshot?.players['user-1']?.zones.battlefield).toEqual([
      expect.objectContaining({ instanceId: 'hand-card', position: { x: 0.030612, y: 0.100559, unit: 'ratio' } }),
    ]);
    expect(optimisticSnapshot?.players['user-1']?.zoneCounts?.hand).toBe(0);
    expect(optimisticSnapshot?.players['user-1']?.zoneCounts?.battlefield).toBe(1);

    commandResponse.next({
      event: { id: 'event-move', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: optimisticSnapshot!,
    });
    commandResponse.complete();
    await movePromise;
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

    fixture.componentInstance.store.pending.set(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.syncStatus()).toBe('pending');
  });

  it('initializes a selected card counter at zero without opening the number dialog', async () => {
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
    vi.useFakeTimers();
    fixture.componentInstance.handleContextMenuAction({ type: 'changeCounter', counter: '+1/+1' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.counter.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        key: '+1/+1',
        value: 0,
      },
    }), 'game-1');
    expect(fixture.componentInstance.numberActionDialog()).toBeNull();
  });

  it('prevents adding a sixth distinct card counter before sending a command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = {
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      counters: { '+1/+1': 0, '-1/-1': 0, charge: 0, red: 0, green: 0 },
    };
    fixture.componentInstance.handleContextMenuAction({ type: 'changeCounter', counter: 'blue' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('Maximum 5 different counters per card.');
  });

  it('removes all visible card counters optimistically from the context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield[0]!.counters = { red: 2, green: 1 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'removeAllCounters' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0]?.counters).toEqual({});
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('asks for a library position when a context-menu card move targets the library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'moveCard', zone: 'library' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
    expect(fixture.componentInstance.store.pendingLibraryMove()).toEqual({
      cardName: 'Sol Ring',
      commandType: 'card.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'battlefield',
        toZone: 'library',
        instanceId: 'card-1',
      },
    });
  });

  it('asks for one library position when selected cards move to the library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-2',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      tapped: false,
      counters: {},
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const cards = snapshot.players['user-1'].zones.battlefield;
    fixture.componentInstance.store.selectedCards.set([
      { playerId: 'user-1', zone: 'battlefield', card: cards[0]! },
      { playerId: 'user-1', zone: 'battlefield', card: cards[1]! },
    ]);

    await fixture.componentInstance.store.moveSelected('library');

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.pendingLibraryMove()).toEqual({
      cardName: '2 cards',
      commandType: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'battlefield',
        toZone: 'library',
        instanceIds: ['card-1', 'card-2'],
      },
    });
  });

  it('gives a battlefield card to another player from the context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      status: 'active',
      concededAt: null,
      colorIdentity: ['B'],
      backgroundName: 'back_5',
      sleevesName: 'facedown_card',
      life: 40,
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
      commanderDamage: {},
      counters: {},
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-controller', type: 'card.controller.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.pendingBattlefieldMove()).toEqual({
      cardName: 'Sol Ring',
      targetPlayerName: 'Opponent',
      commandType: 'card.controller.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        targetPlayerId: 'user-2',
      },
    });

    await fixture.componentInstance.store.confirmPendingBattlefieldMove();

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.controller.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        targetPlayerId: 'user-2',
      },
    }), 'game-1'));
  });

  it('opens target-player selection before creating an arrow from a context-menu source', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-2'] = {
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: [{
          instanceId: 'card-2',
          ownerId: 'user-2',
          controllerId: 'user-2',
          name: 'Arcane Signet',
          typeLine: 'Artifact',
          tapped: false,
          counters: {},
        }],
        graveyard: [],
        exile: [],
        command: [],
      },
      commanderDamage: {},
      counters: {},
    };
    snapshot.players['user-2'].zoneCounts = {
      library: 0,
      hand: 0,
      battlefield: 1,
      graveyard: 0,
      exile: 0,
      command: 0,
    };
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-3',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Mind Stone',
      typeLine: 'Artifact',
      tapped: false,
      counters: {},
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-arrow', type: 'arrow.created', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.focusPlayerBattlefield('user-2');

    const source = snapshot.players['user-1'].zones.battlefield[0]!;
    const target = snapshot.players['user-2'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'drawArrow' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card: source,
    });

    expect(fixture.componentInstance.arrowTargetDialog()).toEqual(expect.objectContaining({
      selectedPlayerId: 'user-1',
      multipleTargets: false,
      targetCount: 1,
    }));
    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-1');
    expect(fixture.componentInstance.store.pendingArrowSource()).toBeNull();

    fixture.componentInstance.updateArrowTargetDialog({ playerId: 'user-2', multipleTargets: false, targetCount: 1 });
    fixture.detectChanges();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(fixture.componentInstance.store.pendingArrowSource()).toBeNull();
    expect(fixture.componentInstance.arrowTargetDialog()).toEqual(expect.objectContaining({
      selectedPlayerId: 'user-2',
      multipleTargets: false,
      targetCount: 1,
    }));

    fixture.componentInstance.confirmArrowTargetDialog({ playerId: 'user-2', multipleTargets: false, targetCount: 1 });

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(fixture.componentInstance.store.pendingArrowSource()).toEqual(expect.objectContaining({
      instanceId: 'card-1',
    }));

    fixture.componentInstance.store.handleBattlefieldCardClick(new MouseEvent('click'), 'user-2', target);

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.created',
      payload: {
        fromInstanceId: 'card-1',
        toInstanceId: 'card-2',
        color: 'yellow',
      },
    }), 'game-1'));
  });

  it('uses source card color for arrows', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield[0]!.colorIdentity = ['B', 'G'];
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-arrow', type: 'arrow.created', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const source = snapshot.players['user-1'].zones.battlefield[0]!;
    const target = snapshot.players['user-2'].zones.battlefield[0]!;
    fixture.componentInstance.store.startArrowFrom({
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card: source,
    });
    fixture.componentInstance.store.handleBattlefieldCardClick(new MouseEvent('click'), 'user-2', target);

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.created',
      payload: {
        fromInstanceId: 'card-1',
        toInstanceId: 'card-2',
        color: 'black',
      },
    }), 'game-1'));
  });

  it('creates one arrow per selected target in multiple-target mode', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield[0]!.colorIdentity = ['G'];
    addOpponent(snapshot);
    snapshot.players['user-2'].zones.battlefield.push({
      instanceId: 'card-4',
      ownerId: 'user-2',
      controllerId: 'user-2',
      name: 'Command Tower',
      typeLine: 'Land',
      tapped: false,
      counters: {},
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-arrow', type: 'arrow.created', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const source = snapshot.players['user-1'].zones.battlefield[0]!;
    const firstTarget = snapshot.players['user-2'].zones.battlefield[0]!;
    const secondTarget = snapshot.players['user-2'].zones.battlefield[1]!;
    fixture.componentInstance.store.startArrowFrom({
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card: source,
    }, 2);

    expect(fixture.componentInstance.store.tableToast()).toBe('Faltan 2 objetivos.');

    fixture.componentInstance.store.handleBattlefieldCardClick(new MouseEvent('click'), 'user-2', firstTarget);

    expect(fixture.componentInstance.store.pendingArrowSource()).toEqual(expect.objectContaining({
      selectedTargetInstanceIds: ['card-2'],
      targetCount: 2,
    }));
    expect(fixture.componentInstance.store.tableToast()).toBe('Falta 1 objetivo.');

    fixture.componentInstance.store.handleBattlefieldCardClick(new MouseEvent('click'), 'user-2', secondTarget);

    expect(fixture.componentInstance.store.pendingArrowSource()).toBeNull();
    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledTimes(2));
    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.created',
      payload: { fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'green' },
    }), 'game-1');
    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.created',
      payload: { fromInstanceId: 'card-1', toInstanceId: 'card-4', color: 'green' },
    }), 'game-1');
  });

  it('cancels target-player selection without activating arrow targeting', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-2',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      tapped: false,
      counters: {},
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const source = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'drawArrow' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card: source!,
    });

    fixture.componentInstance.cancelArrowTargetDialog();

    expect(fixture.componentInstance.arrowTargetDialog()).toBeNull();
    expect(fixture.componentInstance.store.pendingArrowSource()).toBeNull();
    expect(gamesApi.command).not.toHaveBeenCalled();
  });

  it('derives an outgoing targeting pill for an opponent mini board', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.arrows = [{ id: 'arrow-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '' }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.opponentTargetingPills().get('user-2')).toEqual(expect.objectContaining({
      direction: 'outgoing',
      text: 'Objetivo: Opponent',
    }));
    expect(fixture.componentInstance.store.opponentCardsTargetCards().get('user-2')).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ instanceId: 'card-2' }),
        role: 'target',
      }),
    ]);
  });

  it('derives an incoming targeting pill for an opponent mini board', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.arrows = [{ id: 'arrow-1', fromInstanceId: 'card-2', toInstanceId: 'card-1', color: 'yellow', createdAt: '' }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.opponentTargetingPills().get('user-2')).toEqual(expect.objectContaining({
      direction: 'incoming',
      text: 'Objetivo de Opponent',
    }));
    expect(fixture.componentInstance.store.opponentCardsTargetCards().get('user-2')).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ instanceId: 'card-2' }),
        role: 'source',
      }),
    ]);
  });

  it('orders cards-target cards by the counterpart battlefield position', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-1'].zones.battlefield[0]!.position = { x: 600, y: 120 };
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-3',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Second Source',
      typeLine: 'Creature',
      tapped: false,
      position: { x: 120, y: 120 },
      counters: {},
    });
    snapshot.players['user-2'].zones.battlefield.push({
      instanceId: 'card-4',
      ownerId: 'user-2',
      controllerId: 'user-2',
      name: 'Second Target',
      typeLine: 'Creature',
      tapped: false,
      counters: {},
    });
    snapshot.arrows = [
      { id: 'arrow-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '' },
      { id: 'arrow-2', fromInstanceId: 'card-3', toInstanceId: 'card-4', color: 'blue', createdAt: '' },
    ];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.opponentCardsTargetCards().get('user-2')?.map((entry) => entry.card.instanceId)).toEqual([
      'card-4',
      'card-2',
    ]);
  });

  it('opens a focused battlefield when focus receives a user id instead of a snapshot player key', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['seat-2'] = {
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: [{
          instanceId: 'opponent-card',
          ownerId: 'seat-2',
          controllerId: 'seat-2',
          name: 'Arcane Signet',
          typeLine: 'Artifact',
          tapped: false,
          counters: {},
        }],
        graveyard: [],
        exile: [],
        command: [],
      },
      zoneCounts: {
        library: 0,
        hand: 0,
        battlefield: 1,
        graveyard: 0,
        exile: 0,
        command: 0,
      },
      commanderDamage: {},
      counters: {},
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.focusPlayerBattlefield('user-2');
    fixture.detectChanges();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('seat-2');
  });

  it('removes an arrow from the arrow context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.arrows = [{ id: 'arrow-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '' }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-arrow-removed', type: 'arrow.removed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'deleteArrow' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'arrow',
      arrowId: 'arrow-1',
    });

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.removed',
      payload: { id: 'arrow-1' },
    }), 'game-1'));
  });

  it('removes all arrows owned by the current player from the arrow context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-3',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Mind Stone',
      typeLine: 'Artifact',
      tapped: false,
      counters: {},
    });
    snapshot.arrows = [
      { id: 'arrow-1', ownerId: 'user-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '' },
      { id: 'arrow-2', ownerId: 'user-2', fromInstanceId: 'card-2', toInstanceId: 'card-1', color: 'blue', createdAt: '' },
      { id: 'arrow-3', ownerId: 'user-1', fromInstanceId: 'card-3', toInstanceId: 'card-2', color: 'green', createdAt: '' },
    ];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-arrow-removed', type: 'arrow.removed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.store.ownedArrowCount('user-1')).toBe(2);
    fixture.componentInstance.handleContextMenuAction({ type: 'deleteArrows' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'arrow',
      arrowId: 'arrow-1',
    });

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledTimes(2));
    expect(gamesApi.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'arrow.removed',
      payload: { id: 'arrow-1' },
    }), 'game-1');
    expect(gamesApi.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'arrow.removed',
      payload: { id: 'arrow-3' },
    }), 'game-1');
  });

  it('does not open an arrow context menu for arrows owned by another player', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openArrowMenu(new MouseEvent('click'), 'user-2', 'arrow-2');

    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
  });

  it('clears manual power toughness from the card context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    card.power = 3;
    card.toughness = 3;
    card.defaultPower = null;
    card.defaultToughness = null;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-pt', type: 'card.power_toughness.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'clearPowerToughness' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.power_toughness.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        power: null,
        toughness: null,
      },
    }), 'game-1'));
  });

  it('asks for one library position when pointer-moving selected hand cards to the library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const handCards = [
      { ...snapshot.players['user-1'].zones.battlefield[0]!, instanceId: 'hand-1', name: 'Arcane Signet', zone: 'hand' as const },
      { ...snapshot.players['user-1'].zones.battlefield[0]!, instanceId: 'hand-2', name: 'Mind Stone', zone: 'hand' as const },
    ];
    snapshot.players['user-1'].zones.hand = handCards;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.selectedCards.set([
      { playerId: 'user-1', zone: 'hand', card: handCards[0]! },
      { playerId: 'user-1', zone: 'hand', card: handCards[1]! },
    ]);
    await fixture.componentInstance.store.moveHandCardByPointer('user-1', 'user-1', 'hand-1', 'library');

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.pendingLibraryMove()).toEqual({
      cardName: '2 cards',
      commandType: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'hand',
        toZone: 'library',
        instanceIds: ['hand-1', 'hand-2'],
      },
    });
    expect(fixture.componentInstance.store.selectedCards()).toEqual([]);
  });

  it('flips a double-faced card from the context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const card = snapshot.players['user-1'].zones.hand[0] = {
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      instanceId: 'dfc-1',
      name: 'Front // Back',
      zone: 'hand',
      activeFaceIndex: 0,
      cardFaces: [
        { name: 'Front', manaCost: null, typeLine: null, oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: '/front.jpg' } },
        { name: 'Back', manaCost: null, typeLine: null, oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: '/back.jpg' } },
      ],
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-face', type: 'card.face.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'flipCardFace' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'hand',
      kind: 'card',
      card,
    });

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.face.changed',
      payload: {
        playerId: 'user-1',
        zone: 'hand',
        instanceId: 'dfc-1',
        faceIndex: 1,
      },
    }), 'game-1'));
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

  it('queues card counter clicks behind a pending action without showing the wait toast', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield[0]!.counters = { red: 1 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.changeCardCounterForCard(
      'user-1',
      'battlefield',
      snapshot.players['user-1'].zones.battlefield[0]!,
      'red',
      1,
    );

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).not.toBe('Wait for the current table action to finish.');
    expect(fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0]?.counters?.['red']).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not block battlefield position persistence behind another pending action', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-position', type: 'card.position.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.command('card.position.changed', {
      playerId: 'user-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      position: { x: 120, y: 140 },
    });

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledOnce());
    expect(fixture.componentInstance.store.error()).not.toBe('Wait for the current table action to finish.');
  });

  it('clamps positioned battlefield cards when the battlefield viewport shrinks', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.battlefield[0]!.position = { x: 700, y: 520 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.dataset['playerId'] = 'user-1';
    const cardElement = document.createElement('button');
    cardElement.dataset['cardInstanceId'] = 'card-1';
    cardElement.setAttribute('data-testid', 'game-card');
    battlefield.appendChild(cardElement);
    document.body.appendChild(battlefield);
    const battlefieldBounds = {
      x: 0,
      y: 0,
      width: 320,
      height: 260,
      top: 0,
      left: 0,
      right: 320,
      bottom: 260,
      toJSON: () => ({}),
    } as DOMRect;
    const cardBounds = {
      x: 0,
      y: 0,
      width: 100,
      height: 140,
      top: 0,
      left: 0,
      right: 100,
      bottom: 140,
      toJSON: () => ({}),
    } as DOMRect;
    battlefield.getBoundingClientRect = () => battlefieldBounds;
    cardElement.getBoundingClientRect = () => cardBounds;
    Object.defineProperty(cardElement, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(cardElement, 'offsetHeight', { configurable: true, value: 140 });

    fixture.componentInstance.store.reflowBattlefieldCardPositions();
    battlefield.remove();

    expect(fixture.componentInstance.store.snapshot()?.players['user-1']?.zones.battlefield[0]?.position)
      .toEqual({ x: 220, y: 120 });

    const remoteSnapshot = structuredClone(snapshot);
    remoteSnapshot.version += 1;
    remoteSnapshot.players['user-1']!.zones.battlefield[0]!.position = { x: 700, y: 520 };
    gamesApi.snapshot.mockReturnValueOnce(of({ game: { id: 'game-1', status: 'active', snapshot: remoteSnapshot } }));

    await fixture.componentInstance.store.refetch(true);

    expect(fixture.componentInstance.store.snapshot()?.players['user-1']?.zones.battlefield[0]?.position)
      .toEqual({ x: 220, y: 120 });
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

  it('does not play a hand card on double click', async () => {
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

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.selectedCards()).toEqual([
      expect.objectContaining({
        playerId: 'user-1',
        zone: 'hand',
        card: expect.objectContaining({ instanceId: 'hand-card' }),
      }),
    ]);
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
      { x: 0.141582, y: 0.620112, unit: 'ratio' },
      { x: 0.141582, y: 0.620112, unit: 'ratio' },
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

  it('does not send commander cast count commands that keep the value at zero', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.counters = {
      'commander:user-1': { casts: 0 },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.changeCommanderCastCount('user-1', -1);

    expect(gamesApi.command).not.toHaveBeenCalled();
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
      gameLogEntry('event-1', 'card.moved', 'Moved SmÃ©agol, Helpful Guide from battlefield to command.'),
      gameLogEntry('event-2', 'card.moved', 'Moved SmÃ©agol, Helpful Guide from command to battlefield.'),
      gameLogEntry('event-3', 'counter.changed', 'Set commander:user-1 counter casts to 2.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Moved SmÃ©agol, Helpful Guide from battlefield to command. Commander cast count increased from 1 to 2.',
    ]);
  });

  it('compacts consecutive commander cast counter increases', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'counter.changed', 'Commander cast count increased from 1 to 2.'),
      gameLogEntry('event-2', 'counter.changed', 'Commander cast count increased from 2 to 3.'),
      gameLogEntry('event-3', 'counter.changed', 'Commander cast count increased from 3 to 4.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Commander cast count increased from 1 to 4 (+3 clicks).',
    ]);
  });

  it('compacts consecutive commander cast counter decreases', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'counter.changed', 'Commander cast count decreased from 4 to 3.'),
      gameLogEntry('event-2', 'counter.changed', 'Commander cast count decreased from 3 to 2.'),
      gameLogEntry('event-3', 'counter.changed', 'Commander cast count decreased from 2 to 1.'),
      gameLogEntry('event-4', 'counter.changed', 'Commander cast count decreased from 1 to 0.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Commander cast count decreased from 4 to 0 (-4 clicks).',
    ]);
  });

  it('compacts legacy commander cast counter decreases', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'counter.changed', 'Set commander:user-1 counter casts to 17.'),
      gameLogEntry('event-2', 'counter.changed', 'Set commander:user-1 counter casts to 16.'),
      gameLogEntry('event-3', 'counter.changed', 'Set commander:user-1 counter casts to 15.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Commander cast count decreased from 17 to 15 (-2 clicks).',
    ]);
  });

  it('starts a separate commander cast counter group when direction changes', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'counter.changed', 'Commander cast count increased from 5 to 18 (+13 clicks).'),
      gameLogEntry('event-2', 'counter.changed', 'Set commander:user-1 counter casts to 17.'),
      gameLogEntry('event-3', 'counter.changed', 'Set commander:user-1 counter casts to 16.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Commander cast count increased from 5 to 18 (+13 clicks).',
      'Commander cast count decreased from 18 to 16 (-2 clicks).',
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
        backgroundName: 'back_5',
        sleevesName: 'facedown_card',
        life: 40,
        zones: {
          library: [{
            instanceId: 'library-card',
            ownerId: 'user-1',
            controllerId: 'user-1',
            name: 'Plains',
            typeLine: 'Basic Land â€” Plains',
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

function addOpponent(snapshot: GameSnapshot): void {
  snapshot.players['user-2'] = {
    user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
    status: 'active',
    concededAt: null,
    colorIdentity: ['U'],
    backgroundName: 'back_5',
    sleevesName: 'facedown_card',
    life: 39,
    zones: {
      library: [],
      hand: [],
      battlefield: [{
        instanceId: 'card-2',
        ownerId: 'user-2',
        controllerId: 'user-2',
        name: 'Arcane Signet',
        typeLine: 'Artifact',
        tapped: false,
        counters: {},
      }],
      graveyard: [],
      exile: [],
      command: [],
    },
    zoneCounts: {
      library: 0,
      hand: 0,
      battlefield: 1,
      graveyard: 0,
      exile: 0,
      command: 0,
    },
    commanderDamage: {},
    counters: {},
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
