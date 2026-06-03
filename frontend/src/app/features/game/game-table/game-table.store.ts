import { Injectable, OnDestroy, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { Card } from '../../../core/models/card.model';
import { ChatReactionType, GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../core/models/game.model';
import { GameTableDebouncedValueCommandsService } from './services/game-table-debounced-value-commands.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { AlignmentGuide } from './state/drag-drop/game-table-battlefield-drag.state';
import { GameTableDropFeedbackState } from './state/drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState, type PendingTransferExpiration } from './state/core/game-table-pending-transfer.state';
import { GameTableSnapshotSelectors, PlayerView } from './state/core/game-table-snapshot-selectors';
import { GameContextMenu, GameTableUiState } from './state/core/game-table-ui.state';
import { CardPreviewEvent, previewRectFromElement } from './models/card-preview.model';
import { GameTableZoneModalState } from './state/zones/game-table-zone-modal.state';
import { GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsService } from './services/game-table-card-stats.service';
import { PendingBattlefieldMove, PendingLibraryMove } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService } from './services/game-table-interaction-actions.service';
import { PointerDropTarget } from './services/game-table-pointer-drag.service';
import { GameTableZonePointerMoveActionsService } from './services/game-table-zone-pointer-move-actions.service';
import { GameTableSessionService } from './services/game-table-session.service';
import { GameTableZoneActionsService } from './services/game-table-zone-actions.service';
import { BattlefieldSize } from './utils/battlefield-position';
import { SelectedCard } from './models/game-table-card.model';
import { DiceRollCommand } from './models/game-table-dice.model';
import { GameTableSyncStatus } from './models/game-table-sync.model';
import { ZonePointerDropRequest } from './models/game-table-zone-pointer-drag.model';
import { GameTableArrowsState } from './state/arrows/game-table-arrows.state';
import { GameTableAttachmentsState } from './state/attachments/game-table-attachments.state';
import { GameTableBattlefieldState } from './state/battlefield/game-table-battlefield.state';
import { GameTableCardsState } from './state/cards/game-table-cards.state';
import { GameTableChatStore } from './state/chat/game-table-chat.store';
import { GameTableCommandStore } from './state/core/game-table-command.store';
import { GameTableContextStore } from './state/core/game-table-context.store';
import { GameTableCountersState } from './state/cards/game-table-counters.state';
import { GameTableCoreState } from './state/core/game-table-core.state';
import { GameTableDragDropStore } from './state/drag-drop/game-table-drag-drop.store';
import { GameTableGameActionsStore } from './state/game-actions/game-table-game-actions.store';
import { GameTableHandState } from './state/hand/game-table-hand.state';
import { GameTableLibraryTopState } from './state/zones/game-table-library-top.state';
import { GameTableOpponentTargetsState } from './state/arrows/game-table-opponent-targets.state';
import { GameTablePlayersStore } from './state/players/game-table-players.store';
import { GameTablePermanentRelationService } from './services/game-table-permanent-relation.service';
import { GameTableSnapshotCoordinatorState } from './state/core/game-table-snapshot-coordinator.state';
import { GameTableToastState } from './state/core/game-table-toast.state';
import { GameTableZonePilesState } from './state/zones/game-table-zone-piles.state';
import { clampPlayerLife } from './utils/player-life-bounds';
import { GameTableWebsocketGameplayService } from './services/game-table-websocket-gameplay.service';
import { GameTableManaPoolState, ManaPool } from './state/mana/game-table-mana-pool.state';
import { ManaAddition, ManaPoolColor, ManaSourceSuggestion } from './utils/mana-source-detector';
import { automaticTapOnlyManaSourceSuggestionWithAttachments, detectManaSourceWithAttachments } from './utils/mana-source-attachment-detector';

export type { PlayerView } from './state/core/game-table-snapshot-selectors';
export type { SelectedCard } from './models/game-table-card.model';
export type { ChatRecipientOption } from './models/game-table-chat.model';
export type { GameTableSyncStatus } from './models/game-table-sync.model';

interface AutomaticTapManaTarget extends SelectedCard {
  readonly suggestion: ManaSourceSuggestion;
}

@Injectable()
export class GameTableStore implements OnDestroy {
  private openingRevealedLibraryPlayerId: string | null = null;
  private locallyConcededPlayerId: string | null = null;

  private readonly debouncedValueCommands = inject(GameTableDebouncedValueCommandsService);
  private readonly cardActions = inject(GameTableCardActionsService);
  private readonly cardStats = inject(GameTableCardStatsService);
  private readonly drag = inject(GameTableDragService);
  private readonly interactionActions = inject(GameTableInteractionActionsService);
  private readonly libraryActions = inject(GameTableLibraryActionsService);
  private readonly turnActions = inject(GameTableTurnActionsService);
  private readonly zoneActions = inject(GameTableZoneActionsService);
  private readonly zonePointerMoveActions = inject(GameTableZonePointerMoveActionsService);
  private readonly session = inject(GameTableSessionService);
  private readonly websocketGameplay = inject(GameTableWebsocketGameplayService);
  private readonly selection = inject(GameTableSelectionService);
  private readonly coreState = inject(GameTableCoreState);
  private readonly arrowsState = inject(GameTableArrowsState);
  private readonly attachmentsState = inject(GameTableAttachmentsState);
  private readonly battlefieldState = inject(GameTableBattlefieldState);
  private readonly cardsState = inject(GameTableCardsState);
  private readonly chatStore = inject(GameTableChatStore);
  private readonly commandStore = inject(GameTableCommandStore);
  private readonly contexts = inject(GameTableContextStore);
  private readonly countersState = inject(GameTableCountersState);
  private readonly dragDropStore = inject(GameTableDragDropStore);
  private readonly gameActionsStore = inject(GameTableGameActionsStore);
  private readonly handState = inject(GameTableHandState);
  private readonly libraryTopState = inject(GameTableLibraryTopState);
  private readonly opponentTargetsState = inject(GameTableOpponentTargetsState);
  private readonly playersStore = inject(GameTablePlayersStore);
  private readonly permanentRelations = inject(GameTablePermanentRelationService);
  private readonly snapshotCoordinatorState = inject(GameTableSnapshotCoordinatorState);
  private readonly toastState = inject(GameTableToastState);
  private readonly zonePilesState = inject(GameTableZonePilesState);
  private readonly manaPoolState = inject(GameTableManaPoolState);
  private readonly uiState = inject(GameTableUiState);
  private readonly zoneModalState = inject(GameTableZoneModalState);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);
  private readonly selectors = inject(GameTableSnapshotSelectors);

  readonly zones = this.coreState.zones;
  readonly dockZones = this.coreState.dockZones;
  readonly publicZones = this.coreState.publicZones;
  readonly phases = this.coreState.phases;
  readonly gameId = this.coreState.gameId;
  readonly snapshot = this.coreState.snapshot;
  readonly viewerCanControlTable = this.coreState.viewerCanControlTable;
  readonly currentDeckId = this.coreState.currentDeckId;
  private readonly shuffleLibraryOnModalClosePlayerId = signal<string | null>(null);
  private readonly shuffleLibraryOnModalCloseReason = signal<'owner-view' | 'revealed-library-closed' | null>(null);
  readonly focusedPlayerId = this.uiState.focusedPlayerId;
  readonly selectedCards: WritableSignal<SelectedCard[]> = this.selection.selectedCards as WritableSignal<SelectedCard[]>;
  readonly hoveredCard = this.uiState.hoveredCard;
  readonly hoveredPreview = this.uiState.hoveredPreview;
  readonly contextMenu = this.uiState.contextMenu;
  readonly zoneModal = this.zoneModalState.zoneModal;
  readonly activeFloatingTab = this.uiState.activeFloatingTab;
  readonly floatingPanel = this.uiState.floatingPanel;
  readonly floatingMinimized = this.uiState.floatingMinimized;
  readonly chatMessage = this.chatStore.chatMessage;
  readonly chatTargetPlayerId = this.chatStore.chatTargetPlayerId;
  readonly loading = this.coreState.loading;
  readonly error = this.coreState.error;
  readonly targetToast = this.coreState.targetToast;
  readonly tableToast = this.coreState.tableToast;
  readonly pending = this.coreState.pending;
  readonly pendingBattlefieldMove = signal<PendingBattlefieldMove | null>(null);
  readonly pendingLibraryMove = signal<PendingLibraryMove | null>(null);
  readonly pendingArrowSource = this.arrowsState.pendingArrowSource;
  readonly pendingAttachmentSource = this.attachmentsState.pendingAttachmentSource;
  readonly draggingCardInstanceId = this.dragDropStore.draggingCardInstanceId;
  readonly handDropPreview = this.handState.handDropPreview;
  readonly manaLaneDropPlayerId = this.dragDropStore.manaLaneDropPlayerId;
  readonly landStackDropPreview = this.dragDropStore.landStackDropPreview;
  readonly handExternalRevealAllowed = this.dragDropStore.handExternalRevealAllowed;
  readonly alignmentGuide = this.dragDropStore.alignmentGuide;
  readonly activeDropTarget = this.dragDropStore.activeDropTarget;
  readonly activePlayerDropTarget = this.dragDropStore.activePlayerDropTarget;
  readonly pointerDragPreview = this.dragDropStore.pointerDragPreview;
  readonly players = this.playersStore.players;
  readonly focusedPlayer = this.playersStore.focusedPlayer;
  readonly eventLog = this.chatStore.eventLog;
  readonly currentPlayer = this.playersStore.currentPlayer;
  readonly handPlayer = this.playersStore.handPlayer;
  readonly opponentTargetingPills = this.opponentTargetsState.opponentTargetingPills;
  readonly opponentCardsTargetCards = this.opponentTargetsState.opponentCardsTargetCards;
  readonly chatRecipients = this.chatStore.chatRecipients;
  readonly shouldShowChatRecipientSelect = this.chatStore.shouldShowChatRecipientSelect;
  readonly isGameOwner = this.playersStore.isGameOwner;
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
      degraded: 'Live degraded',
    };

    return labels[this.syncStatus()];
  });

  private readonly hiddenManaPoolPlayerIds = signal<ReadonlySet<string>>(new Set());
  readonly manaPool = (playerId: string): ManaPool => this.manaPoolState.pool(playerId);
  readonly isManaPoolHidden = (playerId: string): boolean => this.hiddenManaPoolPlayerIds().has(playerId);

  constructor() {
    this.contexts.bind({
      setSnapshot: (snapshot) => this.setSnapshot(snapshot),
      refetch: (force) => this.refetch(force),
      command: (type, payload, force) => this.command(type, payload, force),
      playCard: (playerId, zone, card) => this.playCard(playerId, zone, card),
      setPendingBattlefieldMove: (move) => this.pendingBattlefieldMove.set(move),
      setPendingLibraryMove: (move) => {
        this.clearCardPreview();
        this.pendingLibraryMove.set(move);
      },
      pendingBattlefieldMove: () => this.pendingBattlefieldMove(),
      pendingLibraryMove: () => this.pendingLibraryMove(),
    });
    this.pendingTransferState.setExpirationHandler((expiration) => this.handlePendingTransferExpired(expiration));
    effect(() => {
      this.toastState.scheduleErrorDismiss(this.error(), this.snapshot() !== null);
    });
    void this.load();
  }

  ngOnDestroy(): void {
    this.toastState.destroy();
    this.debouncedValueCommands.clear();
    this.cardsState.clearCardCounterFlushTimers();
    this.uiState.destroy();
    this.cardStats.clear();
    this.dropFeedbackState.destroy();
    this.pendingTransferState.setExpirationHandler(null);
    this.pendingTransferState.clear();
    this.session.stop();
  }

  async load(): Promise<void> {
    await Promise.all([
      this.gameActionsStore.refreshViewerControlAccess(),
      this.session.load(this.contexts.session()),
    ]);
  }

  async refetch(force = false): Promise<void> {
    if (force) {
      this.dragDropStore.clearForceRefreshState();
    }
    await Promise.all([
      this.gameActionsStore.refreshViewerControlAccess(),
      this.session.refetch(this.contexts.session(), force),
    ]);
  }

  focusPlayer(playerId: string): boolean {
    return this.playersStore.focusPlayer(playerId);
  }

  focusCurrentPlayer(): void {
    this.playersStore.focusCurrentPlayer();
  }

  isCurrentPlayer(playerId: string): boolean {
    return this.playersStore.isCurrentPlayer(playerId, this.contexts.interaction());
  }

  canControlPlayer(playerId: string): boolean {
    return this.playersStore.canControlPlayer(playerId, this.contexts.interaction());
  }

  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean {
    return this.playersStore.canControlOwnedCard(playerId, card, this.contexts.interaction());
  }

  canDragBattlefieldCard(playerId: string, card: GameCardInstance): boolean {
    return this.canControlOwnedCard(playerId, card);
  }

  handleTableClick(event: MouseEvent): void {
    this.closeContextMenu();
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-card-instance-id], .context-menu, .zone-modal, app-modal')) {
      this.clearCardPreview();
      this.clearSelection();
      this.pendingArrowSource.set(null);
      this.pendingAttachmentSource.set(null);
    }
  }

  canUseHiddenZone(playerId: string, zone: GameZoneName): boolean {
    return this.interactionActions.canUseHiddenZone(this.contexts.interaction(), playerId, zone);
  }

  zoneTitle(zone: GameZoneName): string {
    return this.zonePilesState.zoneTitle(zone);
  }

  playerDisplayName(playerId: string): string {
    return this.playersStore.playerDisplayName(playerId);
  }

  zoneCount(player: PlayerView, zone: GameZoneName): number {
    return this.playersStore.zoneCount(player, zone);
  }

  zoneCardCountById(playerId: string, zone: GameZoneName): number {
    return this.playersStore.zoneCardCountById(playerId, zone);
  }

  zoneCardInstanceIds(playerId: string, zone: GameZoneName): string[] {
    return this.playersStore.zoneCardInstanceIds(playerId, zone);
  }

  commanderCastCount(player: PlayerView): number {
    return this.playersStore.commanderCastCount(player);
  }

  countItems(count: number): number[] {
    return this.cardsState.countItems(count);
  }

  cardImage(card: GameCardInstance): string | null {
    return this.cardsState.cardImage(card);
  }

  publicCardImage(card: GameCardInstance): string | null {
    return this.cardsState.publicCardImage(card);
  }

  cardBackImage(player?: PlayerView | null): string {
    return this.cardsState.cardBackImage(player);
  }

  gameBackgroundImage(player: PlayerView | null): string {
    return this.playersStore.gameBackgroundImage(player);
  }

  shouldShowCardBack(card: GameCardInstance): boolean {
    return this.cardsState.shouldShowCardBack(card);
  }

  deckLabel(player: PlayerView | null): string {
    return this.playersStore.deckLabel(player);
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    return this.cardsState.firstCounter(card);
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return this.cardsState.hasPowerToughness(card);
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.cardsState.shouldShowPowerToughness(card);
  }

  cardPowerValue(card: GameCardInstance): number | null {
    return this.cardsState.cardPowerValue(card);
  }

  cardToughnessValue(card: GameCardInstance): number | null {
    return this.cardsState.cardToughnessValue(card);
  }

  isHandDropTarget(playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean {
    return this.handState.isHandDropTarget(playerId, card, placement);
  }

  isCardDropSettling(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.dragDropStore.isCardDropSettling(playerId, zone, card);
  }

  isManaDropSettling(playerId: string, card: GameCardInstance): boolean {
    return this.dragDropStore.isManaDropSettling(playerId, card);
  }

  isBattlefieldEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dragDropStore.isBattlefieldEntrySettling(playerId, card);
  }

  isCommanderEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dragDropStore.isCommanderEntrySettling(playerId, card);
  }

  isZoneDropSettling(playerId: string, zone: GameZoneName): boolean {
    return this.dragDropStore.isZoneDropSettling(playerId, zone);
  }

  isCardTransferPending(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.dragDropStore.isCardTransferPending(playerId, zone, card);
  }

  isZoneTransferPending(playerId: string, zone: GameZoneName): boolean {
    return this.dragDropStore.isZoneTransferPending(playerId, zone);
  }

  cardPosition(card: GameCardInstance): { x: number; y: number } | null {
    return this.battlefieldState.cardPosition(card);
  }

  setBattlefieldLayoutSize(size: BattlefieldSize): void {
    this.battlefieldState.setLayoutSize(size);
  }

  reflowBattlefieldCardPositions(): void {
    this.battlefieldState.reflowBattlefieldCardPositions(this.contexts.battlefield());
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.zonePilesState.topVisibleCard(player, zone);
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.zonePilesState.zonePreviewCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    return this.zonePilesState.zonePreviewImage(player, zone);
  }

  zoneStackLayerImage(player: PlayerView, zone: GameZoneName): string | null {
    return this.zonePilesState.zoneStackLayerImage(player, zone);
  }

  isLibraryTopRevealed(playerId: string): boolean {
    return this.zonePilesState.isLibraryTopRevealed(playerId);
  }

  topDraggableCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.zonePilesState.topDraggableCard(player, zone, this.canControlPlayer(player.id));
  }

  colorIdentity(player: PlayerView | null): string[] {
    return this.playersStore.colorIdentity(player);
  }

  colorAccent(player: PlayerView | null): string {
    return this.playersStore.colorAccent(player);
  }

  manaSymbols(player: PlayerView | null): string[] {
    return this.playersStore.manaSymbols(player);
  }

  manaSourceSuggestion(playerId: string, card: GameCardInstance): ManaSourceSuggestion {
    return detectManaSourceWithAttachments(
      card,
      this.attachedCardsForTarget(card.instanceId),
      { colorIdentity: this.snapshot()?.players[playerId]?.colorIdentity ?? [] },
    );
  }

  addMana(playerId: string, additions: readonly ManaAddition[]): void {
    this.manaPoolState.add(playerId, additions);
  }

  automaticTapManaSuggestion(playerId: string, zone: GameZoneName, card: GameCardInstance): ManaSourceSuggestion | null {
    if (zone !== 'battlefield' || card.tapped || !this.isManaPoolVisibleForPlayer(playerId)) {
      return null;
    }

    const suggestion = automaticTapOnlyManaSourceSuggestionWithAttachments(
      card,
      this.attachedCardsForTarget(card.instanceId),
      { colorIdentity: this.snapshot()?.players[playerId]?.colorIdentity ?? [] },
    );

    return suggestion.kind === 'none' ? null : suggestion;
  }

  tapManaIntentSuggestion(playerId: string, zone: GameZoneName, card: GameCardInstance): ManaSourceSuggestion | null {
    if (zone !== 'battlefield' || card.tapped || !this.isManaPoolVisibleForPlayer(playerId)) {
      return null;
    }

    if (this.automaticTapManaSuggestion(playerId, zone, card)) {
      return null;
    }

    const suggestion = this.manaSourceSuggestion(playerId, card);
    return suggestion.kind !== 'none' && !suggestion.manualOnly ? suggestion : null;
  }

  private attachedCardsForTarget(instanceId: string): readonly GameCardInstance[] {
    const snapshot = this.snapshot();

    return this.permanentRelations.attachmentsForTarget(snapshot, instanceId)
      .map((attachment) => this.permanentRelations.battlefieldCard(snapshot, attachment.equipmentInstanceId)?.card ?? null)
      .filter((card): card is GameCardInstance => card !== null);
  }

  private automaticManaTargetsForTapMenu(menu: GameContextMenu): readonly AutomaticTapManaTarget[] {
    if (!menu.card || menu.card.tapped) {
      return [];
    }

    const selected = this.selectedCards();
    const selectedHasMenuCard = selected.some((item) => item.card.instanceId === menu.card?.instanceId);
    const validSelection = selected.length > 1
      && selectedHasMenuCard
      && selected.every((item) => item.playerId === menu.playerId && item.zone === menu.zone);
    const targets = validSelection ? selected : [{ playerId: menu.playerId, zone: menu.zone, card: menu.card }];

    return targets.flatMap((target) => {
      const suggestion = this.automaticTapManaSuggestion(target.playerId, target.zone, target.card);
      return suggestion ? [{ ...target, suggestion }] : [];
    });
  }

  private addAutomaticFixedTapMana(targets: readonly AutomaticTapManaTarget[]): void {
    for (const target of targets) {
      if (target.suggestion.kind === 'fixed' && target.suggestion.additions.length > 0) {
        this.manaPoolState.add(target.playerId, target.suggestion.additions);
      }
    }
  }

  private isManaPoolVisibleForPlayer(playerId: string): boolean {
    return this.focusedPlayerId() === playerId
      && this.canControlPlayer(playerId)
      && !this.isManaPoolHidden(playerId);
  }

  incrementMana(playerId: string, color: ManaPoolColor): void {
    this.manaPoolState.increment(playerId, color);
  }

  decrementMana(playerId: string, color: ManaPoolColor): void {
    this.manaPoolState.decrement(playerId, color);
  }

  resetManaColor(playerId: string, color: ManaPoolColor): void {
    this.manaPoolState.resetColor(playerId, color);
  }

  resetManaPool(playerId: string): void {
    this.manaPoolState.reset(playerId);
  }

  hideManaPool(playerId: string): void {
    this.manaPoolState.reset(playerId);
    this.hiddenManaPoolPlayerIds.update((current) => new Set([...current, playerId]));
  }

  showManaPool(playerId: string): void {
    this.hiddenManaPoolPlayerIds.update((current) => {
      if (!current.has(playerId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(playerId);

      return next;
    });
  }

  logTime(createdAt: string): string {
    return this.chatStore.logTime(createdAt);
  }

  zoneHint(zone: GameZoneName): string {
    return this.zonePilesState.zoneHint(zone);
  }

  showCardPreview(preview: CardPreviewEvent): void;
  showCardPreview(card: GameCardInstance, playerId?: string, zone?: GameZoneName): void;
  showCardPreview(cardOrPreview: GameCardInstance | CardPreviewEvent, playerId?: string, zone?: GameZoneName): void {
    if ('card' in cardOrPreview) {
      this.uiState.showCardPreview(cardOrPreview, () => Boolean(this.draggingCardInstanceId()));
      return;
    }

    this.uiState.showCardPreview(cardOrPreview, () => Boolean(this.draggingCardInstanceId()), playerId, zone);
  }

  hideCardPreview(): void {
    this.uiState.hideCardPreview();
  }

  clearCardPreview(): void {
    this.uiState.clearCardPreview();
  }

  activeKeyboardCard(): SelectedCard | null {
    return this.interactionActions.activeKeyboardCard() as SelectedCard | null;
  }

  clearSelection(): void {
    this.interactionActions.clearSelection();
  }

  selectAllZoneCards(playerId: string, zone: GameZoneName): void {
    const cards = this.snapshot()?.players[playerId]?.zones[zone] ?? [];
    if (cards.length <= 1 || !this.canControlPlayer(playerId) || (zone !== 'hand' && zone !== 'battlefield')) {
      this.closeContextMenu();
      return;
    }

    this.selection.selectMany(playerId, zone, cards);
    this.closeContextMenu();
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
    return this.dragDropStore.isManaLaneHighlighted(playerId);
  }

  isDropZoneHighlighted(playerId: string, zone: GameZoneName): boolean {
    return this.dragDropStore.isDropZoneHighlighted(playerId, zone);
  }

  isPlayerDropHighlighted(playerId: string): boolean {
    return this.dragDropStore.isPlayerDropHighlighted(playerId);
  }

  isPendingBattlefieldTransfer(card: GameCardInstance): boolean {
    return this.dragDropStore.isPendingBattlefieldTransfer(card, this.pendingBattlefieldMove());
  }

  alignmentGuideFor(playerId: string): AlignmentGuide | null {
    return this.dragDropStore.alignmentGuideFor(playerId);
  }

  isPhasePast(phase: string): boolean {
    return this.selectors.isPhasePast(this.phases, this.snapshot(), phase);
  }

  canAdvanceTurnPhase(): boolean {
    const activePlayerId = this.snapshot()?.turn.activePlayerId ?? null;
    const currentPlayerId = this.currentPlayer()?.id ?? null;
    const blockedByLocalConcede = this.locallyConcededPlayerId !== null && this.locallyConcededPlayerId === currentPlayerId;

    return !!activePlayerId && activePlayerId === currentPlayerId && !this.pending() && !blockedByLocalConcede;
  }

  toggleCardSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.interactionActions.toggleCardSelection(this.contexts.interaction(), event, playerId, zone, card);
  }

  isSelected(instanceId: string): boolean {
    return this.selection.isSelected(instanceId);
  }

  openCardMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    const sourceRect = this.previewSourceRect(event);
    this.clearCardPreview();
    this.interactionActions.openCardMenu(this.contexts.interaction(), event, playerId, zone, card, { sourceRect });
  }

  openZoneMenu(event: MouseEvent, playerId: string, zone: GameZoneName): void {
    this.clearCardPreview();
    this.interactionActions.openZoneMenu(this.contexts.interaction(), event, playerId, zone);
  }

  openManaPoolMenu(event: MouseEvent, playerId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.clearCardPreview();
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'manaPool' });
  }

  openZoneModalCardMenu(event: MouseEvent, card: GameCardInstance): void {
    const modal = this.zoneModal();
    if (!modal || modal.readOnly) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const sourceRect = this.previewSourceRect(event);
    this.clearCardPreview();
    this.interactionActions.openCardMenu(
      this.contexts.interaction(),
      event,
      modal.playerId,
      modal.zone,
      card,
      {
        suppressRandomSelect: !modal.allowRandomSelect,
        fromFixedZoneModal: modal.allowGiveDestination,
        sourceRect,
        menuPosition: this.cardCenterPosition(event, sourceRect),
      },
    );
  }

  openGameMenu(event: MouseEvent): void {
    this.clearCardPreview();
    this.interactionActions.openGameMenu(this.contexts.interaction(), event);
  }

  openPlayerMenu(event: MouseEvent, playerId: string): void {
    this.clearCardPreview();
    this.interactionActions.openPlayerMenu(event, playerId);
  }

  openArrowMenu(event: MouseEvent, playerId: string, arrowId: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControlPlayer(playerId)) {
      return;
    }

    this.clearCardPreview();
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'arrow', arrowId });
  }

  openCounterDeleteMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own cards.');
      return;
    }

    const sourceRect = this.previewSourceRect(event);
    this.clearCardPreview();
    this.uiState.openContextMenu(event, { playerId, zone, card, kind: 'counter', counterKey: key, sourceRect });
  }

  closeContextMenu(): void {
    this.clearCardPreview();
    this.interactionActions.closeContextMenu();
  }

  closeContextMenuForCardDrag(instanceId: string): void {
    this.uiState.closeContextMenuForCardDrag(instanceId);
    this.clearCardPreview();
  }

  async sendChat(): Promise<void> {
    const message = this.chatStore.normalizedMessage();
    if (!message) {
      return;
    }

    const targetPlayerId = this.chatStore.selectedChatTargetPlayerId();
    await this.command('chat.message', {
      message,
      ...(targetPlayerId ? { targetPlayerId } : {}),
    });
    this.chatStore.clearMessage();
  }

  async toggleChatReaction(messageId: string | null | undefined, reaction: ChatReactionType): Promise<void> {
    if (!messageId) {
      return;
    }

    await this.command('chat.reaction.toggled', { messageId, reaction });
  }

  setChatMessage(value: string): void {
    this.chatStore.setChatMessage(value);
  }

  setChatTargetPlayerId(value: string | null): void {
    this.chatStore.setChatTargetPlayerId(value);
  }

  selectedChatTargetValue(): string {
    return this.chatStore.selectedChatTargetValue();
  }

  selectedChatTargetPlayerId(): string | null {
    return this.chatStore.selectedChatTargetPlayerId();
  }

  async changeLife(playerId: string, delta: number): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own life total.');
      return;
    }

    const currentLife = this.debouncedValueCommands.lifeValue(this.snapshot(), playerId);
    const nextLife = clampPlayerLife(currentLife + delta);
    if (nextLife === currentLife) {
      return;
    }

    this.debouncedValueCommands.queueLife(this.contexts.debouncedValueCommand(), {
      playerId,
      life: nextLife,
    });
  }

  async setLife(playerId: string, value: string | number): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own life total.');
      return;
    }

    this.debouncedValueCommands.queueLife(this.contexts.debouncedValueCommand(), {
      playerId,
      life: clampPlayerLife(Number(value)),
    });
  }

  async setCommanderDamage(targetPlayerId: string, sourcePlayerId: string, delta: number): Promise<void> {
    if (!this.canControlPlayer(targetPlayerId)) {
      this.error.set('You can only change your own commander damage.');
      return;
    }

    const currentDamage = this.debouncedValueCommands.commanderDamageValue(this.snapshot(), targetPlayerId, sourcePlayerId);
    const nextDamage = Math.max(0, currentDamage + delta);
    if (nextDamage === currentDamage) {
      return;
    }

    this.debouncedValueCommands.queueCommanderDamage(this.contexts.debouncedValueCommand(), {
      targetPlayerId,
      sourcePlayerId,
      damage: nextDamage,
    });
  }

  playerCounterValue(playerId: string, key: string): number {
    return this.countersState.playerCounterValue(playerId, key);
  }

  async changePlayerCounter(playerId: string, key: string, delta: number): Promise<void> {
    await this.countersState.changePlayerCounter(playerId, key, delta);
  }

  async changeTurnPlayer(activePlayerId: string): Promise<void> {
    await this.turnActions.changeTurnPlayer(this.contexts.turnAction(), activePlayerId);
  }

  async changePhase(phase: string): Promise<void> {
    await this.turnActions.changePhase(this.contexts.turnAction(), phase);
  }

  async changeTurnNumber(number: string | number): Promise<void> {
    await this.turnActions.changeTurnNumber(this.contexts.turnAction(), number);
  }

  async advanceTurnPhase(): Promise<void> {
    if (this.pending()) {
      return;
    }
    if (!this.canAdvanceTurnPhase()) {
      this.error.set('Only the active turn player can advance the turn.');
      return;
    }

    await this.turnActions.advanceTurnPhase(this.contexts.turnAction());
  }

  async passTurn(): Promise<void> {
    if (this.pending()) {
      return;
    }
    if (!this.canAdvanceTurnPhase()) {
      this.error.set('Only the active turn player can pass the turn.');
      return;
    }

    await this.turnActions.passTurn(this.contexts.turnAction());
  }

  async changeCommanderCastCount(playerId: string, delta: number): Promise<void> {
    await this.countersState.changeCommanderCastCount(playerId, delta);
  }

  async draw(playerId: string, count = 1): Promise<void> {
    await this.libraryActions.draw(this.contexts.libraryAction(), playerId, count);
  }

  async drawCurrent(count = 1): Promise<void> {
    await this.libraryActions.drawCurrent(this.contexts.libraryAction(), count);
  }

  async shuffle(playerId: string): Promise<void> {
    await this.libraryActions.shuffle(this.contexts.libraryAction(), playerId);
  }

  async shuffleRevealedLibrary(playerId: string): Promise<void> {
    await this.libraryActions.shuffleRevealedLibrary(this.contexts.libraryAction(), playerId);
  }

  async revealTop(playerId: string, target = 'all'): Promise<void> {
    await this.libraryActions.revealTop(this.contexts.libraryAction(), playerId, target);
  }

  async setPlayTopRevealed(playerId: string, enabled: boolean): Promise<void> {
    await this.libraryActions.setPlayTopRevealed(this.contexts.libraryAction(), playerId, enabled);
  }

  async revealLibrary(playerId: string, targetPlayerId: string): Promise<void> {
    await this.libraryActions.revealLibrary(this.contexts.libraryAction(), playerId, targetPlayerId);
  }

  async moveTop(
    playerId: string,
    toZone: GameZoneName,
    count = 1,
    options: { targetPlayerId?: string; position?: 'top' | 'bottom' } = {},
  ): Promise<void> {
    await this.libraryActions.moveTop(this.contexts.libraryAction(), playerId, toZone, count, options);
  }

  async viewLibrary(playerId: string): Promise<void> {
    await this.libraryActions.view(this.contexts.libraryAction(), playerId);
    await this.openZone(playerId, 'library', null, false, { allowGiveDestination: true });
    this.shuffleLibraryOnModalClosePlayerId.set(playerId);
    this.shuffleLibraryOnModalCloseReason.set('owner-view');
  }

  async viewTopLibrary(playerId: string, count: number): Promise<void> {
    await this.libraryTopState.viewTopLibrary(playerId, count);
  }

  async reorderTopLibraryCards(cards: readonly GameCardInstance[]): Promise<void> {
    await this.libraryTopState.reorderTopLibraryCards(cards);
  }

  async moveAllZoneCards(
    playerId: string,
    fromZone: GameZoneName,
    toZone: GameZoneName,
    options: { position?: 'top' | 'bottom'; randomOrder?: boolean; targetPlayerId?: string } = {},
  ): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }

    const targetPlayerId = options.targetPlayerId ?? playerId;
    const instanceIds = this.zoneCardInstanceIds(playerId, fromZone);
    if (instanceIds.length === 0 || (fromZone === toZone && targetPlayerId === playerId)) {
      this.closeContextMenu();
      return;
    }

    await this.command('cards.moved', {
      playerId,
      fromZone,
      toZone,
      instanceIds,
      ...(targetPlayerId !== playerId ? { targetPlayerId } : {}),
      ...(options.position ? { position: options.position } : {}),
      ...(options.randomOrder === true && toZone === 'library' && instanceIds.length > 1 ? { randomOrder: true } : {}),
    });
  }

  async selectRandomZoneCard(playerId: string, zone: GameZoneName): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only select random cards from your own zones.');
      return;
    }

    const card = this.randomCardFromZone(playerId, zone);
    if (!card) {
      this.error.set(`No cards in ${this.zoneTitle(zone).toLowerCase()}.`);
      return;
    }

    await this.command('zone.random_card.selected', { playerId, zone, instanceId: card.instanceId });
    const selectedCard = this.cardFromCurrentSnapshot(playerId, zone, card.instanceId) ?? card;
    this.openFixedZone(
      playerId,
      zone,
      `${this.playerName(playerId)} random ${this.zoneTitle(zone).toLowerCase()} card`,
      [selectedCard],
      selectedCard.instanceId,
      false,
      { allowGiveDestination: true },
    );
  }

  async playCard(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    await this.cardActions.playCard(this.contexts.cardAction(), playerId, zone, card);
  }

  async playFaceDown(menu: GameContextMenu): Promise<void> {
    await this.cardActions.playFaceDown(this.contexts.cardAction(), menu);
  }

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): void {
    this.dragDropStore.startBattlefieldPointerDrag(this.contexts.dragDrop(), event, playerId, card);
  }

  moveCardPointerDrag(event: PointerEvent): void {
    this.dragDropStore.moveCardPointerDrag(this.contexts.dragDrop(), event);
  }

  hasActivePointerDrag(): boolean {
    return this.dragDropStore.hasActivePointerDrag();
  }

  async endCardPointerDrag(event?: PointerEvent): Promise<void> {
    await this.dragDropStore.endCardPointerDrag(this.contexts.dragDrop(), event);
  }

  cancelCardPointerDrag(event?: PointerEvent): void {
    this.dragDropStore.cancelCardPointerDrag(this.contexts.dragDrop(), event);
  }

  handleBattlefieldCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (event.detail > 2) {
      event.preventDefault();
      event.stopPropagation();
      this.clearCardPreview();
      return;
    }

    if (this.arrowsState.handleBattlefieldCardClick(this.contexts.arrowInteraction(), event, card)) {
      this.clearCardPreview();
      return;
    }
    if (this.attachmentsState.handleBattlefieldCardClick(this.contexts.attachmentInteraction(), event, card)) {
      this.clearCardPreview();
      return;
    }

    this.showPinnedCardPreview(event, playerId, 'battlefield', card);
    this.interactionActions.handleBattlefieldCardClick(this.contexts.interaction(), event, playerId, card);
  }

  handleHandCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    this.showPinnedCardPreview(event, playerId, 'hand', card);
    this.interactionActions.handleHandCardClick(this.contexts.interaction(), event, playerId, card);
  }

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.dragDropStore.dragStart(this.contexts.dragDrop(), event, playerId, zone, card);
  }

  dragEnd(): void {
    this.dragDropStore.dragEnd(this.contexts.dragDrop());
  }

  beginZonePointerDrag(instanceId: string): void {
    this.dragDropStore.beginCardDrag(this.contexts.dragDrop(), instanceId);
  }

  endZonePointerDrag(): void {
    this.dragDropStore.dragEnd(this.contexts.dragDrop());
  }

  dragTopZoneCard(event: DragEvent, player: PlayerView, zone: GameZoneName): void {
    const card = this.topDraggableCard(player, zone);
    if (!card) {
      event.preventDefault();
      return;
    }

    this.dragStart(event, player.id, zone, card);
  }

  allowDrop(event: DragEvent): void {
    this.dragDropStore.allowDrop(this.contexts.dragDrop(), event);
  }

  previewDropOnHand(event: DragEvent, targetPlayerId: string): void {
    this.dragDropStore.previewDropOnHand(this.contexts.dragDrop(), event, targetPlayerId);
  }

  updatePointerDropTarget(target: PointerDropTarget | null): void {
    this.dragDropStore.updatePointerDropTarget(this.contexts.dragDrop(), target);
  }

  async moveZoneCardByPointer(request: ZonePointerDropRequest): Promise<void> {
    await this.zonePointerMoveActions.moveZoneCardByPointer(this.contexts.dropAction(), request);
  }

  previewHandDrop(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): void {
    this.handState.previewHandDrop(this.contexts.hand(), event, targetPlayerId, targetCard);
  }

  clearHandDropPreview(): void {
    this.handState.clearHandDropPreview();
  }

  async reorderHandCard(
    playerId: string,
    movedInstanceId: string,
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    await this.handState.reorderHandCard(this.contexts.hand(), playerId, movedInstanceId, targetInstanceId, placement);
  }

  async moveHandCardByPointer(
    playerId: string,
    targetPlayerId: string,
    movedInstanceId: string,
    toZone: GameZoneName,
    position?: { x: number; y: number },
    rawZone?: string,
  ): Promise<void> {
    await this.handState.moveHandCardByPointer(this.contexts.hand(), playerId, targetPlayerId, movedInstanceId, toZone, position, rawZone);
  }

  async dropOnZone(event: DragEvent, targetPlayerId: string, toZone: GameZoneName): Promise<void> {
    await this.dragDropStore.dropOnZone(this.contexts.dropAction(), event, targetPlayerId, toZone);
  }

  async dropOnManaLane(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropOnZone(event, targetPlayerId, 'battlefield');
  }

  async dropOnHand(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dragDropStore.dropOnHand(this.contexts.dropAction(), event, targetPlayerId);
  }

  async dropOnHandCard(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): Promise<void> {
    await this.dragDropStore.dropOnHandCard(this.contexts.dropAction(), event, targetPlayerId, targetCard);
  }

  async confirmPendingBattlefieldMove(): Promise<void> {
    const pendingMove = this.pendingBattlefieldMove();
    if (!pendingMove) {
      return;
    }

    await this.dragDropStore.confirmPendingBattlefieldMove(this.contexts.dropAction(), pendingMove);
  }

  async cancelPendingBattlefieldMove(): Promise<void> {
    await this.dragDropStore.cancelPendingBattlefieldMove(this.contexts.pendingMove());
  }

  async confirmPendingLibraryMove(position: 'top' | 'bottom', randomOrder = false): Promise<void> {
    const pendingMove = this.pendingLibraryMove();
    if (!pendingMove) {
      return;
    }

    await this.dragDropStore.confirmPendingLibraryMove(this.contexts.dropAction(), pendingMove, position, randomOrder);
  }

  async cancelPendingLibraryMove(): Promise<void> {
    await this.dragDropStore.cancelPendingLibraryMove(this.contexts.pendingMove());
  }

  async dropOnPlayer(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dragDropStore.dropOnPlayer(this.contexts.dropAction(), event, targetPlayerId);
  }

  async moveFocusedZoneToBattlefield(zone: GameZoneName): Promise<void> {
    const selected = this.selectedCards()[0];
    if (!selected || selected.zone !== zone) {
      return;
    }

    await this.playCard(selected.playerId, selected.zone, selected.card);
  }

  async moveCard(menu: GameContextMenu, toZone: GameZoneName, options: { position?: 'top' | 'bottom' } = {}): Promise<void> {
    await this.cardActions.moveCard(this.contexts.cardAction(), menu, toZone, options);
  }

  async moveLibraryCardToHand(menu: GameContextMenu, reveal: boolean): Promise<void> {
    await this.cardActions.moveLibraryCardToHand(this.contexts.cardAction(), menu, reveal);
  }

  startArrowFrom(menu: GameContextMenu, targetCount = 1): void {
    this.arrowsState.startArrowFrom(this.contexts.arrowInteraction(), menu, targetCount);
  }

  startAttachmentFrom(menu: GameContextMenu): void {
    this.attachmentsState.startAttachmentFrom(this.contexts.attachmentInteraction(), menu);
  }

  async giveCardToPlayer(menu: GameContextMenu, targetPlayerId: string, zone: 'battlefield' | 'hand' = 'battlefield'): Promise<void> {
    await this.cardActions.giveCardToPlayer(this.contexts.cardAction(), menu, targetPlayerId, zone);
  }

  async giveHandCardToPlayer(menu: GameContextMenu, targetPlayerId: string): Promise<void> {
    if (!menu.card || menu.zone !== 'hand') {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only move your own cards.');
      this.closeContextMenu();
      return;
    }
    if (targetPlayerId === menu.playerId) {
      this.closeContextMenu();
      return;
    }

    const selected = this.selectedCards();
    const validSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === menu.card?.instanceId)
      && selected.every((item) => item.playerId === menu.playerId && item.zone === 'hand');

    if (validSelection) {
      await this.command('cards.moved', {
        playerId: menu.playerId,
        fromZone: 'hand',
        toZone: 'hand',
        instanceIds: selected.map((item) => item.card.instanceId),
        targetPlayerId,
      });
    } else {
      await this.command('card.moved', {
        playerId: menu.playerId,
        fromZone: 'hand',
        toZone: 'hand',
        instanceId: menu.card.instanceId,
        targetPlayerId,
      });
    }
    this.clearSelection();
    this.closeContextMenu();
  }

  async deleteArrow(menu: GameContextMenu): Promise<void> {
    if (menu.kind !== 'arrow' || !menu.arrowId) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      return;
    }

    this.closeContextMenu();
    await this.command('arrow.removed', { id: menu.arrowId });
  }

  async deleteOwnedArrows(menu: GameContextMenu): Promise<void> {
    if (menu.kind !== 'arrow') {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      return;
    }

    const arrowIds = this.arrowsState.ownedArrowIds(menu.playerId);
    this.closeContextMenu();
    for (const id of arrowIds) {
      await this.command('arrow.removed', { id });
    }
  }

  ownedArrowCount(playerId: string): number {
    return this.arrowsState.ownedArrowCount(playerId);
  }

  isAttachedEquipment(_playerId: string, card: GameCardInstance): boolean {
    return this.attachmentsState.isAttachedEquipment(card.instanceId);
  }

  isAttachmentTarget(_playerId: string, card: GameCardInstance): boolean {
    return this.attachmentsState.isAttachmentTarget(card.instanceId);
  }

  canAttachEquipment(_playerId: string, card: GameCardInstance): boolean {
    return this.permanentRelations.canAttachSource(this.snapshot(), card);
  }

  async removeAttachment(menu: GameContextMenu): Promise<void> {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!this.canControlOwnedCard(menu.playerId, menu.card)) {
      this.error.set('You can only detach cards you control.');
      this.closeContextMenu();
      return;
    }

    this.closeContextMenu();
    await this.attachmentsState.removeAttachment(this.contexts.attachmentInteraction(), menu.playerId, menu.card);
  }

  async removeAttachmentsFromTarget(menu: GameContextMenu): Promise<void> {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!this.canControlOwnedCard(menu.playerId, menu.card)) {
      this.error.set('You can only detach cards from permanents you control.');
      this.closeContextMenu();
      return;
    }

    this.closeContextMenu();
    await this.attachmentsState.removeAttachmentsFromTarget(this.contexts.attachmentInteraction(), menu.playerId, menu.card);
  }

  async moveSelected(toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveSelected(this.contexts.cardAction(), toZone);
  }

  isLandStacked(playerId: string, card: GameCardInstance): boolean {
    return this.cardActions.isLandStacked(this.contexts.cardAction(), playerId, card);
  }

  async removeLandStack(menu: GameContextMenu): Promise<void> {
    await this.cardActions.removeLandStack(this.contexts.cardAction(), menu);
  }

  async moveActiveCard(toZone: GameZoneName): Promise<void> {
    await this.cardActions.moveActiveCard(this.contexts.cardAction(), toZone);
  }

  async tapCard(menu: GameContextMenu, options: { addAutomaticMana?: boolean } = {}): Promise<void> {
    const automaticManaTargets = this.automaticManaTargetsForTapMenu(menu);
    await this.cardActions.tapCard(this.contexts.cardAction(), menu);
    if (options.addAutomaticMana ?? true) {
      this.addAutomaticFixedTapMana(automaticManaTargets);
    }
  }

  async faceDown(menu: GameContextMenu): Promise<void> {
    await this.cardActions.faceDown(this.contexts.cardAction(), menu);
  }

  async flipCardFace(menu: GameContextMenu): Promise<void> {
    await this.cardActions.flipCardFace(this.contexts.cardAction(), menu);
  }

  async revealCard(menu: GameContextMenu, target: string = 'all'): Promise<void> {
    await this.cardActions.revealCard(this.contexts.cardAction(), menu, target);
  }

  async tokenCopy(menu: GameContextMenu): Promise<void> {
    await this.cardActions.tokenCopy(this.contexts.cardAction(), menu);
  }

  async createToken(playerId: string, card: Card | null = null, quantity = 1): Promise<void> {
    const previousBattlefieldIds = this.battlefieldInstanceIds(playerId);
    await this.cardActions.createToken(this.contexts.cardAction(), playerId, card, quantity);
    this.markNewPowerToughnessTokensSettling(playerId, previousBattlefieldIds);
  }

  async setPowerToughness(menu: GameContextMenu, power: number, toughness: number): Promise<void> {
    await this.cardActions.setPowerToughness(this.contexts.cardAction(), menu, power, toughness);
  }

  async clearPowerToughness(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.power_toughness.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      power: null,
      toughness: null,
    });
    this.closeContextMenu();
  }

  async changeCardCounter(menu: GameContextMenu, key = '+1/+1', delta = 1): Promise<void> {
    await this.countersState.changeCardCounter(menu, key, delta);
  }

  async setCardCounter(menu: GameContextMenu, key: string, value: number): Promise<void> {
    await this.countersState.setCardCounter(menu, key, value, this.selectedCards());
  }

  async deleteCardCounter(menu: GameContextMenu): Promise<void> {
    await this.countersState.deleteCardCounter(menu);
  }

  async deleteCardCounterByKey(menu: GameContextMenu, key: string): Promise<void> {
    await this.countersState.deleteCardCounterByKey(menu, key, this.selectedCards());
  }

  async deleteAllCardCounters(menu: GameContextMenu): Promise<void> {
    await this.countersState.deleteAllCardCounters(menu, this.selectedCards());
  }

  async changeCardCounterForCard(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    key = '+1/+1',
    delta = 1,
  ): Promise<void> {
    await this.countersState.changeCardCounterForCard(playerId, zone, card, key, delta);
  }

  async addToStack(menu: GameContextMenu): Promise<void> {
    await this.cardActions.addToStack(this.contexts.cardAction(), menu);
  }

  async toggleTapped(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    options: { addAutomaticMana?: boolean } = {},
  ): Promise<void> {
    const automaticManaSuggestion = this.automaticTapManaSuggestion(playerId, zone, card);
    const automaticManaTargets = automaticManaSuggestion
      ? [{ playerId, zone, card, suggestion: automaticManaSuggestion }]
      : [];
    await this.cardActions.toggleTapped(this.contexts.cardAction(), playerId, zone, card);
    if (options.addAutomaticMana ?? true) {
      this.addAutomaticFixedTapMana(automaticManaTargets);
    }
  }

  async untapCurrentBattlefield(): Promise<void> {
    const current = this.currentPlayer();
    if (!current) {
      return;
    }

    const hasTappedCards = current.state.zones.battlefield.some((card) => card.tapped);
    if (!hasTappedCards) {
      return;
    }

    await this.command('battlefield.untap_all', { playerId: current.id });
  }

  async recordDiceRoll(result: DiceRollCommand): Promise<void> {
    const kind = result.kind.trim();
    const label = result.label.trim();
    const finalResult = result.finalResult.trim();
    if (!kind || !finalResult) {
      return;
    }

    await this.command('dice.rolled', {
      kind,
      label,
      finalResult,
    });
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
    await this.cardActions.moveZoneCard(this.contexts.cardAction(), card, toZone);
  }

  async revealZoneCard(card: GameCardInstance): Promise<void> {
    await this.cardActions.revealZoneCard(this.contexts.cardAction(), card);
  }

  async openZone(
    playerId: string,
    zone: GameZoneName,
    selectedCardId: string | null = null,
    readOnly = false,
    options: { allowGiveDestination?: boolean } = {},
  ): Promise<void> {
    this.clearCardPreview();
    await this.zoneActions.openZone(this.contexts.zoneAction(), playerId, zone, selectedCardId, readOnly, {
      ...options,
      allowGiveDestination: options.allowGiveDestination === true || (!readOnly && this.zoneAllowsModalGiveTo(zone)),
    });
  }

  openFixedZone(
    playerId: string,
    zone: GameZoneName,
    title: string,
    cards: GameCardInstance[],
    selectedCardId: string | null = null,
    allowRandomSelect = false,
    options: { allowGiveDestination?: boolean; allowReorder?: boolean; drawOrderLabels?: readonly string[]; viewTopCount?: number | null } = {},
  ): void {
    this.clearCardPreview();
    this.zoneActions.openFixedZone(playerId, zone, title, cards, selectedCardId, allowRandomSelect, options);
  }

  async loadZone(): Promise<void> {
    await this.zoneActions.loadZone(this.contexts.zoneAction());
  }

  updateZoneFilter(patch: Partial<{ type: string; search: string }>): void {
    this.zoneActions.updateZoneFilter(this.contexts.zoneAction(), patch);
  }

  selectZoneCard(card: GameCardInstance): void {
    this.zoneActions.selectZoneCard(card);
  }

  async closeZoneModal(): Promise<void> {
    const modal = this.zoneModal();
    const shufflePlayerId = this.shuffleLibraryOnModalClosePlayerId();
    const shuffleReason = this.shuffleLibraryOnModalCloseReason();
    const shouldShuffleLibrary = shufflePlayerId !== null
      && modal?.playerId === shufflePlayerId
      && modal.zone === 'library'
      && modal.showFilters;

    this.shuffleLibraryOnModalClosePlayerId.set(null);
    this.shuffleLibraryOnModalCloseReason.set(null);
    this.zoneActions.closeZoneModal();

    if (shouldShuffleLibrary) {
      if (shuffleReason === 'revealed-library-closed') {
        await this.shuffleRevealedLibrary(shufflePlayerId);
        return;
      }

      await this.shuffle(shufflePlayerId);
    }
  }

  private async openRevealedLibraryModal(playerId: string): Promise<void> {
    const currentModal = this.zoneModal();
    if (currentModal?.playerId === playerId && currentModal.zone === 'library') {
      return;
    }
    if (this.openingRevealedLibraryPlayerId === playerId) {
      return;
    }

    this.openingRevealedLibraryPlayerId = playerId;
    try {
      await this.openZone(playerId, 'library', null, true);
      this.shuffleLibraryOnModalClosePlayerId.set(playerId);
      this.shuffleLibraryOnModalCloseReason.set('revealed-library-closed');
    } finally {
      this.openingRevealedLibraryPlayerId = null;
    }
  }

  private zoneAllowsModalGiveTo(zone: GameZoneName): boolean {
    return zone === 'graveyard' || zone === 'exile';
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
    const currentPlayerId = this.currentPlayer()?.id ?? null;
    if (
      type === 'turn.changed'
      && this.locallyConcededPlayerId !== null
      && currentPlayerId !== null
      && this.locallyConcededPlayerId === currentPlayerId
    ) {
      return;
    }

    await this.commandStore.command(this.contexts.command(), type, payload, force);
  }

  async concedeGame(): Promise<void> {
    const current = this.currentPlayer();
    if (!current) {
      this.closeContextMenu();
      return;
    }

    if (current?.state.status === 'conceded') {
      this.closeContextMenu();
      return;
    }

    this.closeContextMenu();
    this.locallyConcededPlayerId = current.id;
    this.websocketGameplay.prepareForLocalConcede();
    try {
      await this.command('game.concede', {}, true);
    } catch (error) {
      this.locallyConcededPlayerId = null;
      throw error;
    }
  }

  async concede(): Promise<void> {
    await this.concedeGame();
  }

  async closeGame(): Promise<void> {
    if (!this.isGameOwner()) {
      return;
    }

    await this.command('game.close', {});
    await this.gameActionsStore.navigateToRooms();
  }

  async leaveTable(): Promise<void> {
    const current = this.currentPlayer();
    this.closeContextMenu();
    if (current && current.state.status !== 'conceded') {
      await this.command('game.concede', {}, true);
    }

    if (this.viewerCanControlTable()) {
      await this.gameActionsStore.recordLeaveRoomVote();
    }
    await this.gameActionsStore.navigateToRooms();
  }

  async copyGameId(): Promise<void> {
    await this.gameActionsStore.copyGameId();
  }

  toggleFloatingMinimized(): void {
    this.uiState.toggleFloatingMinimized();
  }

  async changeCardPower(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changePower(this.contexts.cardStats(), playerId, zone, card, delta);
  }

  async changeCardToughness(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changeToughness(this.contexts.cardStats(), playerId, zone, card, delta);
  }

  async changeCardLoyalty(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changeLoyalty(this.contexts.cardStats(), playerId, zone, card, delta);
  }

  private showPinnedCardPreview(
    event: MouseEvent,
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    sourceRect = this.previewSourceRect(event),
  ): void {
    this.uiState.showPinnedCardPreview({
      card,
      playerId,
      zone,
      sourceRect,
    }, () => Boolean(this.draggingCardInstanceId()));
  }

  private previewSourceRect(event: MouseEvent): CardPreviewEvent['sourceRect'] {
    return previewRectFromElement(event.currentTarget instanceof Element ? event.currentTarget : null);
  }

  private cardCenterPosition(event: MouseEvent, sourceRect: CardPreviewEvent['sourceRect']): { x: number; y: number } {
    if (!sourceRect) {
      return { x: event.clientX, y: event.clientY };
    }

    return {
      x: sourceRect.left + sourceRect.width / 2,
      y: sourceRect.top + sourceRect.height / 2,
    };
  }

  private setSnapshot(snapshot: GameSnapshot | null): void {
    if (snapshot === null) {
      this.locallyConcededPlayerId = null;
    } else if (this.locallyConcededPlayerId !== null) {
      const localPlayerStatus = snapshot.players[this.locallyConcededPlayerId]?.status ?? null;
      if (localPlayerStatus !== 'conceded') {
        this.locallyConcededPlayerId = null;
      }
    }

    this.snapshotCoordinatorState.setSnapshot({
      openRevealedLibraryFromSnapshot: (nextSnapshot) => this.openRevealedLibraryFromSnapshot(nextSnapshot),
    }, snapshot);
  }

  private openRevealedLibraryFromSnapshot(snapshot: GameSnapshot | null): void {
    const currentPlayerId = this.currentPlayer()?.id ?? null;
    if (!snapshot || !currentPlayerId) {
      return;
    }

    const revealedEntry = Object.entries(snapshot.players).find(([playerId, player]) =>
      playerId !== currentPlayerId && (player.revealedLibraryTo ?? []).includes(currentPlayerId),
    );
    if (!revealedEntry) {
      return;
    }

    void this.openRevealedLibraryModal(revealedEntry[0]);
  }

  private battlefieldInstanceIds(playerId: string): ReadonlySet<string> {
    return new Set(this.battlefieldCards(playerId).map((card) => card.instanceId));
  }

  private randomCardFromZone(playerId: string, zone: GameZoneName): GameCardInstance | null {
    const cards = this.visibleCardsFromZone(playerId, zone);
    if (cards.length === 0) {
      return null;
    }

    return cards[Math.floor(Math.random() * cards.length)] ?? null;
  }

  private visibleCardsFromZone(playerId: string, zone: GameZoneName): GameCardInstance[] {
    return this.snapshot()?.players[playerId]?.zones[zone]?.filter((card) => !card.hidden) ?? [];
  }

  private cardFromCurrentSnapshot(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null {
    return this.snapshot()?.players[playerId]?.zones[zone]?.find((card) => card.instanceId === instanceId) ?? null;
  }

  private battlefieldCards(playerId: string): readonly GameCardInstance[] {
    return this.snapshot()?.players[playerId]?.zones.battlefield ?? [];
  }

  private markNewPowerToughnessTokensSettling(playerId: string, previousBattlefieldIds: ReadonlySet<string>): void {
    const addedTokenIds = this.battlefieldCards(playerId)
      .filter((battlefieldCard) => !previousBattlefieldIds.has(battlefieldCard.instanceId))
      .filter((battlefieldCard) => battlefieldCard.isToken === true && this.shouldShowPowerToughness(battlefieldCard))
      .map((battlefieldCard) => battlefieldCard.instanceId);

    if (addedTokenIds.length === 0) {
      return;
    }

    this.dropFeedbackState.markPendingBattlefieldEntry(playerId, addedTokenIds);
    this.dropFeedbackState.trackSnapshot(this.snapshot());
  }

  private playerName(playerId: string): string {
    return this.playersStore.playerName(playerId);
  }

  private handlePendingTransferExpired(_expiration: PendingTransferExpiration): void {
    this.pendingBattlefieldMove.set(null);
    this.pendingLibraryMove.set(null);
    this.selectedCards.set([]);
    this.error.set('Card move did not complete. No changes were applied; try again.');
    void this.refetch(true);
  }

}
