import { Injectable, OnDestroy, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../core/models/game.model';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableBattlefieldDragContext, GameTableBattlefieldDragCoordinatorService } from './services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableTurnActionContext, GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { AlignmentGuide, GameTableBattlefieldDragState } from './state/game-table-battlefield-drag.state';
import { GameLogEntryView, GameTableChatLogState } from './state/game-table-chat-log.state';
import { GameTableDropFeedbackState } from './state/game-table-drop-feedback.state';
import { GameTablePendingTransferState, type PendingTransferExpiration } from './state/game-table-pending-transfer.state';
import { GameTableSnapshotSelectors, PlayerView } from './state/game-table-snapshot-selectors';
import { GameContextMenu, GameTableUiState } from './state/game-table-ui.state';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';
import { GameTableCardActionContext, GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsContext, GameTableCardStatsService } from './services/game-table-card-stats.service';
import { GameTableDropActionContext, GameTableDropActionsService, PendingBattlefieldMove, PendingLibraryMove } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService, GameTableInteractionContext } from './services/game-table-interaction-actions.service';
import { GameTablePointerDragActionContext, GameTablePointerDragActionsService } from './services/game-table-pointer-drag-actions.service';
import { PointerDropTarget } from './services/game-table-pointer-drag.service';
import { GameTableSessionContext, GameTableSessionService } from './services/game-table-session.service';
import { GameTableZoneActionContext, GameTableZoneActionsService } from './services/game-table-zone-actions.service';

export type { PlayerView } from './state/game-table-snapshot-selectors';

export interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export type GameTableSyncStatus = 'pending' | 'connecting' | 'live' | 'degraded';

@Injectable()
export class GameTableStore implements OnDestroy {
  private readonly errorToastDurationMs = 3000;
  private errorToastTimer: number | null = null;

  private readonly commands = inject(GameTableCommandService);
  private readonly cardActions = inject(GameTableCardActionsService);
  private readonly cardStats = inject(GameTableCardStatsService);
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
  private readonly drag = inject(GameTableDragService);
  private readonly dropActions = inject(GameTableDropActionsService);
  private readonly interactionActions = inject(GameTableInteractionActionsService);
  private readonly pointerDragActions = inject(GameTablePointerDragActionsService);
  private readonly libraryActions = inject(GameTableLibraryActionsService);
  private readonly turnActions = inject(GameTableTurnActionsService);
  private readonly zoneActions = inject(GameTableZoneActionsService);
  private readonly session = inject(GameTableSessionService);
  private readonly selection = inject(GameTableSelectionService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly uiState = inject(GameTableUiState);
  private readonly battlefieldDragState = inject(GameTableBattlefieldDragState);
  private readonly zoneModalState = inject(GameTableZoneModalState);
  private readonly chatLogState = inject(GameTableChatLogState);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);
  private readonly selectors = inject(GameTableSnapshotSelectors);

