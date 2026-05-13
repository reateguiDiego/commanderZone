import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { HandDropPreview } from '../state/game-table-battlefield-drag.state';
import { GameTableDragService } from './game-table-drag.service';

export interface PendingBattlefieldMove {
  cardName: string;
  targetPlayerName: string;
  commandType?: Extract<GameCommandType, 'card.moved' | 'cards.moved'>;
  payload: Record<string, unknown>;
}

export interface PendingLibraryMove {
  cardName: string;
  commandType: Extract<GameCommandType, 'card.moved' | 'cards.moved'>;
  payload: Record<string, unknown>;
}

export interface MarkPendingTransferOptions {
  expires?: boolean;
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
  setPendingLibraryMove(move: PendingLibraryMove | null): void;
  endCardDrag(): void;
  clearHandDropPreview(): void;
  clearSelectedCards(): void;
  suppressCardPreview(): void;
  setError(message: string): void;
  snapBattlefieldPosition(playerId: string, instanceId: string, position: { x: number; y: number }, rawZone?: string): { x: number; y: number };
  markPendingManaDrop(playerId: string, instanceIds: readonly string[]): void;
  markPendingTransfer(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[], options?: MarkPendingTransferOptions): void;
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

    const movedCards = this.sourceCards(context, dragged.playerId, dragged.zone, dragged.instanceIds);
    if (!movedCards || movedCards.some((card) => !context.canControlOwnedCard(dragged.playerId, card))) {
      this.endBlockedDrag(context, 'You can only move your own cards.');
      return;
    }

    const instanceIds = movedCards.map((card) => card.instanceId);
    const isMultiMove = instanceIds.length > 1;

    if (dragged.playerId === targetPlayerId && dragged.zone === toZone && toZone !== 'battlefield') {
      this.endCompletedDrag(context);
      return;
    }

    const payload: Record<string, unknown> = {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone,
      targetPlayerId,
      ...(isMultiMove ? { instanceIds } : { instanceId: dragged.instanceId }),
    };
    const rawDropZone = this.rawDropZone(event);
    const position = this.drag.dropPosition(event, toZone);
    if (position) {
      payload['position'] = toZone === 'battlefield'
        ? context.snapBattlefieldPosition(targetPlayerId, dragged.instanceId, position, rawDropZone)
        : position;
    }
    if (toZone === 'battlefield' && rawDropZone === 'mana') {
      context.markPendingManaDrop(targetPlayerId, instanceIds);
    }
    const payloadPosition = payload['position'] as { x: number; y: number } | undefined;

    if (!isMultiMove && dragged.zone === 'battlefield' && toZone === 'battlefield' && targetPlayerId === dragged.playerId && payloadPosition) {
      await context.command('card.position.changed', {
        playerId: dragged.playerId,
        zone: 'battlefield',
        instanceId: dragged.instanceId,
        position: payloadPosition,
      });
      this.endCompletedDrag(context);
      return;
    }

    if (isMultiMove && toZone === 'battlefield' && targetPlayerId === dragged.playerId && payloadPosition) {
      await this.moveMultipleCardsToBattlefieldPositions(
        context,
        dragged.playerId,
        dragged.zone,
        instanceIds,
        payloadPosition,
      );
      await context.recordCommanderCastIfNeeded(dragged.playerId, dragged.zone, toZone, targetPlayerId);
      this.endCompletedDrag(context);
      return;
    }

