import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommanderValidation, Deck } from '../../../core/models/deck.model';
import { FriendUser } from '../../../core/models/friendship.model';
import { RoomInvite } from '../../../core/models/room-invite.model';
import { Room, WaitingRoomEvent } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';

@Component({
  selector: 'app-waiting-room',
  imports: [FormsModule, LucideAngularModule, ManaSymbolsComponent, AppModalComponent],
  templateUrl: './waiting-room.component.html',
  styleUrl: './waiting-room.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomComponent implements OnDestroy {
  private readonly decksApi = inject(DecksApi);
  private readonly friendsApi = inject(FriendsApi);
  private readonly roomsApi = inject(RoomsApi);
  protected readonly auth = inject(AuthStore);
  private readonly mercure = inject(MercureService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private roomSyncHandle?: number;
  private roomSyncInFlight = false;
  private inviteRealtimeSubscription?: Subscription;
  private roomRealtimeSubscription?: Subscription;
  private readonly deckCommanderValidityCache = new Map<string, CommanderValidation>();
  private navigatingToGame = false;
  private deletingOnDestroy = false;

  readonly roomId = computed(() => this.route.snapshot.paramMap.get('id')?.trim() ?? '');
  readonly decks = signal<Deck[]>([]);
  readonly friends = signal<FriendUser[]>([]);
  readonly deckValidations = signal<Record<string, CommanderValidation>>({});
  readonly validatingDeckIds = signal<string[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly sentInvites = signal<RoomInvite[]>([]);
  readonly invitingUserIds = signal<string[]>([]);
  readonly error = signal<string | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  readonly deletingRoomId = signal<string | null>(null);
  readonly archivingRoomId = signal<string | null>(null);
  readonly updatingDeck = signal(false);
  readonly rollModalOpen = signal(false);
  readonly rollingTurn = signal(false);
  readonly updatingCapacity = signal(false);
  readonly inviteModalOpen = signal(false);
  readonly deckSelectorOpen = signal(false);
  readonly copiedTarget = signal<'code' | 'link' | null>(null);
  readonly seatIndexes = [0, 1, 2, 3, 4, 5] as const;
  readonly maxPlayersOptions = [2, 3, 4, 5, 6] as const;
  selectedDeckId = '';

  constructor() {
    void this.loadDecks();
    void this.loadFriends();
    void this.loadRoomState();
    this.subscribeToRoomRealtime();
    this.subscribeToInviteRealtime();
    this.roomSyncHandle = window.setInterval(() => {
      void this.syncRoomState();
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.roomSyncHandle !== undefined) {
      window.clearInterval(this.roomSyncHandle);
    }
    this.inviteRealtimeSubscription?.unsubscribe();
    this.roomRealtimeSubscription?.unsubscribe();
    void this.deleteWaitingRoomOnDestroy();
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

  openInviteModal(room: Room): void {
    if (!this.canOpenInviteModal(room)) {
      return;
    }

    this.inviteModalOpen.set(true);
    void this.loadFriends();
    void this.loadSentInvites(room.id, true);
  }

  closeInviteModal(): void {
    this.inviteModalOpen.set(false);
  }

  async updateDeckSelection(): Promise<void> {
    const room = this.currentRoom();
    if (!room || this.selectedDeckId.trim() === '') {
      return;
    }

    this.error.set(null);
    this.updatingDeck.set(true);
    try {
      if (!(await this.isCommanderValidDeck(this.selectedDeckId))) {
        this.error.set('Selected deck is not Commander-valid.');
        return;
      }

      const response = await firstValueFrom(this.roomsApi.join(room.id, this.selectedDeckId));
      this.setCurrentRoom(response.room);
      this.syncSelectedDeckFromRoom(response.room);
      await this.loadRoomState(true);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update deck for this room.'));
    } finally {
      this.updatingDeck.set(false);
    }
  }

  async leaveRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.roomsApi.leave(id));
      await this.router.navigate(['/rooms']);
    } catch {
      this.error.set('Could not leave room.');
    }
  }

  async startRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.start(id));
      this.setCurrentRoom(response.room);
      this.navigatingToGame = true;
      await this.router.navigate(['/games', response.game.id]);
    } catch (error) {
      this.navigatingToGame = false;
      this.error.set(this.errorMessage(error, 'Could not start game.'));
      await this.loadRoomState(true);
    }
  }

  openRollModal(): void {
    if (!this.currentPlayerCanRoll()) {
      return;
    }

    this.rollModalOpen.set(true);
  }

  closeRollModal(): void {
    this.rollModalOpen.set(false);
  }

  async rollTurnOrder(): Promise<void> {
    const room = this.currentRoom();
    if (!room || !this.currentPlayerCanRoll()) {
      return;
    }

    this.error.set(null);
    this.rollingTurn.set(true);
    try {
      const response = await firstValueFrom(this.roomsApi.rollTurn(room.id));
      this.setCurrentRoom(response.room);
      this.syncSelectedDeckFromRoom(response.room);
      this.rollModalOpen.set(false);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not roll turn order.'));
    } finally {
      this.rollingTurn.set(false);
    }
  }

  async updateRoomCapacity(maxPlayers: number): Promise<void> {
    const room = this.currentRoom();
    if (!room || room.maxPlayers === maxPlayers || !this.canEditRoom(room)) {
      return;
    }

    this.error.set(null);
    this.updatingCapacity.set(true);
    try {
      const response = await firstValueFrom(this.roomsApi.update(room.id, { maxPlayers }));
      this.setCurrentRoom(response.room);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update room size.'));
    } finally {
      this.updatingCapacity.set(false);
    }
  }

  toggleDeckSelector(): void {
    this.deckSelectorOpen.set(!this.deckSelectorOpen());
  }

  closeDeckSelector(): void {
    this.deckSelectorOpen.set(false);
  }

  selectDeck(deckId: string): void {
    this.selectedDeckId = deckId;
    this.deckSelectorOpen.set(false);
  }

  async copyRoomCode(room: Room): Promise<void> {
    await this.copyText(this.roomCode(room), 'code');
  }

  async copyRoomLink(room: Room): Promise<void> {
    await this.copyText(`${window.location.origin}/rooms/${room.id}/waiting`, 'link');
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
      this.roomPendingDelete.set(null);
      await this.router.navigate(['/rooms']);
    } catch {
      this.error.set('Could not delete room.');
    } finally {
      this.deletingRoomId.set(null);
    }
  }

  async archiveRoom(room: Room): Promise<void> {
    if (!this.canArchiveRoom(room)) {
      return;
    }

    this.error.set(null);
    this.archivingRoomId.set(room.id);
    try {
      await firstValueFrom(this.roomsApi.archive(room.id));
      await this.router.navigate(['/rooms']);
    } catch {
      this.error.set('Could not archive room. Only the owner can archive started games.');
    } finally {
      this.archivingRoomId.set(null);
    }
  }

  canDeleteRoom(room: Room): boolean {
    return room.status === 'waiting' && room.owner.id === this.auth.user()?.id;
  }

  canEditRoom(room: Room): boolean {
    return room.status === 'waiting' && room.owner.id === this.auth.user()?.id;
  }

  canOpenInviteModal(room: Room): boolean {
    return this.canShowInviteButton(room) && !this.isRoomFull(room);
  }

  canShowInviteButton(room: Room): boolean {
    return room.status === 'waiting' && this.isCurrentUserInRoom(room);
  }

  isRoomFull(room: Room): boolean {
    return room.players.length >= this.roomCapacity(room);
  }

  canStartRoom(room: Room): boolean {
    return room.owner.id === this.auth.user()?.id
      && room.players.length === this.roomCapacity(room)
      && room.players.length >= 2
      && room.players.every((player) => this.isPlayerReady(player));
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
      && this.isCurrentUserInRoom(room)
      && room.players.length < room.maxPlayers
      && !this.isFriendInCurrentRoom(userId)
      && !this.hasPendingInvite(userId)
      && !this.isInviting(userId);
  }

  roomCode(room: Room): string {
    const compactId = room.id.replace(/-/g, '').slice(-9).toUpperCase();
    return `CZ-${compactId.slice(0, 3)}-${compactId.slice(3, 6)}-${compactId.slice(6, 9)}`;
  }

  roomCapacity(room: Room): number {
    const maxPlayers = Number(room.maxPlayers);
    if (Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 6) {
      return maxPlayers;
    }

    return 4;
  }

  readyPlayersCount(room: Room): number {
    return room.players.filter((player) => this.isPlayerReady(player)).length;
  }

  deckName(deckId: string | null): string {
    if (!deckId) {
      return 'No deck selected';
    }

    return this.decks().find((deck) => deck.id === deckId)?.name ?? 'Selected deck';
  }

  selectedDeckName(): string {
    return this.deckName(this.selectedDeckId || null);
  }

  selectedDeck(): Deck | null {
    return this.decks().find((deck) => deck.id === this.selectedDeckId) ?? null;
  }

  isDeckInvalid(deckId: string): boolean {
    const validation = this.deckValidations()[deckId];

    return validation ? !validation.valid : false;
  }

  isDeckValidationPending(deckId: string): boolean {
    return this.validatingDeckIds().includes(deckId);
  }

  deckColorIdentity(deckId: string): readonly string[] {
    if (this.isDeckInvalid(deckId)) {
      return [];
    }

    return this.deckValidations()[deckId]?.commander?.colorIdentity ?? [];
  }

  deckColorFallback(deckId: string): string {
    return this.isDeckInvalid(deckId) ? '' : 'C';
  }

  isCurrentUser(playerUserId: string): boolean {
    return playerUserId === this.auth.user()?.id;
  }

  isCurrentUserInRoom(room: Room): boolean {
    const userId = this.auth.user()?.id;

    return !!userId && room.players.some((player) => player.user.id === userId);
  }

  isHost(room: Room, playerUserId: string): boolean {
    return room.owner.id === playerUserId;
  }

  isPrivateRoom(room: Room): boolean {
    return room.visibility === 'private';
  }

  isPlayerReady(player: Room['players'][number]): boolean {
    return !!player.deckId && player.turnRoll !== null;
  }

  currentPlayerCanRoll(): boolean {
    const player = this.currentPlayer();
    return !!player?.deckId && player.turnRoll === null && !this.rollingTurn();
  }

  currentPlayer(): Room['players'][number] | null {
    const userId = this.auth.user()?.id;
    return this.currentRoom()?.players.find((player) => player.user.id === userId) ?? null;
  }

  currentPlayerRoll(): number | null {
    return this.currentPlayer()?.turnRoll ?? null;
  }

  openSlots(room: Room): number[] {
    return Array.from({ length: Math.max(0, this.roomCapacity(room) - room.players.length) }, (_, index) => index);
  }

  private async loadDecks(): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.deckCommanderValidityCache.clear();
      this.deckValidations.set({});
      this.decks.set(response.data);
      void this.loadDeckValidations(response.data);
    } catch {
      this.error.set('Could not load decks.');
    }
  }

  private async copyText(text: string, target: 'code' | 'link'): Promise<void> {
    try {
      await navigator.clipboard?.writeText(text);
      this.copiedTarget.set(target);
      window.setTimeout(() => this.copiedTarget.set(null), 1600);
    } catch {
      this.error.set('Could not copy to clipboard.');
    }
  }

  private async loadFriends(): Promise<void> {
    try {
      const response = await firstValueFrom(this.friendsApi.list());
      this.friends.set(response.data.map((friendship) => friendship.friend).filter((friend): friend is FriendUser => !!friend));
    } catch {
      this.error.set('Could not load friends.');
    }
  }

  private async loadRoomState(skipGlobalLoading = false): Promise<void> {
    const waitingRoomId = this.roomId();
    if (!waitingRoomId) {
      await this.router.navigate(['/rooms']);
      return;
    }

    try {
      const response = await firstValueFrom(this.roomsApi.show(waitingRoomId, skipGlobalLoading));
      const room = response.room;
      this.setCurrentRoom(room);

      if (!room) {
        await this.router.navigate(['/rooms']);
        return;
      }

      this.syncSelectedDeckFromRoom(room);

      if (room.gameId) {
        this.navigatingToGame = true;
        await this.router.navigate(['/games', room.gameId]);
        return;
      }

      if (room.status === 'waiting' && this.isCurrentUserInRoom(room)) {
        await this.loadSentInvites(room.id, skipGlobalLoading);
      } else {
        this.sentInvites.set([]);
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && (error.status === 403 || error.status === 404)) {
        this.deletingOnDestroy = true;
        await this.router.navigate(['/rooms']);
        return;
      }

      this.error.set('Could not load room state.');
    }
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

  private async loadSentInvites(roomId: string, skipGlobalLoading = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.invites(roomId, skipGlobalLoading));
      this.sentInvites.set(response.data);
    } catch {
      this.sentInvites.set([]);
    }
  }

  private syncSelectedDeckFromRoom(room: Room): void {
    const userId = this.auth.user()?.id;
    const currentPlayer = room.players.find((player) => player.user.id === userId);
    if (currentPlayer?.deckId) {
      this.selectedDeckId = currentPlayer.deckId;
    }
  }

  private setCurrentRoom(room: Room | null): void {
    const previousOrder = this.currentRoom()?.players.map((player) => player.id).join('|') ?? '';
    const nextOrder = room?.players.map((player) => player.id).join('|') ?? '';
    const shouldAnimateOrder = previousOrder !== '' && nextOrder !== '' && previousOrder !== nextOrder;
    const transitionDocument = document as Document & {
      startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
    };

    if (!shouldAnimateOrder || typeof transitionDocument.startViewTransition !== 'function') {
      this.currentRoom.set(room);
      return;
    }

    document.documentElement.classList.add('waiting-room-transition');
    const transition = transitionDocument.startViewTransition(() => {
      this.currentRoom.set(room);
    });
    void transition.finished
      .catch(() => {})
      .finally(() => {
        document.documentElement.classList.remove('waiting-room-transition');
      });
  }

  private subscribeToInviteRealtime(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return;
    }

    this.inviteRealtimeSubscription?.unsubscribe();
    this.inviteRealtimeSubscription = this.mercure.roomInviteEvents(userId).subscribe({
      next: () => {
        void this.loadRoomState(true);
      },
      error: () => {
        // Polling remains as fallback.
      },
    });
  }

  private subscribeToRoomRealtime(): void {
    const waitingRoomId = this.roomId();
    if (!waitingRoomId) {
      return;
    }

    this.roomRealtimeSubscription?.unsubscribe();
    this.roomRealtimeSubscription = this.mercure.waitingRoomEvents(waitingRoomId).subscribe({
      next: (event) => {
        void this.handleWaitingRoomEvent(event);
      },
      error: () => {
        // Polling remains as fallback.
      },
    });
  }

  private async handleWaitingRoomEvent(event: WaitingRoomEvent): Promise<void> {
    if (event.roomId !== this.roomId()) {
      return;
    }

    if (event.type === 'room.deleted') {
      this.deletingOnDestroy = true;
      this.setCurrentRoom(null);
      await this.router.navigate(['/rooms']);
      return;
    }

    if (!event.room) {
      await this.loadRoomState(true);
      return;
    }

    this.setCurrentRoom(event.room);
    this.syncSelectedDeckFromRoom(event.room);
    if (event.room.status === 'waiting' && this.isCurrentUserInRoom(event.room)) {
      await this.loadSentInvites(event.room.id, true);
    }
    if (event.room.gameId) {
      this.navigatingToGame = true;
      await this.router.navigate(['/games', event.room.gameId]);
    }
  }

  private async isCommanderValidDeck(deckId: string): Promise<boolean> {
    if (this.deckCommanderValidityCache.has(deckId)) {
      return this.deckCommanderValidityCache.get(deckId)?.valid === true;
    }

    try {
      const validation = await firstValueFrom(this.decksApi.validateCommander(deckId));
      this.deckCommanderValidityCache.set(deckId, validation);
      this.deckValidations.update((validations) => ({ ...validations, [deckId]: validation }));

      return validation.valid === true;
    } catch {
      return false;
    }
  }

  private async loadDeckValidations(decks: Deck[]): Promise<void> {
    this.validatingDeckIds.set(decks.map((deck) => deck.id));
    await Promise.all(decks.map(async (deck) => {
      try {
        const validation = await firstValueFrom(this.decksApi.validateCommander(deck.id));
        this.deckCommanderValidityCache.set(deck.id, validation);
        this.deckValidations.update((validations) => ({ ...validations, [deck.id]: validation }));
      } catch {
        // Validation failures are surfaced when the user tries to confirm the deck.
      } finally {
        this.validatingDeckIds.update((ids) => ids.filter((id) => id !== deck.id));
      }
    }));
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

  private async deleteWaitingRoomOnDestroy(): Promise<void> {
    const room = this.currentRoom();
    if (this.navigatingToGame || this.deletingOnDestroy || !room || !this.canDeleteRoom(room)) {
      return;
    }

    this.deletingOnDestroy = true;
    try {
      await firstValueFrom(this.roomsApi.delete(room.id));
    } catch {
      // Component teardown should not block navigation if the room was already gone.
    }
  }
}
