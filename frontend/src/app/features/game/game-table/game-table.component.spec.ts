import { importProvidersFrom, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import {
  ArrowLeft,
  Ban,
  BarChart3,
  Bell,
  Biohazard,
  Building2,
  BookmarkPlus,
  Bug,
  Camera,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  CircleUserRound,
  Copy,
  Dices,
  DoorOpen,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Folder,
  FolderPlus,
  Globe,
  Ghost,
  History,
  KeyRound,
  Layers3,
  Library,
  Link2Off,
  Lock,
  LogIn,
  LogOut,
  LucideAngularModule,
  Maximize2,
  Menu,
  MessageSquare,
  Minus,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Radiation,
  Save,
  Search,
  SearchX,
  Send,
  Settings,
  ShieldCheck,
  Skull,
  Sparkles,
  Swords,
  TabletSmartphone,
  Tickets,
  Trash,
  Trash2,
  TriangleAlert,
  Upload,
  Unlink2,
  UserPlus,
  Users,
  Vote,
  X,
  Zap,
} from 'lucide-angular';
import { EMPTY, Subject, of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { GamesApi } from '../../../core/api/games.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommandResponse } from '../../../core/models/api-responses.model';
import { GameCardInstance, GameSnapshot } from '../../../core/models/game.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { GameTableComponent } from './game-table.component';
import { GameTableChatLogState } from './state/chat/game-table-chat-log.state';
import { RollModalComponent } from '../../../core/ui/roll-modal/roll-modal.component';
import { GameTableMotionService } from './services/game-table-motion.service';
import { GameTableNotificationSoundService } from './services/game-table-notification-sound.service';
import { GameTableWebsocketTransportService } from './services/game-table-websocket-transport.service';
import { GameTableCardActionsService } from './services/game-table-card-actions.service';

describe('GameTableComponent', () => {
  const gameplayWebsocketCommand = vi.fn();
  const gamesApi = {
    snapshot: vi.fn(),
    command: vi.fn(),
    rematchVote: vi.fn(),
    websocketTicket: vi.fn(),
    zone: vi.fn(),
  };
  const cardsApi = {
    search: vi.fn(),
  };
  const decksApi = {
    tokens: vi.fn(),
  };
  const roomsApi = {
    current: vi.fn(),
    leave: vi.fn(),
  };
  const authStore = {
    user: vi.fn(),
    logout: vi.fn(),
  };
  const mercureService = {
    gameEvents: vi.fn(),
  };
  const websocketMessages = new Subject<unknown>();
  const websocketStatus = signal('connected');
  const websocketTransport = {
    status: websocketStatus,
    messages$: websocketMessages.asObservable(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    send: vi.fn((message: unknown) => {
      const parsed = message as {
        kind?: string;
        gameId?: string;
        command?: {
          type: string;
          payload: Record<string, unknown>;
          clientActionId: string;
          baseVersion: number;
        };
      };
      if (parsed.kind !== 'command' || !parsed.command || !parsed.gameId) {
        return true;
      }

      const commandResult = gameplayWebsocketCommand(parsed.command, parsed.gameId) as unknown;
      let responseSnapshot: GameSnapshot | undefined;
      if (commandResult && typeof commandResult === 'object' && 'subscribe' in commandResult) {
        (commandResult as { subscribe(next: (value: { snapshot?: GameSnapshot }) => void): unknown })
          .subscribe((value) => {
            responseSnapshot = value.snapshot;
          });
      }
      websocketMessages.next({
        kind: 'game_patch',
        gameId: parsed.gameId,
        baseVersion: parsed.command.baseVersion,
        version: parsed.command.baseVersion + 1,
        clientActionId: parsed.command.clientActionId,
        operations: websocketPatchOperations(parsed.command, responseSnapshot),
      });

      return true;
    }),
  };
  const websocketPatchOperations = (
    command: {
      type: string;
      payload: Record<string, unknown>;
    },
    responseSnapshot: GameSnapshot | undefined,
  ): unknown[] => {
    switch (command.type) {
      case 'game.concede': {
        const playerId = Object.entries(responseSnapshot?.players ?? {})
          .find(([, player]) => player.status === 'conceded')?.[0] ?? 'user-1';
        const player = responseSnapshot?.players[playerId];
        const operations: unknown[] = [{
          op: 'player.status.set',
          playerId,
          status: player?.status ?? 'conceded',
          ...(player?.concededAt ? { concededAt: player.concededAt } : {}),
        }];
        if (responseSnapshot?.turn) {
          operations.push({
            op: 'turn.set',
            turn: responseSnapshot.turn,
          });
        }

        return operations;
      }

      case 'card.token.created': {
        const playerId = typeof command.payload['playerId'] === 'string' ? command.payload['playerId'] : 'user-1';
        const battlefield = responseSnapshot?.players[playerId]?.zones.battlefield ?? [];
        const requestedName = (command.payload['card'] as { name?: unknown } | undefined)?.name;
        const card = battlefield.find((candidate) => candidate.name === requestedName) ?? battlefield.at(-1);

        return card ? [{ op: 'card.create', playerId, zone: 'battlefield', card }] : [];
      }

      case 'dice.rolled':
        return responseSnapshot?.eventLog.length
          ? [{ op: 'eventLog.append', entries: responseSnapshot.eventLog }]
          : [];

      case 'turn.changed':
        return responseSnapshot?.turn
          ? [{ op: 'turn.set', turn: responseSnapshot.turn }]
          : [];

      case 'zone.random_card.selected': {
        const playerId = typeof command.payload['playerId'] === 'string' ? command.payload['playerId'] : null;
        const zone = typeof command.payload['zone'] === 'string' ? command.payload['zone'] : null;
        const cards = playerId && zone
          ? responseSnapshot?.players[playerId]?.zones[zone as keyof GameSnapshot['players'][string]['zones']]
          : null;

        return playerId && zone && cards ? [{ op: 'zone.visible.set', playerId, zone, cards }] : [];
      }

      default:
        return [];
    }
  };
  const routeParams: Record<string, string> = {};

  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });

    routeParams['id'] = '';
    gamesApi.snapshot.mockReset();
    gameplayWebsocketCommand.mockReset();
    websocketStatus.set('connected');
    websocketTransport.connect.mockClear();
    websocketTransport.disconnect.mockClear();
    websocketTransport.send.mockClear();
    gamesApi.rematchVote.mockReset();
    gamesApi.websocketTicket.mockReset().mockReturnValue(of({
      ticket: 'ticket-1',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8081/games/game-1?ticket=ticket-1',
    }));
    gamesApi.zone.mockReset();
    gamesApi.rematchVote.mockReturnValue(of({ status: 'left', left: true, roomDeleted: false }));
    cardsApi.search.mockReset().mockReturnValue(of({ data: [], page: 1, limit: 36 }));
    decksApi.tokens.mockReset().mockReturnValue(of({ deckId: 'deck-1', data: [], unresolved: [] }));
    roomsApi.current.mockReset().mockReturnValue(of({
      room: { id: 'room-1', name: 'Room', status: 'started', visibility: 'public', format: 'commander', maxPlayers: 4, playerCount: 2, gameId: 'game-1' },
      player: { playerId: 'user-1', deckId: 'deck-1', deckName: 'Deck', deckImageUrl: null },
      turn: null,
      viewerRole: 'player',
    }));
    roomsApi.leave.mockReset().mockReturnValue(of({ left: true, roomDeleted: false }));
    authStore.user.mockReset().mockReturnValue(null);
    authStore.logout.mockReset().mockResolvedValue(undefined);
    mercureService.gameEvents.mockReset().mockReturnValue(EMPTY);
    vi.stubGlobal('WebSocket', vi.fn());
    window.localStorage.clear();

    TestBed.overrideComponent(GameTableComponent, {
      remove: {
        providers: [GameTableWebsocketTransportService],
      },
      add: {
        providers: [
          { provide: GameTableWebsocketTransportService, useValue: websocketTransport },
        ],
      },
    });

    await TestBed.configureTestingModule({
      imports: [GameTableComponent],
      providers: [
        { provide: CardsApi, useValue: cardsApi },
        { provide: DecksApi, useValue: decksApi },
        { provide: GamesApi, useValue: gamesApi },
        { provide: RoomsApi, useValue: roomsApi },
        { provide: AuthStore, useValue: authStore },
        { provide: MercureService, useValue: mercureService },
        importProvidersFrom(LucideAngularModule.pick({
          ArrowLeft,
          Ban,
          BarChart3,
          Bell,
          Biohazard,
          Building2,
          BookmarkPlus,
          Bug,
          Camera,
          ChevronDown,
          ChevronRight,
          Check,
          CheckCircle2,
          CircleUserRound,
          Copy,
          Dices,
          DoorOpen,
          Eye,
          EyeOff,
          FileDown,
          FileUp,
          Folder,
          FolderPlus,
          Globe,
          Ghost,
          History,
          KeyRound,
          Layers3,
          Library,
          Link2Off,
          Lock,
          LogIn,
          LogOut,
          Maximize2,
          Menu,
          MessageSquare,
          Minus,
          MoreVertical,
          Pencil,
          Play,
          Plus,
          RefreshCcw,
          RotateCcw,
          RotateCw,
          Radiation,
          Save,
          Search,
          SearchX,
          Send,
          Settings,
          ShieldCheck,
          Skull,
          Sparkles,
          Swords,
          TabletSmartphone,
          Tickets,
          Trash,
          Trash2,
          TriangleAlert,
          Upload,
          Unlink2,
          UserPlus,
          Users,
          Vote,
          X,
          Zap,
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

  it('renders battlefield zoom controls and applies zoom CSS variables locally', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.store.loading.set(false);
    fixture.componentInstance.store.snapshot.set(snapshotWithStatus('active'));
    fixture.detectChanges();

    const playerPanel = fixture.nativeElement.querySelector('[data-testid="player-panel"]') as HTMLElement;
    const zoomControls = fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-controls"]') as HTMLElement;
    const zoomToggle = fixture.nativeElement.querySelector('.zoom-toggle-button') as HTMLButtonElement;
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      expect(zoomToggle.getAttribute('aria-expanded')).toBe('false');
      zoomToggle.click();
      fixture.detectChanges();

      const zoomSlider = fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-slider"]') as HTMLInputElement;

      expect(fixture.nativeElement.querySelector('.zoom-toggle-button')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-popover"]')).not.toBeNull();
      expect(zoomControls.textContent).not.toContain('100%');
      expect(zoomSlider.min).toBe('70');
      expect(zoomSlider.max).toBe('140');
      expect(zoomSlider.step).toBe('1');
      expect(playerPanel.style.getPropertyValue('--battlefield-card-width')).toBe('7.2rem');

      zoomSlider.value = '111';
      zoomSlider.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(zoomControls.textContent).not.toContain('111%');
      expect(playerPanel.style.getPropertyValue('--battlefield-card-width')).toBe('7.992rem');
      expect(window.localStorage.getItem('commanderZone.gameTable.battlefieldZoomPercent')).toBe('111');
      expect(requestAnimationFrame).toHaveBeenCalled();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
      fixture.destroy();
    }
  });

  it('reflows the focused opponent battlefield with the local zoom applied', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    window.localStorage.setItem('commanderZone.gameTable.battlefieldZoomPercent', '120');
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-2']!.zones.battlefield[0]!.position = { x: 1, y: 1, unit: 'ratio' };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const reflow = vi.spyOn(fixture.componentInstance.store, 'reflowBattlefieldCardPositions');

    try {
      fixture.componentInstance.focusOpponentFromSidebar('user-2');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const playerPanel = fixture.nativeElement.querySelector('[data-testid="player-panel"]') as HTMLElement;
      expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
      expect(playerPanel.dataset['playerId']).toBe('user-2');
      expect(playerPanel.style.getPropertyValue('--battlefield-card-width')).toBe('8.64rem');
      expect(reflow).toHaveBeenCalled();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
      fixture.destroy();
    }
  });

  it('keeps the header summary on the current player and shows a readonly focused battlefield owner summary', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.focusOpponentFromSidebar('user-2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const headerLife = fixture.nativeElement.querySelector('.player-strip [data-testid="focused-player-life"]') as HTMLElement;
    const ownerSummary = fixture.nativeElement.querySelector('[data-testid="battlefield-owner-summary"]') as HTMLElement;
    const ownerLife = ownerSummary.querySelector('[data-testid="focused-player-life"]') as HTMLElement;

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(headerLife.dataset['playerId']).toBe('user-1');
    expect(ownerSummary.textContent).toContain('Estas viendo a:');
    expect(ownerSummary.textContent).toContain('Opponent');
    expect(ownerLife.dataset['playerId']).toBe('user-2');
    expect(ownerSummary.querySelector('[data-testid="life-decrease"]')).toBeNull();
    expect(ownerSummary.querySelector('[data-testid="life-increase"]')).toBeNull();

    (ownerSummary.querySelector('[data-testid="return-own-battlefield"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-1');
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-owner-summary"]')).toBeNull();
  });

  it('keeps battlefield double click tap logic and animates the rotation after the state update', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const toggleTapped = vi.spyOn(fixture.componentInstance.store, 'toggleTapped').mockResolvedValue(undefined);
    const animateRotation = vi.fn();
    const prepareCardRotationFlip = vi.spyOn(motion, 'prepareCardRotationFlip').mockReturnValue(animateRotation);
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const card = { instanceId: 'card-1', name: 'Sol Ring', tapped: false } as GameCardInstance;
    const mouseEvent = new MouseEvent('dblclick');

    try {
      await fixture.componentInstance.handleBattlefieldCardDoubleClicked({
        event: mouseEvent,
        playerId: 'user-1',
        card,
      });

      expect(prepareCardRotationFlip).toHaveBeenCalledWith('card-1', expect.objectContaining({
        onComplete: expect.any(Function),
      }));
      expect(toggleTapped).toHaveBeenCalledWith('user-1', 'battlefield', card, { addAutomaticMana: false });
      expect(animateRotation).toHaveBeenCalledOnce();
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('adds mana automatically when a visible tap-only land is tapped', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const forest = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Forest',
      typeLine: 'Basic Land - Forest',
      oracleText: '',
      tapped: false,
    };
    snapshot.players['user-1']!.zones.battlefield = [forest];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    const toggleTapped = vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);

    await fixture.componentInstance.store.toggleTapped('user-1', 'battlefield', forest);

    expect(toggleTapped).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.store.manaPool('user-1').G).toBe(1);
  });

  it('adds mana automatically when a visible tap-only mana artifact is tapped', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const solRing = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Sol Ring',
      typeLine: 'Artifact',
      oracleText: '{T}: Add {C}{C}.',
      tapped: false,
    };
    snapshot.players['user-1']!.zones.battlefield = [solRing];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);

    await fixture.componentInstance.store.toggleTapped('user-1', 'battlefield', solRing);

    expect(fixture.componentInstance.store.manaPool('user-1').C).toBe(2);
  });

  it('opens the mana dialog when a visible tap-only mana artifact needs a color choice', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const arcaneSignet = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      tapped: false,
    };
    snapshot.players['user-1']!.colorIdentity = ['U', 'R'];
    snapshot.players['user-1']!.zones.battlefield = [arcaneSignet];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      await fixture.componentInstance.handleBattlefieldCardDoubleClicked({
        event: new MouseEvent('dblclick'),
        playerId: 'user-1',
        card: arcaneSignet,
      });

      expect(fixture.componentInstance.manaActionDialog()?.suggestion.kind).toBe('choice');
      expect(fixture.componentInstance.manaActionDialog()?.suggestion.colors).toEqual(['U', 'R']);
      expect(fixture.componentInstance.store.manaPool('user-1').U).toBe(0);
      expect(fixture.componentInstance.store.manaPool('user-1').R).toBe(0);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('adds mana automatically when a tap-only choice source has a single available color', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const arcaneSignet = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      tapped: false,
    };
    snapshot.players['user-1']!.colorIdentity = ['G'];
    snapshot.players['user-1']!.zones.battlefield = [arcaneSignet];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);

    await fixture.componentInstance.store.toggleTapped('user-1', 'battlefield', arcaneSignet);

    expect(fixture.componentInstance.store.manaPool('user-1').G).toBe(1);
    expect(fixture.componentInstance.manaActionDialog()).toBeNull();
  });

  it('opens the mana dialog directly for ambiguous tapped mana cards while the mana pool is visible', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const llanowarElves = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Llanowar Elves',
      typeLine: 'Creature - Elf Druid',
      oracleText: '{T}: Add {G}.',
      tapped: false,
    };
    snapshot.players['user-1']!.zones.battlefield = [llanowarElves];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      await fixture.componentInstance.handleBattlefieldCardDoubleClicked({
        event: new MouseEvent('dblclick', { clientX: 160, clientY: 220 }),
        playerId: 'user-1',
        card: llanowarElves,
      });
      fixture.detectChanges();

      expect(fixture.componentInstance.store.manaPool('user-1').G).toBe(0);
      expect(fixture.componentInstance.manaActionDialog()?.suggestion.cardName).toBe('Llanowar Elves');
      expect(fixture.nativeElement.querySelector('app-tap-mana-intent-menu')).toBeNull();
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('waits for the mana comet before adding confirmed card mana to the pool', () => {
    vi.useFakeTimers();
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const card = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Llanowar Elves',
      typeLine: 'Creature - Elf Druid',
      oracleText: '{T}: Add {G}.',
    };
    const manaTarget = document.createElement('button');
    manaTarget.dataset['manaPoolColor'] = 'G';
    document.body.appendChild(manaTarget);
    vi.spyOn(manaTarget, 'getBoundingClientRect').mockReturnValue(rect(300, 90, 40, 40));
    snapshot.players['user-1']!.zones.battlefield = [card];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    const addMana = vi.spyOn(fixture.componentInstance.store, 'addMana');
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      const request: NonNullable<ReturnType<typeof fixture.componentInstance.manaActionDialog>> = {
        menu: {
          x: 120,
          y: 160,
          kind: 'card',
          playerId: 'user-1',
          zone: 'battlefield',
          card,
        },
        suggestion: {
          kind: 'fixed',
          cardName: 'Llanowar Elves',
          summary: 'Add {G}.',
          additions: [{ color: 'G', amount: 1 }],
          colors: ['G'],
          amount: 1,
          restriction: null,
          manualOnly: false,
        },
        selectedColor: 'G',
        amount: 1,
        position: { x: 120, y: 160 },
      };
      fixture.componentInstance.manaActionDialog.set(request);

      fixture.componentInstance.confirmManaActionDialog();

      expect(addMana).not.toHaveBeenCalled();

      vi.advanceTimersByTime(879);
      expect(addMana).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(addMana).toHaveBeenCalledWith('user-1', [{ color: 'G', amount: 1 }]);
    } finally {
      requestAnimationFrame.mockRestore();
      manaTarget.remove();
      vi.useRealTimers();
    }
  });

  it('materializes an off-identity mana target before animating the comet into it', () => {
    vi.useFakeTimers();
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const card = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Exotic Orchard',
      typeLine: 'Land',
      oracleText: '{T}: Add one mana of any color that a land an opponent controls could produce.',
    };
    snapshot.players['user-1']!.colorIdentity = ['G'];
    snapshot.players['user-1']!.zones.battlefield = [card];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    fixture.detectChanges();

    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset['manaPoolColor'] === 'U'
        ? rect(320, 80, 42, 42)
        : rect(80, 120, 92, 128);
    });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      expect(fixture.nativeElement.querySelector('[data-mana-pool-color="U"]')).toBeNull();

      fixture.componentInstance.manaActionDialog.set({
        menu: {
          x: 120,
          y: 160,
          kind: 'card',
          playerId: 'user-1',
          zone: 'battlefield',
          card,
        },
        suggestion: {
          kind: 'choice',
          cardName: 'Exotic Orchard',
          summary: 'Choose one mana from:',
          additions: [],
          colors: ['U', 'G'],
          amount: 1,
          restriction: null,
          manualOnly: false,
        },
        selectedColor: 'U',
        amount: 1,
        position: { x: 120, y: 160 },
      });

      fixture.componentInstance.confirmManaActionDialog();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-mana-pool-color="U"]')).not.toBeNull();
      expect(fixture.componentInstance.store.manaPool('user-1').U).toBe(0);
      expect(fixture.componentInstance.manaComets.effects().some((effect) => effect.color === 'U')).toBe(true);

      vi.advanceTimersByTime(880);
      fixture.detectChanges();

      expect(fixture.componentInstance.store.manaPool('user-1').U).toBe(1);
      expect(fixture.nativeElement.querySelector('[data-mana-pool-color="U"]')).not.toBeNull();
    } finally {
      requestAnimationFrame.mockRestore();
      getBoundingClientRect.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not open a tap mana intent menu when the mana pool is hidden', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const llanowarElves = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Llanowar Elves',
      typeLine: 'Creature - Elf Druid',
      oracleText: '{T}: Add {G}.',
      tapped: false,
    };
    snapshot.players['user-1']!.zones.battlefield = [llanowarElves];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    fixture.componentInstance.store.hideManaPool('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      await fixture.componentInstance.handleBattlefieldCardDoubleClicked({
        event: new MouseEvent('dblclick', { clientX: 160, clientY: 220 }),
        playerId: 'user-1',
        card: llanowarElves,
      });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-tap-mana-intent-menu')).toBeNull();
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('resets local mana values when the mana pool is hidden', () => {
    const fixture = TestBed.createComponent(GameTableComponent);

    fixture.componentInstance.store.incrementMana('user-1', 'G');
    fixture.componentInstance.store.incrementMana('user-1', 'U');
    fixture.componentInstance.store.hideManaPool('user-1');
    fixture.componentInstance.store.showManaPool('user-1');

    expect(fixture.componentInstance.store.manaPool('user-1').G).toBe(0);
    expect(fixture.componentInstance.store.manaPool('user-1').U).toBe(0);
  });

  it('does not add automatic tap-only land mana when the mana pool is hidden', async () => {
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    const forest = {
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      name: 'Forest',
      typeLine: 'Basic Land - Forest',
      oracleText: '',
      tapped: false,
    };
    snapshot.players['user-1']!.zones.battlefield = [forest];
    fixture.componentInstance.store.snapshot.set(snapshot);
    fixture.componentInstance.store.focusPlayer('user-1');
    fixture.componentInstance.store.hideManaPool('user-1');
    vi.spyOn(fixture.componentInstance.store, 'canControlPlayer').mockReturnValue(true);
    vi.spyOn(fixture.debugElement.injector.get(GameTableCardActionsService), 'toggleTapped').mockResolvedValue(undefined);

    await fixture.componentInstance.store.toggleTapped('user-1', 'battlefield', forest);

    expect(fixture.componentInstance.store.manaPool('user-1').G).toBe(0);
  });

  it('blocks battlefield card drag until the tap animation completes', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    vi.spyOn(fixture.componentInstance.store, 'canDragBattlefieldCard').mockReturnValue(true);
    vi.spyOn(fixture.componentInstance.store, 'toggleTapped').mockResolvedValue(undefined);
    let completeRotation: (() => void) | undefined;
    vi.spyOn(motion, 'prepareCardRotationFlip').mockImplementation((_instanceId, options) => {
      completeRotation = options?.onComplete;

      return vi.fn();
    });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const card = { instanceId: 'card-1', name: 'Sol Ring', tapped: false } as GameCardInstance;

    try {
      await fixture.componentInstance.handleBattlefieldCardDoubleClicked({
        event: new MouseEvent('dblclick'),
        playerId: 'user-1',
        card,
      });

      expect(fixture.componentInstance.canDragBattlefieldCard('user-1', card)).toBe(false);

      completeRotation?.();

      expect(fixture.componentInstance.canDragBattlefieldCard('user-1', card)).toBe(true);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('plays remote ghosts when the focused opponent moves a pile card to hand', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    const pileCard = {
      ...snapshot.players['user-2']!.zones.battlefield[0]!,
      instanceId: 'opponent-graveyard-card',
      name: 'Mystic Remora',
      zone: 'graveyard' as const,
    };
    snapshot.players['user-2']!.zones.graveyard = [pileCard];
    snapshot.players['user-2']!.zoneCounts = {
      ...snapshot.players['user-2']!.zoneCounts!,
      graveyard: 1,
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.componentInstance.store.focusPlayer('user-2');
    fixture.detectChanges();

    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const handTarget = appendDropZone(fixture.nativeElement, 'user-2', 'hand');

    websocketMessages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [{
        op: 'card.move',
        instanceId: 'opponent-graveyard-card',
        from: { playerId: 'user-2', zone: 'graveyard' },
        to: { playerId: 'user-2', zone: 'hand' },
      }],
      event: { id: 'event-move', type: 'card.moved', payload: {}, createdBy: 'user-2', createdAt: '' },
    });

    await vi.waitFor(() => expect(throwGhost).toHaveBeenCalledWith('opponent-graveyard-card', handTarget, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
    })));
  });

  it('plays remote ghosts when a visible opponent battlefield card moves over websocket', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const playerTarget = appendPlayerDropTarget(fixture.nativeElement, 'user-1');

    websocketMessages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [{
        op: 'card.move',
        instanceId: 'card-2',
        from: { playerId: 'user-2', zone: 'battlefield' },
        to: { playerId: 'user-1', zone: 'battlefield' },
      }],
      event: { id: 'event-opponent-move', type: 'card.moved', payload: {}, createdBy: 'user-2', createdAt: '' },
    });

    await vi.waitFor(() => expect(throwGhost).toHaveBeenCalledWith('card-2', playerTarget, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
    })));
  });

  it('delegates hand pointer moves without drag-drop motion effects', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const impactZone = vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const moveHandCardByPointer = vi.spyOn(fixture.componentInstance.store, 'moveHandCardByPointer').mockResolvedValue(undefined);

    await fixture.componentInstance.handleHandCardPointerMoved({
      playerId: 'user-1',
      targetPlayerId: 'user-2',
      movedInstanceId: 'hand-1',
      toZone: 'battlefield',
      position: { x: 12, y: 34 },
    });

    expect(throwGhost).not.toHaveBeenCalled();
    expect(impactZone).not.toHaveBeenCalled();
    expect(moveHandCardByPointer).toHaveBeenCalledWith('user-1', 'user-2', 'hand-1', 'battlefield', { x: 12, y: 34 }, undefined);
  });

  it('does not animate hand pointer moves that stay in hand', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const impactZone = vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const moveHandCardByPointer = vi.spyOn(fixture.componentInstance.store, 'moveHandCardByPointer').mockResolvedValue(undefined);

    await fixture.componentInstance.handleHandCardPointerMoved({
      playerId: 'user-1',
      targetPlayerId: 'user-1',
      movedInstanceId: 'hand-1',
      toZone: 'hand',
    });

    expect(throwGhost).not.toHaveBeenCalled();
    expect(impactZone).not.toHaveBeenCalled();
    expect(moveHandCardByPointer).toHaveBeenCalledWith('user-1', 'user-1', 'hand-1', 'hand', undefined, undefined);
  });

  it('captures hand FLIP for cards dropped into hand from another zone', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const calls: string[] = [];
    const playFlip = vi.fn(() => calls.push('playFlip'));
    const prepareHandDropHandoff = vi.spyOn(motion, 'prepareHandDropHandoff').mockImplementation((selector?: string) => {
      calls.push(`prepare:${selector ?? ''}`);
      return playFlip;
    });
    const dropOnHand = vi.spyOn(fixture.componentInstance.store, 'dropOnHand').mockResolvedValue(undefined);
    const previewDropOnHand = vi.spyOn(fixture.componentInstance.store, 'previewDropOnHand').mockImplementation(() => undefined);
    const dataTransfer = dragDataTransfer();
    const target = document.createElement('div');
    dataTransfer.setData('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'graveyard',
      instanceId: 'graveyard-1',
    }));
    const event = dragEvent('drop', dataTransfer, target);

    await fixture.componentInstance.handleHandDropped({ event, playerId: 'user-1' });

    expect(previewDropOnHand).not.toHaveBeenCalled();
    expect(dropOnHand).toHaveBeenCalledWith(event, 'user-1');
    expect(prepareHandDropHandoff).toHaveBeenCalledWith('[data-zone="hand"][data-card-instance-id]');
    expect(playFlip).toHaveBeenCalledOnce();
    expect(calls).toEqual(['prepare:[data-zone="hand"][data-card-instance-id]', 'playFlip']);
  });

  it('does not run hand FLIP for a battlefield token dropped into hand because it evaporates', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.battlefield = [{
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      instanceId: 'token-1',
      name: 'Goblin Token',
      isToken: true,
    }];
    fixture.componentInstance.store.snapshot.set(snapshot);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const prepareHandDropHandoff = vi.spyOn(motion, 'prepareHandDropHandoff');
    const dropOnHand = vi.spyOn(fixture.componentInstance.store, 'dropOnHand').mockResolvedValue(undefined);
    const dataTransfer = dragDataTransfer();
    const target = document.createElement('div');
    dataTransfer.setData('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'battlefield',
      instanceId: 'token-1',
    }));
    const event = dragEvent('drop', dataTransfer, target);

    await fixture.componentInstance.handleHandDropped({ event, playerId: 'user-1' });

    expect(dropOnHand).toHaveBeenCalledWith(event, 'user-1');
    expect(prepareHandDropHandoff).not.toHaveBeenCalled();
  });

  it('drops same-player native hand events directly', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const dropOnHand = vi.spyOn(fixture.componentInstance.store, 'dropOnHand').mockResolvedValue(undefined);
    const dataTransfer = dragDataTransfer();
    const target = document.createElement('div');
    dataTransfer.setData('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'hand',
      instanceId: 'hand-1',
    }));
    const event = dragEvent('drop', dataTransfer, target);

    await fixture.componentInstance.handleHandDropped({ event, playerId: 'user-1' });

    expect(dropOnHand).toHaveBeenCalledWith(event, 'user-1');
  });

  it('does not run hand FLIP on pointerup without battlefield pointer drag', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const prepareCardFlip = vi.spyOn(motion, 'prepareCardFlip');
    const endCardPointerDrag = vi.spyOn(fixture.componentInstance.store, 'endCardPointerDrag').mockResolvedValue(undefined);
    vi.spyOn(fixture.componentInstance.store, 'hasActivePointerDrag').mockReturnValue(false);
    const event = new Event('pointerup') as PointerEvent;

    fixture.componentInstance.handlePointerUp(event);

    expect(endCardPointerDrag).not.toHaveBeenCalled();
    expect(prepareCardFlip).not.toHaveBeenCalled();
  });

  it('blocks native dragstart events for non-draggable game screen elements', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');
    const background = document.createElement('div');

    Object.defineProperty(event, 'target', {
      configurable: true,
      value: background,
    });

    fixture.componentInstance.handleNativeDragStart(event as DragEvent);

    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('keeps native dragstart enabled for explicit draggable elements', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    const draggable = document.createElement('button');
    draggable.setAttribute('draggable', 'true');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    Object.defineProperty(event, 'target', {
      configurable: true,
      value: draggable,
    });

    fixture.componentInstance.handleNativeDragStart(event as DragEvent);

    expect(event.defaultPrevented).toBe(false);
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it('does not animate a pointer drag into hand when the pointer is not over the hand drop zone', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwElementGhost = vi.spyOn(motion, 'throwElementGhost').mockImplementation(() => undefined);
    const impactZone = vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const endCardPointerDrag = vi.spyOn(fixture.componentInstance.store, 'endCardPointerDrag').mockResolvedValue(undefined);
    vi.spyOn(fixture.componentInstance.store, 'hasActivePointerDrag').mockReturnValue(true);
    vi.spyOn(fixture.componentInstance.store, 'pointerDragPreview').mockReturnValue({
      card: { instanceId: 'battlefield-1', name: 'Forest', tapped: false },
      x: 120,
      y: 520,
      width: 103,
      height: 144,
      count: 1,
    });
    vi.spyOn(fixture.componentInstance.store, 'draggingCardInstanceId').mockReturnValue('battlefield-1');
    vi.spyOn(fixture.componentInstance.store, 'activeDropTarget').mockReturnValue({ playerId: 'user-1', zone: 'hand' });
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });
    const event = new PointerEvent('pointerup', { clientX: 120, clientY: 520 });

    fixture.componentInstance.handlePointerUp(event);

    expect(endCardPointerDrag).toHaveBeenCalledWith(event);
    expect(throwElementGhost).not.toHaveBeenCalled();
    expect(impactZone).not.toHaveBeenCalled();

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('does not animate a pointer drag into hand when hand geometry overlaps but active drop target is not hand', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwElementGhost = vi.spyOn(motion, 'throwElementGhost').mockImplementation(() => undefined);
    const impactZone = vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const endCardPointerDrag = vi.spyOn(fixture.componentInstance.store, 'endCardPointerDrag').mockResolvedValue(undefined);
    vi.spyOn(fixture.componentInstance.store, 'hasActivePointerDrag').mockReturnValue(true);
    vi.spyOn(fixture.componentInstance.store, 'pointerDragPreview').mockReturnValue({
      card: { instanceId: 'battlefield-1', name: 'Forest', tapped: false },
      x: 120,
      y: 520,
      width: 103,
      height: 144,
      count: 1,
    });
    vi.spyOn(fixture.componentInstance.store, 'draggingCardInstanceId').mockReturnValue('battlefield-1');
    vi.spyOn(fixture.componentInstance.store, 'activeDropTarget').mockReturnValue({ playerId: 'user-1', zone: 'battlefield' });
    const overlappingHandTarget = document.createElement('div');
    overlappingHandTarget.dataset['gameDropZone'] = 'hand';
    overlappingHandTarget.dataset['zone'] = 'hand';
    overlappingHandTarget.dataset['playerId'] = 'user-1';
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [overlappingHandTarget]),
    });
    const event = new PointerEvent('pointerup', { clientX: 120, clientY: 520 });

    fixture.componentInstance.handlePointerUp(event);

    expect(endCardPointerDrag).toHaveBeenCalledWith(event);
    expect(throwElementGhost).not.toHaveBeenCalled();
    expect(impactZone).not.toHaveBeenCalled();

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('animates a battlefield pointer drag into a zone pile target', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwElementGhost = vi.spyOn(motion, 'throwElementGhost').mockImplementation(() => undefined);
    const impactZone = vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    const endCardPointerDrag = vi.spyOn(fixture.componentInstance.store, 'endCardPointerDrag').mockResolvedValue(undefined);
    vi.spyOn(fixture.componentInstance.store, 'hasActivePointerDrag').mockReturnValue(true);
    vi.spyOn(fixture.componentInstance.store, 'pointerDragPreview').mockReturnValue({
      card: { instanceId: 'battlefield-1', name: 'Forest', tapped: false },
      x: 120,
      y: 120,
      width: 103,
      height: 144,
      count: 1,
    });
    vi.spyOn(fixture.componentInstance.store, 'draggingCardInstanceId').mockReturnValue('battlefield-1');
    vi.spyOn(fixture.componentInstance.store, 'activeDropTarget').mockReturnValue({ playerId: 'user-1', zone: 'graveyard' });
    const gameScreen = fixture.nativeElement.querySelector('[data-testid="game-screen"]') as HTMLElement;
    const preview = document.createElement('div');
    preview.className = 'drag-card-preview';
    const target = document.createElement('button');
    target.dataset['gameDropZone'] = 'graveyard';
    target.dataset['playerId'] = 'user-1';
    target.dataset['zone'] = 'graveyard';
    target.getBoundingClientRect = () => ({
      x: 320,
      y: 40,
      width: 92,
      height: 128,
      top: 40,
      left: 320,
      bottom: 168,
      right: 412,
      toJSON: () => ({}),
    }) as DOMRect;
    gameScreen.append(preview, target);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [target]),
    });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const event = new PointerEvent('pointerup', { clientX: 120, clientY: 120 });

    try {
      fixture.componentInstance.handlePointerUp(event);

      expect(throwElementGhost).toHaveBeenCalledWith(preview, target, expect.objectContaining({
        scaleToTarget: true,
        rotate: -6,
      }));
      expect(impactZone).toHaveBeenCalledWith(target);
      expect(endCardPointerDrag).toHaveBeenCalledWith(event);
    } finally {
      requestAnimationFrame.mockRestore();
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('keeps zone-to-battlefield drop ghost at card scale', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    vi.spyOn(motion, 'impactZone').mockImplementation(() => undefined);
    vi.spyOn(fixture.componentInstance.store, 'dropOnZone').mockResolvedValue(undefined);
    const target = document.createElement('div');
    target.dataset['gameDropZone'] = 'battlefield';
    target.dataset['playerId'] = 'user-1';
    target.dataset['zone'] = 'battlefield';
    target.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 700,
      height: 500,
      top: 0,
      left: 0,
      bottom: 500,
      right: 700,
      toJSON: () => ({}),
    }) as DOMRect;
    fixture.nativeElement.querySelector('[data-testid="game-screen"]')?.appendChild(target);
    const dataTransfer = dragDataTransfer();
    dataTransfer.setData('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'graveyard',
      instanceId: 'graveyard-top',
    }));

    fixture.componentInstance.handleZoneDrop({
      event: dragEvent('drop', dataTransfer, target),
      playerId: 'user-1',
      zone: 'battlefield',
    });

    expect(throwGhost).toHaveBeenCalledOnce();
    const [sourceId, ghostTarget, options] = throwGhost.mock.calls[0] ?? [];
    expect(sourceId).toBe('graveyard-top');
    expect(ghostTarget).toBeInstanceOf(HTMLElement);
    expect((ghostTarget as HTMLElement).style.left).toBe('40px');
    expect((ghostTarget as HTMLElement).style.top).toBe('40px');
    expect(options).toEqual(expect.objectContaining({ scaleToTarget: false, rotate: -6 }));
  });

  it('animates a fixed zone modal card to its move destination before removing it', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const moveCard = vi.spyOn(fixture.componentInstance.store, 'moveCard').mockResolvedValue(undefined);
    const target = appendDropZone(fixture.nativeElement, 'user-1', 'graveyard');
    const card = {
      instanceId: 'library-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Plains',
      typeLine: 'Basic Land - Plains',
      tapped: false,
      counters: {},
    };
    const sourceRect = { left: 24, top: 48, right: 116, bottom: 176, width: 92, height: 128 };

    fixture.componentInstance.handleContextMenuAction({ type: 'moveCard', zone: 'graveyard' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'library',
      kind: 'card',
      card,
      fromFixedZoneModal: true,
      sourceRect,
    });

    expect(throwGhost).toHaveBeenCalledWith('library-card', target, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
      sourceRect,
    }));
    await vi.waitFor(() => expect(moveCard).toHaveBeenCalledWith(expect.objectContaining({
      card,
      fromFixedZoneModal: true,
    }), 'graveyard', { position: undefined }));
  });

  it('animates a fixed zone modal card to another player hand when giving it', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const giveCardToPlayer = vi.spyOn(fixture.componentInstance.store, 'giveCardToPlayer').mockResolvedValue(undefined);
    const target = appendPlayerDropTarget(fixture.nativeElement, 'user-2');
    const card = {
      instanceId: 'graveyard-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      tapped: false,
      counters: {},
    };
    const sourceRect = { left: 32, top: 64, right: 124, bottom: 192, width: 92, height: 128 };

    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2', zone: 'hand' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'graveyard',
      kind: 'card',
      card,
      fromFixedZoneModal: true,
      sourceRect,
    });

    expect(throwGhost).toHaveBeenCalledWith('graveyard-card', target, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
      sourceRect,
    }));
    await vi.waitFor(() => expect(giveCardToPlayer).toHaveBeenCalledWith(expect.objectContaining({
      card,
      fromFixedZoneModal: true,
    }), 'user-2', 'hand'));
  });

  it('waits for confirmation before animating a fixed zone modal card given to a battlefield', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const giveCardToPlayer = vi.spyOn(fixture.componentInstance.store, 'giveCardToPlayer').mockImplementation(async () => {
      fixture.componentInstance.store.pendingBattlefieldMove.set({
        cardName: 'Lightning Bolt',
        targetPlayerName: 'Opponent',
        commandType: 'card.moved',
        payload: {
          playerId: 'user-1',
          fromZone: 'graveyard',
          toZone: 'battlefield',
          instanceId: 'graveyard-card',
          targetPlayerId: 'user-2',
        },
      });
    });
    const confirmPendingBattlefieldMove = vi.spyOn(fixture.componentInstance.store, 'confirmPendingBattlefieldMove').mockResolvedValue(undefined);
    const target = appendPlayerDropTarget(fixture.nativeElement, 'user-2');
    const card = {
      instanceId: 'graveyard-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      tapped: false,
      counters: {},
    };
    const sourceRect = { left: 32, top: 64, right: 124, bottom: 192, width: 92, height: 128 };

    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2', zone: 'battlefield' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'graveyard',
      kind: 'card',
      card,
      fromFixedZoneModal: true,
      sourceRect,
    });

    await vi.waitFor(() => expect(giveCardToPlayer).toHaveBeenCalled());
    expect(throwGhost).not.toHaveBeenCalled();

    fixture.componentInstance.confirmPendingBattlefieldMove();

    expect(throwGhost).toHaveBeenCalledWith('graveyard-card', target, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
      sourceRect,
    }));
    expect(confirmPendingBattlefieldMove).toHaveBeenCalledOnce();
  });

  it('skips ghost animation but still forwards battlefield drops without valid payload to clear drag state', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const dropOnZone = vi.spyOn(fixture.componentInstance.store, 'dropOnZone').mockResolvedValue(undefined);
    const target = document.createElement('div');
    target.dataset['gameDropZone'] = 'battlefield';
    target.dataset['playerId'] = 'user-1';
    target.dataset['zone'] = 'battlefield';
    fixture.nativeElement.querySelector('[data-testid="game-screen"]')?.appendChild(target);
    const dataTransfer = dragDataTransfer();

    fixture.componentInstance.handleZoneDrop({
      event: dragEvent('drop', dataTransfer, target),
      playerId: 'user-1',
      zone: 'battlefield',
    });

    expect(throwGhost).not.toHaveBeenCalled();
    expect(dropOnZone).toHaveBeenCalledWith(expect.anything(), 'user-1', 'battlefield');
  });

  it('captures hand reorder FLIP before updating the store and plays it after', async () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const calls: string[] = [];
    const playFlip = vi.fn(() => calls.push('playFlip'));
    const prepareHandDropHandoff = vi.spyOn(motion, 'prepareHandDropHandoff').mockImplementation((selector?: string, options?: { readonly freezeHand?: boolean }) => {
      calls.push(`prepare:${selector ?? ''}`);
      if (options) {
        calls.push(`freeze:${String(options.freezeHand)}`);
      }
      return playFlip;
    });
    const reorderHandCard = vi.spyOn(fixture.componentInstance.store, 'reorderHandCard').mockImplementation(async () => {
      calls.push('reorder');
    });

    await fixture.componentInstance.handleHandCardPointerReordered({
      playerId: 'user-1',
      movedInstanceId: 'hand-2',
      targetInstanceId: 'hand-1',
      placement: 'before',
    });

    expect(prepareHandDropHandoff).toHaveBeenCalledWith('[data-zone="hand"][data-card-instance-id]', { freezeHand: false });
    expect(reorderHandCard).toHaveBeenCalledWith('user-1', 'hand-2', 'hand-1', 'before');
    expect(playFlip).toHaveBeenCalledOnce();
    expect(calls).toEqual(['prepare:[data-zone="hand"][data-card-instance-id]', 'freeze:false', 'reorder', 'playFlip']);
  });

  it('concedes through a dedicated game command even if another action is pending', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    const concededSnapshot = snapshotWithStatus('conceded');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({ event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' }, snapshot: concededSnapshot }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.concedeGame();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
  });

  it('blocks local turn changes immediately after conceding', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    addOpponent(activeSnapshot);
    const concededSnapshot = snapshotWithStatus('conceded');
    addOpponent(concededSnapshot);
    concededSnapshot.turn = { activePlayerId: 'user-1', phase: 'main-1', number: 1 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-concede', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: concededSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.concedeGame();
    await fixture.componentInstance.store.passTurn();

    expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(1);
    expect(gameplayWebsocketCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'game.concede', payload: {} }),
      'game-1',
    );
  });

  it('asks for confirmation before conceding from the table menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    addOpponent(activeSnapshot);
    const concededSnapshot = snapshotWithStatus('conceded');
    addOpponent(concededSnapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({ event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' }, snapshot: concededSnapshot }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'concedeGame' }, {} as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.tableExitAction()).toBe('concede');
    expect(fixture.componentInstance.tableExitMessage()).toContain('This cannot be undone.');
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();

    await fixture.componentInstance.confirmTableExitAction();
    await fixture.whenStable();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(gamesApi.rematchVote).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
  });

  it('concedes before leaving the table from an active game', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    const concededSnapshot = snapshotWithStatus('conceded');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: concededSnapshot,
    }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.leaveTable();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(gamesApi.rematchVote).toHaveBeenCalledWith('game-1', 'leave');
    expect(roomsApi.leave).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/rooms']);
  });

  it('asks for confirmation before leaving the table from the table menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.life = 0;
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const leaveTable = vi.spyOn(fixture.componentInstance.store, 'leaveTable').mockResolvedValue(undefined);

    fixture.componentInstance.handleContextMenuAction({ type: 'leaveTable' }, {} as never);
    await fixture.whenStable();

    expect(fixture.componentInstance.tableExitAction()).toBe('leave');
    expect(leaveTable).not.toHaveBeenCalled();
    expect(gamesApi.rematchVote).not.toHaveBeenCalled();
    expect(fixture.componentInstance.rematchModalOpen()).toBe(false);

    await fixture.componentInstance.confirmTableExitAction();

    expect(leaveTable).toHaveBeenCalled();
    expect(gamesApi.rematchVote).not.toHaveBeenCalled();
  });

  it('reuses the table leave confirmation from the unsupported resolution overlay', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const leaveTable = vi.spyOn(fixture.componentInstance.store, 'leaveTable').mockResolvedValue(undefined);

    const leaveButton = fixture.nativeElement.querySelector('[data-testid="unsupported-resolution-leave-room"]') as HTMLButtonElement;
    leaveButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.tableExitAction()).toBe('leave');

    await fixture.componentInstance.confirmTableExitAction();

    expect(leaveTable).toHaveBeenCalled();
  });

  it('treats a snapshot viewer without current room membership as read-only', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    roomsApi.current.mockReturnValue(of({ room: null, player: null, turn: null, viewerRole: null }));
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.store.viewerCanControlTable()).toBe(false);
    expect(fixture.componentInstance.store.currentPlayer()).toBeNull();
    expect(fixture.componentInstance.store.canControlPlayer('user-1')).toBe(false);
  });

  it('opens token search from the battlefield menu and creates the selected token', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const tokenSnapshot = snapshotWithStatus('active');
    const tokenCard: GameCardInstance = {
      instanceId: 'token-card-1',
      ownerId: 'user-1',
      controllerId: 'user-1',
      scryfallId: 'token-1',
      name: 'Goblin Token',
      typeLine: 'Token Creature - Goblin',
      power: 1,
      toughness: 1,
      defaultPower: 1,
      defaultToughness: 1,
      tapped: false,
      counters: {},
      isToken: true,
    };
    tokenSnapshot.version = 2;
    tokenSnapshot.players['user-1']!.zones.battlefield = [
      ...tokenSnapshot.players['user-1']!.zones.battlefield,
      tokenCard,
    ];
    tokenSnapshot.players['user-1']!.zoneCounts!.battlefield = tokenSnapshot.players['user-1']!.zones.battlefield.length;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-token', type: 'card.token.created', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: tokenSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'createToken' }, { playerId: 'user-1' } as never);
    expect(fixture.componentInstance.tokenSearchPlayerId()).toBe('user-1');

    await fixture.componentInstance.createSelectedToken({
      card: {
        id: 'token-1',
        scryfallId: 'token-1',
        name: 'Goblin Token',
        manaCost: null,
        typeLine: 'Token Creature - Goblin',
        oracleText: null,
        power: '1',
        toughness: '1',
        colors: ['R'],
        colorIdentity: ['R'],
        legalities: {},
        imageUris: { normal: 'https://cards.test/token-1.jpg' },
        layout: 'token',
        commanderLegal: false,
        set: 'tst',
        collectorNumber: '1',
      },
      quantity: 3,
    });

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.token.created',
      payload: expect.objectContaining({
        playerId: 'user-1',
        quantity: 3,
        card: expect.objectContaining({
          scryfallId: 'token-1',
          name: 'Goblin Token',
          imageUris: { normal: 'https://cards.test/token-1.jpg' },
        }),
      }),
    }), 'game-1');
    expect(fixture.componentInstance.tokenSearchPlayerId()).toBeNull();
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
  });

  it('opens the shared roll modal from the own battlefield context menu action', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

    fixture.componentInstance.handleContextMenuAction({ type: 'rollDice' }, {
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'zone',
    } as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.rollModalOpen()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-roll-modal')).not.toBeNull();
  });

  it('opens websocket debug in a new tab from the game context menu action', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    try {
      const fixture = TestBed.createComponent(GameTableComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

      fixture.componentInstance.handleContextMenuAction({ type: 'openDebug' }, {
        playerId: 'user-1',
        zone: 'battlefield',
        kind: 'game',
      } as never);

      expect(open).toHaveBeenCalledWith('/games/game-1/debug', '_blank', 'noopener');
    } finally {
      open.mockRestore();
    }
  });

  it('records roll modal results in the game log through a game command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const commandSnapshot = structuredClone(snapshot);
    commandSnapshot.eventLog = [gameLogEntry('event-dice', 'dice.rolled', 'ha tirado un d20, ha salido un 17.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-dice', type: 'dice.rolled', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: commandSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.recordRollResult({
      kind: 'd20',
      label: 'Dado de 20 caras',
      iterationCount: 4,
      finalResult: '17',
    });

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dice.rolled',
      payload: {
        kind: 'd20',
        label: 'Dado de 20 caras',
        finalResult: '17',
      },
    }), 'game-1');
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
  });

  it('sends roll modal button results to the game log', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const commandSnapshot = structuredClone(snapshot);
    commandSnapshot.eventLog = [gameLogEntry('event-dice', 'dice.rolled', 'ha tirado un d20, ha salido un 17.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-dice', type: 'dice.rolled', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: commandSnapshot,
    }));
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.8);

    try {
      const fixture = TestBed.createComponent(GameTableComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

      fixture.componentInstance.openRollModal();
      fixture.detectChanges();
      const modal = fixture.debugElement.query(By.directive(RollModalComponent)).componentInstance as RollModalComponent;
      modal.selectRoll('d20');
      modal.roll();

      await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
        type: 'dice.rolled',
        payload: {
          kind: 'd20',
          label: 'Dado de 20 caras',
          finalResult: '17',
        },
      }), 'game-1'));
      await vi.waitFor(() => expect(fixture.componentInstance.store.eventLog()[0]?.messagePrefix)
        .toBe('ha tirado un d20, ha salido un 17.'));
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log"]')?.textContent)
        .toContain('ha tirado un d20, ha salido un 17.');
    } finally {
      random.mockRestore();
    }
  });

  it('untaps the current player battlefield with one U shortcut command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.battlefield[0]!.tapped = true;
    snapshot.players['user-1']!.zones.battlefield.push({
      ...snapshot.players['user-1']!.zones.battlefield[0]!,
      instanceId: 'card-2',
      name: 'Arcane Signet',
      tapped: true,
    });
    snapshot.players['user-1']!.zoneCounts!.battlefield = 2;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-untap', type: 'battlefield.untap_all', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'battlefield.untap_all',
      payload: {
        playerId: 'user-1',
      },
    }), 'game-1'));
  });

  it('sends the U shortcut to the own battlefield when an opponent is focused', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-1']!.zones.battlefield[0]!.tapped = true;
    snapshot.players['user-2']!.zones.battlefield[0]!.tapped = true;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-untap', type: 'battlefield.untap_all', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.focusPlayer('user-2');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'battlefield.untap_all',
      payload: {
        playerId: 'user-1',
      },
    }), 'game-1'));
  });

  it('does not send the U shortcut command when the current player has no tapped battlefield cards', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    await Promise.resolve();

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
  });

  it('resolves focused player deck visuals for the table background and current player sleeves', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.backgroundName = 'back_5';
    snapshot.players['user-1']!.sleevesName = 'facedown_card';
    snapshot.players['user-2'] = {
      ...structuredClone(snapshot.players['user-1']!),
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      backgroundName: 'U_2',
      sleevesName: 'C_01',
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
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const gameScreen = fixture.nativeElement.querySelector('[data-testid="game-screen"]') as HTMLElement;
    fixture.componentInstance.focusPlayerBattlefield('user-2');
    fixture.detectChanges();
    const faceDownCard = {
      instanceId: 'face-down-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Face-down card',
      tapped: false,
      faceDown: true,
    };

    expect(gameScreen.style.getPropertyValue('--game-wallpaper-image')).toContain('/assets/images/play-mat/U_2.png');
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat.message',
      payload: { message: 'secret', targetPlayerId: 'user-2' },
    }), 'game-1');
  });

  it('marks chat as unread when a new message arrives while game log is active', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();
    const notificationSound = fixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playChatMessage = vi.spyOn(notificationSound, 'playChatMessage').mockImplementation(() => undefined);
    const playGameLogMessage = vi.spyOn(notificationSound, 'playGameLogMessage').mockImplementation(() => undefined);

    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.chat = [{
      userId: 'user-2',
      displayName: 'Opponent',
      message: 'New message',
      targetPlayerId: null,
      targetDisplayName: null,
      createdAt: '2026-04-30T20:03:00+00:00',
    }];
    fixture.componentInstance.store.snapshot.set(nextSnapshot);
    await fixture.whenStable();
    fixture.detectChanges();

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    const logButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-open"]') as HTMLElement;
    expect(chatButton.classList).toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).not.toBeNull();
    expect(playChatMessage).toHaveBeenCalledOnce();
    expect(playGameLogMessage).not.toHaveBeenCalled();
    expect(logButton.classList).not.toContain('has-unread');
    expect(logButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-panel"]')?.classList)
      .not.toContain('has-unread-notifications');

    chatButton.click();
    fixture.detectChanges();

    expect(chatButton.classList).not.toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
  });

  it('highlights unread chat messages and evaporates the highlight after reading them', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.chat = [chatMessage('user-2', 'Opponent', 'New message', null, '2026-04-30T20:03:00+00:00')];
    fixture.componentInstance.store.snapshot.set(nextSnapshot);
    await fixture.whenStable();
    fixture.detectChanges();

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    expect(chatButton.classList).toContain('has-unread');

    vi.useFakeTimers();
    try {
      chatButton.click();
      fixture.detectChanges();

      const chatMessageElement = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-message"]') as HTMLElement;
      expect(chatMessageElement.classList).toContain('new-message-highlight');
      expect(chatMessageElement.classList).toContain('new-message-evaporating');
      expect(chatMessageElement.textContent).toContain('Opponent:New message');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();

      expect(chatMessageElement.classList).not.toContain('new-message-highlight');
      expect(chatMessageElement.classList).not.toContain('new-message-evaporating');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders player colors and sends persisted chat reactions', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const message = chatMessage('user-2', 'Opponent', 'Reactable message', null, new Date().toISOString());
    snapshot.chat = [{
      ...message,
      reactions: {
        like: [{ userId: 'user-3', displayName: 'Third Player', createdAt: '2026-04-30T20:04:00+00:00' }],
      },
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-chat-reaction', type: 'chat.reaction.toggled', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    const author = (fixture.nativeElement as HTMLElement).querySelector('.chat-message-body strong') as HTMLElement;
    expect(author.style.getPropertyValue('--chat-author-color')).not.toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-message"]')?.textContent)
      .toContain('Opponent:Reactable message');
    expect((fixture.nativeElement as HTMLElement).querySelector('.chat-reaction-users')?.textContent)
      .toContain('Third Player');

    const reactions = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="chat-reaction"]')) as HTMLButtonElement[];
    reactions[0]?.click();
    fixture.detectChanges();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat.reaction.toggled',
      payload: { messageId: message.id, reaction: 'like' },
    }), 'game-1');
  });

  it('does not render reaction actions for own chat messages', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.chat = [chatMessage('user-1', 'User', 'Own message', null, '2026-04-30T20:03:00+00:00')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-reaction"]')).toBeNull();
  });

  it('does not render reaction actions for chat messages older than 30 minutes', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const staleCreatedAt = new Date(Date.now() - (31 * 60 * 1000)).toISOString();
    snapshot.chat = [{
      ...chatMessage('user-2', 'Opponent', 'Old message', null, staleCreatedAt),
      reactions: {
        like: [{ userId: 'user-3', displayName: 'Third Player', createdAt: staleCreatedAt }],
      },
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-reaction"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.chat-reaction-pill')?.textContent)
      .toContain('1');
  });

  it('shows reaction authors for private chat messages', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.chat = [{
      ...chatMessage('user-2', 'Opponent', 'Private reaction', 'user-1', '2026-04-30T20:03:00+00:00'),
      reactions: {
        cry: [{ userId: 'user-3', displayName: 'Third Player', createdAt: '2026-04-30T20:04:00+00:00' }],
      },
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.chat-reaction-users')?.textContent)
      .toContain('Third Player');
  });

  it('does not mark existing chat history as unread on initial load', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.chat = [{
      userId: 'user-2',
      displayName: 'Opponent',
      message: 'Already read',
      targetPlayerId: null,
      targetDisplayName: null,
      createdAt: '2026-04-30T20:03:00+00:00',
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();
    const notificationSound = fixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playChatMessage = vi.spyOn(notificationSound, 'playChatMessage').mockImplementation(() => undefined);

    fixture.componentInstance.store.snapshot.set(structuredClone(snapshot));
    await fixture.whenStable();
    fixture.detectChanges();

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    expect(chatButton.classList).not.toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
    expect(playChatMessage).not.toHaveBeenCalled();
  });

  it('persists read public chat messages for the current player', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const firstChatSnapshot = structuredClone(snapshot);
    firstChatSnapshot.chat = [chatMessage('user-2', 'Opponent', 'Public one', null, '2026-04-30T20:03:00+00:00')];
    fixture.componentInstance.store.snapshot.set(firstChatSnapshot);
    await fixture.whenStable();
    fixture.detectChanges();

    const firstChatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    expect(firstChatButton.classList).toContain('has-unread');
    firstChatButton.click();
    fixture.detectChanges();
    expect(firstChatButton.classList).not.toContain('has-unread');
    fixture.destroy();

    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: firstChatSnapshot } }));
    const reloadedFixture = TestBed.createComponent(GameTableComponent);
    reloadedFixture.detectChanges();
    await reloadedFixture.whenStable();
    await vi.waitFor(() => expect(reloadedFixture.componentInstance.store.loading()).toBe(false));
    reloadedFixture.detectChanges();
    const notificationSound = reloadedFixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playChatMessage = vi.spyOn(notificationSound, 'playChatMessage').mockImplementation(() => undefined);

    const reloadedChatButton = (reloadedFixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    expect(reloadedChatButton.classList).not.toContain('has-unread');
    expect(playChatMessage).not.toHaveBeenCalled();

    const secondChatSnapshot = structuredClone(firstChatSnapshot);
    secondChatSnapshot.chat = [
      ...firstChatSnapshot.chat,
      chatMessage('user-2', 'Opponent', 'Public two', null, '2026-04-30T20:04:00+00:00'),
    ];
    reloadedFixture.componentInstance.store.snapshot.set(secondChatSnapshot);
    await reloadedFixture.whenStable();
    reloadedFixture.detectChanges();

    expect(reloadedChatButton.classList).toContain('has-unread');
    expect(playChatMessage).toHaveBeenCalledOnce();
  });

  it('persists read private chat messages for the current player', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    const readSnapshot = structuredClone(snapshot);
    readSnapshot.chat = [chatMessage('user-2', 'Opponent', 'Private one', 'user-1', '2026-04-30T20:03:00+00:00')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: readSnapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();
    fixture.destroy();

    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: readSnapshot } }));
    const reloadedFixture = TestBed.createComponent(GameTableComponent);
    reloadedFixture.detectChanges();
    await reloadedFixture.whenStable();
    await vi.waitFor(() => expect(reloadedFixture.componentInstance.store.loading()).toBe(false));
    reloadedFixture.detectChanges();
    const notificationSound = reloadedFixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playChatMessage = vi.spyOn(notificationSound, 'playChatMessage').mockImplementation(() => undefined);

    const reloadedChatButton = (reloadedFixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    expect(reloadedChatButton.classList).not.toContain('has-unread');

    const nextSnapshot = structuredClone(readSnapshot);
    nextSnapshot.chat = [
      ...readSnapshot.chat,
      chatMessage('user-2', 'Opponent', 'Private two', 'user-1', '2026-04-30T20:04:00+00:00'),
    ];
    reloadedFixture.componentInstance.store.snapshot.set(nextSnapshot);
    await reloadedFixture.whenStable();
    reloadedFixture.detectChanges();

    expect(reloadedChatButton.classList).toContain('has-unread');
    expect(playChatMessage).toHaveBeenCalledOnce();
  });

  it('marks game log as unread when a new action arrives while chat is active', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();
    const notificationSound = fixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playChatMessage = vi.spyOn(notificationSound, 'playChatMessage').mockImplementation(() => undefined);
    const playGameLogMessage = vi.spyOn(notificationSound, 'playGameLogMessage').mockImplementation(() => undefined);

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.eventLog = [gameLogEntry('event-life', 'life.changed', 'Changed life.')];
    fixture.componentInstance.store.snapshot.set(nextSnapshot);
    await fixture.whenStable();
    fixture.detectChanges();

    const logButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-open"]') as HTMLElement;
    expect(logButton.classList).toContain('has-unread');
    expect(logButton.querySelector('lucide-icon[name="bell"]')).not.toBeNull();
    expect(playGameLogMessage).toHaveBeenCalledOnce();
    expect(playChatMessage).not.toHaveBeenCalled();
    expect(chatButton.classList).not.toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-panel"]')?.classList)
      .not.toContain('has-unread-notifications');

    logButton.click();
    fixture.detectChanges();

    expect(logButton.classList).not.toContain('has-unread');
    expect(logButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
  });

  it('highlights unread game log entries and evaporates the highlight after reading them', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();

    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.eventLog = [gameLogEntry('event-life', 'life.changed', 'Changed life.')];
    fixture.componentInstance.store.snapshot.set(nextSnapshot);
    await fixture.whenStable();
    fixture.detectChanges();

    const logButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-open"]') as HTMLElement;
    expect(logButton.classList).toContain('has-unread');

    vi.useFakeTimers();
    try {
      logButton.click();
      fixture.detectChanges();

      const logEntry = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-entry"]') as HTMLElement;
      expect(logEntry.classList).toContain('new-message-highlight');
      expect(logEntry.classList).toContain('new-message-evaporating');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();

      expect(logEntry.classList).not.toContain('new-message-highlight');
      expect(logEntry.classList).not.toContain('new-message-evaporating');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mark existing game log history as unread on initial load', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [gameLogEntry('event-life', 'life.changed', 'Changed life.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();
    const notificationSound = fixture.debugElement.injector.get(GameTableNotificationSoundService);
    const playGameLogMessage = vi.spyOn(notificationSound, 'playGameLogMessage').mockImplementation(() => undefined);

    const chatButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chat-open"]') as HTMLElement;
    chatButton.click();
    fixture.detectChanges();
    fixture.componentInstance.store.snapshot.set(structuredClone(snapshot));
    await fixture.whenStable();
    fixture.detectChanges();

    const logButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-open"]') as HTMLElement;
    expect(logButton.classList).not.toContain('has-unread');
    expect(logButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
    expect(playGameLogMessage).not.toHaveBeenCalled();
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

  it('ignores battlefield clicks beyond double click detail', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0];
    expect(card).toBeTruthy();
    const event = {
      detail: 3,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent;
    const handleClick = vi.spyOn(
      fixture.componentInstance.store['interactionActions'],
      'handleBattlefieldCardClick',
    );

    fixture.componentInstance.store.handleBattlefieldCardClick(event, 'user-1', card!);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(handleClick).not.toHaveBeenCalled();
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

  it('shuffles the library after closing a view all library modal', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const libraryCard = snapshot.players['user-1'].zones.library[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-library', type: 'library.view', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));
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

    fixture.componentInstance.handleContextMenuAction({ type: 'openLibraryView', mode: 'all' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'library',
      kind: 'zone',
    });

    await vi.waitFor(() => expect(gamesApi.zone).toHaveBeenCalledOnce());
    await fixture.componentInstance.store.closeZoneModal();

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(2));
    expect(gameplayWebsocketCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'library.view',
      payload: { playerId: 'user-1' },
    }), 'game-1');
    expect(gameplayWebsocketCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'library.shuffle',
      payload: { playerId: 'user-1' },
    }), 'game-1');
  });

  it('opens view-all library card menus with give destinations enabled', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const libraryCard = snapshot.players['user-1'].zones.library[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-library', type: 'library.view', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));
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

    await fixture.componentInstance.store.viewLibrary('user-1');
    fixture.componentInstance.store.openZoneModalCardMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      clientX: 120,
      clientY: 160,
    } as unknown as MouseEvent, libraryCard);

    expect(fixture.componentInstance.store.contextMenu()).toEqual(expect.objectContaining({
      kind: 'card',
      zone: 'library',
      card: libraryCard,
      fromFixedZoneModal: true,
    }));
  });

  it.each(['graveyard', 'exile'] as const)('opens %s modal card menus with give destinations enabled', async (zone) => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const zoneCard = {
      instanceId: `${zone}-card`,
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: `${zone} card`,
      typeLine: 'Artifact',
      zone,
      tapped: false,
      counters: {},
    };
    snapshot.players['user-1']!.zones[zone] = [zoneCard];
    snapshot.players['user-1']!.zoneCounts![zone] = 1;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.zone.mockReturnValue(of({
      gameId: 'game-1',
      playerId: 'user-1',
      zone,
      total: 1,
      data: [zoneCard],
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.openZone('user-1', zone);
    fixture.componentInstance.store.openZoneModalCardMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      clientX: 120,
      clientY: 160,
    } as unknown as MouseEvent, zoneCard);

    expect(fixture.componentInstance.store.contextMenu()).toEqual(expect.objectContaining({
      kind: 'card',
      zone,
      card: zoneCard,
      fromFixedZoneModal: true,
    }));
  });

  it('allows dragging the top card out of the library pile', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const player = fixture.componentInstance.store.players()[0];
    const setData = vi.fn();
    const event = {
      dataTransfer: { setData, setDragImage: vi.fn(), effectAllowed: '' },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    fixture.componentInstance.store.dragTopZoneCard(event, player, 'library');

    const topLibraryCard = player.state.zones.library[0]!;
    expect(setData).toHaveBeenCalledWith('text/plain', topLibraryCard.instanceId);
    expect(setData).toHaveBeenCalledWith('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'library',
      instanceId: topLibraryCard.instanceId,
      instanceIds: [topLibraryCard.instanceId],
    }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.draggingCardInstanceId()).toBe(topLibraryCard.instanceId);
  });

  it('drops the top library pile card onto an empty hand through the DOM drag path', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-draw', type: 'library.draw', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const dataTransfer = dragDataTransfer();
    const libraryButton = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.zone-stack'))
      .find((element) => element.textContent?.includes('Library'));
    expect(libraryButton).toBeTruthy();

    libraryButton!.dispatchEvent(dragEvent('dragstart', dataTransfer, libraryButton!));
    fixture.detectChanges();

    const emptyHandTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;
    emptyHandTarget.dispatchEvent(dragEvent('dragover', dataTransfer, emptyHandTarget));
    emptyHandTarget.dispatchEvent(dragEvent('drop', dataTransfer, emptyHandTarget));
    await fixture.whenStable();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library.draw',
      payload: { playerId: 'user-1', count: 1 },
    }), 'game-1');
  });

  it('drops a top zone pile card onto the battlefield through the native DOM drag path', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const topLibraryCard = snapshot.players['user-1']!.zones.library[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-move', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    fixture.detectChanges();

    const dataTransfer = dragDataTransfer();
    const libraryButton = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.zone-stack'))
      .find((element) => element.getAttribute('data-zone') === 'library');
    expect(libraryButton).toBeTruthy();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    battlefield.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 600,
      height: 420,
      top: 0,
      right: 600,
      bottom: 420,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    libraryButton!.dispatchEvent(dragEvent('dragstart', dataTransfer, libraryButton!));
    fixture.detectChanges();
    battlefield.dispatchEvent(dragEvent('dragover', dataTransfer, battlefield));
    battlefield.dispatchEvent(dragEvent('drop', dataTransfer, battlefield));
    await fixture.whenStable();

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.moved',
      payload: expect.objectContaining({
        playerId: 'user-1',
        fromZone: 'library',
        toZone: 'battlefield',
        targetPlayerId: 'user-1',
        instanceId: topLibraryCard.instanceId,
      }),
    }), 'game-1');
  });

  it('closes an open zone menu when a zone pile pointer drag starts', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const playerState = snapshot.players['user-1']!;
    const exileCard: GameCardInstance = {
      ...playerState.zones.battlefield[0]!,
      instanceId: 'exile-card',
      name: 'Exiled Card',
      zone: 'exile',
    };
    playerState.zones.exile = [exileCard];
    playerState.zoneCounts = { ...playerState.zoneCounts!, exile: 1 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openZoneMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 120,
      clientY: 120,
    } as unknown as MouseEvent, 'user-1', 'exile');
    expect(fixture.componentInstance.store.contextMenu()).toEqual(expect.objectContaining({ kind: 'zone', zone: 'exile' }));

    fixture.componentInstance.handleZonePointerDragStarted({
      playerId: 'user-1',
      zone: 'exile',
      card: exileCard,
    });

    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
    expect(fixture.componentInstance.store.draggingCardInstanceId()).toBe(exileCard.instanceId);
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
    gameplayWebsocketCommand.mockReturnValue(commandResponse.asObservable());

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
    cardElement.dataset['testid'] = 'game-card';
    cardElement.dataset['zone'] = 'battlefield';
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('Only the active turn player can advance the turn.');
  });

  it('focuses the active turn player when follow turn is enabled', async () => {
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

    fixture.componentInstance.updateFollowActiveTurnPlayer(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
  });

  it('reapplies active turn focus when the focused player drifts while follow turn remains enabled', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.turn.activePlayerId = 'user-2';
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.updateFollowActiveTurnPlayer(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');

    fixture.componentInstance.focusPlayerBattlefield('user-1');
    fixture.detectChanges();

    expect(fixture.componentInstance.followActiveTurnPlayer()).toBe(true);
    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
  });

  it('updates the opponent sidebar for follow turn and disables follow when an opponent is clicked manually', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.turn.activePlayerId = 'user-2';
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.updateFollowActiveTurnPlayer(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(fixture.componentInstance.opponentSidebarPlayers().map((player) => player.id)).toEqual(['user-1']);
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="opponent-mini-board"]'))
      .map((board) => board.dataset['playerId'])).toEqual(['user-1']);

    ((fixture.nativeElement as HTMLElement).querySelector('[data-testid="opponent-mini-board"][data-player-id="user-1"]') as HTMLElement)
      .click();
    fixture.detectChanges();

    expect(fixture.componentInstance.followActiveTurnPlayer()).toBe(false);
    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-1');
    expect(fixture.componentInstance.opponentSidebarPlayers().map((player) => player.id)).toEqual(['user-2']);
  });

  it('keeps defeated opponents at the bottom of the opponent sidebar', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-2']!.life = 0;
    snapshot.players['user-3'] = {
      ...snapshot.players['user-2']!,
      user: { id: 'user-3', email: 'third@test', displayName: 'Third', roles: [] },
      life: 32,
    };
    snapshot.players['user-4'] = {
      ...snapshot.players['user-2']!,
      user: { id: 'user-4', email: 'fourth@test', displayName: 'Fourth', roles: [] },
      status: 'conceded',
      concededAt: '2026-04-30T20:03:00+00:00',
      life: 18,
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.opponentSidebarPlayers().map((player) => player.id)).toEqual([
      'user-3',
      'user-2',
      'user-4',
    ]);
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="opponent-mini-board"]'))
      .map((board) => board.dataset['playerId'])).toEqual(['user-3', 'user-2', 'user-4']);
  });

  it('refreshes the focused battlefield, background, and hand when focus turn follows a passed turn', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-2']!.backgroundName = 'U_2';
    snapshot.players['user-2']!.zones.hand = [];
    snapshot.players['user-2']!.zoneCounts = { ...snapshot.players['user-2']!.zoneCounts!, hand: 3 };
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.turn = { activePlayerId: 'user-2', phase: 'untap', number: 1 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-turn', type: 'turn.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: nextSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.updateFollowActiveTurnPlayer(true);
    await fixture.componentInstance.store.passTurn();
    fixture.detectChanges();

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'turn.changed',
    }), 'game-1'));
    expect(gamesApi.snapshot).toHaveBeenCalledTimes(1);
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
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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

    expect(fixture.componentInstance.store.syncStatus()).toBe('live');

    fixture.componentInstance.store.pending.set(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.syncStatus()).toBe('pending');
  });

  it('initializes a selected card counter at zero without opening the number dialog', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
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

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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
    fixture.componentInstance.store.handleBattlefieldCardClick({
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent, 'user-1', card);
    expect(fixture.componentInstance.store.hoveredPreview()?.card.instanceId).toBe(card.instanceId);

    fixture.componentInstance.handleContextMenuAction({ type: 'moveCard', zone: 'library' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
    expect(fixture.componentInstance.store.hoveredPreview()).toBeNull();
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
    expect(fixture.componentInstance.pendingLibraryMoveMessage(fixture.componentInstance.store.pendingLibraryMove()!))
      .toBe('Donde quieres poner esta carta?');
  });

  it('asks for one library position when selected cards move to the library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.battlefield.push({
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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
    expect(fixture.componentInstance.pendingLibraryMoveMessage(fixture.componentInstance.store.pendingLibraryMove()!))
      .toBe('Donde quieres poner estas 2 cartas?');
  });

  it('allows random order when multiple cards are placed into library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-random-library', type: 'cards.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.snapshot()).not.toBeNull());

    fixture.componentInstance.store.pendingLibraryMove.set({
      cardName: '2 cards',
      commandType: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'battlefield',
        toZone: 'library',
        instanceIds: ['card-1', 'card-2'],
      },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.pendingLibraryMoveSupportsRandomOrder(fixture.componentInstance.store.pendingLibraryMove()!)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Random order');
    const checkbox = fixture.nativeElement.querySelector('.library-random-order-option input') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const topButton = Array.from(host.querySelectorAll<HTMLButtonElement>('footer button'))
      .find((button) => button.textContent?.trim() === 'Top');
    expect(topButton).toBeDefined();
    topButton!.click();

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'battlefield',
        toZone: 'library',
        instanceIds: ['card-1', 'card-2'],
        position: 'top',
        randomOrder: true,
      },
    }), 'game-1'));
  });

  it('asks for top or bottom when moving a whole zone to library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.graveyard = [
      {
        instanceId: 'grave-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'First Grave Card',
        typeLine: 'Creature',
        tapped: false,
        counters: {},
      },
      {
        instanceId: 'grave-2',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'Second Grave Card',
        typeLine: 'Sorcery',
        tapped: false,
        counters: {},
      },
    ];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-zone-library', type: 'cards.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'moveAll', zone: 'library' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'graveyard',
      kind: 'zone',
    });

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.zoneMoveAllLibraryDialog()).toEqual({
      playerId: 'user-1',
      fromZone: 'graveyard',
      count: 2,
    });

    fixture.componentInstance.zoneMoveAllLibraryRandomOrder.set(true);
    fixture.componentInstance.confirmZoneMoveAllToLibrary('bottom');

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'graveyard',
        toZone: 'library',
        instanceIds: ['grave-1', 'grave-2'],
        position: 'bottom',
        randomOrder: true,
      },
    }), 'game-1'));
  });

  it('moves a whole graveyard to a selected player battlefield', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.graveyard = [{
      instanceId: 'grave-1',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Creature Card',
      typeLine: 'Creature',
      tapped: false,
      counters: {},
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-zone-battlefield', type: 'cards.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'moveAll', zone: 'battlefield', targetPlayerId: 'user-2' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'graveyard',
      kind: 'zone',
    });

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'graveyard',
        toZone: 'battlefield',
        instanceIds: ['grave-1'],
        targetPlayerId: 'user-2',
      },
    }), 'game-1'));
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
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-controller', type: 'card.controller.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const target = appendPlayerDropTarget(fixture.nativeElement, 'user-2');

    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'battlefield',
      kind: 'card',
      card,
    });

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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

    fixture.componentInstance.confirmPendingBattlefieldMove();

    expect(throwGhost).toHaveBeenCalledWith('card-1', target, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
    }));
    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.controller.changed',
      payload: {
        playerId: 'user-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        targetPlayerId: 'user-2',
      },
    }), 'game-1'));
  });

  it('plays a hand card face down from the context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.hand = [{
      instanceId: 'hand-1',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Hidden Card',
      typeLine: 'Creature',
      tapped: false,
      counters: {},
    }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-play-face-down', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.hand[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'playFaceDown' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'hand',
      kind: 'card',
      card,
    });

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId: 'hand-1',
        faceDown: true,
      },
    }), 'game-1'));
  });

  it('asks for confirmation before giving a hand card to another player', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.hand = [{
      instanceId: 'hand-1',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Secret Card',
      typeLine: 'Instant',
      tapped: false,
      counters: {},
    }];
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
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-give-hand', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const motion = fixture.debugElement.injector.get(GameTableMotionService);
    const throwGhost = vi.spyOn(motion, 'throwGhost').mockImplementation(() => undefined);
    const target = appendPlayerDropTarget(fixture.nativeElement, 'user-2');

    const card = snapshot.players['user-1'].zones.hand[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'hand',
      kind: 'card',
      card,
    });

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.handCardGiveDialog()).toEqual(expect.objectContaining({
      targetPlayerId: 'user-2',
      targetPlayerName: 'Opponent',
      cardName: 'Secret Card',
    }));

    fixture.componentInstance.confirmHandCardGive();

    expect(throwGhost).toHaveBeenCalledWith('hand-1', target, expect.objectContaining({
      scaleToTarget: true,
      rotate: -6,
    }));
    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'hand',
        toZone: 'hand',
        instanceId: 'hand-1',
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
    gameplayWebsocketCommand.mockReturnValue(of({
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
    expect(fixture.componentInstance.focusEffectsEnabled()).toBe(false);

    fixture.componentInstance.updateArrowTargetDialog({ playerId: 'user-2', multipleTargets: false, targetCount: 1 });
    fixture.detectChanges();

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(fixture.componentInstance.store.pendingArrowSource()).toBeNull();
    expect(fixture.componentInstance.focusEffectsEnabled()).toBe(false);
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
    expect(fixture.componentInstance.focusEffectsEnabled()).toBe(false);

    fixture.componentInstance.store.handleBattlefieldCardClick(new MouseEvent('click'), 'user-2', target);

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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
    snapshot.players['user-2']!.zones.battlefield.push({
      instanceId: 'card-4',
      ownerId: 'user-2',
      controllerId: 'user-2',
      name: 'Command Tower',
      typeLine: 'Land',
      tapped: false,
      counters: {},
    });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
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
    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(2));
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow.created',
      payload: { fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'green' },
    }), 'game-1');
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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

  it('uses a multiple outgoing targeting pill when several arrows target the same opponent', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-1'].zones.battlefield.push({
      instanceId: 'card-3',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Second Source',
      typeLine: 'Creature',
      tapped: false,
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

    expect(fixture.componentInstance.store.opponentTargetingPills().get('user-2')).toEqual(expect.objectContaining({
      direction: 'outgoing',
      text: 'Objetivo: multiple',
    }));
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

  it('shows the focused opponent hand as the active hand with card backs', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    const opponentState = snapshot.players['user-2']!;
    opponentState.zones.hand = [];
    opponentState.zoneCounts = { ...opponentState.zoneCounts!, hand: 3 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.focusPlayerBattlefield('user-2');
    fixture.detectChanges();

    const opponent = fixture.componentInstance.store.handPlayer();
    expect(opponent?.id).toBe('user-2');
    expect(fixture.componentInstance.isHandPlayerReadOnly()).toBe(true);
    expect(fixture.componentInstance.store.zoneCount(opponent!, 'hand')).toBe(3);
  });

  it('removes an arrow from the arrow context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.arrows = [{ id: 'arrow-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '' }];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledTimes(2));
    expect(gameplayWebsocketCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'arrow.removed',
      payload: { id: 'arrow-1' },
    }), 'game-1');
    expect(gameplayWebsocketCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
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
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-draw', type: 'library.draw_many', payload: {}, createdBy: 'user-1', createdAt: '' },
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledOnce());
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library.draw_many',
      payload: {
        playerId: 'user-1',
        count: 3,
      },
    }), 'game-1');
  });

  it('selects a random card from the clicked zone through the context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.graveyard = [{
      instanceId: 'grave-card',
      ownerId: 'user-1',
      controllerId: 'user-1',
      name: 'Random Grave Card',
      typeLine: 'Creature',
      tapped: false,
      counters: {},
      zone: 'graveyard',
    }];
    snapshot.players['user-1']!.zoneCounts!.graveyard = 1;
    const commandSnapshot = structuredClone(snapshot);
    commandSnapshot.players['user-1']!.zones.graveyard[0]!.name = 'Random Grave Card From Command Snapshot';
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-random', type: 'zone.random_card.selected', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: commandSnapshot,
    }));
    gamesApi.zone.mockReturnValue(of({
      gameId: 'game-1',
      playerId: 'user-1',
      zone: 'graveyard',
      total: 1,
      data: snapshot.players['user-1']!.zones.graveyard,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'selectRandomCard' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'graveyard',
      kind: 'zone',
    });

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledOnce());
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'zone.random_card.selected',
      payload: {
        playerId: 'user-1',
        zone: 'graveyard',
        instanceId: 'grave-card',
      },
    }), 'game-1');
    expect(gamesApi.zone).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.store.zoneModal()?.cards.map((card) => card.instanceId)).toEqual(['grave-card']),
    );
    expect(fixture.componentInstance.store.zoneModal()?.showFilters).toBe(false);
    expect(fixture.componentInstance.store.zoneModal()?.selectedCard?.instanceId).toBe('grave-card');
    expect(fixture.componentInstance.store.zoneModal()?.selectedCard?.name).toBe('Random Grave Card');
  });

  it('silently ignores a table action while another action is pending', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.command('life.changed', { playerId: 'user-1', delta: -1 });

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBeNull();
  });

  it('navigates to rooms when a leave vote also completes the rematch room', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));
    gamesApi.rematchVote.mockReturnValue(of({
      status: 'room_ready',
      room: {
        id: 'room-1',
        status: 'waiting',
        visibility: 'public',
        maxPlayers: 2,
        players: [],
        owner: null,
        gameId: null,
      },
    }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.abandonRematchRoom();

    expect(gamesApi.rematchVote).toHaveBeenCalledWith('game-1', 'leave');
    expect(navigate).toHaveBeenCalledWith(['/rooms']);
    expect(navigate).not.toHaveBeenCalledWith(['/rooms', 'room-1', 'waiting']);
  });

  it('does not start the rematch vote countdown while multiple alive players keep playing', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-3'] = {
      ...snapshot.players['user-2'],
      user: { id: 'user-3', email: 'third@test', displayName: 'Third', roles: [] },
      life: 38,
    };
    snapshot.players['user-1'].life = 0;
    snapshot.rematch = {
      votes: {
        'user-1': {
          playerId: 'user-1',
          displayName: 'User',
          vote: 'play_again',
          votedAt: '2026-04-30T20:01:00+00:00',
        },
      },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(fixture.componentInstance.alivePlayers().map((player) => player.id)).toEqual(['user-2', 'user-3']);
    expect(fixture.componentInstance.rematchMissingVotePlayerNames()).toEqual(['Opponent', 'Third']);
    expect(fixture.componentInstance.rematchCountdownSeconds()).toBeNull();
  });

  it('starts the rematch vote countdown after the game has a single winner', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    snapshot.players['user-3'] = {
      ...snapshot.players['user-2'],
      user: { id: 'user-3', email: 'third@test', displayName: 'Third', roles: [] },
      life: 0,
    };
    snapshot.players['user-1'].life = 0;
    snapshot.rematch = {
      votes: {
        'user-1': {
          playerId: 'user-1',
          displayName: 'User',
          vote: 'play_again',
          votedAt: '2026-04-30T20:01:00+00:00',
        },
      },
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(fixture.componentInstance.alivePlayers().map((player) => player.id)).toEqual(['user-2']);
    expect(fixture.componentInstance.rematchMissingVotePlayerNames()).toEqual(['Opponent', 'Third']);
    expect(fixture.componentInstance.rematchCountdownSeconds()).toBe(60);
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBeNull();
    expect(fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0]?.counters?.['red']).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not block battlefield position persistence behind another pending action', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gameplayWebsocketCommand).toHaveBeenCalledOnce());
    expect(fixture.componentInstance.store.error()).toBeNull();
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
    const transformedBattlefieldBounds = {
      x: 0,
      y: 0,
      width: 420,
      height: 340,
      top: 0,
      left: 0,
      right: 420,
      bottom: 340,
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
    battlefield.getBoundingClientRect = () => transformedBattlefieldBounds;
    cardElement.getBoundingClientRect = () => cardBounds;
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 260 });
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.error()).toBe('You can only change your own life total.');
  });

  it('debounces repeated life changes into one absolute command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const responseSnapshot = structuredClone(snapshot);
    responseSnapshot.players['user-1']!.life = 57;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-life', type: 'life.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: responseSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    for (let index = 0; index < 17; index += 1) {
      await fixture.componentInstance.store.changeLife('user-1', 1);
    }

    expect(fixture.componentInstance.store.snapshot()?.players['user-1']?.life).toBe(57);
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(gameplayWebsocketCommand).toHaveBeenCalledOnce();
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'life.changed',
      payload: { playerId: 'user-1', life: 57 },
    }), 'game-1');
  });

  it('debounces repeated commander damage changes into one absolute command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    addOpponent(snapshot);
    const responseSnapshot = structuredClone(snapshot);
    responseSnapshot.players['user-1']!.commanderDamage = { 'user-2': 17 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-damage', type: 'commander.damage.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: responseSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    for (let index = 0; index < 17; index += 1) {
      await fixture.componentInstance.store.setCommanderDamage('user-1', 'user-2', 1);
    }

    expect(fixture.componentInstance.store.snapshot()?.players['user-1']?.commanderDamage?.['user-2']).toBe(17);
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(gameplayWebsocketCommand).toHaveBeenCalledOnce();
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'commander.damage.changed',
      payload: { targetPlayerId: 'user-1', sourcePlayerId: 'user-2', damage: 17 },
    }), 'game-1');
  });

  it('debounces repeated player counter changes into one absolute command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const responseSnapshot = structuredClone(snapshot);
    responseSnapshot.players['user-1']!.counters = { poison: 17 };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-counter', type: 'counter.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: responseSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    for (let index = 0; index < 17; index += 1) {
      await fixture.componentInstance.store.changePlayerCounter('user-1', 'poison', 1);
    }

    expect(fixture.componentInstance.store.playerCounterValue('user-1', 'poison')).toBe(17);
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(gameplayWebsocketCommand).toHaveBeenCalledOnce();
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'counter.changed',
      payload: { scope: 'player:user-1', key: 'poison', value: 17 },
    }), 'game-1');
  });

  it('debounces repeated commander cast count changes into one absolute command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const responseSnapshot = structuredClone(snapshot);
    responseSnapshot.counters = { 'commander:user-1': { casts: 17 } };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-commander-casts', type: 'counter.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: responseSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const player = fixture.componentInstance.store.players()[0]!;
    vi.useFakeTimers();
    for (let index = 0; index < 17; index += 1) {
      await fixture.componentInstance.store.changeCommanderCastCount('user-1', 1);
    }

    expect(fixture.componentInstance.store.commanderCastCount(player)).toBe(17);
    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(gameplayWebsocketCommand).toHaveBeenCalledOnce();
    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'counter.changed',
      payload: { scope: 'commander:user-1', key: 'casts', value: 17 },
    }), 'game-1');
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

  it('focuses the opponent battlefield when a mini battlefield card is clicked', async () => {
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

    fixture.componentInstance.handleOpponentMiniBattlefieldCardClick({
      event: {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent,
      playerId: 'user-2',
      card: snapshot.players['user-2'].zones.battlefield[0]!,
    });

    expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2');
    expect(fixture.componentInstance.store.error()).toBeNull();
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

  it('does not pin a card preview when opening a card context menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.battlefield[0]!;
    fixture.componentInstance.store.showCardPreview(card, 'user-1', 'battlefield');
    fixture.componentInstance.store.openCardMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      clientX: 160,
      clientY: 180,
    } as unknown as MouseEvent, 'user-1', 'battlefield', card);

    expect(fixture.componentInstance.store.contextMenu()).toEqual(expect.objectContaining({
      kind: 'card',
      card,
    }));
    expect(fixture.componentInstance.store.hoveredPreview()).toBeNull();
  });

  it('does not open context menus for command zone cards or the command zone', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const commandCard = {
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      instanceId: 'commander-card',
      zone: 'command' as const,
    };
    snapshot.players['user-1'].zones.command = [commandCard];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    const cardEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    const zoneEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCardMenu(cardEvent, 'user-1', 'command', commandCard);
    fixture.componentInstance.store.openZoneMenu(zoneEvent, 'user-1', 'command');

    expect(fixture.componentInstance.store.contextMenu()).toBeNull();
    expect(fixture.componentInstance.store.error()).toBeNull();
  });

  it('only opens graveyard and exile zone menus when they contain cards', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1'].zones.graveyard = [];
    snapshot.players['user-1'].zones.exile = [{
      ...snapshot.players['user-1'].zones.battlefield[0]!,
      instanceId: 'exiled-card',
      zone: 'exile',
    }];
    const zoneCounts = snapshot.players['user-1'].zoneCounts;
    snapshot.players['user-1'].zoneCounts = {
      library: zoneCounts?.library ?? snapshot.players['user-1'].zones.library.length,
      hand: zoneCounts?.hand ?? snapshot.players['user-1'].zones.hand.length,
      battlefield: zoneCounts?.battlefield ?? snapshot.players['user-1'].zones.battlefield.length,
      graveyard: 0,
      exile: 1,
      command: zoneCounts?.command ?? snapshot.players['user-1'].zones.command.length,
    };
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    const emptyZoneEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 100,
      clientY: 100,
    } as unknown as MouseEvent;
    const populatedZoneEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 120,
      clientY: 120,
    } as unknown as MouseEvent;

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openZoneMenu(emptyZoneEvent, 'user-1', 'graveyard');
    expect(fixture.componentInstance.store.contextMenu()).toBeNull();

    fixture.componentInstance.store.openZoneMenu(populatedZoneEvent, 'user-1', 'exile');
    expect(fixture.componentInstance.store.contextMenu()).toEqual(expect.objectContaining({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'exile',
    }));
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
    gameplayWebsocketCommand.mockReturnValue(of({
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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
    gameplayWebsocketCommand.mockReturnValue(of({
      event: { id: 'event-play', type: 'cards.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
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

    expect(gameplayWebsocketCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cards.moved',
      payload: {
        playerId: 'user-1',
        fromZone: 'hand',
        toZone: 'battlefield',
        targetPlayerId: 'user-1',
        instanceIds: ['hand-1', 'hand-2'],
        position: { x: 0.141582, y: 0.620112, unit: 'ratio' },
      },
    }), 'game-1');
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

    expect(gameplayWebsocketCommand).not.toHaveBeenCalled();
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
      'Lost 3 life (40 -> 37).',
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
      'Lost 2 life (40 -> 38).',
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
      'Commander cast count increased from 1 to 4 (+3).',
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
      'Commander cast count decreased from 4 to 0 (-4).',
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
      'Commander cast count decreased from 17 to 15 (-2).',
    ]);
  });

  it('starts a separate commander cast counter group when direction changes', () => {
    const state = new GameTableChatLogState();
    const snapshot = snapshotWithStatus('active');
    snapshot.eventLog = [
      gameLogEntry('event-1', 'counter.changed', 'Commander cast count increased from 5 to 18 (+13).'),
      gameLogEntry('event-2', 'counter.changed', 'Set commander:user-1 counter casts to 17.'),
      gameLogEntry('event-3', 'counter.changed', 'Set commander:user-1 counter casts to 16.'),
    ];

    expect(state.eventLog(snapshot).map((entry) => entry.message)).toEqual([
      'Commander cast count increased from 5 to 18 (+13).',
      'Commander cast count decreased from 18 to 16 (-2).',
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

function appendDropZone(host: HTMLElement, playerId: string, zone: string): HTMLElement {
  const target = document.createElement('div');
  target.dataset['gameDropZone'] = 'true';
  target.dataset['playerId'] = playerId;
  target.dataset['zone'] = zone;
  target.getBoundingClientRect = () => ({
    x: 320,
    y: 40,
    width: 120,
    height: 80,
    top: 40,
    left: 320,
    bottom: 120,
    right: 440,
    toJSON: () => ({}),
  }) as DOMRect;
  host.querySelector('[data-testid="game-screen"]')?.appendChild(target);

  return target;
}

function appendPlayerDropTarget(host: HTMLElement, playerId: string): HTMLElement {
  const target = document.createElement('div');
  target.dataset['playerDropTarget'] = playerId;
  target.getBoundingClientRect = () => ({
    x: 480,
    y: 36,
    width: 160,
    height: 96,
    top: 36,
    left: 480,
    bottom: 132,
    right: 640,
    toJSON: () => ({}),
  }) as DOMRect;
  host.querySelector('[data-testid="game-screen"]')?.appendChild(target);

  return target;
}

function dragDataTransfer(): DataTransfer {
  const data = new Map<string, string>();

  return {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((format?: string) => {
      if (format) {
        data.delete(format);
      } else {
        data.clear();
      }
    }),
    getData: vi.fn((format: string) => data.get(format) ?? ''),
    setData: vi.fn((format: string, value: string) => {
      data.set(format, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

function dragEvent(type: string, dataTransfer: DataTransfer, target: HTMLElement): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    clientX: { value: 40 },
    clientY: { value: 40 },
    currentTarget: { value: target },
    dataTransfer: { value: dataTransfer },
  });

  return event;
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
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

function chatMessage(
  userId: string,
  displayName: string,
  message: string,
  targetPlayerId: string | null,
  createdAt: string,
): GameSnapshot['chat'][number] {
  return {
    id: `${userId}-${createdAt}`,
    userId,
    displayName,
    message,
    targetPlayerId,
    targetDisplayName: targetPlayerId ? 'User' : null,
    createdAt,
  };
}
