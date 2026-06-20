import { importProvidersFrom } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Building2, DoorOpen, Globe, Library, Lock, LogOut, LucideAngularModule, Minus, Play, Plus, RefreshCcw, Search, Swords, Trash2, Users, X } from 'lucide-angular';
import { of, throwError } from 'rxjs';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { Card } from '../../../core/models/card.model';
import { Deck } from '../../../core/models/deck.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, Room, RoomPlayer } from '../../../core/models/room.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { RoomsComponent } from './rooms.component';

describe('RoomsComponent', () => {
  const roomsApi = {
    list: vi.fn(),
    current: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    joinByCode: vi.fn(),
    leave: vi.fn(),
    delete: vi.fn(),
    acceptInvite: vi.fn(),
    declineInvite: vi.fn(),
    incomingInvites: vi.fn(),
    invites: vi.fn(),
  };
  const deckFormatsApi = {
    list: vi.fn(),
  };

  beforeEach(async () => {
    roomsApi.list.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.current.mockReset().mockReturnValue(of({ room: null, player: null, turn: null, viewerRole: null }));
    roomsApi.create.mockReset();
    roomsApi.join.mockReset().mockReturnValue(of({ room: roomFixture() }));
    roomsApi.joinByCode.mockReset().mockReturnValue(of({ room: roomFixture() }));
    roomsApi.leave.mockReset().mockReturnValue(of({ left: true, roomDeleted: false }));
    roomsApi.delete.mockReset().mockReturnValue(of(undefined));
    roomsApi.acceptInvite.mockReset();
    roomsApi.declineInvite.mockReset().mockReturnValue(of({ invite: null }));
    roomsApi.incomingInvites.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.invites.mockReset().mockReturnValue(of({ data: [] }));
    deckFormatsApi.list.mockReset().mockReturnValue(of({ data: [{ id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true }] }));

    await TestBed.configureTestingModule({
      imports: [RoomsComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Building2, DoorOpen, Globe, Library, Lock, LogOut, Minus, Play, Plus, RefreshCcw, Search, Swords, Trash2, Users, X })),
        { provide: RoomsApi, useValue: roomsApi },
        { provide: DeckFormatsApi, useValue: deckFormatsApi },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) } },
      ],
    }).compileComponents();
  });

  it('renders the rooms page', () => {
    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();
    expect(header?.title).toBe('Rooms');
    expect(header?.stats?.map((stat) => stat.label)).toEqual([
      'Active rooms',
      'Open rooms',
      'Private rooms',
      'Started games',
    ]);
  });

  it('shows and clears route toast passed from navigation state', () => {
    vi.useFakeTimers();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: {
        state: {
          toast: 'Could not load game.',
        },
      },
    } as never);

    try {
      const fixture = TestBed.createComponent(RoomsComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Could not load game.');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Could not load game.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show technical snapshot wording when receiving the stale game route toast', () => {
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: {
        state: {
          toast: 'Could not load game.',
        },
      },
    } as never);

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Could not load game.');
    expect(fixture.nativeElement.textContent).not.toContain('snapshot');
  });

  it('deletes owned waiting rooms after modal confirmation', async () => {
    const room = roomFixture({ id: 'room-1', name: 'Mesa del Bosque', visibility: 'private' });
    roomsApi.list.mockReturnValue(of({ data: [room] }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.requestDeleteRoom(room);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Borrar sala');

    await fixture.componentInstance.confirmDeleteRoom();

    expect(roomsApi.delete).toHaveBeenCalledWith('room-1');
    expect(fixture.componentInstance.roomPendingDelete()).toBeNull();
  });

  it('shows the current room banner and removes that room from the list', async () => {
    const deck = deckFixture();
    const rooms = [
      roomFixture({ id: 'room-public', name: 'Alpha public', visibility: 'public' }),
      roomFixture({
        id: 'room-private-member',
        name: 'Zulu private mine',
        visibility: 'private',
        players: [roomPlayerFixture('user-1', 'Owner', { deckId: deck.id, deck })],
      }),
    ];
    roomsApi.list.mockReturnValue(of({ data: rooms }));
    roomsApi.current.mockReturnValue(of({ room: currentRoomSummaryFixture(rooms[1]), player: currentRoomPlayerSummaryFixture(rooms[1]), turn: { number: null }, viewerRole: 'owner_player' }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Current room');
    expect(fixture.nativeElement.textContent).toContain('Zulu private mine');
    expect(fixture.nativeElement.textContent).toContain('Smeagol test deck');
    expect(fixture.debugElement.query(By.css('.deck-art img')).nativeElement.getAttribute('src')).toBe('https://img.test/art.jpg');

    const roomNames = fixture.debugElement
      .queryAll(By.css('.room-col-main strong'))
      .map((element) => element.nativeElement.textContent.trim());

    expect(roomNames).toEqual(['Alpha public']);
  });

  it('disables list actions while the user already has a current room', async () => {
    const currentRoom = roomFixture({
      id: 'room-current',
      name: 'Current room',
      players: [roomPlayerFixture('user-1', 'Owner')],
    });
    const listedRoom = roomFixture({ id: 'room-public', name: 'Joinable room', visibility: 'public' });
    roomsApi.current.mockReturnValue(of({ room: currentRoomSummaryFixture(currentRoom), player: currentRoomPlayerSummaryFixture(currentRoom), turn: { number: null }, viewerRole: 'owner_player' }));
    roomsApi.list.mockReturnValue(of({ data: [currentRoom, listedRoom] }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const joinButton = fixture.debugElement.query(By.css('.room-list button.secondary-button'));
    expect(joinButton.nativeElement.disabled).toBe(true);
    expect(fixture.debugElement.query(By.css('.room-list .action-tooltip-anchor')).nativeElement.getAttribute('title'))
      .toBe('You are already in a room. Leave it before joining another one.');

    const createPanelTooltipAnchors = fixture.debugElement.queryAll(By.css('.rooms-create-panel .action-tooltip-anchor'));
    expect(createPanelTooltipAnchors.map((element) => element.nativeElement.getAttribute('title'))).toEqual([
      'You are already in a room. Leave it before joining another one.',
      'You are already in a room. Leave it before joining another one.',
    ]);
    expect(createPanelTooltipAnchors.every((element) => element.query(By.css('button')).nativeElement.disabled)).toBe(true);

    await fixture.componentInstance.openListedRoom(listedRoom);
    expect(roomsApi.join).not.toHaveBeenCalled();
  });

  it('creates rooms with the complete setup payload from the modal', async () => {
    const createdRoom = roomFixture({
      id: 'room-created',
      name: 'Mesa premium',
      visibility: 'private',
      maxPlayers: 5,
      startingLife: 45,
      timerMode: 'turn',
      timerDurationSeconds: 180,
      mulliganRule: 'GENEROUS',
      firstMulliganFree: false,
    });
    roomsApi.create.mockReturnValue(of({ room: createdRoom }));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.openCreateRoomModal();
    expect(fixture.componentInstance.createRoomModalOpen()).toBe(true);

    await fixture.componentInstance.createRoom({
      name: 'Mesa premium',
      format: 'commander',
      visibility: 'private',
      maxPlayers: 5,
      startingLife: 45,
      timerMode: 'turn',
      timerDurationSeconds: 180,
      mulliganRule: 'GENEROUS',
      firstMulliganFree: false,
    });

    expect(roomsApi.create).toHaveBeenCalledWith(undefined, 'private', {
      name: 'Mesa premium',
      maxPlayers: 5,
      startingLife: 45,
      timerMode: 'turn',
      timerDurationSeconds: 180,
      format: 'commander',
      mulliganRule: 'GENEROUS',
      firstMulliganFree: false,
    });
    expect(fixture.componentInstance.createRoomModalOpen()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/rooms/room-created/waiting');
  });

  it('opens a private listed room when the current user is already a player', async () => {
    const room = roomFixture({
      id: 'room-private-member',
      name: 'Private member room',
      visibility: 'private',
      players: [roomPlayerFixture('user-1', 'Owner')],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.currentRoom.set(currentRoomSummaryFixture(room));

    await fixture.componentInstance.openListedRoom(room);

    expect(navigate).toHaveBeenCalledWith(['/rooms', 'room-private-member', 'waiting']);
    expect(roomsApi.join).not.toHaveBeenCalled();
  });

  it('does not render actions for private rooms where the current user is not a player', async () => {
    const rooms = [
      roomFixture({
        id: 'room-private-waiting',
        name: 'Private waiting',
        owner: userFixture('user-2', 'Other'),
        visibility: 'private',
        players: [roomPlayerFixture('user-2', 'Other')],
      }),
      roomFixture({
        id: 'room-private-started',
        name: 'Private started',
        owner: userFixture('user-2', 'Other'),
        visibility: 'private',
        status: 'started',
        gameId: 'game-private',
        players: [roomPlayerFixture('user-2', 'Other')],
      }),
    ];
    roomsApi.list.mockReturnValue(of({ data: rooms }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const actions = fixture.debugElement
      .queryAll(By.css('.room-actions'))
      .map((element) => element.nativeElement.textContent.trim());

    expect(actions).toEqual(['', '']);
  });

  it('ignores private listed rooms where the current user is not a player', async () => {
    const room = roomFixture({
      id: 'room-private-started',
      name: 'Private started',
      owner: userFixture('user-2', 'Other'),
      visibility: 'private',
      status: 'started',
      gameId: 'game-private',
      players: [roomPlayerFixture('user-2', 'Other')],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.openListedRoom(room);

    expect(navigate).not.toHaveBeenCalled();
    expect(roomsApi.join).not.toHaveBeenCalled();
  });

  it('leaves the current room and refreshes room state', async () => {
    const room = roomFixture({
      id: 'room-current',
      name: 'Current room',
      players: [roomPlayerFixture('user-1', 'Owner')],
    });
    roomsApi.current.mockReturnValueOnce(of({ room: currentRoomSummaryFixture(room), player: currentRoomPlayerSummaryFixture(room), turn: { number: null }, viewerRole: 'owner_player' })).mockReturnValue(of({ room: null, player: null, turn: null, viewerRole: null }));
    roomsApi.list.mockReturnValue(of({ data: [room] }));
    roomsApi.leave.mockReturnValue(of({ left: true, roomDeleted: false }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.leaveRoom(room);

    expect(roomsApi.leave).toHaveBeenCalledWith('room-current');
    expect(fixture.componentInstance.currentRoom()).toBeNull();
  });

  it('clears stale current room state when the listed room no longer contains the current user', async () => {
    const staleRoom = roomFixture({
      id: 'room-current',
      name: 'Stale current room',
      owner: userFixture('user-2', 'Other owner'),
      players: [roomPlayerFixture('user-2', 'Other player')],
    });
    roomsApi.list.mockReturnValue(of({ data: [staleRoom] }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.currentRoom.set(currentRoomSummaryFixture({
      ...staleRoom,
      owner: userFixture('user-2', 'Other owner'),
      players: [roomPlayerFixture('user-1', 'Owner')],
    }));

    await fixture.componentInstance.loadRooms();

    expect(fixture.componentInstance.currentRoom()).toBeNull();
    expect(fixture.componentInstance.currentRoomPlayer()).toBeNull();
    expect(fixture.componentInstance.currentRoomTurn()).toBeNull();
  });

  it('does not keep a current room response without a viewer role', async () => {
    const staleRoom = roomFixture({
      id: 'room-current',
      name: 'Stale current room',
      players: [roomPlayerFixture('user-2', 'Other player')],
    });
    roomsApi.current.mockReturnValue(of({ room: currentRoomSummaryFixture(staleRoom), player: null, turn: { number: null }, viewerRole: null }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.currentRoom()).toBeNull();
    expect(fixture.componentInstance.currentRoomPlayer()).toBeNull();
    expect(fixture.componentInstance.currentRoomTurn()).toBeNull();
  });

  it('keeps an owner-only current room response', async () => {
    const ownedRoom = roomFixture({
      id: 'room-current',
      name: 'Owner only current room',
      players: [roomPlayerFixture('user-2', 'Other player')],
    });
    roomsApi.current.mockReturnValue(of({ room: currentRoomSummaryFixture(ownedRoom), player: null, turn: { number: null }, viewerRole: 'owner' }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.currentRoom()?.id).toBe('room-current');
    expect(fixture.componentInstance.currentRoomPlayer()).toBeNull();
    expect(fixture.componentInstance.currentRoomViewerRole()).toBe('owner');
  });

  it('does not infer current room state from the room input and listed rooms', async () => {
    const listedRoom = roomFixture({
      id: 'typed-room',
      name: 'Typed room only',
      players: [roomPlayerFixture('user-1', 'Owner')],
    });
    roomsApi.current.mockReturnValue(of({ room: null, player: null, turn: null, viewerRole: null }));
    roomsApi.list.mockReturnValue(of({ data: [listedRoom] }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.roomId = 'typed-room';
    await fixture.componentInstance.loadRooms();

    expect(fixture.componentInstance.currentRoom()).toBeNull();
    expect(fixture.componentInstance.currentRoomPlayer()).toBeNull();
    expect(fixture.componentInstance.currentRoomTurn()).toBeNull();
  });

  it('clears the current room when leave reports that membership is already gone', async () => {
    const room = roomFixture({
      id: 'room-current',
      name: 'Already left room',
      players: [roomPlayerFixture('user-1', 'Owner')],
    });
    roomsApi.leave.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 403,
      error: { error: 'Only room players can leave the room.' },
    })));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.currentRoom.set(currentRoomSummaryFixture(room));

    await fixture.componentInstance.leaveCurrentRoom(room.id);

    expect(fixture.componentInstance.currentRoom()).toBeNull();
    expect(fixture.componentInstance.currentRoomPlayer()).toBeNull();
    expect(fixture.componentInstance.currentRoomTurn()).toBeNull();
  });

  it('polls the active room list four times slower when the user has a current room', async () => {
    vi.useFakeTimers();
    try {
      const room = roomFixture({
        id: 'room-current',
        name: 'Current room',
        players: [roomPlayerFixture('user-1', 'Owner')],
      });
      roomsApi.current.mockReturnValue(of({ room: currentRoomSummaryFixture(room), player: currentRoomPlayerSummaryFixture(room), turn: { number: null }, viewerRole: 'owner_player' }));
      roomsApi.list.mockReturnValue(of({ data: [room] }));

      const fixture = TestBed.createComponent(RoomsComponent);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);

      expect(roomsApi.list).toHaveBeenCalledTimes(1);
      expect(roomsApi.current).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(15000);
      expect(roomsApi.list).toHaveBeenCalledTimes(1);
      expect(roomsApi.current).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(45000);
      expect(roomsApi.list).toHaveBeenCalledTimes(2);
      expect(roomsApi.current).toHaveBeenCalledTimes(1);

      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

function roomFixture(overrides: Partial<Room> = {}): Room {
  return {
    ...baseRoomFixture(),
    ...overrides,
  };
}

function currentRoomSummaryFixture(room: Room): CurrentRoomSummary {
  return {
    id: room.id,
    name: room.name,
    status: room.status,
    visibility: room.visibility,
    format: room.format,
    maxPlayers: room.maxPlayers,
    mulliganRule: room.mulliganRule,
    firstMulliganFree: room.firstMulliganFree,
    playerCount: room.players.length,
    gameId: room.gameId,
  };
}

function currentRoomPlayerSummaryFixture(room: Room): CurrentRoomPlayerSummary {
  const player = room.players.find((candidate) => candidate.user.id === 'user-1') ?? room.players[0];

  return {
    playerId: player?.id ?? 'player-user-1',
    deckId: player?.deckId ?? null,
    deckName: player?.deck?.name ?? null,
    deckImageUrl: player?.deck?.commanders?.[0]?.imageUris?.art_crop ?? null,
  };
}

function baseRoomFixture(): Room {
  return {
    id: 'room-1',
    name: 'Mesa del Bosque',
    owner: userFixture('user-1', 'Owner'),
    status: 'waiting' as const,
    visibility: 'public' as const,
    format: 'commander' as const,
    maxPlayers: 4,
    startingLife: 40,
    timerMode: 'none' as const,
    timerDurationSeconds: 300,
    mulliganRule: 'LONDON' as const,
    firstMulliganFree: true,
    players: [],
    gameId: null,
  };
}

function roomPlayerFixture(userId: string, displayName: string, overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    id: `player-${userId}`,
    user: userFixture(userId, displayName),
    deckId: null,
    turnRoll: null,
    ...overrides,
  };
}

function userFixture(id: string, displayName: string) {
  return { id, email: `${id}@test`, displayName, roles: [] };
}

function deckFixture(): Deck {
  return {
    id: 'deck-1',
    name: 'Smeagol test deck',
    format: 'commander',
    folderId: null,
    commanders: [cardFixture()],
  };
}

function cardFixture(): Card {
  return {
    id: 'card-1',
    scryfallId: 'scryfall-1',
    name: 'Smeagol',
    manaCost: '{B}{G}',
    typeLine: 'Legendary Creature',
    oracleText: null,
    colors: ['B', 'G'],
    colorIdentity: ['B', 'G'],
    legalities: {},
    imageUris: {
      art_crop: 'https://img.test/art.jpg',
      normal: 'https://img.test/normal.jpg',
    },
    layout: 'normal',
    commanderLegal: true,
    set: 'ltr',
    collectorNumber: '1',
  };
}
