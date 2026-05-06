import { Injectable, OnDestroy, WritableSignal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameLogEntry, GameSnapshot, GameZoneName, GameZoneResponse } from '../../../core/models/game.model';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableRealtimeService } from './services/game-table-realtime.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableChatLogState } from './state/game-table-chat-log.state';
import { GameContextMenu, GameTableUiState } from './state/game-table-ui.state';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';

export interface PlayerView {
  id: string;
  state: GameSnapshot['players'][string];
}

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

interface GameLogEntryView extends GameLogEntry {
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
  private readonly drag = inject(GameTableDragService);
  private readonly selection = inject(GameTableSelectionService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly realtime = inject(GameTableRealtimeService);
  private readonly route = inject(ActivatedRoute);
  private readonly uiState = inject(GameTableUiState);
  private readonly zoneModalState = inject(GameTableZoneModalState);
  private readonly chatLogState = inject(GameTableChatLogState);
  private floatingDragOffset: { x: number; y: number } | null = null;
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  private hoveredSelection: SelectedCard | null = null;
  private hoverPreviewHandle?: number;
  private hoverPreviewToken = 0;
  private readonly powerToughnessDebounceMs = 450;
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
  readonly players = computed<PlayerView[]>(() => {
    const players = this.snapshot()?.players ?? {};
    return Object.entries(players).map(([id, state]) => ({ id, state }));
  });
  readonly focusedPlayer = computed<PlayerView | null>(() => {
    const players = this.players();
    const focusedId = this.focusedPlayerId() ?? this.snapshot()?.turn.activePlayerId ?? players[0]?.id ?? null;

    return players.find((player) => player.id === focusedId) ?? players[0] ?? null;
  });
  readonly eventLog = computed<GameLogEntryView[]>(() => this.chatLogState.eventLog(this.snapshot()).map((entry) => this.toLogEntryView(entry)));
  readonly currentPlayer = computed<PlayerView | null>(() => {
    const userId = this.auth.user()?.id;

    return this.players().find((player) => player.state.user.id === userId) ?? null;
  });
  readonly handPlayer = computed<PlayerView | null>(() => this.currentPlayer() ?? this.focusedPlayer());
  readonly isGameOwner = computed(() => this.snapshot()?.ownerId === this.currentPlayer()?.id);
  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.clearHoverPreviewTimer();
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
    const titles: Record<GameZoneName, string> = {
      library: 'Library',
      hand: 'Hand',
      battlefield: 'Battlefield',
      graveyard: 'Graveyard',
      exile: 'Exile',
      command: 'Command',
    };

    return titles[zone];
  }

  zoneCount(player: PlayerView, zone: GameZoneName): number {
    return player.state.zoneCounts?.[zone] ?? player.state.zones[zone]?.length ?? 0;
  }

  commanderCastCount(player: PlayerView): number {
    return Math.max(0, Number(this.snapshot()?.counters?.[`commander:${player.id}`]?.['casts'] ?? 0));
  }

  countItems(count: number): number[] {
    return Array.from({ length: Math.min(count, 12) }, (_, index) => index);
  }

  cardImage(card: GameCardInstance): string | null {
    if (this.shouldShowCardBack(card)) {
      return this.cardBackImage();
    }

    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
  }

  publicCardImage(card: GameCardInstance): string | null {
    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
  }

  cardBackImage(): string {
    return '/assets/images/facedown_card.jpg';
  }

  shouldShowCardBack(card: GameCardInstance): boolean {
    return Boolean(card.faceDown || card.hidden);
  }

  deckLabel(player: PlayerView | null): string {
    const commander = player?.state.zones.command?.[0]?.name;

    return commander ? `${commander} deck` : 'Commander deck';
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    const entries = Object.entries(card.counters ?? {}).filter(([, value]) => value > 0);

    return entries.length > 0 ? { key: entries[0][0], value: entries[0][1] } : null;
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return card.power !== null && card.power !== undefined && card.toughness !== null && card.toughness !== undefined;
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.hasPowerToughness(card) || /\bcreature\b/i.test(card.typeLine ?? '');
  }

  cardPowerValue(card: GameCardInstance): number {
    return card.power ?? 0;
  }

  cardToughnessValue(card: GameCardInstance): number {
    return card.toughness ?? 0;
  }

