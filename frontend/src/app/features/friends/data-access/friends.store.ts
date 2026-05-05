import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { DecksApi } from '../../../core/api/decks.api';
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
  private readonly decksApi = inject(DecksApi);
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
  private readonly deckCommanderValidityCache = new Map<string, boolean>();
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
        detail: 'Friend request received',
      })),
    );
    rows.push(
      ...this.outgoingState().map((friendship) => ({
        id: friendship.id,
        kind: 'pending' as const,
        displayName: friendship.recipient.displayName,
        detail: 'Friend request pending',
      })),
    );

    for (const friendship of this.friendsState()) {
      const friendId = friendship.friend?.id ?? friendship.id;
      rows.push({
        id: friendId,
        kind: 'friend',
        displayName: friendship.friend?.displayName ?? 'Friend',
        detail: this.presenceLabel(friendship.friend?.presence),
        presence: friendship.friend?.presence,
      });

      const senderInvites = invitesBySender.get(friendId) ?? [];
      for (const invite of senderInvites) {
        rows.push({
          id: invite.id,
          kind: 'room-invite',
          displayName: `Invitacion a sala ${invite.room.id.slice(0, 8)}`,
          detail: invite.room.visibility === 'private' ? 'Sala privada' : 'Sala publica',
          roomId: invite.room.id,
          parentFriendId: friendId,
        });
      }
      invitesBySender.delete(friendId);
    }

    for (const invites of invitesBySender.values()) {
      for (const invite of invites) {
        rows.push({
          id: invite.id,
          kind: 'room-invite',
          displayName: invite.sender.displayName,
          detail: `Invitacion a sala ${invite.room.id.slice(0, 8)}`,
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

      this.deckCommanderValidityCache.clear();
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
      const deckId = await this.resolveCommanderValidDeckId();
      if (!deckId) {
        return;
      }

      const response = await firstValueFrom(this.roomsApi.acceptInvite(inviteId, deckId));
      await this.load();
      if (response.room) {
        await this.router.navigate(['/rooms']);
      }
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

  private async resolveCommanderValidDeckId(): Promise<string | null> {
    const decks = await firstValueFrom(this.decksApi.list());
    for (const deck of decks.data) {
      if (await this.isCommanderValidDeck(deck.id)) {
        return deck.id;
      }
    }

    this.errorState.set('Necesitas un mazo Commander valido para aceptar la invitacion.');
    return null;
  }

  private async isCommanderValidDeck(deckId: string): Promise<boolean> {
    if (this.deckCommanderValidityCache.has(deckId)) {
      return this.deckCommanderValidityCache.get(deckId) === true;
    }

    try {
      const validation = await firstValueFrom(this.decksApi.validateCommander(deckId));
      const valid = validation.valid === true;
      this.deckCommanderValidityCache.set(deckId, valid);

      return valid;
    } catch {
      this.deckCommanderValidityCache.set(deckId, false);
      return false;
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
