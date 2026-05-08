import { importProvidersFrom } from '@angular/core';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Copy, DoorOpen, Globe, Lock, LogOut, LucideAngularModule, Play, Plus, Send, ShieldCheck, Swords, Trash2, TriangleAlert, UserPlus, Users } from 'lucide-angular';
import { of } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommanderValidation, Deck } from '../../../core/models/deck.model';
import { Room } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { WaitingRoomComponent } from './waiting-room.component';

@Component({
  standalone: true,
  template: '',
})
class DummyRoomsPageComponent {}

describe('WaitingRoomComponent', () => {
  const roomsApi = {
    list: vi.fn(),
    show: vi.fn(),
    invites: vi.fn(),
    invite: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    kickPlayer: vi.fn(),
    rollTurn: vi.fn(),
    start: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const mercure = {
    roomInviteEvents: vi.fn(),
    waitingRoomEvents: vi.fn(),
  };

  beforeEach(async () => {
    roomsApi.list.mockReset().mockReturnValue(of({ data: [room()] }));
    roomsApi.show.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.invites.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.invite.mockReset().mockReturnValue(of({ invite: null }));
    roomsApi.join.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.leave.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.kickPlayer.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.rollTurn.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.start.mockReset().mockReturnValue(of({ room: room(), game: { id: 'game-1' } }));
    roomsApi.update.mockReset().mockReturnValue(of({ room: room() }));
    roomsApi.delete.mockReset().mockReturnValue(of(undefined));
    mercure.roomInviteEvents.mockReset().mockReturnValue(of());
    mercure.waitingRoomEvents.mockReset().mockReturnValue(of());

    await TestBed.configureTestingModule({
      imports: [WaitingRoomComponent],
      providers: [
        provideRouter([{ path: 'rooms', component: DummyRoomsPageComponent }]),
        importProvidersFrom(LucideAngularModule.pick({ Copy, DoorOpen, Globe, Lock, LogOut, Play, Plus, Send, ShieldCheck, Swords, Trash2, TriangleAlert, UserPlus, Users })),
        { provide: DecksApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [{ id: 'deck-1', name: 'Verdant Bloom', format: 'commander', folderId: null }] })), validateCommander: vi.fn().mockReturnValue(of({ valid: true })) } },
        { provide: FriendsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: RoomsApi, useValue: roomsApi },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) } },
        { provide: MercureService, useValue: mercure },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'room-1' }),
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the waiting room page shell', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Players');
    expect(fixture.nativeElement.querySelector('select[name="waitingDeckId"]')).not.toBeNull();
  });

  it('publishes the room name and invite action to the shared page header', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const header = TestBed.inject(PageHeaderStore).state();

    expect(header?.title).toBe('Dragon Crucible');
    expect(header?.actions?.[0]?.id).toBe('invite-friends');
    expect(header?.actions?.[0]?.label).toBe('Invite friends');
    expect(header?.actions?.map((action) => action.id)).toEqual(['invite-friends', 'copy-room-code', 'share-room-link']);
  });

  it('sorts deck choices by Commander validity and natural name order', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.decks.set([
      deck('invalid-1', 'Deck 1'),
      deck('valid-10', 'Deck 10'),
      deck('valid-2', 'Deck 2'),
      deck('invalid-2', 'Deck 2 invalid'),
    ]);
    component.deckValidations.set({
      'invalid-1': validation(false),
      'invalid-2': validation(false),
      'valid-10': validation(true),
      'valid-2': validation(true),
    });

    expect(component.sortedDecks().map((deckOption) => deckOption.name)).toEqual([
      'Deck 2',
      'Deck 10',
      'Deck 1',
      'Deck 2 invalid',
    ]);
  });

  it('shows a single-action modal instead of selecting an invalid deck', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.decks.set([deck('invalid-1', 'Broken Deck')]);
    component.deckValidations.set({ 'invalid-1': validation(false) });
    roomsApi.join.mockClear();

    await component.selectDeck('invalid-1');
    fixture.detectChanges();

    expect(component.invalidDeckSelection()?.name).toBe('Broken Deck');
    expect(roomsApi.join).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No puedes seleccionar Broken Deck');

    component.closeInvalidDeckModal();
    expect(component.invalidDeckSelection()).toBeNull();
  });

  it('opens and cancels the leave room confirmation', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const currentRoom = room();

    component.requestLeaveRoom(currentRoom);
    expect(component.roomPendingLeave()).toEqual(currentRoom);

    component.cancelLeaveRoom();
    expect(component.roomPendingLeave()).toBeNull();
  });

  it('keeps the deck selector available after selecting a deck', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.decks.set([deck('deck-1', 'Verdant Bloom')]);
    component.selectedDeckId = 'deck-1';
    component.currentRoom.set(room({
      players: [
        {
          id: 'player-1',
          user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
          deckId: 'deck-1',
          turnRoll: null,
        },
      ],
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Verdant Bloom');
    expect(fixture.nativeElement.querySelector('select[name="waitingDeckId"]')).not.toBeNull();
  });

  it('requires every room seat to be filled before starting', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const openRoom = room({
      maxPlayers: 3,
      players: [
        readyPlayer('player-1', 'user-1', 'Owner'),
        readyPlayer('player-2', 'user-2', 'Guest'),
      ],
    });
    const fullRoom = { ...openRoom, maxPlayers: 2 };

    expect(component.canStartRoom(openRoom)).toBe(false);
    expect(component.canStartRoom(fullRoom)).toBe(true);
  });

  it('lets the room owner update starting life', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    roomsApi.update.mockReturnValueOnce(of({ room: room({ startingLife: 45 }) }));

    await component.updateRoomStartingLife(45);

    expect(roomsApi.update).toHaveBeenCalledWith('room-1', { startingLife: 45 }, true);
    expect(component.currentRoom()?.startingLife).toBe(45);
  });

  it('lets the room owner update timer settings', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    roomsApi.update.mockReturnValueOnce(of({ room: room({ timerMode: 'turn', timerDurationSeconds: 300 }) }));

    await component.updateRoomTimerMode('turn');

    expect(roomsApi.update).toHaveBeenCalledWith('room-1', { timerMode: 'turn' }, true);
    expect(component.currentRoom()?.timerMode).toBe('turn');

    roomsApi.update.mockReturnValueOnce(of({ room: room({ timerMode: 'turn', timerDurationSeconds: 180 }) }));
    await component.updateRoomTimerDuration(180);

    expect(roomsApi.update).toHaveBeenCalledWith('room-1', { timerDurationSeconds: 180 }, true);
    expect(component.currentRoom()?.timerDurationSeconds).toBe(180);
  });

  it('lets the room owner confirm kicking another player', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const roomWithGuest = room({
      players: [
        {
          id: 'player-1',
          user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
          deckId: null,
          turnRoll: null,
        },
        {
          id: 'player-2',
          user: { id: 'user-2', email: 'guest@test', displayName: 'Guest', roles: [] },
          deckId: null,
          turnRoll: null,
        },
      ],
    });
    roomsApi.kickPlayer.mockReturnValueOnce(of({ room: room({ players: [roomWithGuest.players[0]] }) }));

    component.currentRoom.set(roomWithGuest);
    fixture.detectChanges();

    const guest = roomWithGuest.players[1];
    expect(component.canKickPlayer(roomWithGuest, roomWithGuest.players[0])).toBe(false);
    expect(component.canKickPlayer(roomWithGuest, guest)).toBe(true);

    component.requestKickPlayer(roomWithGuest, guest);
    expect(component.playerPendingKick()).toEqual(guest);

    await component.confirmKickPlayer();

    expect(roomsApi.kickPlayer).toHaveBeenCalledWith('room-1', 'player-2', true);
    expect(component.playerPendingKick()).toBeNull();
    expect(component.currentRoom()?.players).toHaveLength(1);
  });

  it('orders player seats by d20 once every player has rolled', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const rolledRoom = room({
      players: [
        readyPlayer('player-1', 'user-1', 'Owner', 8),
        readyPlayer('player-2', 'user-2', 'Guest 2', 20),
        readyPlayer('player-3', 'user-3', 'Guest 3', 12),
      ],
    });

    expect(component.turnOrderPlayers(rolledRoom).map((player) => player.user.displayName)).toEqual(['Guest 2', 'Guest 3', 'Owner']);
    expect(component.seatPlayer(rolledRoom, 0)?.user.displayName).toBe('Guest 2');
    expect(component.hasCompletedTurnOrder(rolledRoom)).toBe(true);
    expect(component.isOddLastSeat(rolledRoom, 2)).toBe(true);
    expect(component.shouldRenderOpenSeat(rolledRoom, 3)).toBe(false);
  });

  it('keeps turn labels hidden until every player has rolled', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const waitingRoom = room({
      players: [
        readyPlayer('player-1', 'user-1', 'Owner', 8),
        {
          id: 'player-2',
          user: { id: 'user-2', email: 'user-2@test', displayName: 'Guest 2', roles: [] },
          deckId: null,
          turnRoll: null,
        },
      ],
    });

    component.currentRoom.set(waitingRoom);
    fixture.detectChanges();

    expect(component.hasCompletedTurnOrder(waitingRoom)).toBe(false);
    expect(component.playerDeckName(waitingRoom.players[1])).toBe('Deck pending');
    expect(fixture.nativeElement.textContent).not.toContain('1. Owner');
    expect(fixture.nativeElement.textContent).toContain('Guest 2 - Deck pending');
  });

  it('closes the deck selector from outside clicks and supports random legal decks', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.decks.set([deck('invalid-1', 'Invalid'), deck('valid-1', 'Legal')]);
    component.deckValidations.set({
      'invalid-1': validation(false),
      'valid-1': validation(true),
    });

    component.toggleDeckSelector();
    fixture.detectChanges();
    expect(component.deckSelectorOpen()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(component.deckSelectorOpen()).toBe(false);

    await component.selectRandomLegalDeck();
    expect(component.selectedDeckId).toBe('valid-1');
    expect(component.roomLog()[component.roomLog().length - 1]?.label).toBe('Owner picked a random deck from 1 legal options: Legal.');
  });

  it('debounces starting life log entries across repeated updates', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(WaitingRoomComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      const component = fixture.componentInstance;
      roomsApi.update
        .mockReturnValueOnce(of({ room: room({ startingLife: 41 }) }))
        .mockReturnValueOnce(of({ room: room({ startingLife: 42 }) }));

      await component.updateRoomStartingLife(41);
      await component.updateRoomStartingLife(42);
      vi.advanceTimersByTime(850);

      expect(component.roomLog()[component.roomLog().length - 1]?.label).toBe('Starting life changed from 40 to 42 (+2 life).');
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks deck changes after the current player has rolled', async () => {
    const fixture = TestBed.createComponent(WaitingRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.decks.set([deck('deck-1', 'Locked Deck'), deck('deck-2', 'Other Legal')]);
    component.deckValidations.set({
      'deck-1': validation(true),
      'deck-2': validation(true),
    });
    component.selectedDeckId = 'deck-1';
    component.currentRoom.set(room({
      players: [
        {
          id: 'player-1',
          user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
          deckId: 'deck-1',
          turnRoll: 17,
        },
      ],
    }));
    roomsApi.join.mockClear();

    component.toggleDeckSelector();
    await component.selectDeck('deck-2');
    await component.selectRandomLegalDeck();

    expect(component.currentPlayerDeckLocked()).toBe(true);
    expect(component.deckSelectorOpen()).toBe(false);
    expect(component.selectedDeckId).toBe('deck-1');
    expect(roomsApi.join).not.toHaveBeenCalled();
  });
});