    if (toZone === 'battlefield' && targetPlayerId !== dragged.playerId) {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds, { expires: false });
      context.setPendingBattlefieldMove({
        cardName: isMultiMove ? `${movedCards.length} cards` : movedCards[0]!.name,
        targetPlayerName: context.playerName(targetPlayerId),
        commandType: isMultiMove ? 'cards.moved' : 'card.moved',
        payload,
      });
      context.endCardDrag();
      return;
    }

    if (toZone === 'library') {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds, { expires: false });
      context.setPendingLibraryMove({
        cardName: isMultiMove ? `${movedCards.length} cards` : movedCards[0]!.name,
        commandType: isMultiMove ? 'cards.moved' : 'card.moved',
        payload,
      });
      context.endCardDrag();
      context.clearSelectedCards();
      context.suppressCardPreview();
      return;
    }

    await context.command(isMultiMove ? 'cards.moved' : 'card.moved', payload);
    await context.recordCommanderCastIfNeeded(dragged.playerId, dragged.zone, toZone, targetPlayerId);
    this.endCompletedDrag(context);
  }

  async dropOnHand(context: GameTableDropActionContext, event: DragEvent, targetPlayerId: string): Promise<void> {
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

    const movedCards = this.sourceCards(context, dragged.playerId, dragged.zone, dragged.instanceIds);
    if (!movedCards || movedCards.some((card) => !context.canControlOwnedCard(dragged.playerId, card))) {
      this.endBlockedDrag(context, 'You can only move your own cards.');
      return;
    }

    const preview = this.validHandPreview(context, targetPlayerId, dragged.instanceId);
    if (dragged.zone === 'hand' && dragged.playerId === targetPlayerId) {
      const hand = context.snapshot()?.players[targetPlayerId]?.zones.hand ?? [];
      const lastCard = hand.at(-1);
      if (preview) {
        await this.reorderHand(context, targetPlayerId, movedCards.map((card) => card.instanceId), preview.targetInstanceId, preview.placement);
      } else if (lastCard && dragged.instanceId !== lastCard.instanceId) {
        await this.reorderHand(context, targetPlayerId, movedCards.map((card) => card.instanceId), lastCard.instanceId, 'after');
      }
      context.endCardDrag();
      context.clearHandDropPreview();
      context.clearSelectedCards();
      context.suppressCardPreview();
      return;
    }

    const instanceIds = movedCards.map((card) => card.instanceId);
    const isMultiMove = instanceIds.length > 1;
    if (dragged.zone !== 'hand') {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds);
    }

    await context.command(isMultiMove ? 'cards.moved' : 'card.moved', {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone: 'hand',
      targetPlayerId,
      ...(isMultiMove ? { instanceIds } : { instanceId: dragged.instanceId }),
    });
    if (preview && dragged.playerId === targetPlayerId) {
      const movedInHand = this.sourceCards(context, targetPlayerId, 'hand', instanceIds);
      await this.placeCardsInHand(context, targetPlayerId, movedInHand ?? movedCards, preview.targetInstanceId, preview.placement);
    }
    await context.recordCommanderCastIfNeeded(dragged.playerId, dragged.zone, 'hand', targetPlayerId);
    context.endCardDrag();
    context.clearHandDropPreview();
    context.clearSelectedCards();
    context.suppressCardPreview();
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

    const movedCards = this.sourceCards(context, dragged.playerId, 'hand', dragged.instanceIds);
    if (!movedCards || movedCards.some((card) => !context.canControlOwnedCard(targetPlayerId, card))) {
      context.endCardDrag();
      context.clearHandDropPreview();
      context.setError('You can only reorder your own hand.');
      return;
    }

    const preview = context.handDropPreview();
    const placement = preview?.playerId === targetPlayerId && preview.targetInstanceId === targetCard.instanceId ? preview.placement : 'before';
    await this.reorderHand(context, targetPlayerId, movedCards.map((card) => card.instanceId), targetCard.instanceId, placement);
    context.endCardDrag();
    context.clearHandDropPreview();
    context.clearSelectedCards();
    context.suppressCardPreview();
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

    const movedCards = this.sourceCards(context, dragged.playerId, dragged.zone, dragged.instanceIds);
    if (!movedCards || movedCards.some((card) => !context.canControlOwnedCard(dragged.playerId, card))) {
      this.endBlockedDrag(context, 'You can only give your own cards.');
      return;
    }

    const instanceIds = movedCards.map((card) => card.instanceId);
    const isMultiMove = instanceIds.length > 1;
    context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds, { expires: false });
    context.setPendingBattlefieldMove({
      cardName: isMultiMove ? `${movedCards.length} cards` : movedCards[0]!.name,
      targetPlayerName: context.playerName(targetPlayerId),
      commandType: isMultiMove ? 'cards.moved' : 'card.moved',
      payload: {
        playerId: dragged.playerId,
        fromZone: dragged.zone,
        toZone: 'battlefield',
        targetPlayerId,
        ...(isMultiMove ? { instanceIds } : { instanceId: dragged.instanceId }),
      },
    });
    this.endCompletedDrag(context);
  }

  async confirmPendingBattlefieldMove(context: GameTableDropActionContext, pendingMove: PendingBattlefieldMove): Promise<void> {
    await context.command(pendingMove.commandType ?? 'card.moved', pendingMove.payload);
    const fromZone = pendingMove.payload['fromZone'];
    const targetPlayerId = pendingMove.payload['targetPlayerId'];
    const playerId = pendingMove.payload['playerId'];
    if (typeof playerId === 'string' && this.isGameZone(fromZone) && typeof targetPlayerId === 'string') {
      await context.recordCommanderCastIfNeeded(playerId, fromZone, 'battlefield', targetPlayerId);
    }
    context.setPendingBattlefieldMove(null);
    context.clearSelectedCards();
  }

  async confirmPendingLibraryMove(
    context: GameTableDropActionContext,
    pendingMove: PendingLibraryMove,
    position: 'top' | 'bottom',
  ): Promise<void> {
    await context.command(pendingMove.commandType, {
      ...pendingMove.payload,
      position,
    });
    const fromZone = pendingMove.payload['fromZone'];
    const playerId = pendingMove.payload['playerId'];
    if (typeof playerId === 'string' && this.isGameZone(fromZone)) {
      await context.recordCommanderCastIfNeeded(playerId, fromZone, 'library');
    }
    context.setPendingLibraryMove(null);
    context.clearSelectedCards();
    context.suppressCardPreview();
  }

  private async reorderHand(
    context: GameTableDropActionContext,
    playerId: string,
    movedInstanceIds: readonly string[],
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedIds = new Set(movedInstanceIds);
    if (movedIds.has(targetInstanceId)) {
      return;
    }
    const movedCards = hand.filter((card) => movedIds.has(card.instanceId));
    if (movedCards.length !== movedIds.size) {
      return;
    }

    await this.placeCardsInHand(context, playerId, movedCards, targetInstanceId, placement);
  }

  private async placeCardsInHand(
    context: GameTableDropActionContext,
    playerId: string,
    movedCards: readonly GameCardInstance[],
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedIds = new Set(movedCards.map((card) => card.instanceId));
    if (movedIds.has(targetInstanceId)) {
      return;
    }

    const withoutMoved = hand.filter((card) => !movedIds.has(card.instanceId));
    const targetIndex = withoutMoved.findIndex((card) => card.instanceId === targetInstanceId);
    if (targetIndex < 0) {
      return;
    }

    const reordered = [...withoutMoved];
    reordered.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, ...movedCards);
    if (this.sameCardOrder(hand, reordered)) {
      return;
    }

    await context.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  private sourceCards(
    context: GameTableDropActionContext,
    playerId: string,
    zone: GameZoneName,
    instanceIds: readonly string[],
  ): GameCardInstance[] | null {
    const cards = instanceIds
      .map((instanceId) => context.findCard(playerId, zone, instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));

    return cards.length === instanceIds.length ? cards : null;
  }

  private async moveMultipleCardsToBattlefieldPositions(
    context: GameTableDropActionContext,
    playerId: string,
    fromZone: GameZoneName,
    instanceIds: readonly string[],
    position: { x: number; y: number },
  ): Promise<void> {
    context.markPendingTransfer(playerId, fromZone, instanceIds);
    for (const instanceId of instanceIds) {
      await context.command('card.moved', {
        playerId,
        fromZone,
        toZone: 'battlefield',
        targetPlayerId: playerId,
        instanceId,
        position,
      });
    }
  }

  private validHandPreview(
    context: GameTableDropActionContext,
    playerId: string,
    movedInstanceId: string,
  ): HandDropPreview | null {
    const preview = context.handDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId !== movedInstanceId ? preview : null;
  }

  private sameCardOrder(left: readonly GameCardInstance[], right: readonly GameCardInstance[]): boolean {
    return left.length === right.length
      && left.every((card, index) => card.instanceId === right[index]?.instanceId);
  }

  private endBlockedDrag(context: GameTableDropActionContext, message: string): void {
    context.endCardDrag();
    context.setError(message);
  }

  private endCompletedDrag(context: GameTableDropActionContext): void {
    context.endCardDrag();
    context.clearSelectedCards();
    context.suppressCardPreview();
  }

  private isGameZone(value: unknown): value is GameZoneName {
    return typeof value === 'string'
      && ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(value);
  }

  private rawDropZone(event: DragEvent): string | undefined {
    const target = event.target instanceof Element ? event.target : null;
    const currentTarget = event.currentTarget instanceof Element ? event.currentTarget : null;

    return target?.closest<HTMLElement>('[data-game-drop-zone]')?.dataset['zone']
      ?? currentTarget?.closest<HTMLElement>('[data-game-drop-zone]')?.dataset['zone'];
  }
}
