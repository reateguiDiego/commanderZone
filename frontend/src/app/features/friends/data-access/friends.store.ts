import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { FriendPresence, FriendRealtimeEvent, FriendSearchResult, Friendship } from '../../../core/models/friendship.model';
import { UserAvatar, UserDisplayNameStyle } from '../../../core/models/user.model';
import { RoomsApi } from '../../../core/api/rooms.api';
import { RoomInvite } from '../../../core/models/room-invite.model';

export type FriendListRowKind = 'incoming' | 'pending' | 'friend' | 'room-invite';

export interface FriendListRow {
  id: string;
  kind: FriendListRowKind;
  displayName: string;
  displayNameStyle?: UserDisplayNameStyle;
  detail: string;
  avatar?: UserAvatar;
  presence?: FriendPresence;
  roomId?: string;
  parentFriendId?: string;
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
  private loaded = false;
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

  readonly rows = computed<FriendListRow[]>(() => {
    const rows: FriendListRow[] = [];
    const invitesBySender = new Map<string, RoomInvite[]>();
    for (const invite of this.roomInvitesState()) {
      const senderInvites = invitesBySender.get(invite.sender.id);
      if (senderInvites) {
        senderInvites.push(invite);
      } else {
        invitesBySender.set(invite.sender.id, [invite]);
      }
    }

    rows.push(
      ...this.incomingState().map((friendship) => ({
        id: friendship.id,
        kind: 'incoming' as const,
        displayName: friendship.requester.displayName,
        displayNameStyle: friendship.requester.displayNameStyle,
        detail: 'Friend request received',
        avatar: friendship.requester.avatar,
      })),
    );
    rows.push(
      ...this.outgoingState().map((friendship) => ({
        id: friendship.id,
        kind: 'pending' as const,
        displayName: friendship.recipient.displayName,
        displayNameStyle: friendship.recipient.displayNameStyle,
        detail: 'Friend request pending',
        avatar: friendship.recipient.avatar,
      })),
    );

    for (const friendship of this.friendsState()) {
      const friendId = friendship.friend?.id ?? friendship.id;
      rows.push({
        id: friendId,
        kind: 'friend',
        displayName: friendship.friend?.displayName ?? 'Friend',
        displayNameStyle: friendship.friend?.displayNameStyle,
        detail: this.presenceLabel(friendship.friend?.presence),
        avatar: friendship.friend?.avatar,
        presence: friendship.friend?.presence,
      });

      const senderInvites = invitesBySender.get(friendId) ?? [];
      for (const invite of senderInvites) {
        const roomLabel = invite.room.name?.trim() || 'Sala Commander';
        rows.push({
          id: invite.id,
          kind: 'room-invite',
          displayName: roomLabel,
          detail: invite.room.visibility === 'private' ? 'Sala privada' : 'Sala publica',
          avatar: invite.sender.avatar,
          roomId: invite.room.id,
          parentFriendId: friendId,
        });
      }
      invitesBySender.delete(friendId);
    }

    for (const invites of invitesBySender.values()) {
      for (const invite of invites) {
        const roomLabel = invite.room.name?.trim() || 'Sala Commander';
        rows.push({
          id: invite.id,
          kind: 'room-invite',
          displayName: invite.sender.displayName,
          displayNameStyle: invite.sender.displayNameStyle,
          detail: `Invitacion a ${roomLabel}`,
          avatar: invite.sender.avatar,
          roomId: invite.room.id,
        });
      }
    }

    return rows;
  });

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
      this.loaded = true;
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
      if (response.room) {
        await this.router.navigate(['/rooms', response.room.id, 'waiting']);
      }
      await this.load();
    }, true);
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

  handleRealtimeEvent(event: FriendRealtimeEvent): void {
    if (event.type === 'friend.list.changed') {
      void this.load();
      return;
    }

    this.friendsState.update((friendships) =>
      friendships.map((friendship) => {
        if (friendship.friend?.id !== event.user.id) {
          return friendship;
        }

        return {
          ...friendship,
          friend: {
            ...friendship.friend,
            displayName: event.user.displayName,
            displayNameStyle: event.user.displayNameStyle,
            avatar: event.user.avatar,
            presence: event.user.presence,
          },
        };
      }),
    );
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await this.load();
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

  private async runAction(errorMessage: string, action: () => Promise<void>, useHttpMessage = false): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      await action();
    } catch (error) {
      this.errorState.set(useHttpMessage ? this.errorMessage(error, errorMessage) : errorMessage);
    } finally {
      this.loadingState.set(false);
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    const response = error.error as { error?: unknown; detail?: unknown } | null;
    if (response && typeof response === 'object') {
      if (typeof response.error === 'string' && response.error.trim() !== '') {
        return response.error;
      }
      if (typeof response.detail === 'string' && response.detail.trim() !== '') {
        return response.detail;
      }
    }

    return fallback;
  }
}
