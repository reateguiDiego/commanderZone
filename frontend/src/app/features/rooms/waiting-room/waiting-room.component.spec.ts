import { importProvidersFrom } from '@angular/core';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Copy, DoorOpen, Globe, Lock, LogOut, LucideAngularModule, Play, Plus, Send, ShieldCheck, Swords, Trash2, UserPlus, Users } from 'lucide-angular';
import { of } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { Room } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
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
        importProvidersFrom(LucideAngularModule.pick({ Copy, DoorOpen, Globe, Lock, LogOut, Play, Plus, Send, ShieldCheck, Swords, Trash2, UserPlus, Users })),
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

    expect(fixture.nativeElement.textContent).toContain('Dragon Crucible');
    expect(fixture.nativeElement.textContent).toContain('Room code');
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

function readyPlayer(id: string, userId: string, displayName: string) {
  return {
    id,
    user: { id: userId, email: `${userId}@test`, displayName, roles: [] },
    deckId: `deck-${userId}`,
    turnRoll: 12,
  };
}
