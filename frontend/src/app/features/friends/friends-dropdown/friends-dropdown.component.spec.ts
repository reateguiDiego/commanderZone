import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Check, ChevronDown, ChevronUp, LucideAngularModule, Search, Trash2, UserPlus, X } from 'lucide-angular';
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
        importProvidersFrom(LucideAngularModule.pick({ Check, ChevronDown, ChevronUp, Search, Trash2, UserPlus, X })),
        {
          provide: FriendsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            incoming: vi.fn().mockReturnValue(of({ data: [] })),
            outgoing: vi.fn().mockReturnValue(of({ data: [] })),
            remove: vi.fn().mockReturnValue(of({})),
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

    expect(fixture.nativeElement.textContent).toContain('Friends');
    expect(fixture.nativeElement.querySelector('.search-tab-button')?.getAttribute('aria-label')).toBe('Search');
  });

  it('hides empty request and invitation tabs and does not render the view all friends action', () => {
    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    const tabLabels = Array.from(
      fixture.nativeElement.querySelectorAll('.tab-button') as NodeListOf<HTMLButtonElement>,
    ).map((button) => button.textContent?.trim() ?? '');

    expect(tabLabels.some((label) => label.includes('Requests'))).toBe(false);
    expect(tabLabels.some((label) => label.includes('Invitations'))).toBe(false);
    expect(fixture.nativeElement.querySelector('.view-all-friends')).toBeNull();
  });

  it('shows request and invitation tabs only when those rows exist', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      list: ReturnType<typeof vi.fn>;
      incoming: ReturnType<typeof vi.fn>;
      outgoing: ReturnType<typeof vi.fn>;
    };
    const roomsApi = TestBed.inject(RoomsApi) as unknown as {
      incomingInvites: ReturnType<typeof vi.fn>;
    };

    friendsApi.incoming.mockReturnValue(of({ data: [friendship()] }));
    roomsApi.incomingInvites.mockReturnValue(of({ data: [roomInvite()] }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    const tabLabels = Array.from(
      fixture.nativeElement.querySelectorAll('.tab-button') as NodeListOf<HTMLButtonElement>,
    ).map((button) => button.textContent?.trim() ?? '');

    expect(tabLabels.some((label) => label.includes('Requests'))).toBe(true);
    expect(tabLabels.some((label) => label.includes('Invitations'))).toBe(true);
    expect(tabLabels.findIndex((label) => label.includes('Invitations'))).toBeLessThan(
      tabLabels.findIndex((label) => label.includes('Requests')),
    );

    fixture.componentInstance.selectTab('invitations');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Dragon Crucible');
    expect(fixture.nativeElement.textContent).toContain('Marta');
    expect(fixture.nativeElement.textContent).toContain('2/4');
    expect(fixture.nativeElement.textContent).toContain('2 joined');
    expect(fixture.nativeElement.querySelector('.invitation-card .player-avatar-shell.size-xs')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.invitation-card .player-name-shell.size-xs')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.invitation-card .player-name-shell.align-left')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Hidden Player 1');
    expect(fixture.nativeElement.textContent).not.toContain('Hidden Player 2');
  });

  it('separates received and sent requests and only alerts for received requests', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      incoming: ReturnType<typeof vi.fn>;
      outgoing: ReturnType<typeof vi.fn>;
    };

    friendsApi.incoming.mockReturnValue(of({ data: [friendship()] }));
    friendsApi.outgoing.mockReturnValue(of({ data: [sentFriendship()] }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.componentInstance.selectTab('requests');
    fixture.detectChanges();

    expect(fixture.componentInstance.incomingRequestsOpen()).toBe(true);
    expect(fixture.componentInstance.sentRequestsOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Received (1)');
    expect(fixture.nativeElement.textContent).toContain('Sent (1)');
    expect(fixture.nativeElement.textContent).toContain('Marta');
    expect(fixture.nativeElement.textContent).toContain('Lucas');
    expect(fixture.nativeElement.querySelector('.tab-button.has-alert')).not.toBeNull();
  });

  it('does not animate the request tab when there are only sent requests', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      outgoing: ReturnType<typeof vi.fn>;
    };

    friendsApi.outgoing.mockReturnValue(of({ data: [sentFriendship()] }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    const requestTab = Array.from(
      fixture.nativeElement.querySelectorAll('.tab-button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Requests'));

    expect(requestTab).toBeDefined();
    expect(requestTab?.classList.contains('has-alert')).toBe(false);
    expect(requestTab?.querySelector('.tab-count')?.classList.contains('has-alert')).toBe(false);
  });

  it('only renders the player search input in the search tab', () => {
    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="friendSearch"]')).toBeNull();

    fixture.componentInstance.selectTab('search');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="friendSearch"]')).not.toBeNull();
  });

  it('collapses disconnected friends by default when more than ten friends are online', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    friendsApi.list.mockReturnValue(of({
      data: [
        ...Array.from({ length: 11 }, (_, index) => acceptedFriend(`Online ${index + 1}`, 'online')),
        acceptedFriend('Offline 1', 'offline'),
      ],
    }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.onlineOpen()).toBe(true);
    expect(fixture.componentInstance.disconnectedOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Disconnected (1)');
    expect(fixture.nativeElement.textContent).not.toContain('Offline 1');
  });

  it('keeps disconnected friends expanded when there are no online friends', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    friendsApi.list.mockReturnValue(of({ data: [acceptedFriend('Offline 1', 'offline')] }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.onlineOpen()).toBe(false);
    expect(fixture.componentInstance.disconnectedOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Online (0)');
    expect(fixture.nativeElement.textContent).toContain('Offline 1');
  });

  it('renders a hover delete action for friend rows and removes the selected friend', async () => {
    const friendsApi = TestBed.inject(FriendsApi) as unknown as {
      list: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    friendsApi.list.mockReturnValue(of({ data: [acceptedFriend('Offline 1', 'offline')] }));

    const store = TestBed.inject(FriendsStore);
    await store.load();

    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    const removeButton = fixture.nativeElement.querySelector('.friend-row .row-delete-action') as HTMLButtonElement | null;
    expect(removeButton).not.toBeNull();

    removeButton?.click();

    expect(friendsApi.remove).toHaveBeenCalledWith('friend-offline-1');
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
    players: [
      {
        id: 'room-player-1',
        user: { id: 'player-1', email: 'hidden1@test', displayName: 'Hidden Player 1', roles: [] },
        deckId: null,
        turnRoll: null,
      },
      {
        id: 'room-player-2',
        user: { id: 'player-2', email: 'hidden2@test', displayName: 'Hidden Player 2', roles: [] },
        deckId: null,
        turnRoll: null,
      },
    ],
    gameId: null,
  };
}

function friendship() {
  return {
    id: 'friendship-1',
    status: 'pending' as const,
    requester: { id: 'friend-1', displayName: 'Marta' },
    recipient: { id: 'user-1', displayName: 'Alberto' },
    createdAt: '',
    updatedAt: '',
  };
}

function sentFriendship() {
  return {
    id: 'friendship-2',
    status: 'pending' as const,
    requester: { id: 'user-1', displayName: 'Alberto' },
    recipient: { id: 'friend-2', displayName: 'Lucas' },
    createdAt: '',
    updatedAt: '',
  };
}

function acceptedFriend(displayName: string, presence: 'online' | 'in_game' | 'offline') {
  const id = displayName.toLowerCase().replace(/\s+/g, '-');

  return {
    id: `friendship-${id}`,
    status: 'accepted' as const,
    requester: { id: 'user-1', displayName: 'Alberto' },
    recipient: { id: `friend-${id}`, displayName },
    friend: { id: `friend-${id}`, displayName, presence },
    createdAt: '',
    updatedAt: '',
  };
}

function roomInvite() {
  return {
    id: 'invite-1',
    status: 'pending' as const,
    room: room(),
    sender: { id: 'friend-1', displayName: 'Marta' },
    recipient: { id: 'user-1', displayName: 'Alberto' },
    createdAt: '',
    updatedAt: '',
  };
}
