import { inject, Injectable } from '@angular/core';
import { GameCommandType, GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableWebsocketGameplayContext, GameTableWebsocketGameplayService } from '../../services/game-table-websocket-gameplay.service';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTableCoreState } from './game-table-core.state';
import { GameTablePendingTransferRegistrarState } from './game-table-pending-transfer-registrar.state';

export interface GameTableCommandContext {
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly websocket: () => GameTableWebsocketGameplayContext;
  readonly queueBattlefieldPositionCommand: (
    gameId: string,
    payload: Record<string, unknown>,
    persist: () => Promise<void>,
  ) => boolean;
  readonly errorMessage: (error: unknown) => string;
}

@Injectable()
export class GameTableCommandStore {
  private readonly commands = inject(GameTableCommandService);
  private readonly core = inject(GameTableCoreState);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferRegistrar = inject(GameTablePendingTransferRegistrarState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);
  private readonly websocketCommands = inject(GameTableWebsocketGameplayService);

  async command(context: GameTableCommandContext, type: GameCommandType, payload: Record<string, unknown>, force = false): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      return;
    }

    if (
      this.isBattlefieldPositionCommand(type)
      && context.queueBattlefieldPositionCommand(gameId, payload, () => this.sendAndApplyCommand(context, gameId, type, payload))
    ) {
      return;
    }

    if (this.core.pending() && !force) {
      return;
    }

    this.core.pending.set(true);
    this.core.error.set(null);
    this.pendingTransferRegistrar.register(type, payload);

    try {
      await this.sendAndApplyCommand(context, gameId, type, payload);
    } catch (error) {
      this.pendingTransferState.clear();
      this.dropFeedbackState.clearPendingBattlefieldEntries();
      const message = context.errorMessage(error);
      if (!this.shouldSuppressCommandErrorToast(type, message, error)) {
        this.core.error.set(message);
      }
    } finally {
      this.core.pending.set(false);
    }
  }

  private shouldSuppressCommandErrorToast(type: GameCommandType, message: string, error: unknown): boolean {
    const rawMessage = error instanceof Error ? error.message.toLowerCase() : '';

    if (type === 'turn.changed' && rawMessage.includes('conceded players cannot perform game actions')) {
      return true;
    }

    return type === 'cards.position.changed'
      && message === 'positions must contain at least one card position.';
  }

  private isBattlefieldPositionCommand(type: GameCommandType): boolean {
    return type === 'card.position.changed' || type === 'cards.position.changed';
  }

  private async sendAndApplyCommand(
    context: GameTableCommandContext,
    gameId: string,
    type: GameCommandType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.websocketCommands.isMigratedCommand(type)) {
      const sentOverWebsocket = await this.websocketCommands.sendCommand(context.websocket(), type, payload);
      if (sentOverWebsocket) {
        return;
      }

      throw new Error('WebSocket gameplay connection is not available.');
    }

    const snapshot = await this.commands.send(gameId, type, payload);
    context.setSnapshot(snapshot);
  }
}
