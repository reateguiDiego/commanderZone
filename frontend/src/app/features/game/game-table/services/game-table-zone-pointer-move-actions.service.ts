import { Injectable } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { ZonePointerDropRequest } from '../models/game-table-zone-pointer-drag.model';
import { canDropCardOnZone, COMMAND_ZONE_DROP_ERROR, knownCommanderInstanceIds } from '../utils/command-zone-drop';
import { GameTableDropActionContext } from './game-table-drop-actions.service';

@Injectable()
export class GameTableZonePointerMoveActionsService {
  async moveZoneCardByPointer(context: GameTableDropActionContext, request: ZonePointerDropRequest): Promise<void> {
    const sourceCard = context.findCard(request.playerId, request.fromZone, request.instanceId);
    if (!sourceCard || !context.canControlPlayer(request.playerId) || !context.canControlOwnedCard(request.playerId, sourceCard)) {
      this.endBlockedMove(context, 'You can only move your own cards.');
      return;
    }
    if (!canDropCardOnZone(request.toZone, sourceCard, knownCommanderInstanceIds(context.snapshot()))) {
      this.endBlockedMove(context, COMMAND_ZONE_DROP_ERROR);
      return;
    }

    if (request.playerId === request.targetPlayerId && request.fromZone === request.toZone && request.toZone !== 'battlefield') {
      this.endCompletedMove(context);
      return;
    }

    if (request.fromZone === 'library' && request.toZone === 'hand') {
      await this.drawTopLibraryCard(context, request, sourceCard);
      return;
    }

    if (request.toZone === 'library') {
      this.prepareLibraryMove(context, request, sourceCard);
      return;
    }

    const payload = this.movePayload(context, request);
    if (request.toZone === 'battlefield' && request.rawZone === 'mana') {
      context.markPendingManaDrop(request.targetPlayerId, [request.instanceId]);
    }

    if (request.toZone === 'battlefield' && request.targetPlayerId !== request.playerId) {
      context.markPendingTransfer(request.playerId, request.fromZone, [request.instanceId], { expires: false });
      context.setPendingBattlefieldMove({
        cardName: sourceCard.name,
        targetPlayerName: context.playerName(request.targetPlayerId),
        payload,
      });
      context.endCardDrag();
      return;
    }

    if (request.fromZone !== request.toZone || request.playerId !== request.targetPlayerId) {
      context.markPendingTransfer(request.playerId, request.fromZone, [request.instanceId]);
    }

    await context.command('card.moved', payload);
    await context.recordCommanderCastIfNeeded(request.playerId, request.fromZone, request.toZone, request.targetPlayerId, [request.instanceId]);
    this.endCompletedMove(context);
  }

  private async drawTopLibraryCard(
    context: GameTableDropActionContext,
    request: ZonePointerDropRequest,
    sourceCard: GameCardInstance,
  ): Promise<void> {
    if (request.targetPlayerId !== request.playerId) {
      this.endBlockedMove(context, 'You can only draw from your own library to your own hand.');
      return;
    }

    context.markPendingTransfer(request.playerId, 'library', [sourceCard.instanceId]);
    await context.command('library.draw', { playerId: request.playerId, count: 1 });
    this.endCompletedMove(context);
  }

  private prepareLibraryMove(
    context: GameTableDropActionContext,
    request: ZonePointerDropRequest,
    sourceCard: GameCardInstance,
  ): void {
    context.markPendingTransfer(request.playerId, request.fromZone, [request.instanceId], { expires: false });
    context.setPendingLibraryMove({
      cardName: sourceCard.name,
      commandType: 'card.moved',
      payload: {
        playerId: request.playerId,
        fromZone: request.fromZone,
        toZone: 'library',
        targetPlayerId: request.targetPlayerId,
        instanceId: request.instanceId,
      },
    });
    context.endCardDrag();
    context.clearSelectedCards();
    context.suppressCardPreview();
  }

  private movePayload(context: GameTableDropActionContext, request: ZonePointerDropRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      playerId: request.playerId,
      fromZone: request.fromZone,
      toZone: request.toZone,
      targetPlayerId: request.targetPlayerId,
      instanceId: request.instanceId,
    };

    if (request.toZone === 'battlefield' && request.position) {
      payload['position'] = context.snapBattlefieldPosition(
        request.targetPlayerId,
        request.instanceId,
        request.position,
        request.rawZone,
      );
    }

    return payload;
  }

  private endBlockedMove(context: GameTableDropActionContext, message: string): void {
    context.endCardDrag();
    context.clearHandDropPreview();
    context.clearSelectedCards();
    context.setError(message);
  }

  private endCompletedMove(context: GameTableDropActionContext): void {
    context.endCardDrag();
    context.clearHandDropPreview();
    context.clearSelectedCards();
    context.suppressCardPreview();
  }
}
