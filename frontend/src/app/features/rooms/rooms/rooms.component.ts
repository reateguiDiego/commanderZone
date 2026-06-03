import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
﻿import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { DeckFormat } from '../../../core/models/deck.model';
import { RoomInvite } from '../../../core/models/room-invite.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, CurrentRoomTurn, CurrentRoomViewerRole, Room } from '../../../core/models/room.model';
import { bestCardArtImage } from '../../../shared/utils/card-image';
import { MercureService } from '../../../core/realtime/mercure.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { RoomSetupModalComponent, RoomCreatePayload } from '../shared/room-setup-modal/room-setup-modal.component';
import { RoomBrowserComponent } from './components/room-browser/room-browser.component';
import { RoomCreatePanelComponent } from './components/room-create-panel/room-create-panel.component';
import { RoomInvitesPanelComponent } from './components/room-invites-panel/room-invites-panel.component';

const ROOM_LIST_POLL_INTERVAL_MS = 15000;
const ROOM_LIST_POLL_INTERVAL_WITH_CURRENT_ROOM_MS = ROOM_LIST_POLL_INTERVAL_MS * 4;

@Component({
  selector: 'app-rooms',
  imports: [RuntimeTranslatePipe, AppModalComponent, RoomBrowserComponent, RoomCreatePanelComponent, RoomInvitesPanelComponent, RoomSetupModalComponent],
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
  private routeToastHandle?: number;
  private roomSyncInFlight = false;
  private inviteRealtimeSubscription?: Subscription;
  readonly rooms = signal<Room[]>([]);
  readonly formats = signal<DeckFormat[]>([]);
  readonly incomingInvites = signal<RoomInvite[]>([]);
  readonly routeToast = signal<string | null>(null);
  readonly currentRoom = signal<CurrentRoomSummary | null>(null);
  readonly currentRoomPlayer = signal<CurrentRoomPlayerSummary | null>(null);
  readonly currentRoomTurn = signal<CurrentRoomTurn | null>(null);
  readonly currentRoomViewerRole = signal<CurrentRoomViewerRole | null>(null);
  readonly error = signal<string | null>(null);
  readonly deletingRoomId = signal<string | null>(null);
  readonly leavingRoomId = signal<string | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  readonly createDeckRequiredModalOpen = signal(false);
  readonly createRoomModalOpen = signal(false);
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
    this.showRouteToastFromNavigation();
    void this.loadRoomState(true).finally(() => this.scheduleRoomSync());
    void this.loadFormats(true);
    this.subscribeToInviteRealtime();
  }

  ngOnInit(): void {
    this.updatePageHeader();
  }

  ngOnDestroy(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearTimeout(this.roomSyncHandle);
    }
    if (this.routeToastHandle !== undefined) {
      window.clearTimeout(this.routeToastHandle);
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

  async loadCurrentRoom(skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.current(skipGlobalLoading));
      if (!response.room || !response.viewerRole) {
        this.clearCurrentRoom();
        if (response.room && this.roomId === response.room.id) {
          this.roomId = '';
        }

        return;
      }

      this.currentRoom.set(response.room);
      this.currentRoomPlayer.set(response.player);
      this.currentRoomTurn.set(response.turn ?? null);
      this.currentRoomViewerRole.set(response.viewerRole);
      if (response.room) {
        this.roomId = response.room.id;
      }
    } catch {
      this.error.set('Could not load your current room.');
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
        startingLife: payload.startingLife,
        timerMode: payload.timerMode,
        timerDurationSeconds: payload.timerDurationSeconds,
        format: payload.format,
      }));
      this.createRoomModalOpen.set(false);
      this.currentRoom.set(this.currentRoomSummaryFromRoom(response.room));
      this.currentRoomPlayer.set(this.currentRoomPlayerSummaryFromRoom(response.room));
      this.currentRoomTurn.set(null);
      this.currentRoomViewerRole.set(this.currentRoomViewerRoleFromRoom(response.room));
      this.roomId = response.room.id;
      this.scheduleRoomSync();
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

  openCreateRoomModal(): void {
    if (this.currentRoom()) {
      return;
    }

    this.createRoomModalOpen.set(true);
  }

  closeCreateRoomModal(): void {
    this.createRoomModalOpen.set(false);
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
      this.currentRoom.set(this.currentRoomSummaryFromRoom(response.room));
      this.currentRoomPlayer.set(this.currentRoomPlayerSummaryFromRoom(response.room));
      this.currentRoomTurn.set(null);
      this.currentRoomViewerRole.set(this.currentRoomViewerRoleFromRoom(response.room));
      this.roomId = response.room.id;
      this.scheduleRoomSync();
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
    const isCurrentRoom = this.isCurrentRoom(room);
    if (isCurrentRoom && room.gameId) {
      await this.router.navigate(['/games', room.gameId]);
      return;
    }
    if (isCurrentRoom) {
      await this.router.navigate(['/rooms', room.id, 'waiting']);
      return;
    }
    if (room.visibility === 'private' || room.gameId) {
      return;
    }
    if (this.currentRoom()) {
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
        this.clearCurrentRoom();
      }
      if (this.roomId === room.id) {
        this.roomId = '';
      }
      await this.loadRoomListState();
      this.scheduleRoomSync();
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
      const room = response.room ?? invite.room;
      this.currentRoom.set(this.currentRoomSummaryFromRoom(room));
      this.currentRoomPlayer.set(this.currentRoomPlayerSummaryFromRoom(room));
      this.currentRoomTurn.set(null);
      this.currentRoomViewerRole.set(this.currentRoomViewerRoleFromRoom(room));
      this.roomId = room.id;
      this.scheduleRoomSync();
      await this.navigateToWaitingRoom(room.id);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not accept room invite.'));
    }
  }

  async declineInvite(invite: RoomInvite): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.roomsApi.declineInvite(invite.id));
      await this.loadRoomListState();
    } catch {
      this.error.set('Could not decline room invite.');
    }
  }

  canDeleteRoom(room: Room): boolean {
    return this.isRoomWaiting(room) && room.owner.id === this.auth.user()?.id;
  }

  canLeaveRoom(room: Room): boolean {
    return this.isCurrentRoom(room);
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

  isCurrentUserInRoom(room: Room): boolean {
    const userId = this.auth.user()?.id;

    return !!userId && room.players.some((player) => player.user.id === userId);
  }

  isCurrentRoom(room: Room): boolean {
    return this.currentRoom()?.id === room.id;
  }

  async leaveRoom(room: Room): Promise<void> {
    if (!this.canLeaveRoom(room)) {
      return;
    }

    await this.leaveCurrentRoom(room.id);
  }

  async leaveCurrentRoom(roomId: string): Promise<void> {
    if (this.currentRoom()?.id !== roomId) {
      return;
    }

    this.error.set(null);
    this.leavingRoomId.set(roomId);
    try {
      await firstValueFrom(this.roomsApi.leave(roomId));
      if (this.currentRoom()?.id === roomId) {
        this.clearCurrentRoom();
      }
      if (this.roomId === roomId) {
        this.roomId = '';
      }
      await this.loadRoomState();
      this.scheduleRoomSync();
    } catch (error) {
      if (this.isStaleRoomMembershipError(error)) {
        if (this.currentRoom()?.id === roomId) {
          this.clearCurrentRoom();
        }
        if (this.roomId === roomId) {
          this.roomId = '';
        }
        await this.loadRoomState(true);
        this.scheduleRoomSync();

        return;
      }

      this.error.set(this.errorMessage(error, 'Could not leave room.'));
    } finally {
      this.leavingRoomId.set(null);
    }
  }

  private async loadRoomState(skipGlobalLoading = false): Promise<void> {
    if (!this.inviteRealtimeSubscription) {
      this.subscribeToInviteRealtime();
    }
    await Promise.all([
      this.loadCurrentRoom(skipGlobalLoading),
      this.loadRooms(skipGlobalLoading),
      this.loadInvites(skipGlobalLoading),
    ]);
  }

  private async loadRoomListState(skipGlobalLoading = false): Promise<void> {
    if (!this.inviteRealtimeSubscription) {
      this.subscribeToInviteRealtime();
    }
    await Promise.all([
      this.loadRooms(skipGlobalLoading),
      this.loadInvites(skipGlobalLoading),
    ]);
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
      this.scheduleRoomSync();
    }
  }

  private scheduleRoomSync(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearTimeout(this.roomSyncHandle);
    }

    const interval = this.currentRoom()
      ? ROOM_LIST_POLL_INTERVAL_WITH_CURRENT_ROOM_MS
      : ROOM_LIST_POLL_INTERVAL_MS;
    this.roomSyncHandle = window.setTimeout(() => {
      void this.syncRoomState();
    }, interval);
  }

  private showRouteToastFromNavigation(): void {
    const state = this.router.getCurrentNavigation()?.extras.state ?? (typeof history === 'undefined' ? null : history.state);
    const toast = typeof state?.['toast'] === 'string' ? state['toast'].trim() : '';
    if (!toast) {
      return;
    }

    this.routeToast.set(toast);
    this.routeToastHandle = window.setTimeout(() => {
      if (this.routeToast() === toast) {
        this.routeToast.set(null);
      }
      this.routeToastHandle = undefined;
    }, 3000);
  }

  private syncCurrentRoom(rooms: Room[]): void {
    const currentRoom = this.currentRoom();
    if (!currentRoom) {
      return;
    }

    const currentId = currentRoom.id;
    const room = rooms.find((candidate) => candidate.id === currentId) ?? null;
    if (room) {
      const viewerRole = this.currentRoomViewerRoleFromRoom(room);
      if (!viewerRole) {
        this.clearCurrentRoom();
        if (this.roomId === currentId) {
          this.roomId = '';
        }

        return;
      }

      this.currentRoom.set(this.currentRoomSummaryFromRoom(room));
      this.currentRoomViewerRole.set(viewerRole);
      const listedPlayer = this.currentRoomPlayerSummaryFromRoom(room);
      if (this.shouldUseListedCurrentPlayer(listedPlayer)) {
        this.currentRoomPlayer.set(listedPlayer);
      }
    }
  }

  private currentRoomSummaryFromRoom(room: Room): CurrentRoomSummary {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      visibility: room.visibility,
      format: room.format,
      maxPlayers: room.maxPlayers,
      playerCount: this.roomPlayerCount(room),
      gameId: room.gameId,
    };
  }

  private currentRoomPlayerSummaryFromRoom(room: Room): CurrentRoomPlayerSummary | null {
    const userId = this.auth.user()?.id;
    const player = room.players.find((candidate) => candidate.user.id === userId) ?? null;
    if (!player) {
      return null;
    }

    return {
      playerId: player.id,
      deckId: player.deckId,
      deckName: player.deck?.name ?? null,
      deckImageUrl: bestCardArtImage(player.deck?.commander),
    };
  }

  private shouldUseListedCurrentPlayer(listedPlayer: CurrentRoomPlayerSummary | null): boolean {
    if (!listedPlayer) {
      return false;
    }

    const currentPlayer = this.currentRoomPlayer();
    if (!currentPlayer) {
      return true;
    }

    return (!currentPlayer.deckName && !!listedPlayer.deckName)
      || (!currentPlayer.deckImageUrl && !!listedPlayer.deckImageUrl);
  }

  private currentRoomViewerRoleFromRoom(room: Room): CurrentRoomViewerRole | null {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return null;
    }

    const isOwner = room.owner.id === userId;
    const isPlayer = room.players.some((player) => player.user.id === userId);
    if (isOwner && isPlayer) {
      return 'owner_player';
    }
    if (isOwner) {
      return 'owner';
    }
    if (isPlayer) {
      return 'player';
    }

    return null;
  }

  private clearCurrentRoom(): void {
    this.currentRoom.set(null);
    this.currentRoomPlayer.set(null);
    this.currentRoomTurn.set(null);
    this.currentRoomViewerRole.set(null);
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

  private isStaleRoomMembershipError(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) {
      return false;
    }

    if (error.status === 404) {
      return true;
    }

    if (error.status !== 403) {
      return false;
    }

    return this.errorMessage(error, '').toLowerCase().includes('only room players can leave');
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
      title: 'rooms.header.title',
      stats: [
        {
          id: 'active-rooms',
          label: 'rooms.header.activeRooms',
          value: this.activeRoomsCount(),
          icon: 'building-2',
        },
        {
          id: 'open-rooms',
          label: 'rooms.header.openRooms',
          value: this.openTablesCount(),
          icon: 'door-open',
          tone: 'success',
        },
        {
          id: 'private-rooms',
          label: 'rooms.header.privateRooms',
          value: this.privateRoomsCount(),
          icon: 'lock',
          tone: 'private',
        },
        {
          id: 'started-games',
          label: 'rooms.header.startedGames',
          value: this.startedRoomsCount(),
          icon: 'swords',
          tone: 'started',
        },
      ],
    });
  }
}