  isHandDropTarget(playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean {
    const preview = this.handDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId && preview.placement === placement;
  }

  cardPosition(card: GameCardInstance): { x: number; y: number } | null {
    const position = card.position;
    if (!position || (position.x <= 0 && position.y <= 0)) {
      return null;
    }

    return position;
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    if (zone === 'library' || zone === 'hand') {
      return null;
    }

    const cards = player.state.zones[zone] ?? [];

    return cards.at(-1) ?? null;
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.topVisibleCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    if (zone === 'library') {
      return this.zoneCount(player, zone) > 0 ? this.cardBackImage() : null;
    }

    const card = this.zonePreviewCard(player, zone);

    return card ? this.publicCardImage(card) : null;
  }

  topDraggableCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    if (!this.canControlPlayer(player.id) || zone === 'hand' || zone === 'battlefield') {
      return null;
    }

    return player.state.zones[zone]?.at(-1) ?? null;
  }

  colorIdentity(player: PlayerView | null): string[] {
    return player?.state.colorIdentity?.length ? player.state.colorIdentity : ['W'];
  }

  colorAccent(player: PlayerView | null): string {
    const colorMap: Record<string, string> = {
      W: '#f8f3df',
      U: '#7cc7ff',
      B: '#b9a8c9',
      R: '#f08264',
      G: '#76c779',
    };

    return colorMap[this.colorIdentity(player)[0] ?? 'W'] ?? '#f8f3df';
  }

  miniCardLeft(card: GameCardInstance, index: number): number {
    const position = this.cardPosition(card);
    if (position) {
      return Math.max(1, Math.min(90, (position.x / 900) * 100));
    }

    return 2 + (index % 10) * 9.4;
  }

  manaSymbols(player: PlayerView | null): string[] {
    return this.colorIdentity(player);
  }

  logTime(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  miniCardTop(card: GameCardInstance, index: number): number {
    const position = this.cardPosition(card);
    if (position) {
      return Math.max(4, Math.min(78, (position.y / 520) * 100));
    }

    return 6 + Math.floor(index / 10) * 24;
  }

  zoneHint(zone: GameZoneName): string {
    const hints: Record<GameZoneName, string> = {
      library: 'Draw, reveal, shuffle',
      hand: 'Private cards',
      battlefield: 'Play area',
      graveyard: 'Public discard',
      exile: 'Public exile',
      command: 'Command zone',
    };

    return hints[zone];
  }

  showCardPreview(card: GameCardInstance, playerId?: string, zone?: GameZoneName): void {
    this.clearHoverPreviewTimer();
    if (card.hidden || this.draggingCardInstanceId()) {
      return;
    }

    const token = ++this.hoverPreviewToken;
    this.hoverPreviewHandle = window.setTimeout(() => {
      if (token !== this.hoverPreviewToken || this.draggingCardInstanceId()) {
        return;
      }

      this.hoveredCard.set(card);
      this.hoveredSelection = playerId && zone ? { playerId, zone, card } : null;
    }, 130);
  }

  hideCardPreview(): void {
    this.clearHoverPreviewTimer();
    this.hoveredCard.set(null);
    this.hoveredSelection = null;
  }

  activeKeyboardCard(): SelectedCard | null {
    return this.selection.activeKeyboardCard(this.hoveredSelection) as SelectedCard | null;
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
    const activePhase = this.snapshot()?.turn.phase;
    const activeIndex = activePhase ? this.phases.indexOf(activePhase) : -1;
    const phaseIndex = this.phases.indexOf(phase);

    return activeIndex > -1 && phaseIndex > -1 && phaseIndex < activeIndex;
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
    this.contextMenu.set({ ...this.menuPosition(event), playerId, zone, card, kind: 'card' });
  }

  openZoneMenu(event: MouseEvent, playerId: string, zone: GameZoneName): void {
    event.preventDefault();
    event.stopPropagation();
    if (zone === 'battlefield' && !this.isCurrentPlayer(playerId)) {
      return;
    }
    this.contextMenu.set({ ...this.menuPosition(event), playerId, zone, kind: 'zone' });
  }

  openGameMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const playerId = this.focusedPlayer()?.id ?? this.currentPlayer()?.id ?? '';
    this.contextMenu.set({ ...this.menuPosition(event), playerId, zone: 'battlefield', kind: 'game' });
  }

  openPlayerMenu(event: MouseEvent, playerId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu.set({ ...this.menuPosition(event), playerId, zone: 'battlefield', kind: 'player' });
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
    await this.command('turn.changed', { activePlayerId });
  }

  async changePhase(phase: string): Promise<void> {
    await this.command('turn.changed', { phase });
  }

  async changeTurnNumber(number: string | number): Promise<void> {
    await this.command('turn.changed', { number: Number(number) });
  }

