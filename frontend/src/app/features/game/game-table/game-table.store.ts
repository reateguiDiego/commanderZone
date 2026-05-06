import { Injectable, OnDestroy, WritableSignal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameLogEntry, GameSnapshot, GameZoneName, GameZoneResponse } from '../../../core/models/game.model';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTableRealtimeService } from './services/game-table-realtime.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableTurnActionContext, GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { GameTableChatLogState } from './state/game-table-chat-log.state';
import { GameTableSnapshotSelectors, PlayerView } from './state/game-table-snapshot-selectors';
import { GameContextMenu, GameTableUiState } from './state/game-table-ui.state';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';
import { GameTableCardActionContext, GameTableCardActionsService } from './services/game-table-card-actions.service';

export type { PlayerView } from './state/game-table-snapshot-selectors';

export interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface PendingBattlefieldMove {
  cardName: string;
  targetPlayerName: string;
  payload: Record<string, unknown>;
}

export interface GameLogEntryView extends GameLogEntry {
  card: GameCardInstance | null;
  messagePrefix: string;
  messageSuffix: string;
}

interface HandDropPreview {
  playerId: string;
  targetInstanceId: string;
  placement: 'before' | 'after';
}

interface PendingPowerToughnessChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  power: number;
  toughness: number;
}

interface AlignmentGuide {
  playerId: string;
  y: number;
}

interface AlignmentCandidate {
  y: number;
  distance: number;
}

interface ActiveDropTarget {
  playerId: string;
  zone: GameZoneName;
}

interface PointerDragPreview {
  card: GameCardInstance;
  x: number;
  y: number;
}

@Injectable()
export class GameTableStore implements OnDestroy {
  private readonly gamesApi = inject(GamesApi);
  private readonly commands = inject(GameTableCommandService);
  private readonly cardActions = inject(GameTableCardActionsService);
  private readonly drag = inject(GameTableDragService);
  private readonly libraryActions = inject(GameTableLibraryActionsService);
  private readonly turnActions = inject(GameTableTurnActionsService);
  private readonly selection = inject(GameTableSelectionService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly realtime = inject(GameTableRealtimeService);
  private readonly route = inject(ActivatedRoute);
  private readonly uiState = inject(GameTableUiState);
  private readonly zoneModalState = inject(GameTableZoneModalState);
  private readonly chatLogState = inject(GameTableChatLogState);
  private readonly selectors = inject(GameTableSnapshotSelectors);
  private floatingDragOffset: { x: number; y: number } | null = null;
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  private readonly powerToughnessDebounceMs = 450;
  private readonly battlefieldAlignmentGuideThreshold = 12;
  private readonly battlefieldAlignmentSnapThreshold = 12;
  private readonly powerToughnessTimers = new Map<string, number>();
  private readonly pendingPowerToughnessChanges = new Map<string, PendingPowerToughnessChange>();

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
  readonly draggingCardInstanceId = signal<string | null>(null);
  readonly handDropPreview = signal<HandDropPreview | null>(null);
  readonly manaLaneDropPlayerId = signal<string | null>(null);
  readonly alignmentGuide = signal<AlignmentGuide | null>(null);
  readonly activeDropTarget = signal<ActiveDropTarget | null>(null);
  readonly activePlayerDropTarget = signal<string | null>(null);
  readonly pointerDragPreview = signal<PointerDragPreview | null>(null);
  readonly players = computed<PlayerView[]>(() => this.selectors.players(this.snapshot()));
  readonly focusedPlayer = computed<PlayerView | null>(() => this.selectors.focusedPlayer(this.snapshot(), this.players(), this.focusedPlayerId()));
  readonly eventLog = computed<GameLogEntryView[]>(() => this.chatLogState.eventLog(this.snapshot()).map((entry) => this.toLogEntryView(entry)));
  readonly currentPlayer = computed<PlayerView | null>(() => this.selectors.currentPlayer(this.players(), this.auth.user()?.id));
  readonly handPlayer = computed<PlayerView | null>(() => this.selectors.handPlayer(this.currentPlayer(), this.focusedPlayer()));
  readonly isGameOwner = computed(() => this.selectors.isGameOwner(this.snapshot(), this.currentPlayer()));
  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.uiState.destroy();
    this.clearPowerToughnessTimers();
    this.realtime.stop();
  }

