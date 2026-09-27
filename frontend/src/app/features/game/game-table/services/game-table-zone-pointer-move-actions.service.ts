import { Injectable } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { KnownZonePointerDropRequest, ZonePointerDropRequest } from '../models/game-table-zone-pointer-drag.model';
import { canDropCardOnZone, COMMAND_ZONE_DROP_ERROR, knownCommanderInstanceIds } from '../utils/command-zone-drop';
import { GameTableDropActionContext } from './game-table-drop-actions.service';

@Injectable()
export class GameTableZonePointerMoveActionsService {
  async moveZoneCardByPointer(context: GameTableDropActionContext, request: ZonePointerDropRequest): Promise<void> {
    if (request.fromZone === 'library') {
      await this.moveTopLibraryCard(context, request);
      return;
    }

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

    if (request.toZone === 'library') {
      this.prepareLibraryMove(context, request, sourceCard);
      return;
    }

    const payload = this.movePayload(context, request);
    if (request.toZone === 'battlefield' && request.rawZone === 'mana') {
      context.markPendingManaDrop(request.targetPlayerId, [request.instanceId]);
    }

    if (request.toZone === 'battlefield' && request.targetPlayerId !== request.playerId) {
      context.markPendingTransfer(request.playerId, request.fromZone, [request.instanceId]);
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

  private async moveTopLibraryCard(
    context: GameTableDropActionContext,
    request: ZonePointerDropRequest,
  ): Promise<void> {
    if (!context.canControlPlayer(request.playerId)) {
      this.endBlockedMove(context, 'You can only move your own cards.');
      return;
    }

    if (request.toZone === 'command') {
      this.endBlockedMove(context, COMMAND_ZONE_DROP_ERROR);
      return;
    }

    if (request.toZone === 'hand' && request.targetPlayerId !== request.playerId) {
      this.endBlockedMove(context, 'You can only draw from your own library to your own hand.');
      return;
    }

    if (request.toZone === 'library' && request.targetPlayerId === request.playerId) {
      this.endCompletedMove(context);
      return;
    }

    if (request.toZone === 'hand') {
      await context.command('library.draw', { playerId: request.playerId, count: 1 });
      this.endCompletedMove(context);
      return;
    }

    const payload: Record<string, unknown> = {
      playerId: request.playerId,
      targetPlayerId: request.targetPlayerId,
      toZone: request.toZone,
      count: 1,
    };
    if (request.toZone === 'battlefield' && request.position) {
      payload['position'] = context.snapBattlefieldPosition(
        request.targetPlayerId,
        '',
        request.position,
        request.rawZone,
      );
    }

    await context.command('library.move_top', payload);
    this.endCompletedMove(context);
  }

  private prepareLibraryMove(
    context: GameTableDropActionContext,
    request: KnownZonePointerDropRequest,
    sourceCard: GameCardInstance,
  ): void {
    context.markPendingTransfer(request.playerId, request.fromZone, [request.instanceId]);
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

  private movePayload(context: GameTableDropActionContext, request: KnownZonePointerDropRequest): Record<string, unknown> {
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
