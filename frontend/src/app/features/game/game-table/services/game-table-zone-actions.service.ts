import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableZoneModalState, ZoneModalState } from '../state/zones/game-table-zone-modal.state';

export interface GameTableZoneActionContext {
  gameId(): string;
  snapshot(): GameSnapshot | null;
  playerName(playerId: string): string;
  zoneTitle(zone: GameZoneName): string;
  setError(message: string): void;
}

@Injectable()
export class GameTableZoneActionsService {
  private readonly snapshotBackedZones: ReadonlySet<GameZoneName> = new Set(['graveyard', 'exile']);
  private readonly gamesApi = inject(GamesApi);
  private readonly zoneModalState = inject(GameTableZoneModalState);

  async openZone(
    context: GameTableZoneActionContext,
    playerId: string,
    zone: GameZoneName,
    selectedCardId: string | null = null,
    readOnly = false,
    options: { allowGiveDestination?: boolean } = {},
  ): Promise<void> {
    if (this.shouldBlockEmptyZone(context.snapshot(), playerId, zone)) {
      context.setError(`No cards in ${context.zoneTitle(zone).toLowerCase()}.`);
      return;
    }

    this.zoneModalState.open(playerId, zone, `${context.playerName(playerId)} ${context.zoneTitle(zone)}`, selectedCardId, readOnly, options);
    if (this.loadSnapshotBackedZone(context)) {
      return;
    }

    await this.loadZone(context);
  }

  async loadZone(context: GameTableZoneActionContext): Promise<void> {
    if (this.loadSnapshotBackedZone(context)) {
      return;
    }

    const modal = this.zoneModalState.zoneModal();
    const gameId = context.gameId();
    if (!modal || !gameId) {
      return;
    }

    if (modal.zone === 'library') {
      await this.loadLibraryZone(gameId, modal);
      return;
    }

    this.zoneModalState.setLoading();
    const response = await firstValueFrom(this.gamesApi.zone(gameId, modal.playerId, modal.zone, {
      type: modal.type,
      search: modal.search,
      limit: 200,
    }));
    this.zoneModalState.setLoaded(response.data, response.total);
  }

  updateZoneFilter(context: GameTableZoneActionContext, patch: Partial<Pick<ZoneModalState, 'type' | 'search'>>): void {
    this.zoneModalState.patchFilters(patch);
    if (this.loadSnapshotBackedZone(context)) {
      return;
    }
    if (this.applyCachedZoneFilter()) {
      return;
    }

    void this.loadZone(context);
  }

  selectZoneCard(card: GameCardInstance): void {
    this.zoneModalState.selectCard(card);
  }

  openFixedZone(
    playerId: string,
    zone: GameZoneName,
    title: string,
    cards: GameCardInstance[],
    selectedCardId: string | null = null,
    allowRandomSelect = false,
    options: { readOnly?: boolean; allowGiveDestination?: boolean; allowReorder?: boolean; drawOrderLabels?: readonly string[]; viewTopCount?: number | null; showFilters?: boolean } = {},
  ): void {
    this.zoneModalState.openFixed(playerId, zone, title, cards, selectedCardId, allowRandomSelect, options);
  }

  replaceZoneModalCards(cards: GameCardInstance[]): void {
    this.zoneModalState.replaceCards(cards);
  }

  removeZoneModalCards(instanceIds: readonly string[]): void {
    this.zoneModalState.removeCards(instanceIds);
  }

  closeZoneModal(): void {
    this.zoneModalState.close();
  }

  private shouldBlockEmptyZone(snapshot: GameSnapshot | null, playerId: string, zone: GameZoneName): boolean {
    if (zone !== 'graveyard' && zone !== 'exile') {
      return false;
    }

    const count = snapshot?.players[playerId]?.zoneCounts?.[zone]
      ?? snapshot?.players[playerId]?.zones[zone]?.length
      ?? 0;

    return count < 1;
  }

  private loadSnapshotBackedZone(context: Pick<GameTableZoneActionContext, 'snapshot'>): boolean {
    const modal = this.zoneModalState.zoneModal();
    if (!modal || !this.snapshotBackedZones.has(modal.zone)) {
      return false;
    }

    const cards = this.filteredCards(context.snapshot()?.players[modal.playerId]?.zones[modal.zone] ?? [], modal);
    this.zoneModalState.setLoaded(cards, cards.length);

    return true;
  }

  private async loadLibraryZone(gameId: string, modal: ZoneModalState): Promise<void> {
    this.zoneModalState.setLoading();
    if (this.hasModalFilters(modal) && modal.filterSourceCards === null) {
      const filteredResponse = await firstValueFrom(this.gamesApi.zone(gameId, modal.playerId, modal.zone, {
        type: modal.type,
        search: modal.search,
        limit: 200,
      }));
      this.zoneModalState.setLoaded(filteredResponse.data, filteredResponse.total, null);
      return;
    }

    const response = await firstValueFrom(this.gamesApi.zone(gameId, modal.playerId, modal.zone, { limit: 200 }));
    const currentModal = this.zoneModalState.zoneModal();
    if (!currentModal || currentModal.playerId !== modal.playerId || currentModal.zone !== modal.zone) {
      return;
    }

    if (response.total === response.data.length) {
      const cards = this.filteredCards(response.data, currentModal);
      this.zoneModalState.setLoaded(cards, cards.length, response.data);
      return;
    }

    this.zoneModalState.setLoaded(response.data, response.total, null);
  }

  private applyCachedZoneFilter(): boolean {
    const modal = this.zoneModalState.zoneModal();
    if (!modal || modal.zone !== 'library' || !modal.filterSourceCards) {
      return false;
    }

    const cards = this.filteredCards(modal.filterSourceCards, modal);
    this.zoneModalState.setLoaded(cards, cards.length, modal.filterSourceCards);

    return true;
  }

  private filteredCards(cards: readonly GameCardInstance[], modal: ZoneModalState): GameCardInstance[] {
    const type = modal.type.trim().toLowerCase();
    const search = modal.search.trim().toLowerCase();

    return cards.filter((card) => {
      if (type !== '' && !(card.typeLine ?? '').toLowerCase().includes(type)) {
        return false;
      }

      return search === '' || card.name.toLowerCase().includes(search);
    });
  }

  private hasModalFilters(modal: ZoneModalState): boolean {
    return modal.type.trim() !== '' || modal.search.trim() !== '';
  }
}
