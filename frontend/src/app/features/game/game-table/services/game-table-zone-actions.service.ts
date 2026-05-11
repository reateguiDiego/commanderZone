import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { GameTableZoneModalState, ZoneModalState } from '../state/game-table-zone-modal.state';

export interface GameTableZoneActionContext {
  gameId(): string;
  playerName(playerId: string): string;
  zoneTitle(zone: GameZoneName): string;
}

@Injectable()
export class GameTableZoneActionsService {
  private readonly gamesApi = inject(GamesApi);
  private readonly zoneModalState = inject(GameTableZoneModalState);

  async openZone(context: GameTableZoneActionContext, playerId: string, zone: GameZoneName): Promise<void> {
    this.zoneModalState.open(playerId, zone, `${context.playerName(playerId)} ${context.zoneTitle(zone)}`);
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

  closeZoneModal(): void {
    this.zoneModalState.close();
  }
}
