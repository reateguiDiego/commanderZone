import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { HandDropPreview } from '../state/game-table-battlefield-drag.state';
import { GameTableDragService } from './game-table-drag.service';

export interface PendingBattlefieldMove {
  cardName: string;
  targetPlayerName: string;
  payload: Record<string, unknown>;
}

export interface GameTableDropActionContext {
  zones: readonly GameZoneName[];
  snapshot(): GameSnapshot | null;
  handDropPreview(): HandDropPreview | null;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  canControlPlayer(playerId: string): boolean;
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  playerName(playerId: string): string;
  setPendingBattlefieldMove(move: PendingBattlefieldMove | null): void;
  endCardDrag(): void;
  clearHandDropPreview(): void;
  clearSelectedCards(): void;
  setError(message: string): void;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
  recordCommanderCastIfNeeded(playerId: string, fromZone: GameZoneName, toZone?: GameZoneName, targetPlayerId?: string): Promise<void>;
}

@Injectable()
export class GameTableDropActionsService {
  private readonly drag = inject(GameTableDragService);

  async dropOnZone(
    context: GameTableDropActionContext,
    event: DragEvent,
    targetPlayerId: string,
    toZone: GameZoneName,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    if (!dragged) {
      context.endCardDrag();
      return;
    }
    if (!context.canControlPlayer(dragged.playerId)) {
      this.endBlockedDrag(context, 'You can only move your own cards.');
      return;
    }

    const sourceCard = context.findCard(dragged.playerId, dragged.zone, dragged.instanceId);
    if (!sourceCard || !context.canControlOwnedCard(dragged.playerId, sourceCard)) {
      this.endBlockedDrag(context, 'You can only move your own cards.');
      return;
    }

    const payload: Record<string, unknown> = {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone,
      targetPlayerId,
      instanceId: dragged.instanceId,
    };
    const position = this.drag.dropPosition(event, toZone);
    if (position) {
      payload['position'] = position;
    }

    if (dragged.zone === 'battlefield' && toZone === 'battlefield' && targetPlayerId === dragged.playerId && position) {
      await context.command('card.position.changed', {
        playerId: dragged.playerId,
        zone: 'battlefield',
        instanceId: dragged.instanceId,
        position,
      });
      this.endCompletedDrag(context);
      return;
    }

    if (toZone === 'battlefield' && targetPlayerId !== dragged.playerId) {
      context.setPendingBattlefieldMove({
        cardName: sourceCard.name,
        targetPlayerName: context.playerName(targetPlayerId),
        payload,
      });
      context.endCardDrag();
      return;
    }

    await context.command('card.moved', payload);
    await context.recordCommanderCastIfNeeded(dragged.playerId, dragged.zone, toZone, targetPlayerId);
    this.endCompletedDrag(context);
  }

  async dropOnHand(context: GameTableDropActionContext, event: DragEvent, targetPlayerId: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    if (dragged?.zone === 'hand' && dragged.playerId === targetPlayerId) {
      const hand = context.snapshot()?.players[targetPlayerId]?.zones.hand ?? [];
      const lastCard = hand.at(-1);
      if (lastCard && dragged.instanceId !== lastCard.instanceId) {
        await this.reorderHand(context, targetPlayerId, dragged.instanceId, lastCard.instanceId, 'after');
      }
      context.endCardDrag();
      context.clearHandDropPreview();
      context.clearSelectedCards();
      return;
    }

    await this.dropOnZone(context, event, targetPlayerId, 'hand');
  }

  async dropOnHandCard(
    context: GameTableDropActionContext,
    event: DragEvent,
    targetPlayerId: string,
    targetCard: GameCardInstance,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    if (!dragged || dragged.zone !== 'hand' || dragged.playerId !== targetPlayerId || dragged.instanceId === targetCard.instanceId) {
      context.endCardDrag();
      context.clearHandDropPreview();
      return;
    }

    const sourceCard = context.findCard(dragged.playerId, 'hand', dragged.instanceId);
    if (!sourceCard || !context.canControlOwnedCard(targetPlayerId, sourceCard)) {
      context.endCardDrag();
      context.clearHandDropPreview();
      context.setError('You can only reorder your own hand.');
      return;
    }

    const preview = context.handDropPreview();
    const placement = preview?.playerId === targetPlayerId && preview.targetInstanceId === targetCard.instanceId ? preview.placement : 'before';
    await this.reorderHand(context, targetPlayerId, dragged.instanceId, targetCard.instanceId, placement);
    context.endCardDrag();
    context.clearHandDropPreview();
    context.clearSelectedCards();
  }

  async dropOnPlayer(context: GameTableDropActionContext, event: DragEvent, targetPlayerId: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    if (!dragged || dragged.playerId === targetPlayerId) {
      context.endCardDrag();
      return;
    }
    if (!context.canControlPlayer(dragged.playerId)) {
      this.endBlockedDrag(context, 'You can only give your own cards.');
      return;
    }

    const sourceCard = context.findCard(dragged.playerId, dragged.zone, dragged.instanceId);
    if (!sourceCard || !context.canControlOwnedCard(dragged.playerId, sourceCard)) {
      this.endBlockedDrag(context, 'You can only give your own cards.');
      return;
    }

    context.setPendingBattlefieldMove({
      cardName: sourceCard.name,
      targetPlayerName: context.playerName(targetPlayerId),
      payload: {
        playerId: dragged.playerId,
        fromZone: dragged.zone,
        toZone: 'battlefield',
        targetPlayerId,
        instanceId: dragged.instanceId,
      },
    });
    this.endCompletedDrag(context);
  }

  async confirmPendingBattlefieldMove(context: GameTableDropActionContext, pendingMove: PendingBattlefieldMove): Promise<void> {
    await context.command('card.moved', pendingMove.payload);
    const fromZone = pendingMove.payload['fromZone'];
    const targetPlayerId = pendingMove.payload['targetPlayerId'];
    const playerId = pendingMove.payload['playerId'];
    if (typeof playerId === 'string' && this.isGameZone(fromZone) && typeof targetPlayerId === 'string') {
      await context.recordCommanderCastIfNeeded(playerId, fromZone, 'battlefield', targetPlayerId);
    }
    context.setPendingBattlefieldMove(null);
    context.clearSelectedCards();
  }

  private async reorderHand(
    context: GameTableDropActionContext,
    playerId: string,
    movedInstanceId: string,
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const fromIndex = hand.findIndex((card) => card.instanceId === movedInstanceId);
    const toIndex = hand.findIndex((card) => card.instanceId === targetInstanceId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const reordered = [...hand];
    const [moved] = reordered.splice(fromIndex, 1);
    const adjustedTargetIndex = reordered.findIndex((card) => card.instanceId === targetInstanceId);
    reordered.splice(placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, moved);
    await context.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  private endBlockedDrag(context: GameTableDropActionContext, message: string): void {
    context.endCardDrag();
    context.setError(message);
  }

  private endCompletedDrag(context: GameTableDropActionContext): void {
    context.endCardDrag();
    context.clearSelectedCards();
  }

  private isGameZone(value: unknown): value is GameZoneName {
    return typeof value === 'string'
      && ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(value);
  }
}
