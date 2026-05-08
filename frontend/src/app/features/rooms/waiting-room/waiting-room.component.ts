import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
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
import { Room, RoomPlayer, RoomTimerMode, WaitingRoomEvent } from '../../../core/models/room.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { bestCardArtImage } from '../../../shared/utils/card-image';
import { WaitingDeckOption } from './components/waiting-room-deck-selector/waiting-room-deck-selector.component';
import { WaitingRoomGameSetupComponent, WaitingRoomLogEntry } from './components/waiting-room-game-setup/waiting-room-game-setup.component';
import { WaitingRoomPlayerCardComponent } from './components/waiting-room-player-card/waiting-room-player-card.component';
import { WaitingRoomTurnOrderComponent, WaitingTurnOrderRow } from './components/waiting-room-turn-order/waiting-room-turn-order.component';

@Component({
  selector: 'app-waiting-room',
  imports: [LucideAngularModule, AppModalComponent, PrettyScrollDirective, WaitingRoomGameSetupComponent, WaitingRoomPlayerCardComponent, WaitingRoomTurnOrderComponent],
  templateUrl: './waiting-room.component.html',
  styleUrl: './waiting-room.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomComponent implements OnDestroy {
  private readonly decksApi = inject(DecksApi);
  private readonly friendsApi = inject(FriendsApi);
  private readonly roomsApi = inject(RoomsApi);
  private readonly auth = inject(AuthStore);
  private readonly mercure = inject(MercureService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly pageHeader = inject(PageHeaderStore);
  private roomSyncHandle?: number;
  private roomSyncInFlight = false;
  private inviteRealtimeSubscription?: Subscription;
  private roomRealtimeSubscription?: Subscription;
  private readonly deckCommanderValidityCache = new Map<string, CommanderValidation>();
  private navigatingToGame = false;
  private deletingOnDestroy = false;
  private seatOrderIds: string[] = [];
  private suppressedOwnDeckUpdateDeckId: string | null = null;
  private startingLifeLogHandle?: number;
  private copiedFeedbackHandle?: number;
  private startingLifeLogChange?: { from: number; to: number };
  private timerLogHandle?: number;
  private timerLogChange?: {
    fromMode: RoomTimerMode;
    toMode: RoomTimerMode;
    fromDurationSeconds: number;
    toDurationSeconds: number;
  };

  readonly roomId = computed(() => this.route.snapshot.paramMap.get('id')?.trim() ?? '');
  readonly decks = signal<Deck[]>([]);
  readonly sortedDecks = computed(() => [...this.decks()].sort((firstDeck, secondDeck) => {
    const firstRank = this.deckValiditySortRank(firstDeck.id);
    const secondRank = this.deckValiditySortRank(secondDeck.id);

    if (firstRank !== secondRank) {
      return firstRank - secondRank;
    }

    return firstDeck.name.localeCompare(secondDeck.name, undefined, { numeric: true, sensitivity: 'base' });
  }));
  readonly deckOptions = computed<readonly WaitingDeckOption[]>(() => this.sortedDecks().map((deck) => ({
    id: deck.id,
    name: deck.name,
    colorIdentity: this.deckColorIdentity(deck.id),
    fallback: this.deckColorFallback(deck.id),
    invalid: this.isDeckInvalid(deck.id),
    validating: this.isDeckValidationPending(deck.id),
  })));
  readonly friends = signal<FriendUser[]>([]);
  readonly deckValidations = signal<Record<string, CommanderValidation>>({});
  readonly validatingDeckIds = signal<string[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly sentInvites = signal<RoomInvite[]>([]);
  readonly invitingUserIds = signal<string[]>([]);
  readonly error = signal<string | null>(null);
  readonly roomPendingLeave = signal<Room | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  readonly playerPendingKick = signal<RoomPlayer | null>(null);
  readonly invalidDeckSelection = signal<WaitingDeckOption | null>(null);
  readonly roomLog = signal<WaitingRoomLogEntry[]>([]);
  readonly deletingRoomId = signal<string | null>(null);
  readonly archivingRoomId = signal<string | null>(null);
  readonly kickingPlayerId = signal<string | null>(null);
  readonly updatingDeck = signal(false);
  readonly rollModalOpen = signal(false);
  readonly rollingTurn = signal(false);
  readonly updatingCapacity = signal(false);
  readonly updatingStartingLife = signal(false);
  readonly updatingTimer = signal(false);
  readonly inviteModalOpen = signal(false);
  readonly deckSelectorOpen = signal(false);
  readonly copiedTarget = signal<'code' | 'link' | null>(null);
  readonly seatIndexes = [0, 1, 2, 3, 4, 5] as const;
  readonly maxPlayersOptions = [2, 3, 4, 5, 6] as const;
  readonly startingLifeStep = 1;
  selectedDeckId = '';

  constructor() {
    void this.loadDecks();
    void this.loadFriends();
    void this.loadRoomState(true);
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
    if (this.startingLifeLogHandle !== undefined) {
      window.clearTimeout(this.startingLifeLogHandle);
    }
    if (this.copiedFeedbackHandle !== undefined) {
      window.clearTimeout(this.copiedFeedbackHandle);
    }
    if (this.timerLogHandle !== undefined) {
      window.clearTimeout(this.timerLogHandle);
    }
    this.inviteRealtimeSubscription?.unsubscribe();
    this.roomRealtimeSubscription?.unsubscribe();
    this.pageHeader.clear();
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

  async updateDeckSelection(logMessage?: string): Promise<void> {
    const room = this.currentRoom();
    if (!room || this.selectedDeckId.trim() === '') {
      return;
    }

    this.error.set(null);
    this.updatingDeck.set(true);
    try {
      if (!(await this.isCommanderValidDeck(this.selectedDeckId))) {
        this.invalidDeckSelection.set(this.selectedDeckOption());
        return;
      }

      const response = await firstValueFrom(this.roomsApi.join(room.id, this.selectedDeckId, true));
      this.setCurrentRoom(response.room);
      this.syncSelectedDeckFromRoom(response.room);
      if (logMessage) {
        this.appendRoomLog(logMessage);
      }
      await this.loadRoomState(true);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update deck for this room.'));
    } finally {
      this.updatingDeck.set(false);
    }
  }

  requestLeaveRoom(room: Room): void {
    this.roomPendingLeave.set(room);
  }

  cancelLeaveRoom(): void {
    this.roomPendingLeave.set(null);
  }

  async confirmLeaveRoom(): Promise<void> {
    const room = this.roomPendingLeave();
    if (!room) {
      return;
    }

    await this.leaveRoom(room.id);
  }

  requestKickPlayer(room: Room, player: RoomPlayer): void {
    if (!this.canKickPlayer(room, player)) {
      return;
    }

    this.playerPendingKick.set(player);
  }

  cancelKickPlayer(): void {
    this.playerPendingKick.set(null);
  }

  async confirmKickPlayer(): Promise<void> {
    const room = this.currentRoom();
    const player = this.playerPendingKick();
    if (!room || !player || !this.canKickPlayer(room, player)) {
      return;
    }

    this.error.set(null);
    this.kickingPlayerId.set(player.id);
    try {
      const response = await firstValueFrom(this.roomsApi.kickPlayer(room.id, player.id, true));
      this.setCurrentRoom(response.room);
      this.playerPendingKick.set(null);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not kick this player from the room.'));
    } finally {
      this.kickingPlayerId.set(null);
    }
  }

  private async leaveRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.roomsApi.leave(id));
      this.roomPendingLeave.set(null);
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
      const response = await firstValueFrom(this.roomsApi.rollTurn(room.id, true));
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
      const response = await firstValueFrom(this.roomsApi.update(room.id, { maxPlayers }, true));
      this.setCurrentRoom(response.room);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update room size.'));
    } finally {
      this.updatingCapacity.set(false);
    }
  }

  async updateRoomStartingLife(startingLife: number): Promise<void> {
    const room = this.currentRoom();
    if (!room || this.roomStartingLife(room) === startingLife || !this.canEditRoom(room)) {
      return;
    }

    this.error.set(null);
    this.updatingStartingLife.set(true);
    const previousStartingLife = this.roomStartingLife(room);
    try {
      const response = await firstValueFrom(this.roomsApi.update(room.id, { startingLife }, true));
      this.setCurrentRoom(response.room);
      this.scheduleStartingLifeLog(previousStartingLife, this.roomStartingLife(response.room));
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update starting life.'));
    } finally {
      this.updatingStartingLife.set(false);
    }
  }

  async updateRoomTimerMode(timerMode: RoomTimerMode): Promise<void> {
    const room = this.currentRoom();
    if (!room || this.roomTimerMode(room) === timerMode || !this.canEditRoom(room)) {
      return;
    }

    await this.updateRoomTimer({ timerMode });
  }

  async updateRoomTimerDuration(timerDurationSeconds: number): Promise<void> {
    const room = this.currentRoom();
    if (!room || this.roomTimerDurationSeconds(room) === timerDurationSeconds || !this.canEditRoom(room)) {
      return;
    }

    await this.updateRoomTimer({ timerDurationSeconds });
  }

  toggleDeckSelector(): void {
    if (this.currentPlayerDeckLocked()) {
      return;
    }

    this.deckSelectorOpen.set(!this.deckSelectorOpen());
  }

  closeDeckSelector(): void {
    this.deckSelectorOpen.set(false);
  }

  async selectDeck(deckId: string): Promise<void> {
    if (this.currentPlayerDeckLocked()) {
      return;
    }

    const deckOption = this.deckOptions().find((deck) => deck.id === deckId) ?? null;
    if (deckOption?.invalid) {
      this.deckSelectorOpen.set(false);
      this.invalidDeckSelection.set(deckOption);
      return;
    }

    this.selectedDeckId = deckId;
    this.deckSelectorOpen.set(false);
    await this.updateDeckSelection();
  }

  closeInvalidDeckModal(): void {
    this.invalidDeckSelection.set(null);
  }

  async selectRandomLegalDeck(): Promise<void> {
    if (this.currentPlayerDeckLocked()) {
      return;
    }

    const legalDecks = this.legalDeckOptions();
    if (legalDecks.length === 0) {
      this.error.set('No legal Commander decks available.');
      return;
    }

    const randomIndex = Math.floor(Math.random() * legalDecks.length);
    const selectedDeck = legalDecks[randomIndex];
    this.selectedDeckId = selectedDeck.id;
    this.suppressedOwnDeckUpdateDeckId = selectedDeck.id;
    this.deckSelectorOpen.set(false);
    await this.updateDeckSelection(`${this.auth.user()?.displayName ?? 'You'} picked a random deck from ${legalDecks.length} legal options: ${selectedDeck.name}.`);
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
    return room.status === 'waiting' && this.isRoomOwner(room);
  }

  canEditRoom(room: Room): boolean {
    return room.status === 'waiting' && this.isRoomOwner(room);
  }

  canKickPlayer(room: Room, player: RoomPlayer): boolean {
    return this.canEditRoom(room)
      && player.user.id !== room.owner.id
      && player.user.id !== this.currentUserId();
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
    return this.isRoomOwner(room)
      && room.players.length === this.roomCapacity(room)
      && room.players.length >= 2
      && room.players.every((player) => this.isPlayerReady(player));
  }

  canArchiveRoom(room: Room): boolean {
    return room.status !== 'archived' && this.isRoomOwner(room) && (room.status === 'started' || !!room.gameId);
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

  roomStartingLife(room: Room): number {
    const startingLife = Number(room.startingLife);
    if (Number.isInteger(startingLife) && startingLife > 0) {
      return startingLife;
    }

    return 40;
  }

  roomTimerMode(room: Room): RoomTimerMode {
    return room.timerMode === 'turn' ? 'turn' : 'none';
  }

  roomTimerDurationSeconds(room: Room): number {
    const duration = Number(room.timerDurationSeconds);
    if (Number.isInteger(duration) && duration >= 30) {
      return duration;
    }

    return 300;
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

  playerDeck(player: RoomPlayer): Deck | null {
    return player.deck ?? this.deckById(player.deckId);
  }

  playerDeckName(player: RoomPlayer): string {
    if (!player.deckId) {
      return 'Deck pending';
    }

    return this.playerDeck(player)?.name ?? this.deckName(player.deckId);
  }

  playerDeckArt(player: RoomPlayer): string | null {
    return bestCardArtImage(this.playerDeck(player)?.commander ?? null);
  }

  shouldShowPlayerDeckArt(player: RoomPlayer): boolean {
    return !!this.playerDeckArt(player);
  }

  playerDeckBackground(player: RoomPlayer): string | null {
    const imageUrl = this.playerDeckArt(player);

    return imageUrl ? `url("${imageUrl}")` : null;
  }

  playerDeckColorIdentity(player: RoomPlayer): readonly string[] {
    return this.playerDeck(player)?.commander?.colorIdentity ?? [];
  }

  selectedDeckName(): string {
    return this.deckName(this.selectedDeckId || null);
  }

  selectedDeck(): Deck | null {
    return this.deckById(this.selectedDeckId);
  }

  selectedDeckOption(): WaitingDeckOption | null {
    return this.deckOptions().find((deck) => deck.id === this.selectedDeckId) ?? null;
  }

  legalDeckOptions(): readonly WaitingDeckOption[] {
    return this.deckOptions().filter((deck) => this.deckValidations()[deck.id]?.valid === true);
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
    return playerUserId === this.currentUserId();
  }

  isCurrentUserInRoom(room: Room): boolean {
    const userId = this.currentUserId();

    return !!userId && room.players.some((player) => player.user.id === userId);
  }

  isRoomOwner(room: Room): boolean {
    return room.owner.id === this.currentUserId();
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

  currentPlayerDeckLocked(): boolean {
    const player = this.currentPlayer();

    return player?.turnRoll !== null && player?.turnRoll !== undefined;
  }

  currentPlayer(): Room['players'][number] | null {
    const userId = this.currentUserId();
    return this.currentRoom()?.players.find((player) => player.user.id === userId) ?? null;
  }

  currentPlayerRoll(): number | null {
    return this.currentPlayer()?.turnRoll ?? null;
  }

  turnOrderPlayers(room: Room): readonly RoomPlayer[] {
    if (this.hasCompletedTurnOrder(room)) {
      return [...room.players].sort((firstPlayer, secondPlayer) => this.comparePlayersByTurnOrder(firstPlayer, secondPlayer));
    }

    const orderedIds = this.seatOrderIds.length > 0 ? this.seatOrderIds : this.nextSeatOrderIds(room);

    return this.playersBySeatOrder(room, orderedIds);
  }

  turnOrderRows(room: Room): readonly WaitingTurnOrderRow[] {
    const completed = this.hasCompletedTurnOrder(room);

    return this.turnOrderPlayers(room).map((player, index) => ({
      id: player.id,
      label: completed
        ? `${index + 1}. ${player.user.displayName} - ${this.playerDeckName(player)}`
        : `${player.user.displayName} - ${this.playerDeckName(player)}`,
      roll: player.turnRoll,
    }));
  }

  hasCompletedTurnOrder(room: Room): boolean {
    return this.allPlayersRolled(room);
  }

  seatPlayer(room: Room, seatIndex: number): RoomPlayer | null {
    return this.turnOrderPlayers(room)[seatIndex] ?? null;
  }

  isOddLastSeat(room: Room, seatIndex: number): boolean {
    const players = this.turnOrderPlayers(room);

    return players.length > 1 && players.length % 2 === 1 && seatIndex === players.length - 1;
  }

  shouldRenderOpenSeat(room: Room, seatIndex: number): boolean {
    return seatIndex < this.roomCapacity(room)
      && !this.isCompanionSlotForCenteredOddPlayer(room, seatIndex);
  }

  private async loadDecks(): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.list(undefined, true));
      this.deckCommanderValidityCache.clear();
      this.deckValidations.set({});
      this.decks.set(response.data);
      void this.loadDeckValidations(response.data);
    } catch {
      this.error.set('Could not load decks.');
    }
  }

  private deckById(deckId: string | null): Deck | null {
    if (!deckId) {
      return null;
    }

    return this.decks().find((deck) => deck.id === deckId) ?? null;
  }

  private async copyText(text: string, target: 'code' | 'link'): Promise<void> {
    try {
      await navigator.clipboard?.writeText(text);
      this.copiedTarget.set(target);
      this.updatePageHeader(this.currentRoom());
      if (this.copiedFeedbackHandle !== undefined) {
        window.clearTimeout(this.copiedFeedbackHandle);
      }
      this.copiedFeedbackHandle = window.setTimeout(() => {
        this.copiedTarget.set(null);
        this.updatePageHeader(this.currentRoom());
        this.copiedFeedbackHandle = undefined;
      }, 5000);
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
      let room = response.room;
      if (room?.status === 'waiting' && !this.isCurrentUserInRoom(room)) {
        const joinResponse = await firstValueFrom(this.roomsApi.join(room.id, undefined, skipGlobalLoading));
        room = joinResponse.room;
      }

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

      if (room.status === 'waiting' && this.isCurrentUserInRoom(room) && this.inviteModalOpen()) {
        await this.loadSentInvites(room.id, skipGlobalLoading);
      } else if (!this.inviteModalOpen()) {
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
    const userId = this.currentUserId();
    const currentPlayer = room.players.find((player) => player.user.id === userId);
    if (currentPlayer?.deckId) {
      this.selectedDeckId = currentPlayer.deckId;
    }
  }

  private currentUserId(): string | null {
    return this.auth.user()?.id ?? null;
  }

  private setCurrentRoom(room: Room | null): void {
    const previousRoom = this.currentRoom();
    const previousOrder = previousRoom ? this.turnOrderPlayers(previousRoom).map((player) => player.id).join('|') : '';
    const nextSeatOrderIds = this.nextSeatOrderIds(room);
    const nextOrder = room ? this.playersBySeatOrder(room, nextSeatOrderIds).map((player) => player.id).join('|') : '';
    const shouldAnimateOrder = previousOrder !== '' && nextOrder !== '' && previousOrder !== nextOrder && !!room && this.hasCompletedTurnOrder(room);
    const transitionDocument = document as Document & {
      startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
    };

    if (!shouldAnimateOrder || typeof transitionDocument.startViewTransition !== 'function') {
      this.applyCurrentRoom(room);
      return;
    }

    document.documentElement.classList.add('waiting-room-transition');
    const transition = transitionDocument.startViewTransition(() => {
      this.applyCurrentRoom(room);
    });
    void transition.finished
      .catch(() => {})
      .finally(() => {
        document.documentElement.classList.remove('waiting-room-transition');
      });
  }

  private applyCurrentRoom(room: Room | null): void {
    this.seatOrderIds = this.nextSeatOrderIds(room);
    this.currentRoom.set(room);
    this.updatePageHeader(room);
  }

  private nextSeatOrderIds(room: Room | null): string[] {
    if (!room) {
      return [];
    }

    if (this.hasCompletedTurnOrder(room)) {
      return [...room.players]
        .sort((firstPlayer, secondPlayer) => this.comparePlayersByTurnOrder(firstPlayer, secondPlayer))
        .map((player) => player.id);
    }

    const presentPlayerIds = new Set(room.players.map((player) => player.id));
    const stableOrder = this.seatOrderIds.filter((playerId) => presentPlayerIds.has(playerId));
    for (const player of room.players) {
      if (!stableOrder.includes(player.id)) {
        stableOrder.push(player.id);
      }
    }

    return stableOrder;
  }

  private playersBySeatOrder(room: Room, orderedIds: readonly string[]): RoomPlayer[] {
    const playersById = new Map(room.players.map((player) => [player.id, player]));
    const orderedPlayers = orderedIds
      .map((playerId) => playersById.get(playerId) ?? null)
      .filter((player): player is RoomPlayer => !!player);
    const orderedPlayerIds = new Set(orderedPlayers.map((player) => player.id));
    const newPlayers = room.players.filter((player) => !orderedPlayerIds.has(player.id));

    return [...orderedPlayers, ...newPlayers];
  }

  private updatePageHeader(room: Room | null): void {
    const actions = room
      ? [
        ...(this.canShowInviteButton(room)
          ? [
            {
              id: 'invite-friends',
              label: 'Invite friends',
              icon: 'user-plus',
              tooltip: this.isRoomFull(room) ? 'Room is full' : 'Invite friends',
              disabled: this.isRoomFull(room),
              variant: 'primary' as const,
              execute: () => {
                const currentRoom = this.currentRoom();
                if (currentRoom) {
                  this.openInviteModal(currentRoom);
                }
              },
            },
          ]
          : []),
        {
          id: 'copy-room-code',
          label: this.copiedTarget() === 'code' ? 'Copied' : 'Copy code',
          icon: 'copy',
          tooltip: this.isRoomFull(room) ? 'Room is full' : 'Copy code',
          disabled: this.isRoomFull(room) || this.copiedTarget() === 'code',
          variant: 'secondary' as const,
          execute: () => {
            const currentRoom = this.currentRoom();
            if (currentRoom) {
              void this.copyRoomCode(currentRoom);
            }
          },
        },
        {
          id: 'share-room-link',
          label: this.copiedTarget() === 'link' ? 'Copied' : 'Share link',
          icon: 'send',
          tooltip: this.isRoomFull(room) ? 'Room is full' : 'Share link',
          disabled: this.isRoomFull(room) || this.copiedTarget() === 'link',
          variant: 'secondary' as const,
          execute: () => {
            const currentRoom = this.currentRoom();
            if (currentRoom) {
              void this.copyRoomLink(currentRoom);
            }
          },
        },
      ]
      : [];

    this.pageHeader.set({
      title: room?.name ?? 'Waiting room',
      actions,
      actionFeedback: null,
    });
  }

  private deckValiditySortRank(deckId: string): number {
    return this.isDeckInvalid(deckId) ? 1 : 0;
  }

  private scheduleStartingLifeLog(from: number, to: number): void {
    if (from === to) {
      return;
    }

    this.startingLifeLogChange = {
      from: this.startingLifeLogChange?.from ?? from,
      to,
    };

    if (this.startingLifeLogHandle !== undefined) {
      window.clearTimeout(this.startingLifeLogHandle);
    }

    this.startingLifeLogHandle = window.setTimeout(() => {
      const change = this.startingLifeLogChange;
      this.startingLifeLogHandle = undefined;
      this.startingLifeLogChange = undefined;
      if (!change || change.from === change.to) {
        return;
      }

      const delta = change.to - change.from;
      const sign = delta > 0 ? '+' : '';
      this.appendRoomLog(`Starting life changed from ${change.from} to ${change.to} (${sign}${delta} life).`);
    }, 850);
  }

  private scheduleTimerLog(fromMode: RoomTimerMode, toMode: RoomTimerMode, fromDurationSeconds: number, toDurationSeconds: number): void {
    if (fromMode === toMode && fromDurationSeconds === toDurationSeconds) {
      return;
    }

    this.timerLogChange = {
      fromMode: this.timerLogChange?.fromMode ?? fromMode,
      fromDurationSeconds: this.timerLogChange?.fromDurationSeconds ?? fromDurationSeconds,
      toMode,
      toDurationSeconds,
    };

    if (this.timerLogHandle !== undefined) {
      window.clearTimeout(this.timerLogHandle);
    }

    this.timerLogHandle = window.setTimeout(() => {
      const change = this.timerLogChange;
      this.timerLogHandle = undefined;
      this.timerLogChange = undefined;
      if (!change || (change.fromMode === change.toMode && change.fromDurationSeconds === change.toDurationSeconds)) {
        return;
      }

      this.appendRoomLog(`Timer changed from ${this.timerLabel(change.fromMode, change.fromDurationSeconds)} to ${this.timerLabel(change.toMode, change.toDurationSeconds)}.`);
    }, 850);
  }

  private timerLabel(mode: RoomTimerMode, durationSeconds: number): string {
    if (mode === 'none') {
      return 'off';
    }

    return `${this.formatDuration(durationSeconds)} per turn`;
  }

  private formatDuration(durationSeconds: number): string {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private async updateRoomTimer(options: { timerMode?: RoomTimerMode; timerDurationSeconds?: number }): Promise<void> {
    const room = this.currentRoom();
    if (!room || !this.canEditRoom(room)) {
      return;
    }

    const previousMode = this.roomTimerMode(room);
    const previousDurationSeconds = this.roomTimerDurationSeconds(room);
    this.error.set(null);
    this.updatingTimer.set(true);
    try {
      const response = await firstValueFrom(this.roomsApi.update(room.id, options, true));
      this.setCurrentRoom(response.room);
      this.scheduleTimerLog(
        previousMode,
        this.roomTimerMode(response.room),
        previousDurationSeconds,
        this.roomTimerDurationSeconds(response.room),
      );
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not update timer settings.'));
    } finally {
      this.updatingTimer.set(false);
    }
  }

  private allPlayersRolled(room: Room): boolean {
    return room.players.length > 0 && room.players.every((player) => player.turnRoll !== null);
  }

  private comparePlayersByTurnOrder(firstPlayer: RoomPlayer, secondPlayer: RoomPlayer): number {
    const firstRoll = firstPlayer.turnRoll ?? -1;
    const secondRoll = secondPlayer.turnRoll ?? -1;

    if (firstRoll !== secondRoll) {
      return secondRoll - firstRoll;
    }

    return firstPlayer.user.displayName.localeCompare(secondPlayer.user.displayName, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  private isCompanionSlotForCenteredOddPlayer(room: Room, seatIndex: number): boolean {
    const previousSeatIndex = seatIndex - 1;

    return seatIndex % 2 === 1 && this.isOddLastSeat(room, previousSeatIndex);
  }

  private subscribeToInviteRealtime(): void {
    const userId = this.currentUserId();
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
      this.appendRoomLog(this.describeWaitingRoomEvent(event, null));
      await this.loadRoomState(true);
      return;
    }

    this.appendRoomLog(this.describeWaitingRoomEvent(event, event.room));
    this.setCurrentRoom(event.room);
    this.syncSelectedDeckFromRoom(event.room);
    if (event.room.status === 'waiting' && this.isCurrentUserInRoom(event.room) && this.inviteModalOpen()) {
      await this.loadSentInvites(event.room.id, true);
    }
    if (event.room.gameId) {
      this.navigatingToGame = true;
      await this.router.navigate(['/games', event.room.gameId]);
    }
  }

  private appendRoomLog(label: string): void {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      return;
    }

    const entry: WaitingRoomLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: trimmedLabel,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    this.roomLog.update((entries) => [...entries, entry].slice(-30));
  }

  private describeWaitingRoomEvent(event: WaitingRoomEvent, nextRoom: Room | null): string {
    const previousRoom = this.currentRoom();

    switch (event.type) {
      case 'room.created':
        return 'Room created.';
      case 'room.updated':
        return '';
      case 'room.player.joined':
        return `${this.changedPlayerName(previousRoom, nextRoom, 'joined')} joined the room.`;
      case 'room.player.updated':
        return this.describePlayerDeckChange(previousRoom, nextRoom);
      case 'room.player.rolled':
        return this.describeRollEvent(previousRoom, nextRoom);
      case 'room.player.left':
        return `${this.changedPlayerName(previousRoom, nextRoom, 'left')} left the room.`;
      case 'room.started':
        return 'Game started.';
      case 'room.deleted':
        return 'Room deleted.';
    }
  }

  private describeRollEvent(previousRoom: Room | null, nextRoom: Room | null): string {
    const player = nextRoom?.players.find((nextPlayer) => {
      const previousPlayer = previousRoom?.players.find((candidate) => candidate.id === nextPlayer.id);

      return nextPlayer.turnRoll !== null && previousPlayer?.turnRoll !== nextPlayer.turnRoll;
    });

    if (!player) {
      return 'A player rolled the d20.';
    }

    return `${player.user.displayName} rolled ${player.turnRoll}.`;
  }

  private describePlayerDeckChange(previousRoom: Room | null, nextRoom: Room | null): string {
    const player = nextRoom?.players.find((nextPlayer) => {
      const previousPlayer = previousRoom?.players.find((candidate) => candidate.id === nextPlayer.id);

      return previousPlayer && previousPlayer.deckId !== nextPlayer.deckId;
    });

    if (!player) {
      return '';
    }

    if (player.user.id === this.currentUserId() && player.deckId === this.suppressedOwnDeckUpdateDeckId) {
      this.suppressedOwnDeckUpdateDeckId = null;
      return '';
    }

    return `${player.user.displayName} selected deck: ${this.playerDeckName(player)}.`;
  }

  private changedPlayerName(previousRoom: Room | null, nextRoom: Room | null, change: 'joined' | 'left' | 'updated'): string {
    if (change === 'joined') {
      const player = nextRoom?.players.find((nextPlayer) => !previousRoom?.players.some((previousPlayer) => previousPlayer.id === nextPlayer.id));

      return player?.user.displayName ?? 'A player';
    }

    if (change === 'left') {
      const player = previousRoom?.players.find((previousPlayer) => !nextRoom?.players.some((nextPlayer) => nextPlayer.id === previousPlayer.id));

      return player?.user.displayName ?? 'A player';
    }

    const player = nextRoom?.players.find((nextPlayer) => {
      const previousPlayer = previousRoom?.players.find((candidate) => candidate.id === nextPlayer.id);

      return previousPlayer && previousPlayer.deckId !== nextPlayer.deckId;
    });

    return player?.user.displayName ?? 'A player';
  }

  private async isCommanderValidDeck(deckId: string): Promise<boolean> {
    if (this.deckCommanderValidityCache.has(deckId)) {
      return this.deckCommanderValidityCache.get(deckId)?.valid === true;
    }

    try {
      const validation = await firstValueFrom(this.decksApi.validateCommander(deckId, true));
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
        const validation = await firstValueFrom(this.decksApi.validateCommander(deck.id, true));
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
