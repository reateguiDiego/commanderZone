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
  private readonly gamesApi = inject(GamesApi);
  private readonly zoneModalState = inject(GameTableZoneModalState);

  async openZone(context: GameTableZoneActionContext, playerId: string, zone: GameZoneName, selectedCardId: string | null = null, readOnly = false): Promise<void> {
    if (this.shouldBlockEmptyZone(context.snapshot(), playerId, zone)) {
      context.setError(`No cards in ${context.zoneTitle(zone).toLowerCase()}.`);
      return;
    }

    this.zoneModalState.open(playerId, zone, `${context.playerName(playerId)} ${context.zoneTitle(zone)}`, selectedCardId, readOnly);
    await this.loadZone(context);
  }

  async loadZone(context: Pick<GameTableZoneActionContext, 'gameId'>): Promise<void> {
    const modal = this.zoneModalState.zoneModal();
    const gameId = context.gameId();
    if (!modal || !gameId) {
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

  updateZoneFilter(context: Pick<GameTableZoneActionContext, 'gameId'>, patch: Partial<Pick<ZoneModalState, 'type' | 'search'>>): void {
    this.zoneModalState.patchFilters(patch);
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
    options: { allowReorder?: boolean; drawOrderLabels?: readonly string[] } = {},
  ): void {
    this.zoneModalState.openFixed(playerId, zone, title, cards, selectedCardId, allowRandomSelect, options);
  }

  replaceZoneModalCards(cards: GameCardInstance[]): void {
    this.zoneModalState.replaceCards(cards);
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
}
