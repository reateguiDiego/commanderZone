import { Injectable } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { GameTableLibraryActionsService } from '../../services/game-table-library-actions.service';
import { GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableZoneModalState } from './game-table-zone-modal.state';
import { GameTableZonePilesState } from './game-table-zone-piles.state';

@Injectable()
export class GameTableLibraryTopState {
  constructor(
    private readonly contextStore: GameTableContextStore,
    private readonly core: GameTableCoreState,
    private readonly libraryActions: GameTableLibraryActionsService,
    private readonly playersStore: GameTablePlayersStore,
    private readonly zoneActions: GameTableZoneActionsService,
    private readonly zoneModalState: GameTableZoneModalState,
    private readonly zonePilesState: GameTableZonePilesState,
  ) {}

  async viewTopLibrary(playerId: string, count: number): Promise<void> {
    const sanitizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    await this.libraryActions.view(this.contextStore.libraryAction(), playerId, sanitizedCount);

    const cards = this.visibleLibraryCards(playerId).slice(0, sanitizedCount);
    if (cards.length === 0) {
      this.core.error.set(`No cards in ${this.zonePilesState.zoneTitle('library').toLowerCase()}.`);
      return;
    }

    this.zoneActions.openFixedZone(
      playerId,
      'library',
      `${this.playersStore.playerName(playerId)} top ${cards.length} library card${cards.length === 1 ? '' : 's'}`,
      cards,
      cards[0]?.instanceId ?? null,
      false,
      {
        allowReorder: true,
        drawOrderLabels: this.drawOrderLabels(cards.length),
        viewTopCount: sanitizedCount,
      },
    );
  }

  async reorderTopLibraryCards(cards: readonly GameCardInstance[]): Promise<void> {
    const modal = this.zoneModalState.zoneModal();
    if (!modal || !modal.allowReorder || modal.zone !== 'library') {
      return;
    }

    const orderedCards = [...cards];
    this.zoneActions.replaceZoneModalCards(orderedCards);
    await this.libraryActions.reorderTop(
      this.contextStore.libraryAction(),
      modal.playerId,
      orderedCards.map((card) => card.instanceId),
    );
  }

  drawOrderLabels(count: number): readonly string[] {
    return Array.from({ length: count }, (_unused, index) => {
      if (index === 0) {
        return 'PROXIMO ROBO';
      }
      if (index === 1) {
        return 'SEGUNDO ROBO';
      }
      if (index === 2) {
        return 'TERCER ROBO';
      }

      return `ROBO ${index + 1}`;
    });
  }

  private visibleLibraryCards(playerId: string): GameCardInstance[] {
    return this.core.snapshot()?.players[playerId]?.zones.library?.filter((card) => !card.hidden) ?? [];
  }
}
