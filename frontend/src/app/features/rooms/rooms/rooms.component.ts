import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { RoomInvite } from '../../../core/models/room-invite.model';
import { Room, RoomFormat } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, LucideAngularModule, AppModalComponent],
  templateUrl: './rooms.component.html',
  styleUrl: './rooms.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsComponent implements OnDestroy {
  private readonly roomsApi = inject(RoomsApi);
  private readonly mercure = inject(MercureService);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private roomSyncHandle?: number;
  private roomSyncInFlight = false;
  private inviteRealtimeSubscription?: Subscription;
  readonly rooms = signal<Room[]>([]);
  readonly incomingInvites = signal<RoomInvite[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly error = signal<string | null>(null);
  readonly deletingRoomId = signal<string | null>(null);
  readonly archivingRoomId = signal<string | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  readonly createDeckRequiredModalOpen = signal(false);
  readonly activeRoomsCount = computed(() => this.rooms().length);
  readonly openTablesCount = computed(() => this.rooms()
    .filter((room) => this.isRoomOpen(room))
    .length);
  readonly privateRoomsCount = computed(() => this.rooms()
    .filter((room) => room.visibility === 'private')
    .length);
  readonly startedRoomsCount = computed(() => this.rooms()
    .filter((room) => this.isRoomStarted(room))
    .length);
  readonly roomFormat: RoomFormat = 'commander';
  readonly maxPlayersOptions = [2, 3, 4, 5, 6] as const;
  readonly visibilityOptions: Array<'private' | 'public'> = ['public', 'private'];
  readonly createRoomForm = this.formBuilder.group({
    roomName: ['', [Validators.required, Validators.maxLength(120)]],
    players: [null as number | null, [Validators.required]],
    privacy: [null as 'private' | 'public' | null, [Validators.required]],
  });
  roomId = '';

  constructor() {
    void this.loadRoomState();
    this.subscribeToInviteRealtime();
    this.roomSyncHandle = window.setInterval(() => {
      void this.syncRoomState();
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearInterval(this.roomSyncHandle);
    }
    this.inviteRealtimeSubscription?.unsubscribe();
  }

  async loadRooms(skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.list('active', skipGlobalLoading));
      this.rooms.set(response.data);
      this.syncCurrentRoom(response.data);
    } catch {
      this.error.set('Could not load rooms.');
    }
  }

  async loadInvites(skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.incomingInvites(skipGlobalLoading));
      this.incomingInvites.set(response.data);
    } catch {
      this.error.set('Could not load room invites.');
    }
  }

  async createRoom(): Promise<void> {
    this.error.set(null);
    if (this.createRoomForm.invalid) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    const roomName = (this.createRoomForm.value.roomName ?? '').trim();
    const players = this.createRoomForm.value.players;
    const privacy = this.createRoomForm.value.privacy;
    if (!roomName || players === null || privacy === null) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    try {
      const response = await firstValueFrom(this.roomsApi.create(undefined, privacy, {
        name: roomName,
        maxPlayers: players,
        format: this.roomFormat,
      }));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
      await this.navigateToWaitingRoom(response.room.id);
    } catch (error) {
      const message = this.errorMessage(error, 'Could not create room.');
      if (this.isDeckRequiredError(message)) {
        this.createDeckRequiredModalOpen.set(true);
        return;
      }

      this.error.set(message);
    }
  }

  async joinRoom(): Promise<void> {
    const id = this.roomId.trim();
    if (!id) {
      return;
    }

    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.join(id));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
      await this.navigateToWaitingRoom(response.room.id);
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

  requestDeleteRoom(room: Room): void {
    if (!this.canDeleteRoom(room)) {
      return;
    }

    this.roomPendingDelete.set(room);
  }

  cancelDeleteRoom(): void {
    this.roomPendingDelete.set(null);
  }

  closeCreateDeckRequiredModal(): void {
    this.createDeckRequiredModalOpen.set(false);
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
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.acceptInvite(invite.id));
      this.currentRoom.set(response.room ?? invite.room);
      const room = response.room ?? invite.room;
      this.roomId = room.id;
      await this.navigateToWaitingRoom(room.id);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not accept room invite.'));
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
    return this.isRoomWaiting(room) && room.owner.id === this.auth.user()?.id;
  }

  canArchiveRoom(room: Room): boolean {
    return room.status !== 'archived' && room.owner.id === this.auth.user()?.id && (room.status === 'started' || !!room.gameId);
  }

  roomCapacity(room: Room): number {
    const maxPlayers = Number(room.maxPlayers);
    if (Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 6) {
      return maxPlayers;
    }

    return 4;
  }

  roomPlayerCount(room: Room): number {
    return Array.isArray(room.players) ? room.players.length : 0;
  }

  isRoomStarted(room: Room): boolean {
    return room.status === 'started' || !!room.gameId;
  }

  isRoomWaiting(room: Room): boolean {
    const status = String(room.status ?? '').toLowerCase();
    return status === 'waiting' || status === 'open';
  }

  isRoomFull(room: Room): boolean {
    return this.roomPlayerCount(room) >= this.roomCapacity(room);
  }

  isRoomOpen(room: Room): boolean {
    return this.isRoomWaiting(room) && !this.isRoomStarted(room) && !this.isRoomFull(room);
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

  private async loadRoomState(skipGlobalLoading = false): Promise<void> {
    if (!this.inviteRealtimeSubscription) {
      this.subscribeToInviteRealtime();
    }
    await Promise.all([this.loadRooms(skipGlobalLoading), this.loadInvites(skipGlobalLoading)]);
  }

  private async syncRoomState(): Promise<void> {
    if (this.roomSyncInFlight) {
      return;
    }

    this.roomSyncInFlight = true;
    try {
      await this.loadRoomState(true);
    } finally {
      this.roomSyncInFlight = false;
    }
  }

  private syncCurrentRoom(rooms: Room[]): void {
    const currentRoom = this.currentRoom();
    const currentId = currentRoom?.id ?? this.roomId.trim();
    if (!currentId) {
      return;
    }

    const room = rooms.find((candidate) => candidate.id === currentId) ?? null;
    this.currentRoom.set(room ?? currentRoom);
    if (!room && this.roomId === currentId) {
      this.roomId = '';
    }
  }

  private subscribeToInviteRealtime(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return;
    }

    this.inviteRealtimeSubscription?.unsubscribe();
    this.inviteRealtimeSubscription = this.mercure.roomInviteEvents(userId).subscribe({
      next: () => {
        void this.loadInvites(true);
        void this.loadRooms(true);
      },
      error: () => {
        // Polling remains as fallback.
      },
    });
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

  private isDeckRequiredError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('deck') || normalized.includes('mazo');
  }

  private async navigateToWaitingRoom(roomId: string): Promise<void> {
    const navigated = await this.router.navigateByUrl(`/rooms/${roomId}/waiting`);
    if (!navigated) {
      this.error.set('Room created, but could not open the waiting room.');
    }
  }
}