  async load(): Promise<void> {
    const id = this.gameId();
    if (!id) {
      this.error.set('Missing game id.');
      this.loading.set(false);
      return;
    }

    try {
      await this.refetch(true);
      this.subscribeToRealtime(id);
      this.startPolling();
    } catch {
      this.error.set('Could not load game snapshot.');
    } finally {
      this.loading.set(false);
    }
  }

  async refetch(force = false): Promise<void> {
    const id = this.gameId();
    if (!id) {
      return;
    }

    const response = await firstValueFrom(this.gamesApi.snapshot(id));
    const nextSnapshot = response.game.snapshot;
    const currentSnapshot = this.snapshot();
    if (!force && currentSnapshot?.version === nextSnapshot.version) {
      return;
    }
    if (!force && this.drag.hasActivePointerDrag()) {
      this.deferredRemoteSnapshot = nextSnapshot;
      return;
    }

    this.applySnapshot(nextSnapshot);
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
    return this.selection.isCurrentPlayer(this.currentPlayer(), playerId);
  }

  canControlPlayer(playerId: string): boolean {
    return this.selection.canControlPlayer(this.currentPlayer(), playerId);
  }

  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean {
    const currentPlayerId = this.currentPlayer()?.id;

    return this.canControlPlayer(playerId) && (!card.ownerId || card.ownerId === currentPlayerId);
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
    return this.selection.canUseHiddenZone(this.currentPlayer(), playerId, zone);
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
    return this.selection.activeKeyboardCard(this.uiState.activeHoveredSelection()) as SelectedCard | null;
  }

  clearSelection(): void {
    this.selection.clearSelection();
  }

  isDraggingCard(card: GameCardInstance): boolean {
    return this.draggingCardInstanceId() === card.instanceId;
  }

  isManaLaneHighlighted(playerId: string): boolean {
    return this.manaLaneDropPlayerId() === playerId;
  }

  isDropZoneHighlighted(playerId: string, zone: GameZoneName): boolean {
    const target = this.activeDropTarget();

    return target?.playerId === playerId && target.zone === zone || zone === 'battlefield' && this.manaLaneDropPlayerId() === playerId;
  }

  isPlayerDropHighlighted(playerId: string): boolean {
    return this.activePlayerDropTarget() === playerId;
  }

  isPendingBattlefieldTransfer(card: GameCardInstance): boolean {
    return this.pendingBattlefieldMove()?.payload['instanceId'] === card.instanceId;
  }

  alignmentGuideFor(playerId: string): AlignmentGuide | null {
    const guide = this.alignmentGuide();

    return guide?.playerId === playerId ? guide : null;
  }

  isPhasePast(phase: string): boolean {
    return this.selectors.isPhasePast(this.phases, this.snapshot(), phase);
  }

  toggleCardSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.ripple(event.currentTarget as HTMLElement);
    if (!this.canControlOwnedCard(playerId, card) || !['battlefield', 'hand'].includes(zone)) {
      return;
    }

