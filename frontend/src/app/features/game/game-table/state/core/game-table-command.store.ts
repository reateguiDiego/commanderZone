import { inject, Injectable } from '@angular/core';
import { GameCommandType, GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTableCoreState } from './game-table-core.state';
import { GameTablePendingTransferRegistrarState } from './game-table-pending-transfer-registrar.state';

export interface GameTableCommandContext {
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly queueBattlefieldPositionCommand: (gameId: string, payload: Record<string, unknown>) => boolean;
  readonly errorMessage: (error: unknown) => string;
}

@Injectable()
export class GameTableCommandStore {
  private readonly commands = inject(GameTableCommandService);
  private readonly core = inject(GameTableCoreState);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferRegistrar = inject(GameTablePendingTransferRegistrarState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);

  async command(context: GameTableCommandContext, type: GameCommandType, payload: Record<string, unknown>, force = false): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      return;
    }

    if (type === 'card.position.changed' && context.queueBattlefieldPositionCommand(gameId, payload)) {
      return;
    }

    if (this.core.pending() && !force) {
      return;
    }

    this.core.pending.set(true);
    this.core.error.set(null);
    this.pendingTransferRegistrar.register(type, payload);

    try {
      const snapshot = await this.commands.send(gameId, type, payload);
      context.setSnapshot(snapshot);
    } catch (error) {
      this.pendingTransferState.clear();
      this.dropFeedbackState.clearPendingBattlefieldEntries();
      this.core.error.set(context.errorMessage(error));
    } finally {
      this.core.pending.set(false);
    }
  }
}
