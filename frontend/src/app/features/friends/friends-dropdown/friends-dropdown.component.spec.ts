import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Check, LucideAngularModule, Search, X } from 'lucide-angular';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { FriendsStore } from '../data-access/friends.store';
import { FriendsDropdownComponent } from './friends-dropdown.component';

describe('FriendsDropdownComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendsDropdownComponent],
      providers: [
        FriendsStore,
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Check, Search, X })),
        {
          provide: FriendsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            incoming: vi.fn().mockReturnValue(of({ data: [] })),
            outgoing: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: RoomsApi,
          useValue: {
            incomingInvites: vi.fn().mockReturnValue(of({ data: [] })),
            acceptInvite: vi.fn(),
            declineInvite: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the compact friend list', () => {
    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Friend list');
  });

  it('navigates to the invited room waiting page after accepting a room invite', async () => {
    const roomsApi = TestBed.inject(RoomsApi) as unknown as {
      acceptInvite: ReturnType<typeof vi.fn>;
      incomingInvites: ReturnType<typeof vi.fn>;
    };
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    roomsApi.acceptInvite.mockReturnValue(of({
      invite: {
        id: 'invite-1',
        status: 'accepted',
        room: room(),
        sender: { id: 'friend-1', displayName: 'Marta' },
        recipient: { id: 'user-1', displayName: 'Alberto' },
        createdAt: '',
        updatedAt: '',
      },
      room: room(),
    }));

    const store = TestBed.inject(FriendsStore);
    await store.acceptRoomInvite('invite-1');

    expect(roomsApi.acceptInvite).toHaveBeenCalledWith('invite-1');
    expect(navigateSpy).toHaveBeenCalledWith(['/rooms', 'room-1', 'waiting']);
  });
});

function room() {
  return {
    id: 'room-1',
    name: 'Dragon Crucible',
    owner: { id: 'friend-1', email: 'marta@test', displayName: 'Marta', roles: [] },
    status: 'waiting' as const,
    visibility: 'private' as const,
    format: 'commander' as const,
    maxPlayers: 4,
    startingLife: 40,
    timerMode: 'none',
    timerDurationSeconds: 300,
    players: [],
    gameId: null,
  };
}
