import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCardPosition, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { HandDropPreview } from '../state/drag-drop/game-table-battlefield-drag.state';
import { attachmentDropTarget, attachmentRelationInstanceIds, createAttachmentStackMoves } from '../utils/attachment-stack';
import { createLandStackMoves, landStackDropTarget } from '../utils/land-stack';
import { GameTableDragService } from './game-table-drag.service';

export interface PendingBattlefieldMove {
  cardName: string;
  targetPlayerName: string;
  commandType?: Extract<GameCommandType, 'card.moved' | 'cards.moved' | 'card.controller.changed'>;
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
  cardPosition(card: GameCardInstance): { x: number; y: number } | null;
  snapBattlefieldPosition(playerId: string, instanceId: string, position: { x: number; y: number }, rawZone?: string): GameCardPosition;
  markPendingManaDrop(playerId: string, instanceIds: readonly string[]): void;
  markPendingTransfer(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[], options?: MarkPendingTransferOptions): void;
  syncOpenZoneModalAfterMove(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]): Promise<void>;
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
    const dropPosition = this.drag.dropPosition(event, toZone);
    const battlefieldRelationMove = dropPosition
      ? this.battlefieldRelationMove(context, dragged, movedCards[0] ?? null, targetPlayerId, toZone, dropPosition)
      : null;
    if (dropPosition) {
      payload['position'] = battlefieldRelationMove
        ? battlefieldRelationMove.position
        : toZone === 'battlefield'
          ? context.snapBattlefieldPosition(targetPlayerId, dragged.instanceId, dropPosition, rawDropZone)
          : dropPosition;
    }
    if (toZone === 'battlefield' && rawDropZone === 'mana') {
      context.markPendingManaDrop(targetPlayerId, instanceIds);
    }
    const payloadPosition = payload['position'] as GameCardPosition | undefined;

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
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds);
      await context.command('cards.moved', {
        playerId: dragged.playerId,
        fromZone: dragged.zone,
        toZone,
        targetPlayerId,
        instanceIds,
        position: payloadPosition,
      });
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

    if (toZone === 'library' && movedCards.every((card) => this.evaporatesWhenMovedToLibrary(card))) {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds);
      await context.command(isMultiMove ? 'cards.moved' : 'card.moved', payload);
      this.endCompletedDrag(context);
      return;
    }

    if (toZone === 'library') {
      this.notifyBorrowedCardsReturnToOwner(context, dragged.playerId, toZone, movedCards);
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

    this.notifyBorrowedCardsReturnToOwner(context, dragged.playerId, toZone, movedCards);
    if (dragged.zone !== toZone || dragged.playerId !== targetPlayerId) {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds);
    }
    await context.command(isMultiMove ? 'cards.moved' : 'card.moved', payload);
    if (battlefieldRelationMove?.kind === 'attachment') {
      await context.command('attachment.created', {
        equipmentInstanceId: dragged.instanceId,
        attachedToInstanceId: battlefieldRelationMove.targetInstanceId,
      });
    }
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
    const handDestinationPlayerId = this.destinationPlayerIdForMove(dragged.playerId, dragged.zone, 'hand', movedCards, targetPlayerId);

    if (dragged.zone === 'library') {
      if (targetPlayerId !== dragged.playerId) {
        this.endBlockedDrag(context, 'You can only draw from your own library to your own hand.');
        context.clearHandDropPreview();
        return;
      }

      context.markPendingTransfer(dragged.playerId, 'library', instanceIds);
      await context.command('library.draw', { playerId: dragged.playerId, count: 1 });
      this.endCompletedDrag(context);
      context.clearHandDropPreview();
      return;
    }

    if (dragged.zone !== 'hand') {
      context.markPendingTransfer(dragged.playerId, dragged.zone, instanceIds);
    }

    this.notifyBorrowedCardsReturnToOwner(context, dragged.playerId, 'hand', movedCards);
    await context.command(isMultiMove ? 'cards.moved' : 'card.moved', {
      playerId: dragged.playerId,
      fromZone: dragged.zone,
      toZone: 'hand',
      targetPlayerId,
      ...(isMultiMove ? { instanceIds } : { instanceId: dragged.instanceId }),
    });
    if (preview && dragged.playerId === targetPlayerId && handDestinationPlayerId === targetPlayerId) {
      const movedInHand = this.sourceCards(context, targetPlayerId, 'hand', instanceIds);
      if (movedInHand) {
        await this.placeCardsInHand(context, targetPlayerId, movedInHand, preview.targetInstanceId, preview.placement);
      }
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
    const instanceIds = this.payloadInstanceIds(pendingMove.payload);
    if (pendingMove.commandType !== 'card.controller.changed' && typeof playerId === 'string' && this.isGameZone(fromZone) && typeof targetPlayerId === 'string') {
      await context.recordCommanderCastIfNeeded(playerId, fromZone, 'battlefield', targetPlayerId);
    }
    if (typeof playerId === 'string' && this.isGameZone(fromZone) && instanceIds.length > 0) {
      await context.syncOpenZoneModalAfterMove(playerId, fromZone, instanceIds);
    }
    context.setPendingBattlefieldMove(null);
    context.clearSelectedCards();
  }

  async confirmPendingLibraryMove(
    context: GameTableDropActionContext,
    pendingMove: PendingLibraryMove,
    position: 'top' | 'bottom',
    randomOrder = false,
  ): Promise<void> {
    const shouldRandomize = randomOrder && this.supportsRandomLibraryOrder(pendingMove);
    await context.command(pendingMove.commandType, {
      ...pendingMove.payload,
      position,
      ...(shouldRandomize ? { randomOrder: true } : {}),
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

  supportsRandomLibraryOrder(pendingMove: PendingLibraryMove): boolean {
    const instanceIds = pendingMove.payload['instanceIds'];

    return pendingMove.commandType === 'cards.moved'
      && pendingMove.payload['toZone'] === 'library'
      && Array.isArray(instanceIds)
      && instanceIds.length > 1;
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

  private battlefieldRelationMove(
    context: GameTableDropActionContext,
    dragged: { playerId: string; zone: GameZoneName; instanceId: string; instanceIds: readonly string[] },
    sourceCard: GameCardInstance | null,
    targetPlayerId: string,
    toZone: GameZoneName,
    dropPosition: { x: number; y: number },
  ): { readonly kind: 'land' | 'attachment'; readonly position: GameCardPosition; readonly targetInstanceId?: string } | null {
    if (
      toZone !== 'battlefield'
      || targetPlayerId !== dragged.playerId
      || dragged.zone === 'battlefield'
      || dragged.instanceIds.length !== 1
      || !sourceCard
    ) {
      return null;
    }

    const snapshot = context.snapshot();
    const battlefield = snapshot?.players[targetPlayerId]?.zones.battlefield ?? [];
    const droppedCard = { ...sourceCard, zone: 'battlefield' as const, position: dropPosition };
    const cards = [...battlefield, droppedCard];
    const positionFor = (card: GameCardInstance): { x: number; y: number } | null => {
      if (card.instanceId === sourceCard.instanceId) {
        return dropPosition;
      }

      return context.cardPosition(card);
    };
    const landTarget = landStackDropTarget(
      cards,
      sourceCard.instanceId,
      dropPosition,
      positionFor,
      attachmentRelationInstanceIds(snapshot?.attachments ?? []),
    );
    if (landTarget) {
      const moves = createLandStackMoves(landTarget, droppedCard);
      const droppedMove = moves.find((move) => move.card.instanceId === sourceCard.instanceId);

      return droppedMove ? { kind: 'land', position: droppedMove.position } : null;
    }

    const attachmentTarget = attachmentDropTarget(
      cards,
      snapshot?.attachments ?? [],
      sourceCard.instanceId,
      dropPosition,
      positionFor,
    );
    if (!attachmentTarget) {
      return null;
    }

    const moves = createAttachmentStackMoves(
      cards,
      snapshot?.attachments ?? [],
      sourceCard.instanceId,
      attachmentTarget.targetCard.instanceId,
      positionFor,
    );
    const droppedMove = moves.find((move) => move.instanceId === sourceCard.instanceId);

    return droppedMove
      ? { kind: 'attachment', position: droppedMove.position, targetInstanceId: attachmentTarget.targetCard.instanceId }
      : null;
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

  private evaporatesWhenMovedToLibrary(card: GameCardInstance): boolean {
    return card.isToken === true || card.isTokenCopy === true;
  }

  private isGameZone(value: unknown): value is GameZoneName {
    return typeof value === 'string'
      && ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(value);
  }

  private payloadInstanceIds(payload: Record<string, unknown>): string[] {
    const instanceIds = payload['instanceIds'];
    if (Array.isArray(instanceIds)) {
      return instanceIds.filter((instanceId): instanceId is string => typeof instanceId === 'string');
    }

    return typeof payload['instanceId'] === 'string' ? [payload['instanceId']] : [];
  }

  private destinationPlayerIdForMove(
    sourcePlayerId: string,
    fromZone: GameZoneName,
    toZone: GameZoneName,
    movedCards: readonly GameCardInstance[],
    requestedTargetPlayerId: string,
  ): string | null {
    if (fromZone !== 'battlefield' || toZone === 'battlefield') {
      return requestedTargetPlayerId;
    }

    const ownerIds = new Set(movedCards.map((card) => card.ownerId ?? sourcePlayerId));

    return ownerIds.size === 1 ? [...ownerIds][0]! : null;
  }

  private notifyBorrowedCardsReturnToOwner(
    context: Pick<GameTableDropActionContext, 'playerName' | 'setError'>,
    controllerId: string,
    toZone: GameZoneName,
    movedCards: readonly GameCardInstance[],
  ): void {
    if (toZone === 'battlefield') {
      return;
    }

    const ownerIds = [...new Set(
      movedCards
        .map((card) => card.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId) && ownerId !== controllerId),
    )];
    if (ownerIds.length === 0) {
      return;
    }

    const ownerLabel = ownerIds.length === 1 ? context.playerName(ownerIds[0]!) : 'their deck owners';
    const cardLabel = movedCards.length === 1 ? 'This borrowed card' : 'Borrowed cards';
    context.setError(`${cardLabel} will return to ${ownerLabel}'s ${toZone}.`);
  }

  private rawDropZone(event: DragEvent): string | undefined {
    const target = event.target instanceof Element ? event.target : null;
    const currentTarget = event.currentTarget instanceof Element ? event.currentTarget : null;

    return target?.closest<HTMLElement>('[data-game-drop-zone]')?.dataset['zone']
      ?? currentTarget?.closest<HTMLElement>('[data-game-drop-zone]')?.dataset['zone'];
  }
}
