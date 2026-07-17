import { Injectable } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { GameTableLibraryActionsService } from '../../services/game-table-library-actions.service';
import { isGameplayCommandRejectedError } from '../../services/game-table-websocket-gameplay.service';
import { GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableZoneModalState } from './game-table-zone-modal.state';
import { LibrarySelectionBatchAction, LibrarySelectionBatchRequest, LibraryTopFaceDownRequest } from './library-batch-action.model';

@Injectable()
export class GameTableLibraryTopState {
  constructor(
    private readonly contextStore: GameTableContextStore,
    private readonly core: GameTableCoreState,
    private readonly libraryActions: GameTableLibraryActionsService,
    private readonly playersStore: GameTablePlayersStore,
    private readonly zoneActions: GameTableZoneActionsService,
    private readonly zoneModalState: GameTableZoneModalState,
  ) {}

  async viewTopLibrary(playerId: string, count: number): Promise<void> {
    const sanitizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    this.zoneActions.openFixedZone(
      playerId,
      'library',
      `${this.playersStore.playerName(playerId)} top ${sanitizedCount} library card${sanitizedCount === 1 ? '' : 's'}`,
      [],
      null,
      false,
      {
        allowReorder: true,
        drawOrderLabels: this.drawOrderLabels(sanitizedCount),
        viewTopCount: sanitizedCount,
        localMultiSelect: true,
      },
    );
    const selectionRevision = this.zoneModalState.zoneModal()?.selectionRevision ?? null;
    this.zoneModalState.setLoading();
    try {
      await this.libraryActions.view(this.contextStore.libraryAction(), playerId, sanitizedCount);
    } catch (error) {
      if (this.isCurrentView(selectionRevision)) {
        this.zoneModalState.markLibraryViewError();
      }
      throw error;
    }
    const cards = this.visibleLibraryCards(playerId).slice(0, sanitizedCount);
    if (cards.length === 0) {
      if (this.isCurrentView(selectionRevision)) {
        this.zoneModalState.markLibraryViewError('game.zoneModal.emptyView');
      }
      return;
    }
    this.finishOpeningView(selectionRevision, cards);
  }

