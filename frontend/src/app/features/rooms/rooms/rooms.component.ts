import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { DeckFormat } from '../../../core/models/deck.model';
import { RoomInvite } from '../../../core/models/room-invite.model';
import { Room } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { RoomBrowserComponent } from './components/room-browser/room-browser.component';
import { RoomCreatePanelComponent, RoomCreatePayload } from './components/room-create-panel/room-create-panel.component';
import { RoomInvitesPanelComponent } from './components/room-invites-panel/room-invites-panel.component';

const ROOM_LIST_POLL_INTERVAL_MS = 15000;

@Component({
  selector: 'app-rooms',
  imports: [RouterLink, LucideAngularModule, AppModalComponent, RoomBrowserComponent, RoomCreatePanelComponent, RoomInvitesPanelComponent],
  templateUrl: './rooms.component.html',
  styleUrl: './rooms.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsComponent implements OnInit, OnDestroy {
  private readonly roomsApi = inject(RoomsApi);
  private readonly deckFormatsApi = inject(DeckFormatsApi);
  private readonly mercure = inject(MercureService);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly pageHeader = inject(PageHeaderStore);
  private roomSyncHandle?: number;
  private roomSyncInFlight = false;
  private inviteRealtimeSubscription?: Subscription;
  readonly rooms = signal<Room[]>([]);
  readonly formats = signal<DeckFormat[]>([]);
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
  roomId = '';

  constructor() {
    void this.loadRoomState(true);
    void this.loadFormats(true);
    this.subscribeToInviteRealtime();
    this.roomSyncHandle = window.setInterval(() => {
      void this.syncRoomState();
    }, ROOM_LIST_POLL_INTERVAL_MS);
  }

  ngOnInit(): void {
    this.updatePageHeader();
  }

  ngOnDestroy(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearInterval(this.roomSyncHandle);
    }
    this.inviteRealtimeSubscription?.unsubscribe();
    this.pageHeader.clear();
  }

  async loadRooms(skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.list('active', skipGlobalLoading));
      this.rooms.set(response.data);
      this.syncCurrentRoom(response.data);
      this.updatePageHeader();
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

  async loadFormats(skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.deckFormatsApi.list(skipGlobalLoading));
      this.formats.set(response.data);
    } catch {
      this.error.set('Could not load room formats.');
    }
  }

  async createRoom(payload: RoomCreatePayload): Promise<void> {
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.roomsApi.create(undefined, payload.visibility, {
        name: payload.name,
        maxPlayers: payload.maxPlayers,
        format: payload.format,
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
    const roomReference = this.roomReferenceFromInput(this.roomId);
    if (!roomReference) {
      return;
    }

    this.error.set(null);
    try {
      const response = await firstValueFrom(roomReference.type === 'id'
        ? this.roomsApi.join(roomReference.value)
        : this.roomsApi.joinByCode(roomReference.value));
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
      await this.loadRooms(true);
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

  async joinRoomByCode(code: string): Promise<void> {
    this.roomId = code;
    await this.joinRoom();
  }

  private roomReferenceFromInput(value: string): { type: 'id' | 'code'; value: string } | null {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const roomRouteMatch = trimmedValue.match(/\/rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/waiting/i);
    if (roomRouteMatch?.[1]) {
      return { type: 'id', value: roomRouteMatch[1] };
    }

    const uuidMatch = trimmedValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    if (uuidMatch) {
      return { type: 'id', value: trimmedValue };
    }

    return { type: 'code', value: trimmedValue };
  }

  private updatePageHeader(): void {
    this.pageHeader.set({
      title: 'Rooms',
      stats: [
        {
          id: 'active-rooms',
          label: 'Active rooms',
          value: this.activeRoomsCount(),
          icon: 'building-2',
        },
        {
          id: 'open-rooms',
          label: 'Open rooms',
          value: this.openTablesCount(),
          icon: 'door-open',
          tone: 'success',
        },
        {
          id: 'private-rooms',
          label: 'Private rooms',
          value: this.privateRoomsCount(),
          icon: 'lock',
          tone: 'private',
        },
        {
          id: 'started-games',
          label: 'Started games',
          value: this.startedRoomsCount(),
          icon: 'swords',
          tone: 'started',
        },
      ],
    });
  }
}

