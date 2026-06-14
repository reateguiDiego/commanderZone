import { Injectable } from '@angular/core';
import {
  GameCardInstance,
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

  async updateHelper(context: GameTableSpecialEntityActionContext, entityId: string, state: Record<string, unknown>): Promise<void> {
    await context.command('helper.updated', { entityId, state });
    context.closeContextMenu();
  }

  async removeHelper(context: GameTableSpecialEntityActionContext, entityId: string): Promise<void> {
    await context.command('helper.removed', { entityId });
    context.closeContextMenu();
  }

  async setRingBearer(context: GameTableSpecialEntityActionContext, playerId: string, card: GameCardInstance): Promise<void> {
    if (!this.isCreature(card)) {
      context.setError('Only creatures can become Ring-bearers.');
      return;
    }

    const snapshot = context.snapshot();
    const currentRing = snapshot?.specialEntities?.find((entity) => entity.template === 'the_ring' && entity.ownerPlayerId === playerId) ?? null;
    if (!currentRing) {
      await context.command('helper.created', {
        template: 'the_ring',
        ownerPlayerId: playerId,
        state: { level: 1, ringBearerInstanceId: card.instanceId },
      });
      context.closeContextMenu();
      return;
    }

    await context.command('helper.updated', {
      entityId: currentRing.id,
      state: {
        level: typeof currentRing.state['level'] === 'number' ? currentRing.state['level'] : 1,
        ringBearerInstanceId: card.instanceId,
      },
    });
    context.closeContextMenu();
  }

  private isCreature(card: GameCardInstance): boolean {
    return (card.typeLine ?? '').toLowerCase().includes('creature');
  }
}