  async viewLibrary(playerId: string): Promise<void> {
    this.zoneActions.openFixedZone(
      playerId,
      'library',
      `${this.playersStore.playerName(playerId)} library`,
      [],
      null,
      false,
      {
        viewTopCount: null,
        localMultiSelect: true,
      },
    );
    const selectionRevision = this.zoneModalState.zoneModal()?.selectionRevision ?? null;
    this.zoneModalState.setLoading();
    try {
      await this.libraryActions.view(this.contextStore.libraryAction(), playerId);
    } catch (error) {
      if (this.isCurrentView(selectionRevision)) {
        this.zoneModalState.markLibraryViewError();
      }
      throw error;
    }
    const cards = this.visibleLibraryCards(playerId);
    if (cards.length === 0) {
      if (this.isCurrentView(selectionRevision)) {
        this.zoneModalState.markLibraryViewError('game.zoneModal.emptyView');
      }
      return;
    }
    this.finishOpeningView(selectionRevision, cards);
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
    this.zoneModalState.markLibraryViewStale();
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

  async moveSelected(request: LibrarySelectionBatchRequest): Promise<void> {
    const modal = this.zoneModalState.zoneModal();
    const window = modal?.libraryWindow;
    if (!modal?.localMultiSelect || modal.zone !== 'library' || modal.lifecycle !== 'ready' || !window || window.status !== 'active') {
      this.zoneModalState.markLibraryViewStale();
      return;
    }
    const visible = new Set(modal.cards.map((card) => card.instanceId));
    const orderedIds = [...request.orderedInstanceIds];
    if (orderedIds.length === 0 || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((instanceId) => !visible.has(instanceId))) {
      this.zoneModalState.markLibraryViewStale();
      return;
    }

    const revision = modal.selectionRevision;
    const destination = this.batchDestination(request.action);
    this.zoneModalState.setMutationPending(true);
    try {
      await this.libraryActions.moveSelection(
        this.contextStore.libraryAction(),
        modal.playerId,
        window.windowId,
        window.expectedEpoch,
        orderedIds,
        destination.toZone,
        destination.options,
      );
      if (this.isCurrentView(revision)) {
        this.zoneActions.closeZoneModal();
      }
    } catch (error) {
      if (!this.isCurrentView(revision)) {
        return;
      }
      if (this.isStaleWindowError(error)) {
        this.zoneModalState.markLibraryViewStale();
      } else {
        this.zoneModalState.setMutationError();
      }
    } finally {
      if (this.isCurrentView(revision)) {
        this.zoneModalState.setMutationPending(false);
      }
    }
  }

  async playTopFaceDown(request: LibraryTopFaceDownRequest): Promise<void> {
    const modal = this.zoneModalState.zoneModal();
    const window = modal?.libraryWindow;
    if (!modal?.localMultiSelect || modal.zone !== 'library' || modal.lifecycle !== 'ready' || !window || window.status !== 'active') {
      this.zoneModalState.markLibraryViewStale();
      return;
    }
    const count = Number.isFinite(request.count) ? Math.max(1, Math.floor(request.count)) : 1;
    if (count > modal.cards.length) {
      this.zoneModalState.setMutationError('game.zoneModal.invalidBatch');
      return;
    }

    const revision = modal.selectionRevision;
    this.zoneModalState.setMutationPending(true);
    try {
      await this.libraryActions.playTopFaceDown(
        this.contextStore.libraryAction(),
        modal.playerId,
        window.windowId,
        count,
        window.expectedEpoch,
      );
      if (this.isCurrentView(revision)) {
        this.zoneActions.closeZoneModal();
      }
    } catch (error) {
      if (!this.isCurrentView(revision)) {
        return;
      }
      if (this.isStaleWindowError(error)) {
        this.zoneModalState.markLibraryViewStale();
      } else {
        this.zoneModalState.setMutationError();
      }
    } finally {
      if (this.isCurrentView(revision)) {
        this.zoneModalState.setMutationPending(false);
      }
    }
  }

  private finishOpeningView(selectionRevision: string | null, cards: GameCardInstance[]): void {
    if (!this.isCurrentView(selectionRevision)) {
      return;
    }
    const window = this.core.snapshot()?.players[this.zoneModalState.zoneModal()?.playerId ?? '']?.libraryWindow;
    if (!window || window.status !== 'active') {
      this.zoneModalState.markLibraryViewError();
      return;
    }
    this.zoneModalState.bindLibraryWindow(window);
    this.zoneModalState.setLoaded(cards, cards.length);
    this.zoneModalState.reconcileLibraryView(this.core.snapshot());
  }

  private isCurrentView(selectionRevision: string | null): boolean {
    return selectionRevision !== null
      && this.zoneModalState.zoneModal()?.selectionRevision === selectionRevision;
  }

  private batchDestination(action: LibrarySelectionBatchAction): {
    toZone: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'library';
    options: { faceDown?: boolean; position?: 'top' | 'bottom' };
  } {
    switch (action) {
      case 'battlefield-face-up':
        return { toZone: 'battlefield', options: { faceDown: false } };
      case 'battlefield-face-down':
        return { toZone: 'battlefield', options: { faceDown: true } };
      case 'library-top':
        return { toZone: 'library', options: { position: 'top' } };
      case 'library-bottom':
        return { toZone: 'library', options: { position: 'bottom' } };
      default:
        return { toZone: action, options: {} };
    }
  }

  private isStaleWindowError(error: unknown): boolean {
    if (!isGameplayCommandRejectedError(error)) {
      return false;
    }
    return [
      'LIBRARY_WINDOW_NOT_FOUND',
      'LIBRARY_WINDOW_STALE',
      'LIBRARY_WINDOW_CONSUMED',
      'LIBRARY_EPOCH_MISMATCH',
      'LIBRARY_SELECTION_MISMATCH',
      'LIBRARY_ORDER_MISMATCH',
      'INSTANCE_NOT_IN_WINDOW',
    ].includes(error.details.code);
  }
}
