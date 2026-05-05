import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { Deck } from '../../../core/models/deck.model';
import { FriendUser } from '../../../core/models/friendship.model';
import { RoomInvite } from '../../../core/models/room-invite.model';
import { Room } from '../../../core/models/room.model';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent],
  templateUrl: './rooms.component.html',
  styleUrl: './rooms.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsComponent implements OnDestroy {
  private readonly decksApi = inject(DecksApi);
  private readonly friendsApi = inject(FriendsApi);
  private readonly roomsApi = inject(RoomsApi);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private roomSyncHandle?: number;
  private roomSyncInFlight = false;

  readonly decks = signal<Deck[]>([]);
  readonly friends = signal<FriendUser[]>([]);
  readonly rooms = signal<Room[]>([]);
  readonly incomingInvites = signal<RoomInvite[]>([]);
  readonly sentInvites = signal<RoomInvite[]>([]);
  readonly invitingUserIds = signal<string[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly error = signal<string | null>(null);
  readonly deletingRoomId = signal<string | null>(null);
  readonly archivingRoomId = signal<string | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  selectedDeckId = '';
  visibility: 'private' | 'public' = 'private';
  roomId = '';

  constructor() {
    void this.loadDecks();
    void this.loadFriends();
    void this.loadRoomState();
    this.roomSyncHandle = window.setInterval(() => {
      void this.syncRoomState();
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearInterval(this.roomSyncHandle);
    }
  }

  async loadDecks(): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
      if (!this.selectedDeckId && response.data.length > 0) {
        this.selectedDeckId = response.data[0].id;
      }
    } catch {
      this.error.set('Could not load decks for room selection.');
    }
  }

  async loadFriends(): Promise<void> {
    try {
      const response = await firstValueFrom(this.friendsApi.list());
      this.friends.set(response.data.map((friendship) => friendship.friend).filter((friend): friend is FriendUser => !!friend));
    } catch {
      this.error.set('Could not load friends.');
    }
  }

  async loadRooms(): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.list());
      this.rooms.set(response.data);
      this.syncCurrentRoom(response.data);
      await this.navigateToCurrentGameIfAvailable();
    } catch {
      this.error.set('Could not load rooms.');
    }
  }

  async loadInvites(): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.incomingInvites());
      this.incomingInvites.set(response.data);
    } catch {
      this.error.set('Could not load room invites.');
    }
  }

  async inviteFriend(userId: string): Promise<void> {
    const room = this.currentRoom();
    if (!room || !this.canInviteFriend(room, userId)) {
      return;
    }

    this.error.set(null);
    this.invitingUserIds.set([...this.invitingUserIds(), userId]);
    try {
      await firstValueFrom(this.roomsApi.invite(room.id, userId));
      await this.loadSentInvites(room.id);
    } catch {
      this.error.set('Could not send invite.');
    } finally {
      this.invitingUserIds.set(this.invitingUserIds().filter((id) => id !== userId));
    }
  }

  async createRoom(): Promise<void> {
    this.error.set(null);
    if (!this.selectedDeckId) {
      this.error.set('Select a deck before creating a room.');
      return;
    }

    try {
      const response = await firstValueFrom(this.roomsApi.create(this.optionalDeckId(), this.visibility));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
      await this.loadRoomState();
    } catch {
      this.error.set('Could not create room.');
    }
  }

  async joinRoom(): Promise<void> {
    const id = this.roomId.trim();
    if (!id) {
      return;
    }
    if (!this.selectedDeckId) {
      this.error.set('Select a deck before joining a room.');
      return;
    }

    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.join(id, this.optionalDeckId()));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
      await this.loadRoomState();
    } catch {
      this.error.set('Could not join room.');
    }
  }

  async joinListedRoom(id: string): Promise<void> {
    this.roomId = id;
    await this.joinRoom();
  }

  async openListedRoom(room: Room): Promise<void> {
    if (room.gameId) {
      await this.router.navigate(['/games', room.gameId]);
      return;
    }

    await this.joinListedRoom(room.id);
  }

  async leaveRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.leave(id));
      this.currentRoom.set(response.room.players.length > 0 ? response.room : null);
      await this.loadRoomState();
    } catch {
      this.error.set('Could not leave room.');
    }
  }

  requestDeleteRoom(room: Room): void {
    if (!this.canDeleteRoom(room)) {
      return;
    }

    this.roomPendingDelete.set(room);
  }

  cancelDeleteRoom(): void {
    this.roomPendingDelete.set(null);
  }

  async confirmDeleteRoom(): Promise<void> {
    const room = this.roomPendingDelete();
    if (!room || !this.canDeleteRoom(room)) {
      return;
    }

    this.error.set(null);
    this.deletingRoomId.set(room.id);
    try {
      await firstValueFrom(this.roomsApi.delete(room.id));
      if (this.currentRoom()?.id === room.id) {
        this.currentRoom.set(null);
      }
      if (this.roomId === room.id) {
        this.roomId = '';
      }
      await this.loadRoomState();
      this.roomPendingDelete.set(null);
    } catch {
      this.error.set('Could not delete room.');
    } finally {
      this.deletingRoomId.set(null);
    }
  }

  async acceptInvite(invite: RoomInvite): Promise<void> {
    if (!this.selectedDeckId) {
      this.error.set('Select a deck before accepting a room invite.');
      return;
    }

    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.acceptInvite(invite.id, this.selectedDeckId));
      this.currentRoom.set(response.room ?? invite.room);
      this.roomId = (response.room ?? invite.room).id;
      await this.loadRoomState();
    } catch {
      this.error.set('Could not accept room invite.');
    }
  }

  async declineInvite(invite: RoomInvite): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.roomsApi.declineInvite(invite.id));
      await this.loadRoomState();
    } catch {
      this.error.set('Could not decline room invite.');
    }
  }

  canDeleteRoom(room: Room): boolean {
    return room.status === 'waiting' && room.owner.id === this.auth.user()?.id;
  }

  canStartRoom(room: Room): boolean {
    return room.owner.id === this.auth.user()?.id && room.players.length >= 2 && room.players.every((player) => !!player.deckId);
  }

  canArchiveRoom(room: Room): boolean {
    return room.status !== 'archived' && room.owner.id === this.auth.user()?.id && (room.status === 'started' || !!room.gameId);
  }

  isInviting(userId: string): boolean {
    return this.invitingUserIds().includes(userId);
  }

  isFriendInCurrentRoom(userId: string): boolean {
    const room = this.currentRoom();
    return !!room?.players.some((player) => player.user.id === userId);
  }

  hasPendingInvite(userId: string): boolean {
    return this.sentInvites().some((invite) => invite.recipient.id === userId && invite.status === 'pending');
  }

  canInviteFriend(room: Room, userId: string): boolean {
    return room.status === 'waiting'
      && room.owner.id === this.auth.user()?.id
      && !this.isFriendInCurrentRoom(userId)
      && !this.hasPendingInvite(userId)
      && !this.isInviting(userId);
  }

  async archiveRoom(room: Room): Promise<void> {
    if (!this.canArchiveRoom(room)) {
      return;
    }

    this.error.set(null);
    this.archivingRoomId.set(room.id);
    try {
      await firstValueFrom(this.roomsApi.archive(room.id));
      if (this.currentRoom()?.id === room.id) {
        this.currentRoom.set(null);
      }
      await this.loadRoomState();
    } catch {
      this.error.set('Could not archive room. Only the owner can archive started games.');
    } finally {
      this.archivingRoomId.set(null);
    }
  }

  async startRoom(id: string): Promise<void> {
    this.error.set(null);
    const room = this.currentRoom();
    if (room?.players.some((player) => !player.deckId)) {
      this.error.set('Every player needs a deck before starting.');
      return;
    }

    try {
      const response = await firstValueFrom(this.roomsApi.start(id));
      this.currentRoom.set(response.room);
      await this.router.navigate(['/games', response.game.id]);
    } catch {
      this.error.set('Could not start game. The owner needs at least two players.');
    }
  }

  private optionalDeckId(): string | undefined {
    return this.selectedDeckId || undefined;
  }

  private async loadRoomState(): Promise<void> {
    await Promise.all([this.loadRooms(), this.loadInvites()]);
    const room = this.currentRoom();
    if (room && room.status === 'waiting' && room.owner.id === this.auth.user()?.id) {
      await this.loadSentInvites(room.id);
    } else {
      this.sentInvites.set([]);
    }
  }

  private async syncRoomState(): Promise<void> {
    if (this.roomSyncInFlight) {
      return;
    }

    this.roomSyncInFlight = true;
    try {
      await this.loadRoomState();
    } finally {
      this.roomSyncInFlight = false;
    }
  }

  private async loadSentInvites(roomId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.invites(roomId));
      this.sentInvites.set(response.data);
    } catch {
      this.sentInvites.set([]);
    }
  }

  private syncCurrentRoom(rooms: Room[]): void {
    const currentId = this.currentRoom()?.id ?? this.roomId.trim();
    if (!currentId) {
      return;
    }

    const room = rooms.find((candidate) => candidate.id === currentId) ?? null;
    this.currentRoom.set(room);
    if (!room && this.roomId === currentId) {
      this.roomId = '';
    }
  }

  private async navigateToCurrentGameIfAvailable(): Promise<void> {
    const room = this.currentRoom();
    if (room?.gameId) {
      try {
        await this.router.navigate(['/games', room.gameId]);
      } catch {
        // Keep room state, navigation can be retried manually.
      }
    }
  }

}