    this.selection.toggleSelection(event, playerId, zone, card);
  }

  isSelected(instanceId: string): boolean {
    return this.selection.isSelected(instanceId);
  }

  openCardMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    if (zone === 'battlefield' && !this.isCurrentPlayer(playerId)) {
      return;
    }
    this.uiState.openContextMenu(event, { playerId, zone, card, kind: 'card' });
  }

  openZoneMenu(event: MouseEvent, playerId: string, zone: GameZoneName): void {
    event.preventDefault();
    event.stopPropagation();
    if (zone === 'battlefield' && !this.isCurrentPlayer(playerId)) {
      return;
    }
    this.uiState.openContextMenu(event, { playerId, zone, kind: 'zone' });
  }

  openGameMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const playerId = this.focusedPlayer()?.id ?? this.currentPlayer()?.id ?? '';
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'game' });
  }

  openPlayerMenu(event: MouseEvent, playerId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'player' });
  }

  closeContextMenu(): void {
    this.uiState.closeContextMenu();
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
    await this.command('life.changed', { playerId, delta });
  }

  async setLife(playerId: string, value: string | number): Promise<void> {
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
    await this.turnActions.advanceTurnPhase(this.turnActionContext());
  }

  async changeCommanderCastCount(playerId: string, delta: number): Promise<void> {
    const player = this.players().find((candidate) => candidate.id === playerId);
    if (!player || !this.canControlPlayer(playerId)) {
      return;
    }

    await this.command('counter.changed', {
      scope: `commander:${playerId}`,
      key: 'casts',
      value: Math.max(0, this.commanderCastCount(player) + delta),
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
      loadZone: () => this.loadZone(),
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
      this.updatePointerDragPreview(event, draggingInstanceId);
      this.updateBattlefieldDragAid(event, draggingInstanceId);
      this.updatePointerDropTarget(event);
    }
  }

  async endCardPointerDrag(event?: PointerEvent): Promise<void> {
    const drag = this.drag.endCardPointerDrag(
      event,
      (pointerEvent, playerId) => this.drag.pointerDropZone(pointerEvent, playerId, this.zones),
      (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
    );
    const applyDeferredSnapshot = () => this.applyDeferredRemoteSnapshot();
    const activeGuideY = drag ? this.alignmentGuideFor(drag.playerId)?.y ?? null : null;
    const targetPlayerId = event && drag ? this.playerDropTargetAt(event, drag.playerId) : null;
    this.endCardDrag();
    if (!drag || !drag.moved) {
      applyDeferredSnapshot();
      return;
    }
    this.selectedCards.set([]);

    if (targetPlayerId) {
      const sourceCard = this.findCard(drag.playerId, 'battlefield', drag.instanceId);
      if (sourceCard && this.canControlOwnedCard(drag.playerId, sourceCard)) {
        this.pendingBattlefieldMove.set({
          cardName: sourceCard.name,
          targetPlayerName: this.playerName(targetPlayerId),
          payload: {
            playerId: drag.playerId,
            fromZone: 'battlefield',
            toZone: 'battlefield',
            targetPlayerId,
            instanceId: drag.instanceId,
          },
        });
      }
      return;
    }

    if (drag.dropZone && drag.dropZone !== 'battlefield') {
      if (!this.canControlPlayer(drag.playerId)) {
        applyDeferredSnapshot();
        return;
      }
      await this.command('card.moved', {
        playerId: drag.playerId,
        fromZone: 'battlefield',
        toZone: drag.dropZone,
        instanceId: drag.instanceId,
      });
      applyDeferredSnapshot();
      return;
    }

    if (!drag.dropZone && (!event || !this.isPointerInsidePlayerBattlefield(event, drag.playerId))) {
      await this.refetch(true);
      applyDeferredSnapshot();
      return;
    }

    const position = this.positionWithAlignmentGuide(
      drag.playerId,
      drag.instanceId,
      drag.position,
      activeGuideY,
    );

    await this.command('card.position.changed', {
      playerId: drag.playerId,
      zone: 'battlefield',
      instanceId: drag.instanceId,
      position,
    });
    applyDeferredSnapshot();
  }

  cancelCardPointerDrag(event?: PointerEvent): void {
    this.drag.cancelCardPointerDrag(event);
    this.endCardDrag();
    this.selectedCards.set([]);
    this.applyDeferredRemoteSnapshot();
  }

  handleBattlefieldCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.stopPropagation();
    if (!this.isCurrentPlayer(playerId)) {
      return;
    }
    if (this.drag.consumeSuppressedClick(card.instanceId)) {
      return;
    }

    const alreadySelected = this.selectedCards().length === 1 && this.selectedCards()[0]?.card.instanceId === card.instanceId;
    if (alreadySelected && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      this.ripple(event.currentTarget as HTMLElement);
      return;
    }

    this.toggleCardSelection(event, playerId, 'battlefield', card);
  }

  handleHandCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.stopPropagation();
    const alreadySelected = this.selectedCards().length === 1 && this.selectedCards()[0]?.card.instanceId === card.instanceId;
    if (event.detail >= 2 || (alreadySelected && !event.ctrlKey && !event.metaKey && !event.shiftKey)) {
      event.preventDefault();
      void this.playCard(playerId, 'hand', card);
      return;
    }

    this.toggleCardSelection(event, playerId, 'hand', card);
  }

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    if (!this.canControlOwnedCard(playerId, card)) {
      event.preventDefault();
      this.error.set('You can only move your own cards.');
      return;
    }

    this.drag.dragStart(event, playerId, zone, card);
    this.beginCardDrag(card.instanceId);
  }

  dragEnd(): void {
    this.endCardDrag();
    this.clearHandDropPreview();
    this.selectedCards.set([]);
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
    this.drag.allowDrop(event);
    this.updateActiveDropTarget(event);
  }

  previewHandDrop(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): void {
    this.drag.allowDrop(event);
    this.updateActiveDropTarget(event);
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged || dragged.zone !== 'hand' || dragged.playerId !== targetPlayerId || dragged.instanceId === targetCard.instanceId) {
      this.clearHandDropPreview();
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const placement = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    this.handDropPreview.set({ playerId: targetPlayerId, targetInstanceId: targetCard.instanceId, placement });
  }

  clearHandDropPreview(): void {
    this.handDropPreview.set(null);
  }

  async dropOnZone(event: DragEvent, targetPlayerId: string, toZone: GameZoneName): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged) {
      this.endCardDrag();
      return;
    }
    if (!this.canControlPlayer(dragged.playerId)) {
      this.endCardDrag();
      this.error.set('You can only move your own cards.');
      return;
    }
    const sourceCard = this.findCard(dragged.playerId, dragged.zone, dragged.instanceId);
    if (!sourceCard || !this.canControlOwnedCard(dragged.playerId, sourceCard)) {
      this.endCardDrag();
      this.error.set('You can only move your own cards.');
      return;
    }

    const payload: Record<string, unknown> = {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone,
      targetPlayerId,
      instanceId: dragged.instanceId,
    };
    const position = this.drag.dropPosition(event, toZone);
    if (position) {
      payload['position'] = position;
    }

    if (dragged.zone === 'battlefield' && toZone === 'battlefield' && targetPlayerId === dragged.playerId && position) {
      await this.command('card.position.changed', {
        playerId: dragged.playerId,
        zone: 'battlefield',
        instanceId: dragged.instanceId,
        position,
      });
      this.endCardDrag();
      this.selectedCards.set([]);
      return;
    }

    if (toZone === 'battlefield' && targetPlayerId !== dragged.playerId) {
      this.pendingBattlefieldMove.set({
        cardName: sourceCard.name,
        targetPlayerName: this.playerName(targetPlayerId),
        payload,
      });
      this.endCardDrag();
      return;
    }

    await this.command('card.moved', payload);
    await this.recordCommanderCastIfNeeded(dragged.playerId, dragged.zone, toZone, targetPlayerId);
    this.endCardDrag();
    this.selectedCards.set([]);
  }

  async dropOnManaLane(event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropOnZone(event, targetPlayerId, 'battlefield');
  }

  async dropOnHand(event: DragEvent, targetPlayerId: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, this.zones);
    if (dragged?.zone === 'hand' && dragged.playerId === targetPlayerId) {
      const hand = this.snapshot()?.players[targetPlayerId]?.zones.hand ?? [];
      const lastCard = hand.at(-1);
      if (lastCard && dragged.instanceId !== lastCard.instanceId) {
        await this.reorderHand(targetPlayerId, dragged.instanceId, lastCard.instanceId, 'after');
      }
      this.endCardDrag();
      this.clearHandDropPreview();
      this.selectedCards.set([]);
      return;
    }

    await this.dropOnZone(event, targetPlayerId, 'hand');
  }

  async dropOnHandCard(event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged || dragged.zone !== 'hand' || dragged.playerId !== targetPlayerId || dragged.instanceId === targetCard.instanceId) {
      this.endCardDrag();
      this.clearHandDropPreview();
      return;
    }
    const player = this.players().find((candidate) => candidate.id === targetPlayerId);
    const sourceCard = this.findCard(dragged.playerId, 'hand', dragged.instanceId);
    if (!player || !sourceCard || !this.canControlOwnedCard(targetPlayerId, sourceCard)) {
      this.endCardDrag();
      this.clearHandDropPreview();
      this.error.set('You can only reorder your own hand.');
      return;
    }

    const preview = this.handDropPreview();
    const placement = preview?.playerId === targetPlayerId && preview.targetInstanceId === targetCard.instanceId ? preview.placement : 'before';
    await this.reorderHand(targetPlayerId, dragged.instanceId, targetCard.instanceId, placement);
    this.endCardDrag();
    this.clearHandDropPreview();
    this.selectedCards.set([]);
  }

  async confirmPendingBattlefieldMove(): Promise<void> {
    const pendingMove = this.pendingBattlefieldMove();
    if (!pendingMove) {
      return;
    }

    await this.command('card.moved', pendingMove.payload);
    const fromZone = pendingMove.payload['fromZone'];
    const targetPlayerId = pendingMove.payload['targetPlayerId'];
    const playerId = pendingMove.payload['playerId'];
    if (typeof playerId === 'string' && typeof fromZone === 'string' && typeof targetPlayerId === 'string') {
      await this.recordCommanderCastIfNeeded(playerId, fromZone as GameZoneName, 'battlefield', targetPlayerId);
    }
    this.pendingBattlefieldMove.set(null);
    this.selectedCards.set([]);
  }

  async cancelPendingBattlefieldMove(): Promise<void> {
    await this.refetch(true);
    this.pendingBattlefieldMove.set(null);
  }

  async dropOnPlayer(event: DragEvent, targetPlayerId: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged || dragged.playerId === targetPlayerId) {
      this.endCardDrag();
      return;
    }
    if (!this.canControlPlayer(dragged.playerId)) {
      this.endCardDrag();
      this.error.set('You can only give your own cards.');
      return;
    }
    const sourceCard = this.findCard(dragged.playerId, dragged.zone, dragged.instanceId);
    if (!sourceCard || !this.canControlOwnedCard(dragged.playerId, sourceCard)) {
      this.endCardDrag();
      this.error.set('You can only give your own cards.');
      return;
    }

    this.pendingBattlefieldMove.set({
      cardName: sourceCard.name,
      targetPlayerName: this.playerName(targetPlayerId),
      payload: {
        playerId: dragged.playerId,
        fromZone: dragged.zone,
        toZone: 'battlefield',
        targetPlayerId,
        instanceId: dragged.instanceId,
      },
    });
    this.endCardDrag();
    this.selectedCards.set([]);
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

  async setPowerToughness(menu: GameContextMenu): Promise<void> {
    await this.cardActions.setPowerToughness(this.cardActionContext(), menu);
  }

  async changeCardCounter(menu: GameContextMenu, key = '+1/+1'): Promise<void> {
    await this.cardActions.changeCardCounter(this.cardActionContext(), menu, key);
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
    const title = `${this.playerName(playerId)} ${this.zoneTitle(zone)}`;
    this.zoneModalState.open(playerId, zone, title);
    await this.loadZone();
  }

  async loadZone(): Promise<void> {
    const modal = this.zoneModal();
    const gameId = this.gameId();
    if (!modal || !gameId) {
      return;
    }

    this.zoneModalState.setLoading();
    const response: GameZoneResponse = await firstValueFrom(this.gamesApi.zone(gameId, modal.playerId, modal.zone, {
      type: modal.type,
      search: modal.search,
      limit: 200,
    }));
    this.zoneModalState.setLoaded(response.data, response.total);
  }

  updateZoneFilter(patch: Partial<{ type: string; search: string }>): void {
    this.zoneModalState.patchFilters(patch);
    void this.loadZone();
  }

  selectZoneCard(card: GameCardInstance): void {
    this.zoneModalState.selectCard(card);
  }

  closeZoneModal(): void {
    this.zoneModalState.close();
  }

  startFloatingDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const panel = target.closest('.floating-panel') as HTMLElement | null;
    if (!panel) {
      return;
    }

    const bounds = panel.getBoundingClientRect();
    this.floatingDragOffset = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    panel.setPointerCapture?.(event.pointerId);
  }

  moveFloatingPanel(event: PointerEvent): void {
    if (!this.floatingDragOffset) {
      return;
    }

    const width = 384;
    const height = 420;
    this.floatingPanel.set({
      x: Math.max(8, Math.min(event.clientX - this.floatingDragOffset.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY - this.floatingDragOffset.y, window.innerHeight - height - 8)),
    });
  }

  endFloatingDrag(): void {
    this.floatingDragOffset = null;
  }

  async command(type: GameCommandType, payload: Record<string, unknown>, force = false): Promise<void> {
    const gameId = this.gameId();
    if (!gameId || (this.pending() && !force)) {
      return;
    }

    this.pending.set(true);
    this.error.set(null);
    try {
      const snapshot = await this.commands.send(gameId, type, payload);
      this.snapshot.set(snapshot);
    } catch (error) {
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
    const gameId = this.gameId();
    if (!gameId) {
      return;
    }

    this.error.set(null);
    this.pending.set(true);
    try {
      const snapshot = await this.commands.send(gameId, 'game.concede', {});
      this.snapshot.set(snapshot);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.pending.set(false);
    }
  }

  async concede(): Promise<void> {
    await this.concedeGame();
  }

  async closeGame(): Promise<void> {
    if (!this.isGameOwner() || !confirm('Close and archive this game?')) {
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

  private subscribeToRealtime(gameId: string): void {
    this.realtime.subscribeToGame(gameId, () => {
      void this.refetch(false);
    });
  }

  async changeCardPower(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changeCardPowerToughness(playerId, zone, card, 'power', delta);
  }

  async changeCardToughness(playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changeCardPowerToughness(playerId, zone, card, 'toughness', delta);
  }

  private startPolling(): void {
    this.realtime.startPolling(
      () => {
        void this.refetch(false);
      },
      () => !this.pending(),
      4000,
    );
  }

  private applySnapshot(nextSnapshot: GameSnapshot): void {
    this.snapshot.set(nextSnapshot);
    if (!this.focusedPlayerId()) {
      this.focusedPlayerId.set(this.ownPlayerId(nextSnapshot) ?? nextSnapshot.turn.activePlayerId ?? Object.keys(nextSnapshot.players)[0] ?? null);
    }
  }

  private applyDeferredRemoteSnapshot(): void {
    const deferred = this.deferredRemoteSnapshot;
    this.deferredRemoteSnapshot = null;
    if (!deferred) {
      return;
    }

    const current = this.snapshot();
    if (!current || deferred.version > current.version) {
      this.applySnapshot(deferred);
    }
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
      this.snapshot.set(next);
    }
  }

  private updateBattlefieldDragAid(event: PointerEvent, instanceId: string): void {
    const selected = this.selectedCards()[0];
    if (!selected || selected.zone !== 'battlefield' || selected.card.instanceId !== instanceId) {
      this.manaLaneDropPlayerId.set(null);
      this.alignmentGuide.set(null);
      return;
    }

    if (!this.isPointerInsidePlayerBattlefield(event, selected.playerId)) {
      this.manaLaneDropPlayerId.set(null);
      this.alignmentGuide.set(null);
      return;
    }

    if (this.isPointerNearManaLane(event, selected.playerId)) {
      this.manaLaneDropPlayerId.set(selected.playerId);
      this.alignmentGuide.set(null);
      return;
    }

    this.manaLaneDropPlayerId.set(null);
    const card = this.findCard(selected.playerId, 'battlefield', instanceId);
    const position = card?.position;
    const guide = position ? this.battlefieldDragGuide(selected.playerId, instanceId, position.y) : null;
    if (!position || !guide) {
      this.alignmentGuide.set(null);
      return;
    }

    this.alignmentGuide.set({ playerId: selected.playerId, y: guide.y });
    this.updateLocalCardPosition(selected.playerId, instanceId, { x: position.x, y: guide.y });
  }

  private battlefieldDragGuide(playerId: string, instanceId: string, y: number): AlignmentCandidate | null {
    return this.nearestBattlefieldRow(playerId, instanceId, y, this.battlefieldAlignmentGuideThreshold);
  }

  private positionWithAlignmentGuide(
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    activeGuideY: number | null = null,
  ): { x: number; y: number } {
    if (activeGuideY !== null) {
      return Math.abs(activeGuideY - position.y) <= this.battlefieldAlignmentSnapThreshold ? { ...position, y: activeGuideY } : position;
    }

    const guide = this.nearestBattlefieldRow(playerId, instanceId, position.y, this.battlefieldAlignmentSnapThreshold);

    return guide ? { ...position, y: guide.y } : position;
  }

  private nearestBattlefieldRow(playerId: string, instanceId: string, y: number, threshold: number): AlignmentCandidate | null {
    const snapshotRows = this.snapshot()?.players[playerId]?.zones.battlefield
      .filter((card) => card.instanceId !== instanceId)
      .map((card) => card.position?.y)
      .filter((candidate): candidate is number => typeof candidate === 'number')
      .filter((candidate) => !this.isManaLaneRow(playerId, candidate)) ?? [];
    const rows = [...snapshotRows, ...this.battlefieldDomRows(playerId, instanceId)];
    const nearest = rows
      .map((candidate) => ({ y: candidate, distance: Math.abs(candidate - y) }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest && nearest.distance <= threshold ? nearest : null;
  }

  private battlefieldDomRows(playerId: string, instanceId: string): number[] {
    const positionedInstanceIds = new Set((this.snapshot()?.players[playerId]?.zones.battlefield ?? [])
      .filter((card) => card.instanceId !== instanceId && card.position)
      .map((card) => card.instanceId));
    const battlefield = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId);
    if (!battlefield) {
      return [];
    }

    const rows = Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"]'))
      .filter((element) => element.dataset['cardInstanceId'] !== instanceId)
      .filter((element) => !positionedInstanceIds.has(element.dataset['cardInstanceId'] ?? ''))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.offsetTop)
      .filter((row) => !this.isManaLaneRow(playerId, row));

    return [...new Set(rows)];
  }

  private isManaLaneRow(playerId: string, rowY: number): boolean {
    const battlefield = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId);
    const manaLane = battlefield?.querySelector<HTMLElement>('[data-mana-lane]');
    if (!manaLane) {
      return false;
    }

    return rowY >= manaLane.offsetTop - 4;
  }

  private isPointerInsidePlayerBattlefield(event: PointerEvent, playerId: string): boolean {
    return this.elementsAtPoint(event).some((element) => {
      const battlefield = element.closest<HTMLElement>('.battlefield');

      return battlefield?.dataset['playerId'] === playerId;
    });
  }

  private isPointerNearManaLane(event: PointerEvent, playerId: string): boolean {
    const manaLane = this.elementsAtPoint(event)
      .map((element) => element.closest<HTMLElement>('[data-mana-lane]'))
      .find((element) => element?.dataset['playerId'] === playerId);
    if (!manaLane) {
      return false;
    }

    const bounds = manaLane.getBoundingClientRect();
    const activationInset = 10;

    return event.clientY >= bounds.top + activationInset;
  }

  private elementsAtPoint(event: PointerEvent): Element[] {
    return document.elementsFromPoint(event.clientX, event.clientY);
  }

  private updatePointerDropTarget(event: PointerEvent): void {
    const selected = this.selectedCards()[0];
    if (!selected) {
      this.activeDropTarget.set(null);
      this.activePlayerDropTarget.set(null);
      return;
    }

    const targetPlayerId = this.playerDropTargetAt(event, selected.playerId);
    if (targetPlayerId) {
      this.activePlayerDropTarget.set(targetPlayerId);
      this.activeDropTarget.set(null);
      return;
    }

    this.activePlayerDropTarget.set(null);
    const zone = this.drag.pointerDropZone(event, selected.playerId, this.zones);
    this.activeDropTarget.set(zone ? { playerId: selected.playerId, zone } : null);
  }

  private updateActiveDropTarget(event: DragEvent): void {
    const dragged = this.drag.dragPayload(event, this.zones);

    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const playerTarget = element.closest<HTMLElement>('[data-player-drop-target]');
      const dropPlayerId = playerTarget?.dataset['playerDropTarget'];
      if (dropPlayerId && dragged && dragged.playerId !== dropPlayerId) {
        this.activePlayerDropTarget.set(dropPlayerId);
        this.activeDropTarget.set(null);
        this.manaLaneDropPlayerId.set(null);
        return;
      }

      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const playerId = target?.dataset['playerId'];
      const zone = target?.dataset['zone'];
      this.activePlayerDropTarget.set(null);
      if (playerId && zone === 'mana') {
        this.manaLaneDropPlayerId.set(playerId);
        this.activeDropTarget.set(null);
        return;
      }
      if (playerId && dragged?.zone === 'hand' && zone === 'battlefield') {
        this.manaLaneDropPlayerId.set(playerId);
      } else {
        this.manaLaneDropPlayerId.set(null);
      }
      if (playerId && this.isGameZone(zone)) {
        this.activeDropTarget.set({ playerId, zone });
        return;
      }
    }

    this.manaLaneDropPlayerId.set(null);
    this.activePlayerDropTarget.set(null);
    this.activeDropTarget.set(null);
  }

  private isGameZone(zone: string | undefined): zone is GameZoneName {
    return zone !== undefined && this.zones.includes(zone as GameZoneName);
  }

  private playerDropTargetAt(event: PointerEvent, sourcePlayerId: string): string | null {
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = element.closest<HTMLElement>('[data-player-drop-target]');
      const targetPlayerId = target?.dataset['playerDropTarget'];
      if (targetPlayerId && targetPlayerId !== sourcePlayerId) {
        return targetPlayerId;
      }
    }

    return null;
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
      this.snapshot.set(next);
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

  private async reorderHand(playerId: string, movedInstanceId: string, targetInstanceId: string, placement: 'before' | 'after'): Promise<void> {
    const hand = this.snapshot()?.players[playerId]?.zones.hand ?? [];
    const fromIndex = hand.findIndex((card) => card.instanceId === movedInstanceId);
    const toIndex = hand.findIndex((card) => card.instanceId === targetInstanceId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const reordered = [...hand];
    const [moved] = reordered.splice(fromIndex, 1);
    const adjustedTargetIndex = reordered.findIndex((card) => card.instanceId === targetInstanceId);
    reordered.splice(placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, moved);
    await this.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  private async changeCardPowerToughness(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    stat: 'power' | 'toughness',
    delta: number,
  ): Promise<void> {
    if (!this.canControlOwnedCard(playerId, card)) {
      this.error.set('You can only change your own cards.');
      return;
    }

    const currentCard = this.findCard(playerId, zone, card.instanceId) ?? card;
    const currentPower = currentCard.power ?? 0;
    const currentToughness = currentCard.toughness ?? 0;
    const nextPower = stat === 'power' ? currentPower + delta : currentPower;
    const nextToughness = stat === 'toughness' ? currentToughness + delta : currentToughness;
    const key = this.powerToughnessKey(playerId, zone, card.instanceId);

    this.updateLocalCardPowerToughness(playerId, zone, card.instanceId, nextPower, nextToughness);
    this.pendingPowerToughnessChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      power: nextPower,
      toughness: nextToughness,
    });
    const currentTimer = this.powerToughnessTimers.get(key);
    if (currentTimer !== undefined) {
      window.clearTimeout(currentTimer);
    }
    this.powerToughnessTimers.set(key, window.setTimeout(() => void this.flushPowerToughnessChange(key), this.powerToughnessDebounceMs));
  }

  private async flushPowerToughnessChange(key: string): Promise<void> {
    const change = this.pendingPowerToughnessChanges.get(key);
    this.pendingPowerToughnessChanges.delete(key);
    this.powerToughnessTimers.delete(key);
    if (!change) {
      return;
    }

    await this.command('card.power_toughness.changed', {
      playerId: change.playerId,
      zone: change.zone,
      instanceId: change.instanceId,
      power: change.power,
      toughness: change.toughness,
    }, true);
  }

  private clearPowerToughnessTimers(): void {
    for (const timer of this.powerToughnessTimers.values()) {
      window.clearTimeout(timer);
    }
    this.powerToughnessTimers.clear();
    this.pendingPowerToughnessChanges.clear();
  }

  private powerToughnessKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `${playerId}:${zone}:${instanceId}`;
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
    this.draggingCardInstanceId.set(instanceId);
  }

  private endCardDrag(): void {
    this.hideCardPreview();
    this.draggingCardInstanceId.set(null);
    this.manaLaneDropPlayerId.set(null);
    this.alignmentGuide.set(null);
    this.activeDropTarget.set(null);
    this.activePlayerDropTarget.set(null);
    this.pointerDragPreview.set(null);
    this.clearHandDropPreview();
  }

  private updatePointerDragPreview(event: PointerEvent, instanceId: string): void {
    const selected = this.battlefieldSelectionByInstanceId(instanceId);
    if (!selected) {
      return;
    }

    this.pointerDragPreview.set({ card: selected.card, x: event.clientX, y: event.clientY });
  }

  private ensureDraggingBattlefieldSelection(instanceId: string): void {
    const selected = this.battlefieldSelectionByInstanceId(instanceId);
    if (selected) {
      this.selectedCards.set([selected]);
    }
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

  private toLogEntryView(entry: GameLogEntry): GameLogEntryView {
    const card = this.cardFromLogEntry(entry);
    if (!card) {
      return { ...entry, card: null, messagePrefix: entry.message, messageSuffix: '' };
    }

    const index = entry.message.indexOf(card.name);

    return {
      ...entry,
      card,
      messagePrefix: index >= 0 ? entry.message.slice(0, index) : entry.message,
      messageSuffix: index >= 0 ? entry.message.slice(index + card.name.length) : '',
    };
  }

  private cardFromLogEntry(entry: GameLogEntry): GameCardInstance | null {
    if (!entry.message) {
      return null;
    }

    return this.allCards()
      .filter((card) => !card.hidden && card.name.length > 2 && entry.message.includes(card.name))
      .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
  }

  private allCards(): GameCardInstance[] {
    return Object.values(this.snapshot()?.players ?? {}).flatMap((player) => this.zones.flatMap((zone) => player.zones[zone] ?? []));
  }

  private ripple(element: HTMLElement): void {
    element.classList.remove('clicked');
    void element.offsetWidth;
    element.classList.add('clicked');
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'Could not apply game action.';
    }

    return 'Could not apply game action.';
  }
}