function room(overrides: Partial<Room> = {}): Room {
  return { ...baseRoom(), ...overrides };
}

function baseRoom(): Room {
  return {
    id: 'room-1',
    name: 'Dragon Crucible',
    owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
    status: 'waiting' as const,
    visibility: 'public' as const,
    format: 'commander' as const,
    maxPlayers: 4,
    startingLife: 40,
    timerMode: 'none',
    timerDurationSeconds: 300,
    players: [
      {
        id: 'player-1',
        user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
        deckId: null,
        turnRoll: null,
      },
    ],
    gameId: null,
  };
}

function readyPlayer(id: string, userId: string, displayName: string, turnRoll = 12) {
  return {
    id,
    user: { id: userId, email: `${userId}@test`, displayName, roles: [] },
    deckId: `deck-${userId}`,
    turnRoll,
  };
}

function deck(id: string, name: string): Deck {
  return {
    id,
    name,
    format: 'commander',
    folderId: null,
  };
}

function validation(valid: boolean): CommanderValidation {
  return {
    valid,
    format: 'commander',
    counts: {
      total: 100,
      commander: 1,
      main: 99,
      sideboard: 0,
      maybeboard: 0,
    },
    commander: {
      mode: valid ? 'single' : 'invalid',
      names: valid ? ['Commander'] : [],
      colorIdentity: valid ? ['G'] : [],
    },
    errors: valid ? [] : [{ code: 'invalid', title: 'Invalid', detail: 'Invalid deck', cards: [] }],
    warnings: [],
  };
}
