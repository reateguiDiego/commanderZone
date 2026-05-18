import { importProvidersFrom } from '@angular/core';
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
  Radiation,
  Save,
  Search,
  SearchX,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Swords,
  TabletSmartphone,
  Tickets,
  Trash,
  Trash2,
  TriangleAlert,
  Upload,
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
import { GameTableChatLogState } from './state/game-table-chat-log.state';
import { RollModalComponent } from '../../../core/ui/roll-modal/roll-modal.component';

describe('GameTableComponent', () => {
  const gamesApi = {
    snapshot: vi.fn(),
    command: vi.fn(),
    rematchVote: vi.fn(),
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
  const routeParams: Record<string, string> = {};

  beforeEach(async () => {
    routeParams['id'] = '';
    gamesApi.snapshot.mockReset();
    gamesApi.command.mockReset();
    gamesApi.rematchVote.mockReset();
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
          Radiation,
          Save,
          Search,
          SearchX,
          Send,
          Settings,
          ShieldCheck,
          Sparkles,
          Swords,
          TabletSmartphone,
          Tickets,
          Trash,
          Trash2,
          TriangleAlert,
          Upload,
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

  it('asks for confirmation before conceding from the table menu', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    addOpponent(activeSnapshot);
    const concededSnapshot = snapshotWithStatus('conceded');
    addOpponent(concededSnapshot);
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gamesApi.command.mockReturnValue(of({ event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' }, snapshot: concededSnapshot }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'concedeGame' }, {} as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.tableExitAction()).toBe('concede');
    expect(fixture.componentInstance.tableExitMessage()).toContain('This cannot be undone.');
    expect(gamesApi.command).not.toHaveBeenCalled();

    await fixture.componentInstance.confirmTableExitAction();
    await fixture.whenStable();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(gamesApi.rematchVote).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.rematchPromptKind()).toBe('defeated');
    expect(fixture.componentInstance.rematchModalOpen()).toBe(true);
    expect(fixture.componentInstance.rematchVotePlayers().find((player) => player.playerId === 'user-1')?.defeated).toBe(true);
  });

  it('concedes before leaving the table from an active game', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    const concededSnapshot = snapshotWithStatus('conceded');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: concededSnapshot,
    }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.store.leaveTable();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
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
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-token', type: 'card.token.created', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: tokenSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleContextMenuAction({ type: 'createToken' }, { playerId: 'user-1' } as never);
    expect(fixture.componentInstance.tokenSearchPlayerId()).toBe('user-1');

    await fixture.componentInstance.createSelectedToken({
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
    });

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card.token.created',
      payload: expect.objectContaining({
        playerId: 'user-1',
        card: expect.objectContaining({
          scryfallId: 'token-1',
          name: 'Goblin Token',
          imageUris: { normal: 'https://cards.test/token-1.jpg' },
        }),
      }),
    }), 'game-1');
    expect(fixture.componentInstance.tokenSearchPlayerId()).toBeNull();
    expect(fixture.componentInstance.store.isBattlefieldEntrySettling('user-1', tokenCard)).toBe(true);
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

  it('records roll modal results in the game log through a game command', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const commandSnapshot = structuredClone(snapshot);
    commandSnapshot.eventLog = [gameLogEntry('event-dice', 'dice.rolled', 'ha tirado un d20, ha salido un 17.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
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

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dice.rolled',
      payload: {
        kind: 'd20',
        label: 'Dado de 20 caras',
        finalResult: '17',
      },
    }), 'game-1');
    expect(fixture.componentInstance.store.eventLog()[0]?.messagePrefix).toBe('ha tirado un d20, ha salido un 17.');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log"]')?.textContent)
      .toContain('ha tirado un d20, ha salido un 17.');
  });

  it('sends roll modal button results to the game log', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const commandSnapshot = structuredClone(snapshot);
    commandSnapshot.eventLog = [gameLogEntry('event-dice', 'dice.rolled', 'ha tirado un d20, ha salido un 17.')];
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
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

      await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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

  it('untaps the current player battlefield with the U shortcut', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    snapshot.players['user-1']!.zones.battlefield[0]!.tapped = true;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-untap', type: 'battlefield.untap_all', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'battlefield.untap_all',
      payload: { playerId: 'user-1' },
    }), 'game-1'));
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
    expect(chatButton.classList).toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-log-panel"]')?.classList)
      .toContain('has-unread-notifications');

    chatButton.click();
    fixture.detectChanges();

    expect(chatButton.classList).not.toContain('has-unread');
    expect(chatButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
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

    logButton.click();
    fixture.detectChanges();

    expect(logButton.classList).not.toContain('has-unread');
    expect(logButton.querySelector('lucide-icon[name="bell"]')).toBeNull();
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

  it('shuffles the library after closing a view all library modal', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    const libraryCard = snapshot.players['user-1'].zones.library[0]!;
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledTimes(2));
    expect(gamesApi.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'library.view',
      payload: { playerId: 'user-1' },
    }), 'game-1');
    expect(gamesApi.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'library.shuffle',
      payload: { playerId: 'user-1' },
    }), 'game-1');
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

    expect(gamesApi.command).not.toHaveBeenCalled();
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
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-turn', type: 'turn.changed', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot: nextSnapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.updateFollowActiveTurnPlayer(true);
    await fixture.componentInstance.store.passTurn();
    fixture.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.store.focusedPlayer()?.id).toBe('user-2'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="battlefield-zone"]')?.getAttribute('data-player-id'))
      .toBe('user-2');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="hand-zone"]')?.getAttribute('data-player-id'))
      .toBe('user-2');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="hand-count"]')?.textContent)
      .toContain('3 cards');
    expect(((fixture.nativeElement as HTMLElement).querySelector('[data-testid="game-screen"]') as HTMLElement).style.getPropertyValue('--game-wallpaper-image'))
      .toContain('/assets/images/play-mat/U_2.png');
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

  it('allows random order when multiple cards are placed into library', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const snapshot = snapshotWithStatus('active');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot } }));
    gamesApi.command.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    gamesApi.command.mockReturnValue(of({
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

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.zoneMoveAllLibraryDialog()).toEqual({
      playerId: 'user-1',
      fromZone: 'graveyard',
      count: 2,
    });

    fixture.componentInstance.zoneMoveAllLibraryRandomOrder.set(true);
    fixture.componentInstance.confirmZoneMoveAllToLibrary('bottom');

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    gamesApi.command.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    gamesApi.command.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    gamesApi.command.mockReturnValue(of({
      event: { id: 'event-give-hand', type: 'card.moved', payload: {}, createdBy: 'user-1', createdAt: '' },
      snapshot,
    }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = snapshot.players['user-1'].zones.hand[0]!;
    fixture.componentInstance.handleContextMenuAction({ type: 'giveToPlayer', targetPlayerId: 'user-2' }, {
      x: 0,
      y: 0,
      playerId: 'user-1',
      zone: 'hand',
      kind: 'card',
      card,
    });

    expect(gamesApi.command).not.toHaveBeenCalled();
    expect(fixture.componentInstance.handCardGiveDialog()).toEqual(expect.objectContaining({
      targetPlayerId: 'user-2',
      targetPlayerName: 'Opponent',
      cardName: 'Secret Card',
    }));

    fixture.componentInstance.confirmHandCardGive();

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledOnce());
    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    gamesApi.command.mockReturnValue(of({
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

    await vi.waitFor(() => expect(gamesApi.command).toHaveBeenCalledOnce());
    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(fixture.componentInstance.store.zoneModal()?.selectedCard?.name).toBe('Random Grave Card From Command Snapshot');
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

    expect(gamesApi.command).not.toHaveBeenCalled();
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

    expect(gamesApi.command).not.toHaveBeenCalled();
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
