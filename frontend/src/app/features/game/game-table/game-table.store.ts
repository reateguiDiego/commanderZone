import { Injectable, OnDestroy, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCardPosition, GameCommandType, GameSnapshot, GameZoneName } from '../../../core/models/game.model';
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
import { CardPreviewEvent } from './card-preview.model';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';
import { GameTableCardActionContext, GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsContext, GameTableCardStatsService } from './services/game-table-card-stats.service';
import { GameTableDropActionContext, GameTableDropActionsService, PendingBattlefieldMove, PendingLibraryMove } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService, GameTableInteractionContext } from './services/game-table-interaction-actions.service';
import { GameTablePointerDragActionContext, GameTablePointerDragActionsService } from './services/game-table-pointer-drag-actions.service';
import { PointerDropTarget } from './services/game-table-pointer-drag.service';
import { GameTableSessionContext, GameTableSessionService } from './services/game-table-session.service';
import { GameTableZoneActionContext, GameTableZoneActionsService } from './services/game-table-zone-actions.service';
import {
  BattlefieldSize,
  DEFAULT_BATTLEFIELD_CARD_SIZE,
  DEFAULT_BATTLEFIELD_SIZE,
  isRatioPosition,
  ratioBattlefieldPosition,
  sameBattlefieldPosition,
} from './battlefield-position';
import { OpponentCardsTargetCard, OpponentCardsTargetRole } from './opponent-cards-target-card.model';
import { OpponentTargetingPill } from './opponent-targeting-pill.model';

export type { PlayerView } from './state/game-table-snapshot-selectors';

export interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export type GameTableSyncStatus = 'pending' | 'connecting' | 'live' | 'degraded';

export interface ChatRecipientOption {
  playerId: string | null;
  label: string;
}

interface BattlefieldPositionCommand {
  playerId: string;
  instanceId: string;
  position: GameCardPosition;
}

interface ViewportClampedBattlefieldPosition {
  playerId: string;
  instanceId: string;
  sourcePosition: { x: number; y: number };
  clampedPosition: { x: number; y: number };
}

interface PendingArrowSource {
  instanceId: string;
  cardName: string;
  color: string;
  targetCount: number;
  selectedTargetInstanceIds: readonly string[];
}

interface TargetCardBuildEntry {
  readonly card: GameCardInstance;
  readonly source: boolean;
  readonly target: boolean;
  readonly sortValues: readonly number[];
}

interface PendingCardCounterCommand {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  key: string;
  value: number | null;
}