  readonly zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  readonly dockZones: GameZoneName[] = ['library', 'command', 'graveyard', 'exile'];
  readonly publicZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'command'];
  readonly phases = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
  readonly gameId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly snapshot = signal<GameSnapshot | null>(null);
  readonly focusedPlayerId = this.uiState.focusedPlayerId;
  readonly selectedCards: WritableSignal<SelectedCard[]> = this.selection.selectedCards as WritableSignal<SelectedCard[]>;
  readonly hoveredCard = this.uiState.hoveredCard;
  readonly contextMenu = this.uiState.contextMenu;
  readonly zoneModal = this.zoneModalState.zoneModal;
  readonly activeFloatingTab = this.uiState.activeFloatingTab;
  readonly floatingPanel = this.uiState.floatingPanel;
  readonly floatingMinimized = this.uiState.floatingMinimized;
  readonly chatMessage = this.chatLogState.chatMessage;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pending = signal(false);
  readonly pendingBattlefieldMove = signal<PendingBattlefieldMove | null>(null);
  readonly pendingLibraryMove = signal<PendingLibraryMove | null>(null);
  readonly draggingCardInstanceId = this.battlefieldDragState.draggingCardInstanceId;
  readonly handDropPreview = this.battlefieldDragState.handDropPreview;
  readonly manaLaneDropPlayerId = this.battlefieldDragState.manaLaneDropPlayerId;
  readonly handExternalRevealAllowed = this.battlefieldDragState.handExternalRevealAllowed;
  readonly alignmentGuide = this.battlefieldDragState.alignmentGuide;
  readonly activeDropTarget = this.battlefieldDragState.activeDropTarget;
  readonly activePlayerDropTarget = this.battlefieldDragState.activePlayerDropTarget;
  readonly pointerDragPreview = this.battlefieldDragState.pointerDragPreview;
  readonly players = computed<PlayerView[]>(() => this.selectors.players(this.snapshot()));
  readonly focusedPlayer = computed<PlayerView | null>(() => this.selectors.focusedPlayer(this.snapshot(), this.players(), this.focusedPlayerId()));
  readonly eventLog = computed<GameLogEntryView[]>(() => this.chatLogState.eventLogView(this.snapshot(), this.zones));
  readonly currentPlayer = computed<PlayerView | null>(() => this.selectors.currentPlayer(this.players(), this.auth.user()?.id));
  readonly handPlayer = computed<PlayerView | null>(() => this.currentPlayer());
  readonly isGameOwner = computed(() => this.selectors.isGameOwner(this.snapshot(), this.currentPlayer()));
  readonly syncStatus = computed<GameTableSyncStatus>(() => {
    if (this.pending()) {
      return 'pending';
    }

    const realtimeStatus = this.session.realtimeStatus();
    if (realtimeStatus === 'live' || realtimeStatus === 'degraded') {
      return realtimeStatus;
    }

    return 'connecting';
  });
  readonly syncStatusLabel = computed(() => {
    const labels: Record<GameTableSyncStatus, string> = {
      pending: 'Applying action',
      connecting: 'Connecting',
      live: 'Live',
      degraded: 'Polling backup',
    };

    return labels[this.syncStatus()];
  });

  constructor() {
    this.pendingTransferState.setExpirationHandler((expiration) => this.handlePendingTransferExpired(expiration));
    effect(() => {
      this.scheduleErrorDismiss(this.error(), this.snapshot() !== null);
    });
    void this.load();
  }

  ngOnDestroy(): void {
    this.clearErrorDismissTimer();
    this.uiState.destroy();
    this.cardStats.clear();
    this.dropFeedbackState.destroy();
    this.pendingTransferState.setExpirationHandler(null);
    this.pendingTransferState.clear();
    this.session.stop();
  }

  async load(): Promise<void> {
    await this.session.load(this.sessionContext());
  }

  async refetch(force = false): Promise<void> {
    if (force) {
      this.pendingTransferState.clear();
    }
    await this.session.refetch(this.sessionContext(), force);
  }

  focusPlayer(playerId: string): void {
    this.focusedPlayerId.set(playerId);
    this.uiState.closeContextMenu();
  }

  focusCurrentPlayer(): void {
    const player = this.currentPlayer();
    if (player) {
      this.focusPlayer(player.id);
    }
  }

  isCurrentPlayer(playerId: string): boolean {
    return this.interactionActions.isCurrentPlayer(this.interactionContext(), playerId);
  }

  canControlPlayer(playerId: string): boolean {
    return this.interactionActions.canControlPlayer(this.interactionContext(), playerId);
  }

  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean {
    return this.interactionActions.canControlOwnedCard(this.interactionContext(), playerId, card);
  }

  canDragBattlefieldCard(playerId: string, card: GameCardInstance): boolean {
    return this.canControlOwnedCard(playerId, card);
  }

  handleTableClick(event: MouseEvent): void {
    this.closeContextMenu();
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-card-instance-id], .context-menu, .zone-modal, app-modal')) {
      this.clearSelection();
    }
  }

  canUseHiddenZone(playerId: string, zone: GameZoneName): boolean {
    return this.interactionActions.canUseHiddenZone(this.interactionContext(), playerId, zone);
  }

  zoneTitle(zone: GameZoneName): string {
    return this.selectors.zoneTitle(zone);
  }

  zoneCount(player: PlayerView, zone: GameZoneName): number {
    return this.selectors.zoneCount(player, zone);
  }

  commanderCastCount(player: PlayerView): number {
    return this.selectors.commanderCastCount(this.snapshot(), player);
  }

  countItems(count: number): number[] {
    return this.selectors.countItems(count);
  }

  cardImage(card: GameCardInstance): string | null {
    return this.selectors.cardImage(card);
  }

  publicCardImage(card: GameCardInstance): string | null {
    return this.selectors.publicCardImage(card);
  }

  cardBackImage(): string {
    return this.selectors.cardBackImage();
  }

  shouldShowCardBack(card: GameCardInstance): boolean {
    return this.selectors.shouldShowCardBack(card);
  }

  deckLabel(player: PlayerView | null): string {
    return this.selectors.deckLabel(player);
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    return this.selectors.firstCounter(card);
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return this.selectors.hasPowerToughness(card);
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.selectors.shouldShowPowerToughness(card);
  }

  cardPowerValue(card: GameCardInstance): number {
    return this.selectors.cardPowerValue(card);
  }

  cardToughnessValue(card: GameCardInstance): number {
    return this.selectors.cardToughnessValue(card);
  }

  isHandDropTarget(playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean {
    const preview = this.handDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId && preview.placement === placement;
  }

  isCardDropSettling(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isCardDropSettling(playerId, zone, card.instanceId);
  }

  isManaDropSettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isManaDropSettling(playerId, card.instanceId);
  }

  isBattlefieldEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isBattlefieldEntrySettling(playerId, card.instanceId);
  }

  isZoneDropSettling(playerId: string, zone: GameZoneName): boolean {
    return this.dropFeedbackState.isZoneDropSettling(playerId, zone);
  }

  isCardTransferPending(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.pendingTransferState.isCardPending(playerId, zone, card.instanceId);
  }

  isZoneTransferPending(playerId: string, zone: GameZoneName): boolean {
    return this.pendingTransferState.isZonePending(playerId, zone);
  }

  cardPosition(card: GameCardInstance): { x: number; y: number } | null {
    return this.selectors.cardPosition(card);
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.selectors.topVisibleCard(player, zone);
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.selectors.zonePreviewCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    return this.selectors.zonePreviewImage(player, zone);
  }

  topDraggableCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    if (zone === 'library') {
      return null;
    }

    return this.selectors.topDraggableCard(player, zone, this.canControlPlayer(player.id));
  }

  colorIdentity(player: PlayerView | null): string[] {
    return this.selectors.colorIdentity(player);
  }

  colorAccent(player: PlayerView | null): string {
    return this.selectors.colorAccent(player);
  }

  miniCardLeft(card: GameCardInstance, index: number): number {
    return this.selectors.miniCardLeft(card, index);
  }

  manaSymbols(player: PlayerView | null): string[] {
    return this.selectors.manaSymbols(player);
  }

  logTime(createdAt: string): string {
    return this.selectors.logTime(createdAt);
  }

  miniCardTop(card: GameCardInstance, index: number): number {
    return this.selectors.miniCardTop(card, index);
  }

  zoneHint(zone: GameZoneName): string {
    return this.selectors.zoneHint(zone);
  }

  showCardPreview(card: GameCardInstance, playerId?: string, zone?: GameZoneName): void {
    this.uiState.showCardPreview(card, () => Boolean(this.draggingCardInstanceId()), playerId, zone);
  }

  hideCardPreview(): void {
    this.uiState.hideCardPreview();
  }

  activeKeyboardCard(): SelectedCard | null {
    return this.interactionActions.activeKeyboardCard() as SelectedCard | null;
  }

  clearSelection(): void {
    this.interactionActions.clearSelection();
  }

  isDraggingCard(card: GameCardInstance): boolean {
    const draggingInstanceId = this.draggingCardInstanceId();
    if (!draggingInstanceId) {
      return false;
    }

    const selected = this.selectedCards();
    const isDraggingSelection = selected.some((item) => item.card.instanceId === draggingInstanceId);

    return draggingInstanceId === card.instanceId
      || isDraggingSelection && selected.some((item) => item.card.instanceId === card.instanceId);
  }

  isManaLaneHighlighted(playerId: string): boolean {
    return this.battlefieldDragState.isManaLaneHighlighted(playerId);
  }

  isDropZoneHighlighted(playerId: string, zone: GameZoneName): boolean {
    return this.battlefieldDragState.isDropZoneHighlighted(playerId, zone);
  }

  isPlayerDropHighlighted(playerId: string): boolean {
    return this.battlefieldDragState.isPlayerDropHighlighted(playerId);
  }

  isPendingBattlefieldTransfer(card: GameCardInstance): boolean {
    const payload = this.pendingBattlefieldMove()?.payload;
    const instanceIds = payload?.['instanceIds'];

    return payload?.['instanceId'] === card.instanceId
      || Array.isArray(instanceIds) && instanceIds.includes(card.instanceId);
  }

  alignmentGuideFor(playerId: string): AlignmentGuide | null {
    return this.battlefieldDragState.alignmentGuideFor(playerId);
  }

  isPhasePast(phase: string): boolean {
    return this.selectors.isPhasePast(this.phases, this.snapshot(), phase);
  }

  canAdvanceTurnPhase(): boolean {
    const activePlayerId = this.snapshot()?.turn.activePlayerId ?? null;
    const currentPlayerId = this.currentPlayer()?.id ?? null;

    return !!activePlayerId && activePlayerId === currentPlayerId && !this.pending();
  }

  toggleCardSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.interactionActions.toggleCardSelection(this.interactionContext(), event, playerId, zone, card);
  }

  isSelected(instanceId: string): boolean {
    return this.selection.isSelected(instanceId);
  }

  openCardMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.interactionActions.openCardMenu(this.interactionContext(), event, playerId, zone, card);
  }

  openZoneMenu(event: MouseEvent, playerId: string, zone: GameZoneName): void {
    this.interactionActions.openZoneMenu(this.interactionContext(), event, playerId, zone);
  }

  openGameMenu(event: MouseEvent): void {
    this.interactionActions.openGameMenu(this.interactionContext(), event);
  }

  openPlayerMenu(event: MouseEvent, playerId: string): void {
    this.interactionActions.openPlayerMenu(event, playerId);
  }

  closeContextMenu(): void {
    this.interactionActions.closeContextMenu();
  }

  async sendChat(): Promise<void> {
    const message = this.chatLogState.normalizedMessage();
    if (!message) {
      return;
    }

    await this.command('chat.message', { message });
    this.chatLogState.clearMessage();
  }

  setChatMessage(value: string): void {
    this.chatLogState.setMessage(value);
  }

  async changeLife(playerId: string, delta: number): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own life total.');
      return;
    }

    await this.command('life.changed', { playerId, delta });
  }

  async setLife(playerId: string, value: string | number): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own life total.');
      return;
    }

    await this.command('life.changed', { playerId, life: Number(value) });
  }

  async setCommanderDamage(targetPlayerId: string, sourcePlayerId: string, delta: number): Promise<void> {
    await this.command('commander.damage.changed', { targetPlayerId, sourcePlayerId, delta });
  }

  async changeTurnPlayer(activePlayerId: string): Promise<void> {
    await this.turnActions.changeTurnPlayer(this.turnActionContext(), activePlayerId);
  }

  async changePhase(phase: string): Promise<void> {
    await this.turnActions.changePhase(this.turnActionContext(), phase);
  }

  async changeTurnNumber(number: string | number): Promise<void> {
    await this.turnActions.changeTurnNumber(this.turnActionContext(), number);
  }

  async advanceTurnPhase(): Promise<void> {
    if (this.pending()) {
      this.error.set('Wait for the current table action to finish.');
      return;
    }
    if (!this.canAdvanceTurnPhase()) {
      this.error.set('Only the active turn player can advance the turn.');
      return;
    }

    await this.turnActions.advanceTurnPhase(this.turnActionContext());
  }

  async changeCommanderCastCount(playerId: string, delta: number): Promise<void> {
    const player = this.players().find((candidate) => candidate.id === playerId);
    if (!player || !this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own commander cast count.');
      return;
    }

    const currentCount = this.commanderCastCount(player);
    const nextCount = Math.max(0, currentCount + delta);
    if (nextCount === currentCount) {
      return;
    }

    await this.command('counter.changed', {
      scope: `commander:${playerId}`,
      key: 'casts',
      value: nextCount,
    });
  }

  private libraryActionContext(): GameTableLibraryActionContext {
    return {
      isCurrentPlayer: (playerId) => this.isCurrentPlayer(playerId),
      currentPlayer: () => this.currentPlayer(),
      focusedPlayer: () => this.focusedPlayer(),
      focusPlayer: (playerId) => this.focusPlayer(playerId),
      setError: (message) => this.error.set(message),
      command: (type, payload) => this.command(type, payload),
    };
  }

  private cardActionContext(): GameTableCardActionContext {
    return {
      canControlPlayer: (playerId) => this.canControlPlayer(playerId),
      activeKeyboardCard: () => this.activeKeyboardCard(),
      selectedCards: () => this.selectedCards(),
      clearSelectedCards: () => this.selectedCards.set([]),
      zoneModal: () => this.zoneModal(),
      loadZone: () => this.zoneActions.loadZone(this.zoneActionContext()),
      setError: (message) => this.error.set(message),
      closeContextMenu: () => this.closeContextMenu(),
      recordCommanderCastIfNeeded: (playerId, fromZone, toZone) => this.recordCommanderCastIfNeeded(playerId, fromZone, toZone),
      command: (type, payload) => this.command(type, payload),
    };
  }

  private turnActionContext(): GameTableTurnActionContext {
    return {
      snapshot: () => this.snapshot(),
      players: () => this.players(),
      phases: () => this.phases,
      command: (type, payload) => this.command(type, payload),
    };
  }

  async draw(playerId: string, count = 1): Promise<void> {
    await this.libraryActions.draw(this.libraryActionContext(), playerId, count);
  }

  async drawCurrent(count = 1): Promise<void> {
    await this.libraryActions.drawCurrent(this.libraryActionContext(), count);
  }

  async shuffle(playerId: string): Promise<void> {
    await this.libraryActions.shuffle(this.libraryActionContext(), playerId);
  }

  async revealTop(playerId: string): Promise<void> {
    await this.libraryActions.revealTop(this.libraryActionContext(), playerId);
  }

  async moveTop(playerId: string, toZone: GameZoneName, count = 1): Promise<void> {
    await this.libraryActions.moveTop(this.libraryActionContext(), playerId, toZone, count);
  }

  async playCard(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    await this.cardActions.playCard(this.cardActionContext(), playerId, zone, card);
  }

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): void {
    if (!this.canControlOwnedCard(playerId, card)) {
      this.error.set('You can only move your own cards.');
      return;
    }
    if (event.detail > 1) {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    if (!this.drag.startBattlefieldPointerDrag(event, playerId, card)) {
      return;
    }
  }

  moveCardPointerDrag(event: PointerEvent): void {
    const draggingInstanceId = this.drag.moveCardPointerDrag(event, (playerId, instanceId, position) => {
      this.updateLocalCardPosition(playerId, instanceId, position);
    });
    if (draggingInstanceId && this.draggingCardInstanceId() !== draggingInstanceId) {
      this.beginCardDrag(draggingInstanceId);
    }
    if (draggingInstanceId) {
      this.ensureDraggingBattlefieldSelection(draggingInstanceId);
      this.battlefieldDrag.updateBattlefieldDragAid(event, draggingInstanceId, this.battlefieldDragContext());
      this.battlefieldDrag.updatePointerDropTarget(event, this.battlefieldDragContext());
      this.updatePointerDragPreview(draggingInstanceId);
    }
  }

  async endCardPointerDrag(event?: PointerEvent): Promise<void> {
    await this.pointerDragActions.endCardPointerDrag(this.pointerDragActionContext(), event);
  }

  cancelCardPointerDrag(event?: PointerEvent): void {
    this.drag.cancelCardPointerDrag(event);
    this.endCardDrag();
    this.selectedCards.set([]);
    this.applyDeferredRemoteSnapshot();
  }

  handleBattlefieldCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    this.interactionActions.handleBattlefieldCardClick(this.interactionContext(), event, playerId, card);
  }

  handleHandCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    this.interactionActions.handleHandCardClick(this.interactionContext(), event, playerId, card);
  }

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    if (!this.canControlOwnedCard(playerId, card)) {
      event.preventDefault();
      this.error.set('You can only move your own cards.');
      return;
    }

    this.drag.dragStart(event, playerId, zone, card, this.selectedDragInstanceIds(playerId, zone, card.instanceId));
    this.beginCardDrag(card.instanceId);
  }

  dragEnd(): void {
    this.endCardDrag();
    this.clearHandDropPreview();
    this.selectedCards.set([]);
    this.uiState.suppressCardPreview(450);
  }

  dragTopZoneCard(event: DragEvent, player: PlayerView, zone: GameZoneName): void {
    if (zone === 'library') {
      event.preventDefault();
      this.error.set('You cannot drag cards out of your library.');
      return;
    }

    const card = this.topDraggableCard(player, zone);
    if (!card) {
      event.preventDefault();
      return;
    }

    this.dragStart(event, player.id, zone, card);
  }

  allowDrop(event: DragEvent): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, this.battlefieldDragContext());
  }

  previewDropOnHand(event: DragEvent, targetPlayerId: string): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, this.battlefieldDragContext());
    this.battlefieldDrag.updateHandDropPreview(event, targetPlayerId, this.battlefieldDragContext());
  }

  updatePointerDropTarget(target: PointerDropTarget | null): void {
    this.battlefieldDragState.clearHandDropPreview();
    if (!target) {
      this.battlefieldDragState.clearDropTargets();
      return;
    }

    if (target.rawZone === 'mana') {
      this.battlefieldDragState.setActivePlayerDropTarget(null);
      this.battlefieldDragState.setActiveDropTarget(null);
      this.battlefieldDragState.setManaLaneDropPlayer(target.targetPlayerId);
      this.battlefieldDragState.setAlignmentGuide(null);
      return;
    }

    this.battlefieldDragState.setManaLaneDropPlayer(null);
    if (target.kind === 'player') {
      this.battlefieldDragState.setActivePlayerDropTarget(target.targetPlayerId);
      this.battlefieldDragState.setActiveDropTarget(null);
      return;
    }

    this.battlefieldDragState.setActivePlayerDropTarget(null);
    this.battlefieldDragState.setActiveDropTarget({ playerId: target.targetPlayerId, zone: target.toZone });
    if (target.toZone === 'battlefield') {
      this.battlefieldDrag.updateExternalBattlefieldAlignmentGuide(
        this.battlefieldDragContext(),
        target.targetPlayerId,
        target.draggedInstanceId ?? '',
        target.position,
      );
    } else {
      this.battlefieldDragState.setAlignmentGuide(null);
    }
  }

  previewHandDrop(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, this.battlefieldDragContext());
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged || dragged.zone !== 'hand' || dragged.playerId !== targetPlayerId || dragged.instanceId === targetCard.instanceId) {
      this.clearHandDropPreview();
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const placement = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    this.battlefieldDragState.setHandDropPreview({ playerId: targetPlayerId, targetInstanceId: targetCard.instanceId, placement });
  }

  clearHandDropPreview(): void {
    this.battlefieldDragState.clearHandDropPreview();
  }

  async reorderHandCard(
    playerId: string,
    movedInstanceId: string,
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const snapshot = this.snapshot();
    const hand = snapshot?.players[playerId]?.zones.hand ?? [];
    const movedCard = hand.find((card) => card.instanceId === movedInstanceId);
    if (!movedCard || !this.canControlOwnedCard(playerId, movedCard)) {
      this.error.set('You can only reorder your own hand.');
      return;
    }

    const movedInstanceIds = this.selectedDragInstanceIds(playerId, 'hand', movedInstanceId);
    if (movedInstanceIds.length > 1) {
      await this.reorderHandCards(playerId, movedInstanceIds, targetInstanceId, placement);
      return;
    }

    const fromIndex = hand.findIndex((card) => card.instanceId === movedInstanceId);
    const toIndex = hand.findIndex((card) => card.instanceId === targetInstanceId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const reordered = [...hand];
    const [moved] = reordered.splice(fromIndex, 1);
    const targetIndex = reordered.findIndex((card) => card.instanceId === targetInstanceId);
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    if (reordered[insertIndex]?.instanceId === movedInstanceId) {
      return;
    }

    reordered.splice(insertIndex, 0, moved);

    await this.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  async moveHandCardByPointer(
    playerId: string,
    targetPlayerId: string,
    movedInstanceId: string,
    toZone: GameZoneName,
    position?: { x: number; y: number },
    rawZone?: string,
  ): Promise<void> {
    const sourceCard = this.findCard(playerId, 'hand', movedInstanceId);
    if (!sourceCard || !this.canControlOwnedCard(playerId, sourceCard)) {
      this.error.set('You can only move your own cards.');
      return;
    }

    const battlefieldPosition = toZone === 'battlefield' && position
      ? this.snappedBattlefieldPosition(targetPlayerId, movedInstanceId, position, rawZone)
      : position;
    const movedInstanceIds = this.selectedDragInstanceIds(playerId, 'hand', movedInstanceId);
    if (toZone === 'battlefield' && rawZone === 'mana') {
      this.dropFeedbackState.markPendingManaDrop(targetPlayerId, movedInstanceIds);
    }
    if (movedInstanceIds.length > 1) {
      await this.moveSelectedHandCardsByPointer(playerId, targetPlayerId, movedInstanceIds, toZone, battlefieldPosition);
      return;
    }

    const payload: Record<string, unknown> = {
      playerId,
      fromZone: 'hand',
      toZone,
      targetPlayerId,
      instanceId: movedInstanceId,
    };
    if (toZone === 'battlefield' && battlefieldPosition) {
      payload['position'] = battlefieldPosition;
    }

    if (toZone === 'battlefield' && targetPlayerId !== playerId) {
      this.pendingTransferState.register({
        playerId,
        fromZone: 'hand',
        instanceIds: [movedInstanceId],
        sourceVersion: this.snapshot()?.version ?? null,
      });
      this.pendingBattlefieldMove.set({
        cardName: sourceCard.name,
        targetPlayerName: this.playerName(targetPlayerId),
        payload,
      });
      this.selectedCards.set([]);
      return;
    }

    await this.command('card.moved', payload);
    await this.recordCommanderCastIfNeeded(playerId, 'hand', toZone, targetPlayerId);
    this.selectedCards.set([]);
  }

  async dropOnZone(event: DragEvent, targetPlayerId: string, toZone: GameZoneName): Promise<void> {
    await this.dropActions.dropOnZone(this.dropActionContext(), event, targetPlayerId, toZone);
  }

  async dropOnManaLane(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropOnZone(event, targetPlayerId, 'battlefield');
  }

  async dropOnHand(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropActions.dropOnHand(this.dropActionContext(), event, targetPlayerId);
  }

  async dropOnHandCard(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): Promise<void> {
    await this.dropActions.dropOnHandCard(this.dropActionContext(), event, targetPlayerId, targetCard);
  }

  async confirmPendingBattlefieldMove(): Promise<void> {
    const pendingMove = this.pendingBattlefieldMove();
    if (!pendingMove) {
      return;
    }

    await this.dropActions.confirmPendingBattlefieldMove(this.dropActionContext(), pendingMove);
  }

  async cancelPendingBattlefieldMove(): Promise<void> {
    this.pendingTransferState.clear();
    await this.refetch(true);
    this.pendingBattlefieldMove.set(null);
  }

  async confirmPendingLibraryMove(position: 'top' | 'bottom'): Promise<void> {
    const pendingMove = this.pendingLibraryMove();
    if (!pendingMove) {
      return;
    }

    await this.dropActions.confirmPendingLibraryMove(this.dropActionContext(), pendingMove, position);
  }

  async cancelPendingLibraryMove(): Promise<void> {
    this.pendingTransferState.clear();
    await this.refetch(true);
    this.pendingLibraryMove.set(null);
  }

  async dropOnPlayer(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropActions.dropOnPlayer(this.dropActionContext(), event, targetPlayerId);
  }

  async moveFocusedZoneToBattlefield(zone: GameZoneName): Promise<void> {
    const selected = this.selectedCards()[0];
    if (!selected || selected.zone !== zone) {
      return;
    }

    await this.playCard(selected.playerId, selected.zone, selected.card);
  }

  async moveCard(menu: GameContextMenu, toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveCard(this.cardActionContext(), menu, toZone);
  }

  async moveSelected(toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveSelected(this.cardActionContext(), toZone);
  }

  async moveActiveCard(toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveActiveCard(this.cardActionContext(), toZone);
  }

  async tapCard(menu: GameContextMenu): Promise<void> {
    await this.cardActions.tapCard(this.cardActionContext(), menu);
  }

  async faceDown(menu: GameContextMenu): Promise<void> {
    await this.cardActions.faceDown(this.cardActionContext(), menu);
  }

  async revealCard(menu: GameContextMenu): Promise<void> {
    await this.cardActions.revealCard(this.cardActionContext(), menu);
  }

  async tokenCopy(menu: GameContextMenu): Promise<void> {
    await this.cardActions.tokenCopy(this.cardActionContext(), menu);
  }

  async setPowerToughness(menu: GameContextMenu, power: number, toughness: number): Promise<void> {
    await this.cardActions.setPowerToughness(this.cardActionContext(), menu, power, toughness);
  }

  async changeCardCounter(menu: GameContextMenu, key = '+1/+1', delta = 1): Promise<void> {
    await this.cardActions.changeCardCounter(this.cardActionContext(), menu, key, delta);
  }

  async addToStack(menu: GameContextMenu): Promise<void> {
    await this.cardActions.addToStack(this.cardActionContext(), menu);
  }

  async toggleTapped(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    await this.cardActions.toggleTapped(this.cardActionContext(), playerId, zone, card);
  }

  async moveBattlefieldCard(playerId: string, card: GameCardInstance, event: DragEvent): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }
    const position = this.drag.dropPosition(event, 'battlefield');
    if (!position) {
      return;
    }

    await this.command('card.position.changed', {
      playerId,
      zone: 'battlefield',
      instanceId: card.instanceId,
      position,
    });
  }

  async moveZoneCard(card: GameCardInstance, toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveZoneCard(this.cardActionContext(), card, toZone);
  }

  async revealZoneCard(card: GameCardInstance): Promise<void> {
    await this.cardActions.revealZoneCard(this.cardActionContext(), card);
  }

  async openZone(playerId: string, zone: GameZoneName): Promise<void> {
    await this.zoneActions.openZone(this.zoneActionContext(), playerId, zone);
  }

  async loadZone(): Promise<void> {
    await this.zoneActions.loadZone(this.zoneActionContext());
  }

  updateZoneFilter(patch: Partial<{ type: string; search: string }>): void {
    this.zoneActions.updateZoneFilter(this.zoneActionContext(), patch);
  }

  selectZoneCard(card: GameCardInstance): void {
    this.zoneActions.selectZoneCard(card);
  }

  closeZoneModal(): void {
    this.zoneActions.closeZoneModal();
  }

  startFloatingDrag(event: PointerEvent): void {
    this.uiState.startFloatingDrag(event);
  }

  moveFloatingPanel(event: PointerEvent): void {
    this.uiState.moveFloatingPanel(event);
  }

  endFloatingDrag(): void {
    this.uiState.endFloatingDrag();
  }

  async command(type: GameCommandType, payload: Record<string, unknown>, force = false): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) {
      return;
    }
    if (this.pending() && !force) {
      this.error.set('Wait for the current table action to finish.');
      return;
    }

    this.pending.set(true);
    this.error.set(null);
    this.registerPendingTransferForCommand(type, payload);
    try {
      const snapshot = await this.commands.send(gameId, type, payload);
      this.setSnapshot(snapshot);
    } catch (error) {
      this.pendingTransferState.clear();
      this.error.set(this.errorMessage(error));
    } finally {
      this.pending.set(false);
    }
  }

  async concedeGame(): Promise<void> {
    const current = this.currentPlayer();
    if (current?.state.status === 'conceded') {
      this.closeContextMenu();
      return;
    }

    this.closeContextMenu();
    await this.command('game.concede', {}, true);
  }

  async concede(): Promise<void> {
    await this.concedeGame();
  }

  async closeGame(): Promise<void> {
    if (!this.isGameOwner()) {
      return;
    }

    await this.command('game.close', {});
    await this.router.navigate(['/rooms']);
  }

  async leaveTable(): Promise<void> {
    await this.router.navigate(['/rooms']);
  }

  async copyGameId(): Promise<void> {
    await navigator.clipboard?.writeText(this.gameId());
    this.closeContextMenu();
  }

  toggleFloatingMinimized(): void {
    this.uiState.toggleFloatingMinimized();
  }

  async changeCardPower(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changePower(this.cardStatsContext(), playerId, zone, card, delta);
  }

  async changeCardToughness(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changeToughness(this.cardStatsContext(), playerId, zone, card, delta);
  }

  private applyDeferredRemoteSnapshot(): void {
    this.session.applyDeferredRemoteSnapshot(this.sessionContext());
  }

  private registerPendingTransferForCommand(type: GameCommandType, payload: Record<string, unknown>): void {
    switch (type) {
      case 'card.moved':
      case 'cards.moved':
        this.registerCardMovePendingTransfer(payload);
        return;
      case 'library.draw':
        this.registerLibraryTopPendingTransfer(payload, 'hand');
        return;
      case 'library.move_top':
        this.registerLibraryTopPendingTransfer(payload, payload['toZone']);
        return;
      case 'zone.move_all':
        this.registerZoneMoveAllPendingTransfer(payload);
        return;
    }
  }

  private registerCardMovePendingTransfer(payload: Record<string, unknown>): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const fromZone = this.zonePayload(payload, 'fromZone');
    const toZone = this.zonePayload(payload, 'toZone');
    const targetPlayerId = this.stringPayload(payload, 'targetPlayerId') ?? playerId;
    const instanceIds = this.instanceIdsPayload(payload);
    if (!playerId || !fromZone || !toZone || instanceIds.length === 0) {
      return;
    }
    if (fromZone === toZone && playerId === targetPlayerId) {
      return;
    }

    this.pendingTransferState.register({
      playerId,
      fromZone,
      instanceIds,
      sourceVersion: this.snapshot()?.version ?? null,
    });
  }

  private registerLibraryTopPendingTransfer(payload: Record<string, unknown>, toZoneValue: unknown): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const toZone = this.zoneValue(toZoneValue);
    if (!playerId || toZone === 'library') {
      return;
    }

    const rawCount = Number(payload['count'] ?? 1);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1;
    const library = this.snapshot()?.players[playerId]?.zones.library ?? [];
    const instanceIds = library.slice(0, count).map((card) => card.instanceId);
    this.pendingTransferState.register({
      playerId,
      fromZone: 'library',
      instanceIds,
      sourceVersion: this.snapshot()?.version ?? null,
    });
  }

  private registerZoneMoveAllPendingTransfer(payload: Record<string, unknown>): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const fromZone = this.zonePayload(payload, 'fromZone');
    const toZone = this.zonePayload(payload, 'toZone');
    if (!playerId || !fromZone || !toZone || fromZone === toZone) {
      return;
    }

    const instanceIds = this.snapshot()?.players[playerId]?.zones[fromZone]?.map((card) => card.instanceId) ?? [];
    this.pendingTransferState.register({
      playerId,
      fromZone,
      instanceIds,
      sourceVersion: this.snapshot()?.version ?? null,
    });
  }

  private instanceIdsPayload(payload: Record<string, unknown>): string[] {
    const instanceIds = payload['instanceIds'];
    if (Array.isArray(instanceIds)) {
      return instanceIds.filter((instanceId): instanceId is string => typeof instanceId === 'string' && instanceId !== '');
    }

    const instanceId = this.stringPayload(payload, 'instanceId');
    return instanceId ? [instanceId] : [];
  }

  private stringPayload(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key];
    return typeof value === 'string' && value !== '' ? value : null;
  }

  private zonePayload(payload: Record<string, unknown>, key: string): GameZoneName | null {
    return this.zoneValue(payload[key]);
  }

  private zoneValue(value: unknown): GameZoneName | null {
    return typeof value === 'string' && this.zones.includes(value as GameZoneName) ? value as GameZoneName : null;
  }

  private setSnapshot(snapshot: GameSnapshot | null): void {
    this.dropFeedbackState.trackSnapshot(snapshot);
    this.pendingTransferState.reconcileSnapshot(snapshot);
    this.snapshot.set(snapshot);
  }

  private playerName(playerId: string): string {
    return this.snapshot()?.players[playerId]?.user.displayName ?? playerId;
  }

  private updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.position = position;
      this.setSnapshot(next);
    }
  }

  private snappedBattlefieldPosition(
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    rawZone?: string,
  ): { x: number; y: number } {
    if (rawZone === 'mana') {
      return position;
    }

    return this.battlefieldDrag.positionWithAlignmentGuide(
      this.battlefieldDragContext(),
      playerId,
      instanceId,
      position,
      this.alignmentGuideFor(playerId)?.y ?? null,
    );
  }

  private battlefieldDragContext(): GameTableBattlefieldDragContext {
    return {
      zones: this.zones,
      snapshot: () => this.snapshot(),
      selectedCards: () => this.selectedCards(),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      updateLocalCardPosition: (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
    };
  }

  private cardStatsContext(): GameTableCardStatsContext {
    return {
      canControlOwnedCard: (playerId, card) => this.canControlOwnedCard(playerId, card),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      updateLocalCardPowerToughness: (playerId, zone, instanceId, power, toughness) =>
        this.updateLocalCardPowerToughness(playerId, zone, instanceId, power, toughness),
      setError: (message) => this.error.set(message),
      command: (type, payload, force) => this.command(type, payload, force),
    };
  }

  private dropActionContext(): GameTableDropActionContext {
    return {
      zones: this.zones,
      snapshot: () => this.snapshot(),
      handDropPreview: () => this.handDropPreview(),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      canControlPlayer: (playerId) => this.canControlPlayer(playerId),
      canControlOwnedCard: (playerId, card) => this.canControlOwnedCard(playerId, card),
      playerName: (playerId) => this.playerName(playerId),
      setPendingBattlefieldMove: (move) => this.pendingBattlefieldMove.set(move),
      setPendingLibraryMove: (move) => this.pendingLibraryMove.set(move),
      endCardDrag: () => this.endCardDrag(),
      clearHandDropPreview: () => this.clearHandDropPreview(),
      clearSelectedCards: () => this.selectedCards.set([]),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      setError: (message) => this.error.set(message),
      snapBattlefieldPosition: (playerId, instanceId, position, rawZone) =>
        this.snappedBattlefieldPosition(playerId, instanceId, position, rawZone),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
      }),
      command: (type, payload) => this.command(type, payload),
      recordCommanderCastIfNeeded: (playerId, fromZone, toZone, targetPlayerId) =>
        this.recordCommanderCastIfNeeded(playerId, fromZone, toZone, targetPlayerId),
    };
  }

  private pointerDragActionContext(): GameTablePointerDragActionContext {
    return {
      zones: this.zones,
      snapshot: () => this.snapshot(),
      handDropPreview: () => this.handDropPreview(),
      selectedCards: () => this.selectedCards(),
      battlefieldDragContext: () => this.battlefieldDragContext(),
      alignmentGuideY: (playerId) => this.alignmentGuideFor(playerId)?.y ?? null,
      isManaLaneHighlighted: (playerId) => this.isManaLaneHighlighted(playerId),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      canControlPlayer: (playerId) => this.canControlPlayer(playerId),
      canControlOwnedCard: (playerId, card) => this.canControlOwnedCard(playerId, card),
      playerName: (playerId) => this.playerName(playerId),
      updateLocalCardPosition: (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
      setPendingBattlefieldMove: (move) => this.pendingBattlefieldMove.set(move),
      setPendingLibraryMove: (move) => this.pendingLibraryMove.set(move),
      endCardDrag: () => this.endCardDrag(),
      clearSelectedCards: () => this.selectedCards.set([]),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      applyDeferredRemoteSnapshot: () => this.applyDeferredRemoteSnapshot(),
      refetch: (force) => this.refetch(force),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
      }),
      command: (type, payload) => this.command(type, payload),
    };
  }

  private zoneActionContext(): GameTableZoneActionContext {
    return {
      gameId: () => this.gameId(),
      playerName: (playerId) => this.playerName(playerId),
      zoneTitle: (zone) => this.zoneTitle(zone),
    };
  }

  private interactionContext(): GameTableInteractionContext {
    return {
      currentPlayer: () => this.currentPlayer(),
      focusedPlayer: () => this.focusedPlayer(),
      setError: (message) => this.error.set(message),
      playCard: (playerId, zone, card) => this.playCard(playerId, zone, card),
    };
  }

  private sessionContext(): GameTableSessionContext {
    return {
      gameId: () => this.gameId(),
      snapshot: () => this.snapshot(),
      setSnapshot: (snapshot) => this.setSnapshot(snapshot),
      focusedPlayerId: () => this.focusedPlayerId(),
      setFocusedPlayerId: (playerId) => this.focusedPlayerId.set(playerId),
      ownPlayerId: (snapshot) => this.ownPlayerId(snapshot),
      hasActivePointerDrag: () => this.drag.hasActivePointerDrag(),
      isPending: () => this.pending(),
      setLoading: (loading) => this.loading.set(loading),
      setError: (message) => this.error.set(message),
    };
  }

  private updateLocalCardPowerToughness(playerId: string, zone: GameZoneName, instanceId: string, power: number, toughness: number): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones[zone]?.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.power = power;
      card.toughness = toughness;
      this.setSnapshot(next);
    }
  }

  private async recordCommanderCastIfNeeded(
    playerId: string,
    fromZone: GameZoneName,
    toZone: GameZoneName = 'battlefield',
    targetPlayerId: string = playerId,
  ): Promise<void> {
    const player = this.players().find((candidate) => candidate.id === playerId);
    if (!player || fromZone !== 'command' || toZone !== 'battlefield' || targetPlayerId !== playerId) {
      return;
    }

    await this.command('counter.changed', {
      scope: `commander:${playerId}`,
      key: 'casts',
      value: this.commanderCastCount(player) + 1,
    });
  }

  private findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null {
    return this.snapshot()?.players[playerId]?.zones[zone]?.find((card) => card.instanceId === instanceId) ?? null;
  }

  private ownPlayerId(snapshot: GameSnapshot): string | null {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return null;
    }

    return Object.entries(snapshot.players).find(([, player]) => player.user.id === userId)?.[0] ?? null;
  }

  private beginCardDrag(instanceId: string): void {
    this.hideCardPreview();
    this.battlefieldDragState.beginCardDrag(instanceId);
  }

  private endCardDrag(): void {
    this.hideCardPreview();
    this.battlefieldDragState.endCardDrag();
  }

  private updatePointerDragPreview(instanceId: string): void {
    const selected = this.battlefieldSelectionByInstanceId(instanceId);
    const preview = this.drag.pointerDragPreview();
    if (!selected || !preview) {
      return;
    }

    this.battlefieldDragState.setPointerDragPreview({
      card: selected.card,
      x: preview.x,
      y: preview.y,
      width: preview.width,
      height: preview.height,
      count: this.selectedDragInstanceIds(selected.playerId, 'battlefield', instanceId).length,
    });
  }

  private ensureDraggingBattlefieldSelection(instanceId: string): void {
    if (this.selectedCards().some((item) => item.card.instanceId === instanceId)) {
      return;
    }

    const selected = this.battlefieldSelectionByInstanceId(instanceId);
    if (selected) {
      this.selectedCards.set([selected]);
    }
  }

  private selectedDragInstanceIds(playerId: string, zone: GameZoneName, instanceId: string): string[] {
    const selected = this.selectedCards();
    const canUseSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === instanceId)
      && selected.every((item) => item.playerId === playerId && item.zone === zone);

    return canUseSelection ? selected.map((item) => item.card.instanceId) : [instanceId];
  }

  private async reorderHandCards(
    playerId: string,
    movedInstanceIds: readonly string[],
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const hand = this.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedIds = new Set(movedInstanceIds);
    if (movedIds.has(targetInstanceId)) {
      return;
    }

    const movedCards = hand.filter((card) => movedIds.has(card.instanceId));
    if (movedCards.length !== movedIds.size || movedCards.some((card) => !this.canControlOwnedCard(playerId, card))) {
      this.error.set('You can only reorder your own hand.');
      return;
    }

    const withoutMoved = hand.filter((card) => !movedIds.has(card.instanceId));
    const targetIndex = withoutMoved.findIndex((card) => card.instanceId === targetInstanceId);
    if (targetIndex < 0) {
      return;
    }

    const reordered = [...withoutMoved];
    reordered.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, ...movedCards);
    await this.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  private async moveSelectedHandCardsByPointer(
    playerId: string,
    targetPlayerId: string,
    movedInstanceIds: readonly string[],
    toZone: GameZoneName,
    position?: { x: number; y: number },
  ): Promise<void> {
    const hand = this.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedCards = movedInstanceIds
      .map((instanceId) => hand.find((card) => card.instanceId === instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));
    if (movedCards.length !== movedInstanceIds.length || movedCards.some((card) => !this.canControlOwnedCard(playerId, card))) {
      this.error.set('You can only move your own cards.');
      return;
    }

    if (toZone === 'battlefield' && targetPlayerId !== playerId) {
      this.pendingTransferState.register({
        playerId,
        fromZone: 'hand',
        instanceIds: movedInstanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
      });
      this.pendingBattlefieldMove.set({
        cardName: `${movedCards.length} cards`,
        targetPlayerName: this.playerName(targetPlayerId),
        commandType: 'cards.moved',
        payload: {
          playerId,
          fromZone: 'hand',
          toZone,
          targetPlayerId,
          instanceIds: movedInstanceIds,
        },
      });
      this.selectedCards.set([]);
      return;
    }

    if (toZone === 'battlefield' && position) {
      this.pendingTransferState.register({
        playerId,
        fromZone: 'hand',
        instanceIds: movedInstanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
      });
      for (const instanceId of movedInstanceIds) {
        await this.command('card.moved', {
          playerId,
          fromZone: 'hand',
          toZone,
          targetPlayerId,
          instanceId,
          position,
        });
      }
      this.selectedCards.set([]);
      return;
    }

    await this.command('cards.moved', {
      playerId,
      fromZone: 'hand',
      toZone,
      targetPlayerId,
      instanceIds: movedInstanceIds,
    });
    this.selectedCards.set([]);
  }

  private battlefieldSelectionByInstanceId(instanceId: string): SelectedCard | null {
    for (const player of this.players()) {
      const card = player.state.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return { playerId: player.id, zone: 'battlefield', card };
      }
    }

    return null;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'Could not apply game action.';
    }

    return 'Could not apply game action.';
  }

  private handlePendingTransferExpired(_expiration: PendingTransferExpiration): void {
    this.pendingBattlefieldMove.set(null);
    this.pendingLibraryMove.set(null);
    this.selectedCards.set([]);
    this.error.set('Card move did not complete. No changes were applied; try again.');
    void this.refetch(true);
  }

  private scheduleErrorDismiss(message: string | null, canDismiss: boolean): void {
    this.clearErrorDismissTimer();
    if (!message || !canDismiss) {
      return;
    }

    this.errorToastTimer = window.setTimeout(() => {
      if (this.error() === message) {
        this.error.set(null);
      }
      this.errorToastTimer = null;
    }, this.errorToastDurationMs);
  }

  private clearErrorDismissTimer(): void {
    if (this.errorToastTimer === null) {
      return;
    }

    window.clearTimeout(this.errorToastTimer);
    this.errorToastTimer = null;
  }
}
