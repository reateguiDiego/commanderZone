import { FreshResource } from '../../../core/api/fresh-resource';
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
  roomName?: string;
  roomPlayerCount?: number;
  roomMaxPlayers?: number;
  parentFriendId?: string;
}

export const FRIEND_PRESENCE_LABELS: Record<FriendPresence, string> = {
  online: 'Online',
  in_game: 'Online in a game',
  offline: 'Offline',
};

@Injectable({ providedIn: 'root' })
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
  private readonly resources = {
    friends: new FreshResource(), incoming: new FreshResource(),
    outgoing: new FreshResource(), invites: new FreshResource(), summary: new FreshResource(),
  };
  readonly resourceStates = this.resources;
  private readonly summaryCounts = signal<{ onlineFriendsCount: number; incomingRequestsCount: number; roomInvitesCount: number } | null>(null);
  private searchVersion = 0;
  private userId: string | null | undefined;

  setUser(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    Object.values(this.resources).forEach((resource) => resource.reset());
    this.friendsState.set([]);
    this.incomingState.set([]);
    this.outgoingState.set([]);
    this.roomInvitesState.set([]);
    this.summaryCounts.set(null);
    this.loadingState.set(false);
    this.resetTransientState();
  }

  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');

  readonly searchResults = this.searchResultsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly searching = this.searchingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly onlineFriendsCount = computed(() =>
    this.summaryCounts()?.onlineFriendsCount ?? this.friendsState().filter((friendship) => {
      const presence = friendship.friend?.presence ?? 'offline';

      return presence === 'online' || presence === 'in_game';
    }).length,
  );

  readonly incomingRequestsCount = computed(() => this.summaryCounts()?.incomingRequestsCount ?? this.incomingState().length);
  readonly roomInvitesCount = computed(() => this.summaryCounts()?.roomInvitesCount ?? this.roomInvitesState().length);
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
          displayName: invite.sender.displayName,
          displayNameStyle: invite.sender.displayNameStyle,
          detail: invite.room.visibility === 'private' ? 'Sala privada' : 'Sala publica',
          avatar: invite.sender.avatar,
          roomId: invite.room.id,
          roomName: roomLabel,
          roomPlayerCount: invite.room.players.length,
          roomMaxPlayers: invite.room.maxPlayers,
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
          detail: invite.room.visibility === 'private' ? 'Sala privada' : 'Sala publica',
          avatar: invite.sender.avatar,
          roomId: invite.room.id,
          roomName: roomLabel,
          roomPlayerCount: invite.room.players.length,
          roomMaxPlayers: invite.room.maxPlayers,
        });
      }
    }

    return rows;
  });

  async ensureSummaryLoaded(): Promise<void> {
    this.errorState.set(null);
    try {
      await this.resources.summary.load(() => firstValueFrom(this.friendsApi.summary()), (value) => this.summaryCounts.set(value));
    } catch {
      this.errorState.set('Could not load friends.');
    }
  }

  private invalidate(...keys: ('friends' | 'incoming' | 'outgoing' | 'invites')[]): void {
    keys.forEach((key) => this.resources[key].invalidate());
    this.resources.summary.invalidate();
  }

  handleRoomInviteEvent(): void { this.invalidate('invites'); }

  async load(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    const results = await Promise.allSettled([
      this.resources.friends.load(() => firstValueFrom(this.friendsApi.list()), (r) => this.friendsState.set(r.data)),
      this.resources.incoming.load(() => firstValueFrom(this.friendsApi.incoming()), (r) => this.incomingState.set(r.data)),
      this.resources.outgoing.load(() => firstValueFrom(this.friendsApi.outgoing()), (r) => this.outgoingState.set(r.data)),
      this.resources.invites.load(() => firstValueFrom(this.roomsApi.incomingInvites()), (r) => this.roomInvitesState.set(r.data)),
    ]);
    if (results.some((r) => r.status === 'rejected')) this.errorState.set('Could not load friends.');
    this.loadingState.set(false);
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
      this.invalidate('outgoing');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  async acceptRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not accept friend request.', async () => {
      await firstValueFrom(this.friendsApi.accept(friendshipId));
      this.invalidate('friends', 'incoming');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  async declineRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not decline friend request.', async () => {
      await firstValueFrom(this.friendsApi.decline(friendshipId));
      this.invalidate('incoming');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  async acceptRoomInvite(inviteId: string): Promise<void> {
    await this.runAction('Could not accept room invite.', async () => {
      const response = await firstValueFrom(this.roomsApi.acceptInvite(inviteId));
      if (response.room) {
        await this.router.navigate(['/rooms', response.room.id, 'waiting']);
      }
      this.invalidate('invites');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    }, true);
  }

  async declineRoomInvite(inviteId: string): Promise<void> {
    await this.runAction('Could not decline room invite.', async () => {
      await firstValueFrom(this.roomsApi.declineInvite(inviteId));
      this.invalidate('invites');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  async cancelRequest(friendshipId: string): Promise<void> {
    await this.runAction('Could not cancel friend request.', async () => {
      await firstValueFrom(this.friendsApi.cancel(friendshipId));
      this.invalidate('outgoing');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  async removeFriend(userId: string): Promise<void> {
    await this.runAction('Could not remove friend.', async () => {
      await firstValueFrom(this.friendsApi.remove(userId));
      this.invalidate('friends');
      await Promise.all([this.load(), this.ensureSummaryLoaded()]);
    });
  }

  presenceLabel(presence: FriendPresence | undefined): string {
    return FRIEND_PRESENCE_LABELS[presence ?? 'offline'];
  }

  handleRealtimeEvent(event: FriendRealtimeEvent): void {
    if (event.type === 'friend.list.changed') {
      this.invalidate('friends', 'incoming', 'outgoing');
      return;
    }

    // A summary may be newer than the cached list: applying a presence delta
    // against that list could count the same transition twice.
    this.resources.summary.invalidate();
    this.resources.friends.invalidatePendingRead();
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

  ensureLoaded(): Promise<void> { return this.load(); }

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
