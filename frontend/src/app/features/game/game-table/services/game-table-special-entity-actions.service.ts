import { Injectable } from '@angular/core';
import {
  GameCommandType,
  GameSnapshot,
  GameSpecialEntity,
  GameSpecialEntityCardRef,
  GameSpecialEntityTemplate,
} from '../../../../core/models/game.model';

export interface GameTableSpecialEntityActionContext {
  snapshot(): GameSnapshot | null;
  setError(message: string): void;
  closeContextMenu(): void;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTableSpecialEntityActionsService {
  async createHelper(
    context: GameTableSpecialEntityActionContext,
    template: GameSpecialEntityTemplate,
    ownerPlayerId: string | null,
    options: { card?: GameSpecialEntityCardRef | null; state?: Record<string, unknown> } = {},
  ): Promise<void> {
    await context.command('helper.created', {
      template,
      ...(ownerPlayerId ? { ownerPlayerId } : {}),
      ...(options.card ? { card: options.card } : {}),
      ...(options.state ? { state: options.state } : {}),
    });
    context.closeContextMenu();
  }

  async updateHelper(
    context: GameTableSpecialEntityActionContext,
    entityId: string,
    state: Record<string, unknown>,
    options: { card?: GameSpecialEntityCardRef | null } = {},
  ): Promise<void> {
    await context.command('helper.updated', {
      entityId,
      state,
      ...(options.card ? { card: options.card } : {}),
    });
    context.closeContextMenu();
  }

  async removeHelper(context: GameTableSpecialEntityActionContext, entityId: string): Promise<void> {
    await context.command('helper.removed', { entityId });
    context.closeContextMenu();
  }
}
