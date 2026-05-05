import { Injectable, OnDestroy, WritableSignal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName, GameZoneResponse } from '../../../core/models/game.model';
import { GameTableCommandService } from './game-table-command.service';
import { GameTableDragService } from './game-table-drag.service';
import { GameTableRealtimeService } from './game-table-realtime.service';
import { GameTableSelectionService } from './game-table-selection.service';

export interface PlayerView {
  id: string;
  state: GameSnapshot['players'][string];
}

export interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export interface GameContextMenu {
  x: number;
  y: number;
  playerId: string;
  zone: GameZoneName;
  card?: GameCardInstance;
  kind?: 'zone' | 'card' | 'game' | 'player';
}

export interface ZoneModalState {
  playerId: string;
  zone: GameZoneName;
  title: string;
  cards: GameCardInstance[];
  total: number;
  type: string;
  search: string;
  selectedCard: GameCardInstance | null;
  loading: boolean;
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
  private floatingDragOffset: { x: number; y: number } | null = null;
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  private hoveredSelection: SelectedCard | null = null;

  readonly zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  readonly dockZones: GameZoneName[] = ['library', 'graveyard', 'exile', 'command'];
  readonly publicZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'command'];
  readonly phases = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
  readonly gameId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly snapshot = signal<GameSnapshot | null>(null);
  readonly focusedPlayerId = signal<string | null>(null);
  readonly selectedCards: WritableSignal<SelectedCard[]> = this.selection.selectedCards as WritableSignal<SelectedCard[]>;
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly zoneModal = signal<ZoneModalState | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
  readonly floatingMinimized = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pending = signal(false);

  readonly players = computed<PlayerView[]>(() => {
    const players = this.snapshot()?.players ?? {};
    return Object.entries(players).map(([id, state]) => ({ id, state }));
  });
  readonly focusedPlayer = computed<PlayerView | null>(() => {
    const players = this.players();
    const focusedId = this.focusedPlayerId() ?? this.snapshot()?.turn.activePlayerId ?? players[0]?.id ?? null;

    return players.find((player) => player.id === focusedId) ?? players[0] ?? null;
  });
  readonly eventLog = computed(() => [...(this.snapshot()?.eventLog ?? [])].reverse());
  readonly currentPlayer = computed<PlayerView | null>(() => {
    const userId = this.auth.user()?.id;

    return this.players().find((player) => player.state.user.id === userId) ?? null;
  });
  readonly isGameOwner = computed(() => this.snapshot()?.ownerId === this.currentPlayer()?.id);

  chatMessage = '';

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
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
    this.contextMenu.set(null);
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

  countItems(count: number): number[] {
    return Array.from({ length: Math.min(count, 12) }, (_, index) => index);
  }

  cardImage(card: GameCardInstance): string | null {
    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    const entries = Object.entries(card.counters ?? {}).filter(([, value]) => value > 0);

    return entries.length > 0 ? { key: entries[0][0], value: entries[0][1] } : null;
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
      return Math.max(2, Math.min(82, (position.x / 900) * 100));
    }

    return 4 + (index % 7) * 12.5;
  }

  miniCardTop(card: GameCardInstance, index: number): number {
    const position = this.cardPosition(card);
    if (position) {
      return Math.max(6, Math.min(68, (position.y / 520) * 100));
    }

    return 10 + Math.floor(index / 7) * 34;
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
    if (!card.hidden) {
      this.hoveredCard.set(card);
      this.hoveredSelection = playerId && zone ? { playerId, zone, card } : null;
    }
  }

  hideCardPreview(): void {
    this.hoveredCard.set(null);
    this.hoveredSelection = null;
  }

  activeKeyboardCard(): SelectedCard | null {
    return this.selection.activeKeyboardCard(this.hoveredSelection) as SelectedCard | null;
  }

  clearSelection(): void {
    this.selection.clearSelection();
  }

  toggleCardSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.ripple(event.currentTarget as HTMLElement);
    if (zone !== 'battlefield' || card.hidden) {
      this.selection.selectSingle(playerId, zone, card);
      return;
    }

    this.selection.toggleBattlefieldSelection(event, playerId, zone, card);
  }

  isSelected(instanceId: string): boolean {
    return this.selection.isSelected(instanceId);
  }

  openCardMenu(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu.set({ ...this.menuPosition(event), playerId, zone, card, kind: 'card' });
  }

  openZoneMenu(event: MouseEvent, playerId: string, zone: GameZoneName): void {
    event.preventDefault();
    event.stopPropagation();
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
    this.contextMenu.set(null);
  }

  async sendChat(): Promise<void> {
    const message = this.chatMessage.trim();
    if (!message) {
      return;
    }

    await this.command('chat.message', { message });
    this.chatMessage = '';
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
    this.selectedCards.set([]);
  }

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): void {
    if (!this.canControlPlayer(playerId)) {
      this.error.set('You can only move your own cards.');
      return;
    }
    if (!this.drag.startBattlefieldPointerDrag(event, playerId, card)) {
      return;
    }
    this.selectedCards.set([{ playerId, zone: 'battlefield', card }]);
  }

  moveCardPointerDrag(event: PointerEvent): void {
    this.drag.moveCardPointerDrag(event, (playerId, instanceId, position) => {
      this.updateLocalCardPosition(playerId, instanceId, position);
    });
  }

  async endCardPointerDrag(event?: PointerEvent): Promise<void> {
    const drag = this.drag.endCardPointerDrag(
      event,
      (pointerEvent, playerId) => this.drag.pointerDropZone(pointerEvent, playerId, this.zones),
      (playerId, instanceId, position) => this.updateLocalCardPosition(playerId, instanceId, position),
    );
    const applyDeferredSnapshot = () => this.applyDeferredRemoteSnapshot();
    if (!drag || !drag.moved) {
      applyDeferredSnapshot();
      return;
    }

    if (drag.dropZone && drag.dropZone !== 'battlefield') {
      await this.command('card.moved', {
        playerId: drag.playerId,
        fromZone: 'battlefield',
        toZone: drag.dropZone,
        instanceId: drag.instanceId,
      });
      applyDeferredSnapshot();
      return;
    }

    await this.command('card.position.changed', {
      playerId: drag.playerId,
      zone: 'battlefield',
      instanceId: drag.instanceId,
      position: drag.position,
    });
    applyDeferredSnapshot();
  }

  cancelCardPointerDrag(event?: PointerEvent): void {
    this.drag.cancelCardPointerDrag(event);
    this.applyDeferredRemoteSnapshot();
  }

  handleBattlefieldCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.stopPropagation();
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

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.drag.dragStart(event, playerId, zone, card);
    this.selectedCards.set([{ playerId, zone, card }]);
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
  }

  async dropOnZone(event: DragEvent, targetPlayerId: string, toZone: GameZoneName): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, this.zones);
    if (!dragged) {
      return;
    }
    if (!this.canControlPlayer(dragged.playerId)) {
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

    await this.command('card.moved', payload);
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
    this.zoneModal.set({ playerId, zone, title, cards: [], total: 0, type: '', search: '', selectedCard: null, loading: true });
    await this.loadZone();
  }

  async loadZone(): Promise<void> {
    const modal = this.zoneModal();
    const gameId = this.gameId();
    if (!modal || !gameId) {
      return;
    }

    this.zoneModal.set({ ...modal, loading: true });
    const response: GameZoneResponse = await firstValueFrom(this.gamesApi.zone(gameId, modal.playerId, modal.zone, {
      type: modal.type,
      search: modal.search,
      limit: 200,
    }));
    this.zoneModal.set({
      ...modal,
      cards: response.data,
      total: response.total,
      selectedCard: response.data[0] ?? null,
      loading: false,
    });
  }

  updateZoneFilter(patch: Partial<Pick<ZoneModalState, 'type' | 'search'>>): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, ...patch });
    void this.loadZone();
  }

  selectZoneCard(card: GameCardInstance): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, selectedCard: card });
  }

  closeZoneModal(): void {
    this.zoneModal.set(null);
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
    this.floatingMinimized.update((value) => !value);
  }

  private subscribeToRealtime(gameId: string): void {
    this.realtime.subscribeToGame(gameId, () => {
      void this.refetch(false);
    });
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
      this.focusedPlayerId.set(nextSnapshot.turn.activePlayerId ?? Object.keys(nextSnapshot.players)[0] ?? null);
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
