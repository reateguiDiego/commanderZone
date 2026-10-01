import { Injectable } from '@angular/core';
import { GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableDebouncedValueCommandsService } from '../../services/game-table-debounced-value-commands.service';
import { GameTableLibraryImagePreloadService } from '../../services/game-table-library-image-preload.service';
import { GameTableBattlefieldState } from '../battlefield/game-table-battlefield.state';
import { GameTableCardsState } from '../cards/game-table-cards.state';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTableCoreState } from './game-table-core.state';

export interface GameTableSnapshotCoordinatorContext {
  readonly openRevealedLibraryFromSnapshot: (snapshot: GameSnapshot | null) => void;
}

export interface GameTableSnapshotOptions {
  readonly trackDropFeedback?: boolean;
}

@Injectable()
export class GameTableSnapshotCoordinatorState {
  constructor(
    private readonly battlefieldState: GameTableBattlefieldState,
    private readonly cardsState: GameTableCardsState,
    private readonly core: GameTableCoreState,
    private readonly debouncedValueCommands: GameTableDebouncedValueCommandsService,
    private readonly dropFeedbackState: GameTableDropFeedbackState,
    private readonly pendingTransferState: GameTablePendingTransferState,
    private readonly libraryImagePreloads: GameTableLibraryImagePreloadService,
  ) {}

  setSnapshot(
    context: GameTableSnapshotCoordinatorContext,
    snapshot: GameSnapshot | null,
    options: GameTableSnapshotOptions = {},
  ): void {
    // Entry feedback must only react to authoritative game changes. The
    // viewport and optimistic transforms below can recalculate battlefield
    // positions while processing unrelated commands (such as drawing or
    // changing a commander cast counter).
    if (options.trackDropFeedback !== false) {
      this.dropFeedbackState.trackSnapshot(snapshot);
    }

    const viewportSnapshot = this.battlefieldState.applyViewportClampedBattlefieldPositions(snapshot);
    const positionSnapshot = this.battlefieldState.applyOptimisticBattlefieldPositions(viewportSnapshot);
    const counterSnapshot = this.debouncedValueCommands.applyOptimisticValues(positionSnapshot);
    const nextSnapshot = this.cardsState.applyOptimisticCardCounters(counterSnapshot);
    this.pendingTransferState.reconcileSnapshot(nextSnapshot);
    this.core.snapshot.set(nextSnapshot);
    this.libraryImagePreloads.sync(nextSnapshot);
    context.openRevealedLibraryFromSnapshot(nextSnapshot);
  }
}
