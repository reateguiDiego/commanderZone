import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { FriendPresence, FriendSearchResult, Friendship } from '../../../core/models/friendship.model';
import { RoomsApi } from '../../../core/api/rooms.api';
import { RoomInvite } from '../../../core/models/room-invite.model';

export type FriendListRowKind = 'incoming' | 'pending' | 'friend' | 'room-invite';

export interface FriendListRow {
  id: string;
  kind: FriendListRowKind;
  displayName: string;
  detail: string;
  presence?: FriendPresence;
  roomId?: string;
}

export const FRIEND_PRESENCE_LABELS: Record<FriendPresence, string> = {
  online: 'Online',
  in_game: 'Online in a game',
  offline: 'Offline',
};

@Injectable()
export class FriendsStore {
  private readonly friendsApi = inject(FriendsApi);
  private readonly roomsApi = inject(RoomsApi);
  private readonly router = inject(Router);

  private readonly friendsState = signal<Friendship[]>([]);
  private readonly incomingState = signal<Friendship[]>([]);
  private readonly outgoingState = signal<Friendship[]>([]);
  private readonly roomInvitesState = signal<RoomInvite[]>([]);
  private readonly searchResultsState = signal<FriendSearchResult[]>([]);
  private readonly loadingState = signal(false);
  private readonly searchingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private searchVersion = 0;

  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');

  readonly searchResults = this.searchResultsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly searching = this.searchingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly onlineFriendsCount = computed(() =>
    this.friendsState().filter((friendship) => {
      const presence = friendship.friend?.presence ?? 'offline';

      return presence === 'online' || presence === 'in_game';
    }).length,
  );

  readonly incomingRequestsCount = computed(() => this.incomingState().length);
  readonly roomInvitesCount = computed(() => this.roomInvitesState().length);
  readonly pendingNotificationsCount = computed(() => this.incomingRequestsCount() + this.roomInvitesCount());

  readonly rows = computed<FriendListRow[]>(() => [
    ...this.roomInvitesState().map((invite) => ({
      id: invite.id,
      kind: 'room-invite' as const,
      displayName: invite.sender.displayName,
      detail: `Te invita a sala ${invite.room.id.slice(0, 8)}`,
      roomId: invite.room.id,
    })),
    ...this.incomingState().map((friendship) => ({
      id: friendship.id,
      kind: 'incoming' as const,
      displayName: friendship.requester.displayName,
      detail: 'Friend request received',
    })),
    ...this.outgoingState().map((friendship) => ({
      id: friendship.id,
      kind: 'pending' as const,
      displayName: friendship.recipient.displayName,
      detail: 'Friend request pending',
    })),
    ...this.friendsState().map((friendship) => ({
      id: friendship.friend?.id ?? friendship.id,
      kind: 'friend' as const,
      displayName: friendship.friend?.displayName ?? 'Friend',
      detail: this.presenceLabel(friendship.friend?.presence),
      presence: friendship.friend?.presence,
    })),
  ]);

  async load(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const [friends, incoming, outgoing, roomInvites] = await Promise.all([
        firstValueFrom(this.friendsApi.list()),
        firstValueFrom(this.friendsApi.incoming()),
        firstValueFrom(this.friendsApi.outgoing()),
        firstValueFrom(this.roomsApi.incomingInvites()),
      ]);

      this.friendsState.set(friends.data);
      this.incomingState.set(incoming.data);
      this.outgoingState.set(outgoing.data);
      this.roomInvitesState.set(roomInvites.data);
    } catch {
      this.errorState.set('Could not load friends.');
    } finally {
      this.loadingState.set(false);
    }
  }

  async updateSearch(query: string): Promise<void> {
    this.searchQuery.set(query);
    const normalizedQuery = query.trim();
    const version = ++this.searchVersion;

    if (normalizedQuery.length < 2) {
      this.searchResultsState.set([]);
      this.searchingState.set(false);
      return;
    }

    this.searchingState.set(true);
    this.errorState.set(null);

    try {
      const response = await firstValueFrom(this.friendsApi.search(normalizedQuery));
      if (version === this.searchVersion) {
        this.searchResultsState.set(response.data);
      }
    } catch {
      if (version === this.searchVersion) {
        this.errorState.set('Could not search users.');
        this.searchResultsState.set([]);
      }
    } finally {
      if (version === this.searchVersion) {
        this.searchingState.set(false);
      }
    }
  }

  async sendRequest(userId: string): Promise<void> {
    await this.runAction('Could not send friend request.', async () => {
      await firstValueFrom(this.friendsApi.requestUser(userId));
      this.closeSearch();
      await this.load();
    });
  }

  async acceptRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not accept friend request.', async () => {
      await firstValueFrom(this.friendsApi.accept(friendshipId));
      await this.load();
    });
  }

  async declineRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not decline friend request.', async () => {
      await firstValueFrom(this.friendsApi.decline(friendshipId));
      await this.load();
    });
  }

  async acceptRoomInvite(inviteId: string): Promise<void> {
    await this.runAction('Could not accept room invite.', async () => {
      const response = await firstValueFrom(this.roomsApi.acceptInvite(inviteId));
      await this.load();
      if (response.room) {
        await this.router.navigate(['/table-assistant', response.room.id]);
      }
    });
  }

  async declineRoomInvite(inviteId: string): Promise<void> {
    await this.runAction('Could not decline room invite.', async () => {
      await firstValueFrom(this.roomsApi.declineInvite(inviteId));
      await this.load();
    });
  }

  async cancelRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not cancel friend request.', async () => {
      await firstValueFrom(this.friendsApi.cancel(friendshipId));
      await this.load();
    });
  }

  async removeFriend(userId: string): Promise<void> {
    await this.runAction('Could not remove friend.', async () => {
      await firstValueFrom(this.friendsApi.remove(userId));
      await this.load();
    });
  }

  presenceLabel(presence: FriendPresence | undefined): string {
    return FRIEND_PRESENCE_LABELS[presence ?? 'offline'];
  }

  toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
      return;
    }

    this.searchOpen.set(true);
  }

  resetTransientState(): void {
    this.closeSearch();
    this.errorState.set(null);
  }

  private closeSearch(): void {
    this.searchVersion++;
    this.searchOpen.set(false);
    this.searchQuery.set('');
    this.searchResultsState.set([]);
    this.searchingState.set(false);
  }

  private async runAction(errorMessage: string, action: () => Promise<void>): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      await action();
    } catch {
      this.errorState.set(errorMessage);
    } finally {
      this.loadingState.set(false);
    }
  }
}