  async advanceTurnPhase(): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }

    const currentIndex = Math.max(0, this.phases.indexOf(snapshot.turn.phase));
    const nextPhase = this.phases[currentIndex + 1];
    if (nextPhase) {
      await this.command('turn.changed', { phase: nextPhase });
      return;
    }

    const players = this.players();
    const activeIndex = players.findIndex((player) => player.id === snapshot.turn.activePlayerId);
    const nextPlayer = players[(activeIndex + 1) % players.length] ?? players[0];
    await this.command('turn.changed', {
      activePlayerId: nextPlayer?.id ?? snapshot.turn.activePlayerId,
      phase: this.phases[0],
      number: snapshot.turn.number + 1,
    });
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

  async draw(playerId: string, count = 1): Promise<void> {
    if (!this.isCurrentPlayer(playerId)) {
      this.error.set('You can only draw from your own library.');
      return;
    }

    await this.command(count === 1 ? 'library.draw' : 'library.draw_many', { playerId, count });
  }

  async drawCurrent(count = 1): Promise<void> {
    const player = this.currentPlayer() ?? this.focusedPlayer();
    if (player) {
      this.focusPlayer(player.id);
      await this.draw(player.id, count);
    }
  }

  async drawPrompt(playerId: string): Promise<void> {
    const count = Number(prompt('How many cards?', '1') ?? '1');
    await this.draw(playerId, Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1);
  }

  async shuffle(playerId: string): Promise<void> {
    if (!this.isCurrentPlayer(playerId)) {
      this.error.set('You can only shuffle your own library.');
      return;
    }

    await this.command('library.shuffle', { playerId });
  }

  async revealTop(playerId: string): Promise<void> {
    if (!this.isCurrentPlayer(playerId)) {
      this.error.set('You can only reveal from your own library.');
      return;
    }

    await this.command('library.reveal_top', { playerId, count: 1, to: 'all' });
  }

  async moveTop(playerId: string, toZone: GameZoneName): Promise<void> {
    if (!this.isCurrentPlayer(playerId)) {
      this.error.set('You can only move cards from your own library.');
      return;
    }

    const count = Number(prompt('How many top cards?', '1') ?? '1');
    await this.command('library.move_top', { playerId, toZone, count: Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1 });
  }

  async playCard(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }

    await this.command('card.moved', {
      playerId,
      fromZone: zone,
      toZone: 'battlefield',
      instanceId: card.instanceId,
    });
    await this.recordCommanderCastIfNeeded(playerId, zone);
    this.selectedCards.set([]);
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
    this.selectedCards.set([{ playerId, zone: 'battlefield', card }]);
  }

  moveCardPointerDrag(event: PointerEvent): void {
    const draggingInstanceId = this.drag.moveCardPointerDrag(event, (playerId, instanceId, position) => {
      this.updateLocalCardPosition(playerId, instanceId, position);
    });
    if (draggingInstanceId && this.draggingCardInstanceId() !== draggingInstanceId) {
      this.beginCardDrag(draggingInstanceId);
    }
    if (draggingInstanceId) {
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
    if (!this.isSelected(card.instanceId)) {
      this.selectedCards.set([{ playerId, zone, card }]);
    }
  }

  dragEnd(): void {
    this.endCardDrag();
    this.clearHandDropPreview();
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
  }

  async moveFocusedZoneToBattlefield(zone: GameZoneName): Promise<void> {
    const selected = this.selectedCards()[0];
    if (!selected || selected.zone !== zone) {
      return;
    }

    await this.playCard(selected.playerId, selected.zone, selected.card);
  }

  async moveCard(menu: GameContextMenu, toZone: GameZoneName): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only move your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.moved', {
      playerId: menu.playerId,
      fromZone: menu.zone,
      toZone,
      instanceId: menu.card.instanceId,
    });
    await this.recordCommanderCastIfNeeded(menu.playerId, menu.zone, toZone);
    this.selectedCards.set([]);
    this.closeContextMenu();
  }

  async moveSelected(toZone: GameZoneName): Promise<void> {
    const selected = this.selectedCards();
    const first = selected[0];
    if (!first) {
      return;
    }
    if (!this.canControlPlayer(first.playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }
    const sameSource = selected.every((item) => item.playerId === first.playerId && item.zone === first.zone);
    if (!sameSource) {
      return;
    }

    await this.command('cards.moved', {
      playerId: first.playerId,
      fromZone: first.zone,
      toZone,
      instanceIds: selected.map((item) => item.card.instanceId),
    });
    this.selectedCards.set([]);
  }

  async moveActiveCard(toZone: GameZoneName): Promise<void> {
    const selected = this.selectedCards();
    if (selected.length > 1) {
      await this.moveSelected(toZone);
      return;
    }

    const item = this.activeKeyboardCard();
    if (!item || !this.canControlPlayer(item.playerId)) {
      return;
    }

    await this.command('card.moved', {
      playerId: item.playerId,
      fromZone: item.zone,
      toZone,
      instanceId: item.card.instanceId,
    });
    await this.recordCommanderCastIfNeeded(item.playerId, item.zone, toZone);
    this.selectedCards.set([]);
  }

  async tapCard(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.tapped', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      tapped: !menu.card.tapped,
    });
    this.closeContextMenu();
  }

  async faceDown(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.face_down.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      faceDown: !menu.card.faceDown,
    });
    this.closeContextMenu();
  }

  async revealCard(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only reveal your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.revealed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      to: 'all',
    });
    this.closeContextMenu();
  }

  async tokenCopy(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only copy your own cards.');
      this.closeContextMenu();
      return;
    }

    await this.command('card.token_copy.created', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      targetPlayerId: menu.playerId,
    });
    this.closeContextMenu();
  }

  async setPowerToughness(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }
    const power = Number(prompt('Power', String(menu.card.power ?? '')) ?? '');
    const toughness = Number(prompt('Toughness', String(menu.card.toughness ?? '')) ?? '');

    await this.command('card.power_toughness.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      ...(Number.isFinite(power) ? { power } : {}),
      ...(Number.isFinite(toughness) ? { toughness } : {}),
    });
    this.closeContextMenu();
  }

  async changeCardCounter(menu: GameContextMenu, key = '+1/+1'): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only change your own cards.');
      this.closeContextMenu();
      return;
    }
    const delta = Number(prompt(`${key} delta`, '1') ?? '1');
    await this.command('card.counter.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      delta: Number.isFinite(delta) ? delta : 1,
    });
    this.closeContextMenu();
  }

  async addToStack(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.error.set('You can only add your own cards to stack.');
      this.closeContextMenu();
      return;
    }
    await this.command('stack.card_added', { playerId: menu.playerId, zone: menu.zone, instanceId: menu.card.instanceId });
    this.closeContextMenu();
  }

  async toggleTapped(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only change your own cards.');
      return;
    }
    await this.command('card.tapped', {
      playerId,
      zone,
      instanceId: card.instanceId,
      tapped: !card.tapped,
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
    const modal = this.zoneModal();
    if (!modal || !this.canControlPlayer(modal.playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }

    await this.command('card.moved', {
      playerId: modal.playerId,
      fromZone: modal.zone,
      toZone,
      instanceId: card.instanceId,
    });
    await this.recordCommanderCastIfNeeded(modal.playerId, modal.zone, toZone);
    await this.loadZone();
  }

  async revealZoneCard(card: GameCardInstance): Promise<void> {
    const modal = this.zoneModal();
    if (!modal || !this.canControlPlayer(modal.playerId)) {
      this.error.set('You can only reveal your own cards.');
      return;
    }

    await this.command('card.revealed', {
      playerId: modal.playerId,
      zone: modal.zone,
      instanceId: card.instanceId,
      to: 'all',
    });
    await this.loadZone();
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
    const guideY = position ? this.nearestBattlefieldRowY(selected.playerId, instanceId, position.y) : null;
    if (!position || guideY === null) {
      this.alignmentGuide.set(null);
      return;
    }

    this.alignmentGuide.set({ playerId: selected.playerId, y: guideY });
    this.updateLocalCardPosition(selected.playerId, instanceId, { x: position.x, y: guideY });
  }

  private positionWithAlignmentGuide(
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    activeGuideY: number | null = null,
  ): { x: number; y: number } {
    const guideY = activeGuideY ?? this.nearestBattlefieldRowY(playerId, instanceId, position.y);

    return guideY === null ? position : { ...position, y: guideY };
  }

  private nearestBattlefieldRowY(playerId: string, instanceId: string, y: number): number | null {
    const threshold = 18;
    const rows = this.snapshot()?.players[playerId]?.zones.battlefield
      .filter((card) => card.instanceId !== instanceId)
      .map((card) => card.position?.y)
      .filter((candidate): candidate is number => typeof candidate === 'number') ?? [];
    const nearest = rows
      .map((candidate) => ({ y: candidate, distance: Math.abs(candidate - y) }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest && nearest.distance <= threshold ? nearest.y : null;
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
    const selected = this.selectedCards()[0];
    if (!selected || selected.card.instanceId !== instanceId) {
      return;
    }

    this.pointerDragPreview.set({ card: selected.card, x: event.clientX, y: event.clientY });
  }

  private clearHoverPreviewTimer(): void {
    this.hoverPreviewToken++;
    if (this.hoverPreviewHandle !== undefined) {
      window.clearTimeout(this.hoverPreviewHandle);
      this.hoverPreviewHandle = undefined;
    }
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

  private menuPosition(event: MouseEvent): { x: number; y: number } {
    const width = 260;
    const height = 360;

    return {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    };
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'Could not apply game action.';
    }

    return 'Could not apply game action.';
  }
}
