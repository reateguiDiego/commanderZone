import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName, GameZoneResponse } from '../../../core/models/game.model';
import { MercureService } from '../../../core/realtime/mercure.service';

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
  kind?: 'zone' | 'card' | 'game';
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
  private readonly auth = inject(AuthStore);
  private readonly mercure = inject(MercureService);
  private readonly route = inject(ActivatedRoute);
  private realtimeSubscription?: Subscription;
  private pollHandle?: number;

  readonly zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  readonly publicZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'command'];
  readonly phases = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
  readonly gameId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly snapshot = signal<GameSnapshot | null>(null);
  readonly focusedPlayerId = signal<string | null>(null);
  readonly selectedCards = signal<SelectedCard[]>([]);
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly zoneModal = signal<ZoneModalState | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
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

    return this.players().find((player) => player.id === userId) ?? null;
  });

  chatMessage = '';

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.realtimeSubscription?.unsubscribe();
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
    }
  }

  async load(): Promise<void> {
    const id = this.gameId();
    if (!id) {
      this.error.set('Missing game id.');
      this.loading.set(false);
      return;
    }

    try {
      await this.refetch();
      this.subscribeToRealtime(id);
      this.startPolling();
    } catch {
      this.error.set('Could not load game snapshot.');
    } finally {
      this.loading.set(false);
    }
  }

  async refetch(): Promise<void> {
    const id = this.gameId();
    if (!id) {
      return;
    }

    const response = await firstValueFrom(this.gamesApi.snapshot(id));
    this.snapshot.set(response.game.snapshot);
    if (!this.focusedPlayerId()) {
      this.focusedPlayerId.set(response.game.snapshot.turn.activePlayerId ?? Object.keys(response.game.snapshot.players)[0] ?? null);
    }
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

  cardImage(card: GameCardInstance): string | null {
    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    const entries = Object.entries(card.counters ?? {}).filter(([, value]) => value > 0);

    return entries.length > 0 ? { key: entries[0][0], value: entries[0][1] } : null;
  }

  showCardPreview(card: GameCardInstance): void {
    if (!card.hidden) {
      this.hoveredCard.set(card);
    }
  }

  hideCardPreview(): void {
    this.hoveredCard.set(null);
  }

  toggleCardSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.ripple(event.currentTarget as HTMLElement);
    if (zone !== 'battlefield' || card.hidden) {
      this.selectedCards.set([{ playerId, zone, card }]);
      return;
    }

    const selected = this.selectedCards();
    const existing = selected.some((item) => item.card.instanceId === card.instanceId);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.selectedCards.set(existing
        ? selected.filter((item) => item.card.instanceId !== card.instanceId)
        : [...selected, { playerId, zone, card }]);
      return;
    }

    this.selectedCards.set(existing && selected.length === 1 ? [] : [{ playerId, zone, card }]);
  }

  isSelected(instanceId: string): boolean {
    return this.selectedCards().some((item) => item.card.instanceId === instanceId);
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
    await this.command(count === 1 ? 'library.draw' : 'library.draw_many', { playerId, count });
  }

  async drawCurrent(count = 1): Promise<void> {
    const player = this.currentPlayer() ?? this.focusedPlayer();
    if (player) {
      await this.draw(player.id, count);
    }
  }

  async drawPrompt(playerId: string): Promise<void> {
    const count = Number(prompt('How many cards?', '1') ?? '1');
    await this.draw(playerId, Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1);
  }

  async shuffle(playerId: string): Promise<void> {
    await this.command('library.shuffle', { playerId });
  }

  async revealTop(playerId: string): Promise<void> {
    await this.command('library.reveal_top', { playerId, count: 1, to: 'all' });
  }

  async moveTop(playerId: string, toZone: GameZoneName): Promise<void> {
    const count = Number(prompt('How many top cards?', '1') ?? '1');
    await this.command('library.move_top', { playerId, toZone, count: Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1 });
  }

  async playCard(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    await this.command('card.moved', {
      playerId,
      fromZone: zone,
      toZone: 'battlefield',
      instanceId: card.instanceId,
    });
    this.selectedCards.set([]);
  }

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    event.dataTransfer?.setData('application/json', JSON.stringify({ playerId, zone, instanceId: card.instanceId }));
    event.dataTransfer?.setData('text/plain', card.instanceId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.selectedCards.set([{ playerId, zone, card }]);
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async dropOnZone(event: DragEvent, targetPlayerId: string, toZone: GameZoneName): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.dragPayload(event);
    if (!dragged) {
      return;
    }

    await this.command('card.moved', {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone,
      targetPlayerId,
      instanceId: dragged.instanceId,
    });
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

  async tapCard(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
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
    await this.command('stack.card_added', { playerId: menu.playerId, zone: menu.zone, instanceId: menu.card.instanceId });
    this.closeContextMenu();
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

  async command(type: GameCommandType, payload: Record<string, unknown>): Promise<void> {
    const gameId = this.gameId();
    if (!gameId || this.pending()) {
      return;
    }

    this.pending.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.gamesApi.command({
        type,
        payload,
        clientActionId: this.clientActionId(),
      }, gameId));
      this.snapshot.set(response.snapshot);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.pending.set(false);
    }
  }

  private subscribeToRealtime(gameId: string): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = this.mercure.gameEvents(gameId).subscribe({
      next: () => void this.refetch(),
    });
  }

  private startPolling(): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
    }

    this.pollHandle = window.setInterval(() => {
      if (!this.pending()) {
        void this.refetch();
      }
    }, 2000);
  }

  private playerName(playerId: string): string {
    return this.snapshot()?.players[playerId]?.user.displayName ?? playerId;
  }

  private ripple(element: HTMLElement): void {
    element.classList.remove('clicked');
    void element.offsetWidth;
    element.classList.add('clicked');
  }

  private clientActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private menuPosition(event: MouseEvent): { x: number; y: number } {
    const width = 260;
    const height = 360;

    return {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    };
  }

  private dragPayload(event: DragEvent): { playerId: string; zone: GameZoneName; instanceId: string } | null {
    const raw = event.dataTransfer?.getData('application/json');
    if (!raw) {
      return null;
    }

    try {
      const payload = JSON.parse(raw) as { playerId?: string; zone?: string; instanceId?: string };
      if (!payload.playerId || !payload.instanceId || !this.zones.includes(payload.zone as GameZoneName)) {
        return null;
      }

      return { playerId: payload.playerId, zone: payload.zone as GameZoneName, instanceId: payload.instanceId };
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'Could not apply game action.';
    }

    return 'Could not apply game action.';
  }
}
