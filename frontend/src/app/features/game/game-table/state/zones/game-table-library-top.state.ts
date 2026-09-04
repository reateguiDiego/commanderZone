import { Injectable, Optional } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { runtimeTranslationFallback } from '../../../../../core/localization/runtime-translate.pipe';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { GameTableLibraryActionsService } from '../../services/game-table-library-actions.service';
import { GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableZoneModalState } from './game-table-zone-modal.state';

@Injectable()
export class GameTableLibraryTopState {
  constructor(
    private readonly contextStore: GameTableContextStore,
    private readonly core: GameTableCoreState,
    private readonly libraryActions: GameTableLibraryActionsService,
    private readonly playersStore: GameTablePlayersStore,
    private readonly zoneActions: GameTableZoneActionsService,
    private readonly zoneModalState: GameTableZoneModalState,
    @Optional() private readonly translation: TranslateService | null = null,
  ) {}

  async viewTopLibrary(playerId: string, count: number): Promise<void> {
    const sanitizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    await this.libraryActions.view(this.contextStore.libraryAction(), playerId, sanitizedCount);

    const cards = this.visibleLibraryCards(playerId).slice(0, sanitizedCount);
    if (cards.length === 0) {
      this.core.error.set('common.ui.emptyZone');
      return;
    }

    this.zoneActions.openFixedZone(
      playerId,
      'library',
      'game.numberAction.viewTopCards.title',
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

  openRevealedTopLibrary(playerId: string, count: number): void {
    if (this.playersStore.currentPlayer()?.id === playerId) {
      return;
    }

    const cards = this.visibleLibraryCards(playerId).slice(0, count);
    if (cards.length === 0) {
      return;
    }

    this.zoneActions.openFixedZone(
      playerId,
      'library',
      'game.numberAction.viewTopCards.title',
      cards,
      cards[0]?.instanceId ?? null,
      false,
      {
        readOnly: true,
        drawOrderLabels: this.drawOrderLabels(cards.length),
        viewTopCount: count,
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
    const drawLabel = this.translateText('shared.text.draw');

    return Array.from({ length: count }, (_unused, index) => `${drawLabel} ${index + 1}`);
  }

  private visibleLibraryCards(playerId: string): GameCardInstance[] {
    return this.core.snapshot()?.players[playerId]?.zones.library?.filter((card) => !card.hidden) ?? [];
  }

  private translateText(key: string, params?: Record<string, unknown>): string {
    const translated = this.translation?.instant(key, params);

    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key, params);
  }
}