@Injectable()
export class GameTableStore implements OnDestroy {
  private readonly errorToastDurationMs = 3000;
  private readonly maxDistinctCardCounters = 5;
  private readonly counterFlushDelayMs = 160;
  private readonly counterFlushRetryMs = 80;
  private errorToastTimer: number | null = null;
  private targetToastTimer: number | null = null;
  private arrowCreationQueue: Promise<void> = Promise.resolve();
  private battlefieldPositionQueue: Promise<void> = Promise.resolve();
  private readonly optimisticBattlefieldPositions = new Map<string, BattlefieldPositionCommand>();
  private readonly viewportClampedBattlefieldPositions = new Map<string, ViewportClampedBattlefieldPosition>();
  private readonly optimisticCardCounters = new Map<string, PendingCardCounterCommand>();
  private readonly cardCounterFlushTimers = new Map<string, number>();
  private readonly battlefieldLayoutSize = signal<BattlefieldSize>(DEFAULT_BATTLEFIELD_SIZE);

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
  readonly hoveredPreview = this.uiState.hoveredPreview;
  readonly contextMenu = this.uiState.contextMenu;
  readonly zoneModal = this.zoneModalState.zoneModal;
  readonly activeFloatingTab = this.uiState.activeFloatingTab;
  readonly floatingPanel = this.uiState.floatingPanel;
  readonly floatingMinimized = this.uiState.floatingMinimized;
  readonly chatMessage = this.chatLogState.chatMessage;
  readonly chatTargetPlayerId = this.chatLogState.chatTargetPlayerId;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly targetToast = signal<string | null>(null);
  readonly tableToast = computed(() => this.error() ?? this.targetToast());
  readonly pending = signal(false);
  readonly pendingBattlefieldMove = signal<PendingBattlefieldMove | null>(null);
  readonly pendingLibraryMove = signal<PendingLibraryMove | null>(null);
  readonly pendingArrowSource = signal<PendingArrowSource | null>(null);
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
  readonly handPlayer = computed<PlayerView | null>(() => this.focusedPlayer());
  readonly opponentTargetingPills = computed<ReadonlyMap<string, OpponentTargetingPill>>(() => this.buildOpponentTargetingPills());
  readonly opponentCardsTargetCards = computed<ReadonlyMap<string, readonly OpponentCardsTargetCard[]>>(() => this.buildOpponentCardsTargetCards());
  readonly chatRecipients = computed<ChatRecipientOption[]>(() => this.chatRecipientOptions());
  readonly shouldShowChatRecipientSelect = computed(() => this.chatRecipients().length > 1);
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
    this.clearTargetToastTimer();
    this.clearCardCounterFlushTimers();
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
      this.dropFeedbackState.clearPendingBattlefieldEntries();
    }
    await this.session.refetch(this.sessionContext(), force);
  }

  focusPlayer(playerId: string): boolean {
    const resolvedPlayerId = this.resolvePlayerId(playerId);
    if (!resolvedPlayerId) {
      this.error.set('Could not open that battlefield.');
      this.uiState.closeContextMenu();

      return false;
    }

    this.focusedPlayerId.set(resolvedPlayerId);
    this.uiState.closeContextMenu();

    return true;
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
      this.pendingArrowSource.set(null);
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

  zoneCardCountById(playerId: string, zone: GameZoneName): number {
    const player = this.players().find((candidate) => candidate.id === playerId);
    return player ? this.zoneCount(player, zone) : 0;
  }

  commanderCastCount(player: PlayerView): number {
    return this.selectors.commanderCastCount(this.snapshot(), player);
  }

  countItems(count: number): number[] {
    return this.selectors.countItems(count);
  }

  cardImage(card: GameCardInstance): string | null {
    return this.selectors.cardImage(card, this.snapshot());
  }

  publicCardImage(card: GameCardInstance): string | null {
    return this.selectors.publicCardImage(card);
  }

  cardBackImage(player?: PlayerView | null): string {
    return this.selectors.cardBackImage(player?.state.sleevesName);
  }

  gameBackgroundImage(player: PlayerView | null): string {
    return this.selectors.gameBackgroundImage(player);
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

  cardPowerValue(card: GameCardInstance): number | null {
    return this.selectors.cardPowerValue(card);
  }

  cardToughnessValue(card: GameCardInstance): number | null {
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

  isCommanderEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isCommanderEntrySettling(playerId, card.instanceId);
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
    const cardSize = isRatioPosition(card.position)
      ? this.battlefieldCardSize(card.controllerId ?? card.ownerId ?? '', card.instanceId)
      : undefined;

    return this.selectors.cardPosition(card, this.battlefieldLayoutSize(), cardSize);
  }

  setBattlefieldLayoutSize(size: BattlefieldSize): void {
    const current = this.battlefieldLayoutSize();
    if (current.width === size.width && current.height === size.height) {
      return;
    }

    this.battlefieldLayoutSize.set(size);
  }

  reflowBattlefieldCardPositions(): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    let nextSnapshot: GameSnapshot | null = null;
    for (const battlefield of document.querySelectorAll<HTMLElement>('.battlefield[data-player-id]')) {
      const playerId = battlefield.dataset['playerId'];
      if (!playerId || !snapshot.players[playerId]) {
        continue;
      }

      const bounds = battlefield.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        continue;
      }

      const cardElements = new Map(
        Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-card-instance-id]'))
          .map((element) => [element.dataset['cardInstanceId'] ?? '', element] as const)
          .filter(([instanceId]) => instanceId !== ''),
      );
      const sourceCards = (nextSnapshot ?? snapshot).players[playerId]?.zones.battlefield ?? [];
      for (const card of sourceCards) {
        if (isRatioPosition(card.position)) {
          this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey({ playerId, instanceId: card.instanceId }));
          continue;
        }

        const position = this.selectors.cardPosition(card, { width: bounds.width, height: bounds.height });
        if (!position) {
          continue;
        }

        const cardElement = cardElements.get(card.instanceId);
        const cardBounds = cardElement?.getBoundingClientRect();
        const cardWidth = Math.max(1, Math.round(cardElement?.offsetWidth || cardBounds?.width || 116));
        const cardHeight = Math.max(1, Math.round(cardElement?.offsetHeight || cardBounds?.height || 162));
        const positionKey = this.battlefieldPositionKey({ playerId, instanceId: card.instanceId });
        const existingClamp = this.viewportClampedBattlefieldPositions.get(positionKey);
        const sourcePosition = existingClamp && this.samePosition(existingClamp.clampedPosition, position)
          ? existingClamp.sourcePosition
          : position;
        const clamped = this.clampBattlefieldPosition(sourcePosition, bounds.width, bounds.height, cardWidth, cardHeight);
        if (this.samePosition(clamped, sourcePosition)) {
          this.viewportClampedBattlefieldPositions.delete(positionKey);
          if (this.samePosition(position, sourcePosition)) {
            continue;
          }
        } else {
          this.viewportClampedBattlefieldPositions.set(positionKey, {
            playerId,
            instanceId: card.instanceId,
            sourcePosition,
            clampedPosition: clamped,
          });
          if (this.samePosition(clamped, position)) {
            continue;
          }
        }

        if (this.samePosition(clamped, position)) {
          continue;
        }

        nextSnapshot ??= structuredClone(snapshot);
        const nextCard = nextSnapshot.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === card.instanceId);
        if (nextCard) {
          nextCard.position = clamped;
        }
      }
    }

    if (nextSnapshot) {
      this.setSnapshot(nextSnapshot);
    }
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

  manaSymbols(player: PlayerView | null): string[] {
    return this.selectors.manaSymbols(player);
  }

  logTime(createdAt: string): string {
    return this.selectors.logTime(createdAt);
  }

  zoneHint(zone: GameZoneName): string {
    return this.selectors.zoneHint(zone);
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

  openArrowMenu(event: MouseEvent, playerId: string, arrowId: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControlPlayer(playerId)) {
      return;
    }

    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'arrow', arrowId });
  }

  openCounterDeleteMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own cards.');
      return;
    }

    this.uiState.openContextMenu(event, { playerId, zone, card, kind: 'counter', counterKey: key });
  }

  closeContextMenu(): void {
    this.interactionActions.closeContextMenu();
  }

  async sendChat(): Promise<void> {
    const message = this.chatLogState.normalizedMessage();
    if (!message) {
      return;
    }

    const targetPlayerId = this.selectedChatTargetPlayerId();
    await this.command('chat.message', {
      message,
      ...(targetPlayerId ? { targetPlayerId } : {}),
    });
    this.chatLogState.clearMessage();
  }

  setChatMessage(value: string): void {
    this.chatLogState.setMessage(value);
  }

  setChatTargetPlayerId(value: string | null): void {
    this.chatLogState.setTargetPlayerId(value);
  }

  selectedChatTargetValue(): string {
    return this.selectedChatTargetPlayerId() ?? 'all';
  }

  selectedChatTargetPlayerId(): string | null {
    const recipients = this.chatRecipients();
    if (recipients.length === 0) {
      return null;
    }

    const current = this.chatTargetPlayerId();
    return recipients.some((recipient) => recipient.playerId === current) ? current : recipients[0]?.playerId ?? null;
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

  async passTurn(): Promise<void> {
    if (this.pending()) {
      this.error.set('Wait for the current table action to finish.');
      return;
    }
    if (!this.canAdvanceTurnPhase()) {
      this.error.set('Only the active turn player can pass the turn.');
      return;
    }

    await this.turnActions.passTurn(this.turnActionContext());
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
      playerName: (playerId) => this.playerName(playerId),
      setError: (message) => this.error.set(message),
      closeContextMenu: () => this.closeContextMenu(),
      setPendingBattlefieldMove: (move) => this.pendingBattlefieldMove.set(move),
      setPendingLibraryMove: (move) => this.pendingLibraryMove.set(move),
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
    const pendingArrow = this.pendingArrowSource();
    if (pendingArrow) {
      event.preventDefault();
      event.stopPropagation();
      if (pendingArrow.instanceId === card.instanceId) {
        this.pendingArrowSource.set(null);
        this.showTargetToast('Target selection cancelled.');
        return;
      }
      if (pendingArrow.selectedTargetInstanceIds.includes(card.instanceId)) {
        this.showArrowTargetProgressToast(pendingArrow.targetCount - pendingArrow.selectedTargetInstanceIds.length);
        return;
      }

      const selectedTargetInstanceIds = [...pendingArrow.selectedTargetInstanceIds, card.instanceId];
      const remainingTargets = pendingArrow.targetCount - selectedTargetInstanceIds.length;
      this.pendingArrowSource.set(remainingTargets > 0
        ? { ...pendingArrow, selectedTargetInstanceIds }
        : null);
      this.queueArrowCreatedCommand({
        fromInstanceId: pendingArrow.instanceId,
        toInstanceId: card.instanceId,
        color: pendingArrow.color,
      });
      if (remainingTargets > 0) {
        this.showArrowTargetProgressToast(remainingTargets);
      } else {
        this.clearTargetToast();
      }
      return;
    }

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
    if (toZone === 'library') {
      this.pendingLibraryMove.set({
        cardName: movedInstanceIds.length > 1 ? `${movedInstanceIds.length} cards` : sourceCard.name,
        commandType: movedInstanceIds.length > 1 ? 'cards.moved' : 'card.moved',
        payload: {
          playerId,
          fromZone: 'hand',
          toZone: 'library',
          ...(movedInstanceIds.length > 1 ? { instanceIds: movedInstanceIds } : { instanceId: movedInstanceId }),
        },
      });
      this.selectedCards.set([]);
      return;
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

    if (toZone === 'battlefield') {
      this.dropFeedbackState.markPendingBattlefieldEntry(targetPlayerId, [movedInstanceId]);
      this.moveLocalCardsFromHandToBattlefield(playerId, targetPlayerId, [movedInstanceId], battlefieldPosition);
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

  async confirmPendingLibraryMove(position: 'top' | 'bottom', randomOrder = false): Promise<void> {
    const pendingMove = this.pendingLibraryMove();
    if (!pendingMove) {
      return;
    }

    await this.dropActions.confirmPendingLibraryMove(this.dropActionContext(), pendingMove, position, randomOrder);
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

  startArrowFrom(menu: GameContextMenu, targetCount = 1): void {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!this.canControlOwnedCard(menu.playerId, menu.card)) {
      this.error.set('You can only draw arrows from cards you control.');
      this.closeContextMenu();
      return;
    }

    const normalizedTargetCount = Math.max(1, Math.floor(Number.isFinite(targetCount) ? targetCount : 1));
    this.pendingArrowSource.set({
      instanceId: menu.card.instanceId,
      cardName: menu.card.name,
      color: this.arrowColorForCard(menu.card),
      targetCount: normalizedTargetCount,
      selectedTargetInstanceIds: [],
    });
    this.showArrowTargetProgressToast(normalizedTargetCount);
    this.closeContextMenu();
  }

  async giveCardToPlayer(menu: GameContextMenu, targetPlayerId: string): Promise<void> {
    await this.cardActions.giveCardToPlayer(this.cardActionContext(), menu, targetPlayerId);
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

    const arrowIds = this.ownedArrowIds(menu.playerId);
    this.closeContextMenu();
    for (const id of arrowIds) {
      await this.command('arrow.removed', { id });
    }
  }

  ownedArrowCount(playerId: string): number {
    return this.ownedArrowIds(playerId).length;
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

  async flipCardFace(menu: GameContextMenu): Promise<void> {
    await this.cardActions.flipCardFace(this.cardActionContext(), menu);
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
    if (!menu.card) {
      return;
    }

    await this.changeCardCounterForCard(menu.playerId, menu.zone, menu.card, key, delta);
    this.closeContextMenu();
  }

  async setCardCounter(menu: GameContextMenu, key: string, value: number): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }
    if (!this.canAddCardCounter(menu.card, key)) {
      this.error.set(`Maximum ${this.maxDistinctCardCounters} different counters per card.`);
      this.closeContextMenu();
      return;
    }

    this.queueCardCounter({
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      value: Math.max(0, value),
    });
    this.closeContextMenu();
  }

  async deleteCardCounter(menu: GameContextMenu): Promise<void> {
    if (menu.kind !== 'counter' || !menu.card || !menu.counterKey) {
      return;
    }
    await this.deleteCardCounterByKey(menu, menu.counterKey);
  }

  async deleteCardCounterByKey(menu: GameContextMenu, key: string): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }

    this.queueCardCounter({
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      value: null,
    });
    this.closeContextMenu();
  }

  async deleteAllCardCounters(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }

    for (const key of Object.keys(menu.card.counters ?? {})) {
      this.queueCardCounter({
        playerId: menu.playerId,
        zone: menu.zone,
        instanceId: menu.card.instanceId,
        key,
        value: null,
      });
    }
    this.closeContextMenu();
  }

  async changeCardCounterForCard(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    key = '+1/+1',
    delta = 1,
  ): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own cards.');
      return;
    }
    if (!this.canAddCardCounter(card, key)) {
      this.error.set(`Maximum ${this.maxDistinctCardCounters} different counters per card.`);
      return;
    }

    const currentValue = this.cardCounterValue(playerId, zone, card, key);
    const nextValue = Math.max(0, currentValue + delta);
    if (nextValue === currentValue) {
      return;
    }

    this.queueCardCounter({
      playerId,
      zone,
      instanceId: card.instanceId,
      key,
      value: nextValue,
    });
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
    if (type === 'card.position.changed') {
      const positionCommand = this.battlefieldPositionCommand(payload);
      if (positionCommand) {
        this.queueBattlefieldPositionCommand(gameId, positionCommand, payload);
        return;
      }
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
      this.dropFeedbackState.clearPendingBattlefieldEntries();
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

  async changeCardLoyalty(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.cardStats.changeLoyalty(this.cardStatsContext(), playerId, zone, card, delta);
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
    const moveTargetPlayerId = targetPlayerId ?? playerId;
    if (fromZone === toZone && playerId === moveTargetPlayerId) {
      return;
    }

    if (fromZone !== 'battlefield' && toZone === 'battlefield' && !this.areCardsInZone(moveTargetPlayerId, 'battlefield', instanceIds)) {
      this.dropFeedbackState.markPendingBattlefieldEntry(moveTargetPlayerId, instanceIds);
      if (fromZone === 'command') {
        this.dropFeedbackState.markPendingCommanderBattlefieldEntry(moveTargetPlayerId, instanceIds);
      }
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
    if (toZone === 'battlefield') {
      this.dropFeedbackState.markPendingBattlefieldEntry(playerId, instanceIds);
    }
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
    if (toZone === 'battlefield') {
      this.dropFeedbackState.markPendingBattlefieldEntry(playerId, instanceIds);
    }
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

  private areCardsInZone(playerId: string, zone: GameZoneName, instanceIds: readonly string[]): boolean {
    const zoneCards = this.snapshot()?.players[playerId]?.zones[zone] ?? [];
    const zoneIds = new Set(zoneCards.map((card) => card.instanceId));
    return instanceIds.length > 0 && instanceIds.every((instanceId) => zoneIds.has(instanceId));
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

  private chatRecipientOptions(): ChatRecipientOption[] {
    const players = this.players();
    const currentPlayerId = this.currentPlayer()?.id ?? null;
    const opponents = players
      .filter((player) => player.id !== currentPlayerId)
      .map((player) => ({
        playerId: player.id,
        label: player.state.user.displayName,
      }));

    if (players.length === 2) {
      return opponents;
    }

    return [
      { playerId: null, label: 'Todos' },
      ...opponents,
    ];
  }

  private setSnapshot(snapshot: GameSnapshot | null): void {
    const viewportSnapshot = this.applyViewportClampedBattlefieldPositions(snapshot);
    const positionSnapshot = this.applyOptimisticBattlefieldPositions(viewportSnapshot);
    const nextSnapshot = this.applyOptimisticCardCounters(positionSnapshot);
    this.dropFeedbackState.trackSnapshot(nextSnapshot);
    this.pendingTransferState.reconcileSnapshot(nextSnapshot);
    this.snapshot.set(nextSnapshot);
  }

  private canAddCardCounter(card: GameCardInstance, key: string): boolean {
    return this.hasCardCounter(card, key) || this.countCardCounters(card) < this.maxDistinctCardCounters;
  }

  private hasCardCounter(card: GameCardInstance, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(card.counters ?? {}, key);
  }

  private countCardCounters(card: GameCardInstance): number {
    return Object.keys(card.counters ?? {}).length;
  }

  private cardCounterValue(playerId: string, zone: GameZoneName, card: GameCardInstance, key: string): number {
    const command = this.optimisticCardCounters.get(this.cardCounterCommandKey(playerId, zone, card.instanceId, key));
    if (command) {
      return command.value ?? 0;
    }

    return Math.max(0, Number(card.counters?.[key] ?? 0));
  }

  private queueCardCounter(command: PendingCardCounterCommand): void {
    const key = this.cardCounterCommandKey(command.playerId, command.zone, command.instanceId, command.key);
    this.optimisticCardCounters.set(key, command);
    this.updateLocalCardCounter(command);
    this.scheduleCardCounterFlush(key, this.counterFlushDelayMs);
  }

  private scheduleCardCounterFlush(key: string, delayMs: number): void {
    const existingTimer = this.cardCounterFlushTimers.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.cardCounterFlushTimers.delete(key);
      void this.flushCardCounter(key);
    }, delayMs);
    this.cardCounterFlushTimers.set(key, timer);
  }

  private async flushCardCounter(key: string): Promise<void> {
    const command = this.optimisticCardCounters.get(key);
    const gameId = this.gameId();
    if (!command || !gameId) {
      return;
    }
    if (this.pending()) {
      this.scheduleCardCounterFlush(key, this.counterFlushRetryMs);
      return;
    }

    this.pending.set(true);
    this.error.set(null);
    try {
      const snapshot = await this.commands.send(gameId, 'card.counter.changed', {
        playerId: command.playerId,
        zone: command.zone,
        instanceId: command.instanceId,
        key: command.key,
        ...(command.value === null ? { remove: true } : { value: command.value }),
      });
      if (this.optimisticCardCounters.get(key) === command) {
        this.optimisticCardCounters.delete(key);
      }
      this.setSnapshot(snapshot);
    } catch (error) {
      if (this.optimisticCardCounters.get(key) === command) {
        this.optimisticCardCounters.delete(key);
      }
      this.error.set(this.errorMessage(error));
      await this.refetch(true);
    } finally {
      this.pending.set(false);
      if (this.optimisticCardCounters.has(key)) {
        this.scheduleCardCounterFlush(key, this.counterFlushRetryMs);
      }
    }
  }

  private updateLocalCardCounter(command: PendingCardCounterCommand): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[command.playerId]?.zones[command.zone].find(
      (candidate) => candidate.instanceId === command.instanceId,
    );
    if (!card) {
      return;
    }

    card.counters = { ...(card.counters ?? {}) };
    this.applyCardCounterValue(card, command.key, command.value);
    this.setSnapshot(next);
  }

  private applyOptimisticCardCounters(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticCardCounters.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const command of this.optimisticCardCounters.values()) {
      const card = next.players[command.playerId]?.zones[command.zone].find(
        (candidate) => candidate.instanceId === command.instanceId,
      );
      if (!card) {
        continue;
      }

      card.counters = { ...(card.counters ?? {}) };
      this.applyCardCounterValue(card, command.key, command.value);
      applied = true;
    }

    return applied ? next : snapshot;
  }

  private clearCardCounterFlushTimers(): void {
    for (const timer of this.cardCounterFlushTimers.values()) {
      window.clearTimeout(timer);
    }
    this.cardCounterFlushTimers.clear();
    this.optimisticCardCounters.clear();
  }

  private cardCounterCommandKey(playerId: string, zone: GameZoneName, instanceId: string, key: string): string {
    return `${playerId}:${zone}:${instanceId}:${key}`;
  }

  private applyCardCounterValue(card: GameCardInstance, key: string, value: number | null): void {
    const previousValue = Math.max(0, Number(card.counters?.[key] ?? 0));
    const nextValue = value === null ? 0 : Math.max(0, value);
    if (value === null) {
      delete card.counters?.[key];
    } else {
      card.counters ??= {};
      card.counters[key] = nextValue;
    }

    this.applyStatCounterDelta(card, key, nextValue - previousValue);
  }

  private applyStatCounterDelta(card: GameCardInstance, key: string, delta: number): void {
    if (delta === 0 || (key !== '+1/+1' && key !== '-1/-1')) {
      return;
    }

    const modifier = key === '+1/+1' ? 1 : -1;
    const powerBase = Number.isFinite(Number(card.power)) ? Number(card.power) : Number(card.defaultPower ?? 0);
    const toughnessBase = Number.isFinite(Number(card.toughness)) ? Number(card.toughness) : Number(card.defaultToughness ?? 0);
    card.power = powerBase + (delta * modifier);
    card.toughness = toughnessBase + (delta * modifier);
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
      card.position = this.ratioPositionForBattlefield(playerId, instanceId, position);
      this.setSnapshot(next);
    }
  }

  private queueBattlefieldPositionCommand(
    gameId: string,
    positionCommand: BattlefieldPositionCommand,
    payload: Record<string, unknown>,
  ): void {
    this.optimisticBattlefieldPositions.set(this.battlefieldPositionKey(positionCommand), positionCommand);
    this.battlefieldPositionQueue = this.battlefieldPositionQueue
      .catch(() => undefined)
      .then(() => this.persistBattlefieldPositionCommand(gameId, positionCommand, payload));
  }

  private async persistBattlefieldPositionCommand(
    gameId: string,
    positionCommand: BattlefieldPositionCommand,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = await this.commands.send(gameId, 'card.position.changed', payload);
      this.clearOptimisticBattlefieldPosition(positionCommand);
      this.setSnapshot(snapshot);
    } catch (error) {
      this.clearOptimisticBattlefieldPosition(positionCommand);
      this.error.set(this.errorMessage(error));
    }
  }

  private applyOptimisticBattlefieldPositions(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticBattlefieldPositions.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const optimisticPosition of this.optimisticBattlefieldPositions.values()) {
      const card = next.players[optimisticPosition.playerId]?.zones.battlefield.find(
        (candidate) => candidate.instanceId === optimisticPosition.instanceId,
      );
      if (!card) {
        continue;
      }

      card.position = optimisticPosition.position;
      applied = true;
    }

    return applied ? next : snapshot;
  }

  private applyViewportClampedBattlefieldPositions(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.viewportClampedBattlefieldPositions.size === 0) {
      return snapshot;
    }

    let next: GameSnapshot | null = null;
    for (const clamp of this.viewportClampedBattlefieldPositions.values()) {
      const card = (next ?? snapshot).players[clamp.playerId]?.zones.battlefield.find(
        (candidate) => candidate.instanceId === clamp.instanceId,
      );
      if (isRatioPosition(card?.position)) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      const position = card ? this.selectors.cardPosition(card, this.battlefieldLayoutSize()) : null;
      if (!card || !position) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      if (!this.samePosition(position, clamp.sourcePosition) && !this.samePosition(position, clamp.clampedPosition)) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      if (this.samePosition(position, clamp.clampedPosition)) {
        continue;
      }

      next ??= structuredClone(snapshot);
      const nextCard = next.players[clamp.playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === clamp.instanceId);
      if (nextCard) {
        nextCard.position = clamp.clampedPosition;
      }
    }

    return next ?? snapshot;
  }

  private clearOptimisticBattlefieldPosition(positionCommand: BattlefieldPositionCommand): void {
    const key = this.battlefieldPositionKey(positionCommand);
    const current = this.optimisticBattlefieldPositions.get(key);
    if (current && this.samePosition(current.position, positionCommand.position)) {
      this.optimisticBattlefieldPositions.delete(key);
    }
  }

  private battlefieldPositionCommand(payload: Record<string, unknown>): BattlefieldPositionCommand | null {
    const playerId = this.stringPayload(payload, 'playerId');
    const zone = this.zonePayload(payload, 'zone');
    const instanceId = this.stringPayload(payload, 'instanceId');
    const position = this.positionPayload(payload['position']);
    if (!playerId || zone !== 'battlefield' || !instanceId || !position) {
      return null;
    }

    return { playerId, instanceId, position };
  }

  private positionPayload(value: unknown): GameCardPosition | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as { x?: unknown; y?: unknown; unit?: unknown };
    if (
      typeof candidate.x !== 'number'
      || !Number.isFinite(candidate.x)
      || typeof candidate.y !== 'number'
      || !Number.isFinite(candidate.y)
    ) {
      return null;
    }

    return candidate.unit === 'ratio'
      ? { x: candidate.x, y: candidate.y, unit: 'ratio' }
      : { x: candidate.x, y: candidate.y };
  }

  private battlefieldPositionKey(positionCommand: Pick<BattlefieldPositionCommand, 'playerId' | 'instanceId'>): string {
    return `${positionCommand.playerId}:${positionCommand.instanceId}`;
  }

  private samePosition(left: GameCardPosition, right: GameCardPosition): boolean {
    return sameBattlefieldPosition(left, right);
  }

  private clampBattlefieldPosition(
    position: { x: number; y: number },
    battlefieldWidth: number,
    battlefieldHeight: number,
    cardWidth: number,
    cardHeight: number,
  ): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(Math.round(battlefieldWidth - cardWidth), Math.round(position.x))),
      y: Math.max(0, Math.min(Math.round(battlefieldHeight - cardHeight), Math.round(position.y))),
    };
  }

  private moveLocalCardsFromHandToBattlefield(
    playerId: string,
    targetPlayerId: string,
    movedInstanceIds: readonly string[],
    position?: GameCardPosition,
  ): boolean {
    const snapshot = this.snapshot();
    if (!snapshot || movedInstanceIds.length === 0 || !snapshot.players[playerId] || !snapshot.players[targetPlayerId]) {
      return false;
    }

    const movedIds = new Set(movedInstanceIds);
    const next = structuredClone(snapshot);
    const sourcePlayer = next.players[playerId];
    const targetPlayer = next.players[targetPlayerId];
    if (!sourcePlayer || !targetPlayer) {
      return false;
    }

    const movedCards = sourcePlayer.zones.hand.filter((card) => movedIds.has(card.instanceId));
    if (movedCards.length !== movedIds.size) {
      return false;
    }

    sourcePlayer.zones.hand = sourcePlayer.zones.hand.filter((card) => !movedIds.has(card.instanceId));
    targetPlayer.zones.battlefield = [
      ...targetPlayer.zones.battlefield.filter((card) => !movedIds.has(card.instanceId)),
      ...movedCards.map((card) => ({
        ...card,
        ...(position ? { position } : {}),
      })),
    ];

    if (sourcePlayer.zoneCounts) {
      sourcePlayer.zoneCounts = {
        ...sourcePlayer.zoneCounts,
        hand: sourcePlayer.zones.hand.length,
      };
    }
    if (targetPlayer.zoneCounts) {
      targetPlayer.zoneCounts = {
        ...targetPlayer.zoneCounts,
        battlefield: targetPlayer.zones.battlefield.length,
      };
    }

    this.setSnapshot(next);
    return true;
  }

  private snappedBattlefieldPosition(
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    rawZone?: string,
  ): GameCardPosition {
    const snapped = rawZone === 'mana'
      ? position
      : this.battlefieldDrag.positionWithAlignmentGuide(
        this.battlefieldDragContext(),
        playerId,
        instanceId,
        position,
        this.alignmentGuideFor(playerId)?.y ?? null,
      );

    return this.ratioPositionForBattlefield(playerId, instanceId, snapped);
  }

  private ratioPositionForBattlefield(playerId: string, instanceId: string, position: { x: number; y: number }): GameCardPosition {
    return ratioBattlefieldPosition(
      position,
      this.battlefieldElementSize(playerId),
      this.battlefieldCardSize(playerId, instanceId),
    );
  }

  private battlefieldElementSize(playerId: string): BattlefieldSize {
    const battlefield = this.battlefieldElement(playerId);
    const bounds = battlefield?.getBoundingClientRect();

    return bounds && bounds.width > 0 && bounds.height > 0
      ? { width: bounds.width, height: bounds.height }
      : this.battlefieldLayoutSize();
  }

  private battlefieldCardSize(playerId: string, instanceId: string): { width: number; height: number } {
    const cardElement = Array.from(this.battlefieldElement(playerId)?.querySelectorAll<HTMLElement>(
      '[data-testid="game-card"][data-card-instance-id]',
    ) ?? []).find((element) => element.dataset['cardInstanceId'] === instanceId);
    const bounds = cardElement?.getBoundingClientRect();

    return {
      width: Math.max(1, Math.round(cardElement?.offsetWidth || bounds?.width || DEFAULT_BATTLEFIELD_CARD_SIZE.width)),
      height: Math.max(1, Math.round(cardElement?.offsetHeight || bounds?.height || DEFAULT_BATTLEFIELD_CARD_SIZE.height)),
    };
  }

  private battlefieldElement(playerId: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId) ?? null;
  }

  private battlefieldDragContext(): GameTableBattlefieldDragContext {
    return {
      zones: this.zones,
      snapshot: () => this.snapshot(),
      selectedCards: () => this.selectedCards(),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      cardPosition: (card) => this.cardPosition(card),
      updateLocalCardPosition: (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
    };
  }

  private cardStatsContext(): GameTableCardStatsContext {
    return {
      canControlOwnedCard: (playerId, card) => this.canControlOwnedCard(playerId, card),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      updateLocalCardPowerToughness: (playerId, zone, instanceId, power, toughness) =>
        this.updateLocalCardPowerToughness(playerId, zone, instanceId, power, toughness),
      updateLocalCardLoyalty: (playerId, zone, instanceId, loyalty) =>
        this.updateLocalCardLoyalty(playerId, zone, instanceId, loyalty),
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
      markPendingTransfer: (playerId, fromZone, instanceIds, options) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
        expires: options?.expires,
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
      cardPosition: (card) => this.cardPosition(card),
      canControlPlayer: (playerId) => this.canControlPlayer(playerId),
      canControlOwnedCard: (playerId, card) => this.canControlOwnedCard(playerId, card),
      playerName: (playerId) => this.playerName(playerId),
      battlefieldPosition: (playerId, instanceId, position) => this.ratioPositionForBattlefield(playerId, instanceId, position),
      updateLocalCardPosition: (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
      setPendingBattlefieldMove: (move) => this.pendingBattlefieldMove.set(move),
      setPendingLibraryMove: (move) => this.pendingLibraryMove.set(move),
      endCardDrag: () => this.endCardDrag(),
      clearSelectedCards: () => this.selectedCards.set([]),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      setError: (message) => this.error.set(message),
      applyDeferredRemoteSnapshot: () => this.applyDeferredRemoteSnapshot(),
      refetch: (force) => this.refetch(force),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds, options) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.snapshot()?.version ?? null,
        expires: options?.expires,
      }),
      command: (type, payload) => this.command(type, payload),
    };
  }

  private zoneActionContext(): GameTableZoneActionContext {
    return {
      gameId: () => this.gameId(),
      snapshot: () => this.snapshot(),
      playerName: (playerId) => this.playerName(playerId),
      zoneTitle: (zone) => this.zoneTitle(zone),
      setError: (message) => this.error.set(message),
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

  private buildOpponentTargetingPills(): ReadonlyMap<string, OpponentTargetingPill> {
    const snapshot = this.snapshot();
    const currentPlayerId = this.currentPlayer()?.id;
    if (!snapshot || !currentPlayerId || snapshot.arrows.length === 0) {
      return new Map();
    }

    const battlefieldCardOwners = new Map<string, string>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      for (const card of player.zones.battlefield) {
        battlefieldCardOwners.set(card.instanceId, playerId);
      }
    }

    const outgoingTargetCounts = new Map<string, number>();
    for (const arrow of snapshot.arrows) {
      const sourcePlayerId = battlefieldCardOwners.get(arrow.fromInstanceId);
      const targetPlayerId = battlefieldCardOwners.get(arrow.toInstanceId);
      if (!sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId) {
        continue;
      }

      if (sourcePlayerId === currentPlayerId && targetPlayerId !== currentPlayerId) {
        outgoingTargetCounts.set(targetPlayerId, (outgoingTargetCounts.get(targetPlayerId) ?? 0) + 1);
      }
    }

    const pills = new Map<string, OpponentTargetingPill>();
    for (const [targetPlayerId, count] of outgoingTargetCounts) {
      const target = this.players().find((player) => player.id === targetPlayerId) ?? null;
      const label = count > 1 ? 'multiple' : this.targetingPlayerLabel(target);
      pills.set(targetPlayerId, {
        direction: 'outgoing',
        text: `Objetivo: ${label}`,
        title: count > 1 ? 'Tienes multiples objetivos en este battlefield.' : `${label} es el objetivo de una de tus flechas.`,
      });
    }

    for (const arrow of snapshot.arrows) {
      const sourcePlayerId = battlefieldCardOwners.get(arrow.fromInstanceId);
      const targetPlayerId = battlefieldCardOwners.get(arrow.toInstanceId);
      if (!sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId) {
        continue;
      }

      if (targetPlayerId === currentPlayerId && sourcePlayerId !== currentPlayerId) {
        const source = this.players().find((player) => player.id === sourcePlayerId) ?? null;
        const label = this.targetingPlayerLabel(source);
        pills.set(sourcePlayerId, {
          direction: 'incoming',
          text: `Objetivo de ${label}`,
          title: `Una de tus cartas es objetivo de ${label}.`,
        });
      }
    }

    return pills;
  }

  private buildOpponentCardsTargetCards(): ReadonlyMap<string, readonly OpponentCardsTargetCard[]> {
    const snapshot = this.snapshot();
    if (!snapshot || snapshot.arrows.length === 0) {
      return new Map();
    }

    const battlefieldCards = new Map<string, { playerId: string; card: GameCardInstance; position: { x: number; y: number } }>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      for (const card of player.zones.battlefield) {
        battlefieldCards.set(card.instanceId, {
          playerId,
          card,
          position: this.cardPosition(card) ?? { x: 0, y: 0 },
        });
      }
    }

    const focusByPlayer = new Map<string, Map<string, TargetCardBuildEntry>>();
    const markCard = (
      playerId: string,
      card: GameCardInstance,
      role: OpponentCardsTargetRole,
      counterpartPosition: { x: number; y: number },
    ): void => {
      const playerFocus = focusByPlayer.get(playerId) ?? new Map<string, TargetCardBuildEntry>();
      const entry = playerFocus.get(card.instanceId) ?? { card, source: false, target: false, sortValues: [] };

      playerFocus.set(card.instanceId, {
        card,
        source: entry.source || role === 'source',
        target: entry.target || role === 'target',
        sortValues: [...entry.sortValues, this.cardsTargetSortValue(counterpartPosition)],
      });
      focusByPlayer.set(playerId, playerFocus);
    };

    for (const arrow of snapshot.arrows) {
      const source = battlefieldCards.get(arrow.fromInstanceId);
      const target = battlefieldCards.get(arrow.toInstanceId);
      if (source) {
        markCard(source.playerId, source.card, 'source', target?.position ?? source.position);
      }
      if (target) {
        markCard(target.playerId, target.card, 'target', source?.position ?? target.position);
      }
    }

    const targetCardsByPlayer = new Map<string, readonly OpponentCardsTargetCard[]>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      const playerFocus = focusByPlayer.get(playerId);
      if (!playerFocus) {
        continue;
      }

      const focusCards = player.zones.battlefield
        .map((card) => playerFocus.get(card.instanceId))
        .filter((entry): entry is TargetCardBuildEntry => Boolean(entry))
        .sort((left, right) => this.averageSortValue(left.sortValues) - this.averageSortValue(right.sortValues))
        .map((entry) => ({
          card: entry.card,
          role: this.cardsTargetRole(entry.source, entry.target),
        }));

      if (focusCards.length > 0) {
        targetCardsByPlayer.set(playerId, focusCards);
      }
    }

    return targetCardsByPlayer;
  }

  private cardsTargetSortValue(position: { x: number; y: number }): number {
    return position.x + position.y * 0.05;
  }

  private averageSortValue(values: readonly number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  private cardsTargetRole(source: boolean, target: boolean): OpponentCardsTargetRole {
    if (source && target) {
      return 'both';
    }

    return source ? 'source' : 'target';
  }

  private targetingPlayerLabel(player: PlayerView | null): string {
    return this.deckLabel(player) || player?.state.user.displayName || player?.state.user.email || player?.id || 'ese jugador';
  }

  private arrowColorForCard(card: GameCardInstance): string {
    return this.arrowColorPalette(card.colorIdentity ?? [])[0] ?? 'yellow';
  }

  private arrowColorPalette(colorIdentity: readonly string[]): readonly string[] {
    const colorsByIdentity: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
    };
    const identityColors = ['W', 'U', 'B', 'R', 'G']
      .filter((color) => colorIdentity.includes(color))
      .map((color) => colorsByIdentity[color])
      .filter((color): color is string => Boolean(color));

    return identityColors.length > 0 ? identityColors : ['yellow'];
  }

  private ownedArrowIds(playerId: string): readonly string[] {
    const snapshot = this.snapshot();
    const battlefield = snapshot?.players[playerId]?.zones.battlefield;
    if (!snapshot || !battlefield) {
      return [];
    }

    const sourceInstanceIds = new Set(battlefield.map((card) => card.instanceId));

    return snapshot.arrows
      .filter((arrow) => arrow.ownerId === playerId || (!arrow.ownerId && sourceInstanceIds.has(arrow.fromInstanceId)))
      .map((arrow) => arrow.id);
  }

  private ownPlayerId(snapshot: GameSnapshot): string | null {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return null;
    }

    return Object.entries(snapshot.players).find(([, player]) => player.user.id === userId)?.[0] ?? null;
  }

  private resolvePlayerId(playerId: string): string | null {
    const players = this.snapshot()?.players;
    if (!players) {
      return null;
    }

    if (players[playerId]) {
      return playerId;
    }

    return Object.entries(players).find(([, player]) => player.user.id === playerId)?.[0] ?? null;
  }

  private beginCardDrag(instanceId: string): void {
    this.hideCardPreview();
    this.battlefieldDragState.beginCardDrag(instanceId);
  }

  private updateLocalCardLoyalty(playerId: string, zone: GameZoneName, instanceId: string, loyalty: number): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones[zone]?.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.loyalty = loyalty;
      this.setSnapshot(next);
    }
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
    position?: GameCardPosition,
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
      this.dropFeedbackState.markPendingBattlefieldEntry(targetPlayerId, movedInstanceIds);
      this.moveLocalCardsFromHandToBattlefield(playerId, targetPlayerId, movedInstanceIds, position);
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

  private queueArrowCreatedCommand(payload: { fromInstanceId: string; toInstanceId: string; color: string }): void {
    this.arrowCreationQueue = this.arrowCreationQueue
      .then(() => this.command('arrow.created', payload))
      .catch(() => undefined);
  }

  private showArrowTargetProgressToast(remainingTargets: number): void {
    const normalizedRemaining = Math.max(1, Math.floor(remainingTargets));
    this.showTargetToast(normalizedRemaining === 1
      ? 'Falta 1 objetivo.'
      : `Faltan ${normalizedRemaining} objetivos.`);
  }

  private showTargetToast(message: string): void {
    this.clearTargetToastTimer();
    this.targetToast.set(message);
    this.targetToastTimer = window.setTimeout(() => {
      if (this.targetToast() === message) {
        this.targetToast.set(null);
      }
      this.targetToastTimer = null;
    }, this.errorToastDurationMs);
  }

  private clearTargetToast(): void {
    this.clearTargetToastTimer();
    this.targetToast.set(null);
  }

  private clearTargetToastTimer(): void {
    if (this.targetToastTimer === null) {
      return;
    }

    window.clearTimeout(this.targetToastTimer);
    this.targetToastTimer = null;
  }
}
