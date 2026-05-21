import { inject, Injectable } from '@angular/core';
import { GameCardInstance, GameCardPosition, GameCommandType, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import {
  GameTableBattlefieldDragContext,
  GameTableBattlefieldDragCoordinatorService,
} from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { PendingBattlefieldMove, PendingLibraryMove } from '../../services/game-table-drop-actions.service';
import { GameTableMotionService } from '../../services/game-table-motion.service';
import { attachmentDropTarget, attachmentRelationInstanceIds, createAttachmentStackMoves } from '../../utils/attachment-stack';
import { createLandStackMoves, LandStackDropTarget, landStackDropTarget } from '../../utils/land-stack';
import { GameTableBattlefieldDragState } from '../drag-drop/game-table-battlefield-drag.state';

export interface GameTableHandContext {
  readonly zones: readonly GameZoneName[];
  readonly snapshot: () => GameSnapshot | null;
  readonly selectedDragInstanceIds: (playerId: string, zone: GameZoneName, instanceId: string) => string[];
  readonly findCard: (playerId: string, zone: GameZoneName, instanceId: string) => GameCardInstance | null;
  readonly canControlOwnedCard: (playerId: string, card: GameCardInstance) => boolean;
  readonly playerName: (playerId: string) => string;
  readonly battlefieldDragContext: () => GameTableBattlefieldDragContext;
  readonly snapBattlefieldPosition: (
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    rawZone?: string,
  ) => GameCardPosition;
  readonly moveLocalCardsFromHandToBattlefield: (
    playerId: string,
    targetPlayerId: string,
    movedInstanceIds: readonly string[],
    position?: GameCardPosition,
  ) => boolean;
  readonly markPendingManaDrop: (playerId: string, instanceIds: readonly string[]) => void;
  readonly markPendingBattlefieldEntry: (playerId: string, instanceIds: readonly string[]) => void;
  readonly markPendingTransfer: (playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]) => void;
  readonly setPendingBattlefieldMove: (move: PendingBattlefieldMove | null) => void;
  readonly setPendingLibraryMove: (move: PendingLibraryMove | null) => void;
  readonly clearSelectedCards: () => void;
  readonly setError: (message: string) => void;
  readonly command: (type: GameCommandType, payload: Record<string, unknown>) => Promise<void>;
  readonly recordCommanderCastIfNeeded: (
    playerId: string,
    fromZone: GameZoneName,
    toZone?: GameZoneName,
    targetPlayerId?: string,
  ) => Promise<void>;
}

@Injectable()
export class GameTableHandState {
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
  private readonly battlefieldDragState = inject(GameTableBattlefieldDragState);
  private readonly drag = inject(GameTableDragService);
  private readonly motion = inject(GameTableMotionService, { optional: true });

  readonly handDropPreview = this.battlefieldDragState.handDropPreview;

  isHandDropTarget(playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean {
    const preview = this.handDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId && preview.placement === placement;
  }

  previewHandDrop(context: GameTableHandContext, event: DragEvent, targetPlayerId: string, targetCard: GameCardInstance): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, context.battlefieldDragContext());
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    if (!dragged || dragged.zone !== 'hand' || dragged.playerId !== targetPlayerId || dragged.instanceId === targetCard.instanceId) {
      this.clearHandDropPreview();
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const placement = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    this.battlefieldDragState.setHandDropPreview({ playerId: targetPlayerId, targetInstanceId: targetCard.instanceId, placement });
  }

  clearHandDropPreview(): void {
    this.battlefieldDragState.clearHandDropPreview();
  }

  async reorderHandCard(
    context: GameTableHandContext,
    playerId: string,
    movedInstanceId: string,
    targetInstanceId: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const snapshot = context.snapshot();
    const hand = snapshot?.players[playerId]?.zones.hand ?? [];
    const movedCard = hand.find((card) => card.instanceId === movedInstanceId);
    if (!movedCard || !context.canControlOwnedCard(playerId, movedCard)) {
      context.setError('You can only reorder your own hand.');
      return;
    }

    const movedInstanceIds = context.selectedDragInstanceIds(playerId, 'hand', movedInstanceId);
    if (movedInstanceIds.length > 1) {
      await this.reorderHandCards(context, playerId, movedInstanceIds, targetInstanceId, placement);
      return;
    }

    const fromIndex = hand.findIndex((card) => card.instanceId === movedInstanceId);
    const toIndex = hand.findIndex((card) => card.instanceId === targetInstanceId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const reordered = [...hand];
    const [moved] = reordered.splice(fromIndex, 1);
    const targetIndex = reordered.findIndex((card) => card.instanceId === targetInstanceId);
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    if (reordered[insertIndex]?.instanceId === movedInstanceId) {
      return;
    }

    reordered.splice(insertIndex, 0, moved);

    await context.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  async moveHandCardByPointer(
    context: GameTableHandContext,
    playerId: string,
    targetPlayerId: string,
    movedInstanceId: string,
    toZone: GameZoneName,
    position?: { x: number; y: number },
    rawZone?: string,
  ): Promise<void> {
    const sourceCard = context.findCard(playerId, 'hand', movedInstanceId);
    if (!sourceCard || !context.canControlOwnedCard(playerId, sourceCard)) {
      context.setError('You can only move your own cards.');
      return;
    }

    const battlefieldPosition = toZone === 'battlefield' && position
      ? context.snapBattlefieldPosition(targetPlayerId, movedInstanceId, position, rawZone)
      : position;
    const movedInstanceIds = context.selectedDragInstanceIds(playerId, 'hand', movedInstanceId);
    if (toZone === 'battlefield' && rawZone === 'mana') {
      context.markPendingManaDrop(targetPlayerId, movedInstanceIds);
    }
    if (toZone === 'library') {
      context.setPendingLibraryMove({
        cardName: movedInstanceIds.length > 1 ? `${movedInstanceIds.length} cards` : sourceCard.name,
        commandType: movedInstanceIds.length > 1 ? 'cards.moved' : 'card.moved',
        payload: {
          playerId,
          fromZone: 'hand',
          toZone: 'library',
          ...(movedInstanceIds.length > 1 ? { instanceIds: movedInstanceIds } : { instanceId: movedInstanceId }),
        },
      });
      context.clearSelectedCards();
      return;
    }
    if (movedInstanceIds.length > 1) {
      await this.moveSelectedHandCardsByPointer(context, playerId, targetPlayerId, movedInstanceIds, toZone, battlefieldPosition);
      return;
    }

    const landStackMove = toZone === 'battlefield' && position && targetPlayerId === playerId
      ? this.handLandStackMove(context, playerId, sourceCard, position)
      : null;
    const attachmentStackMove = !landStackMove && toZone === 'battlefield' && position && targetPlayerId === playerId
      ? this.handAttachmentStackMove(context, playerId, sourceCard, position)
      : null;
    const resolvedBattlefieldPosition = landStackMove
      ? context.snapBattlefieldPosition(targetPlayerId, movedInstanceId, landStackMove.position, 'mana')
      : attachmentStackMove
        ? context.snapBattlefieldPosition(targetPlayerId, movedInstanceId, attachmentStackMove.position)
      : battlefieldPosition;

    const payload: Record<string, unknown> = {
      playerId,
      fromZone: 'hand',
      toZone,
      targetPlayerId,
      instanceId: movedInstanceId,
    };
    if (toZone === 'battlefield' && resolvedBattlefieldPosition) {
      payload['position'] = resolvedBattlefieldPosition;
    }

    if (toZone === 'battlefield' && targetPlayerId !== playerId) {
      context.markPendingTransfer(playerId, 'hand', [movedInstanceId]);
      context.setPendingBattlefieldMove({
        cardName: sourceCard.name,
        targetPlayerName: context.playerName(targetPlayerId),
        payload,
      });
      context.clearSelectedCards();
      return;
    }

    if (toZone === 'battlefield') {
      context.markPendingBattlefieldEntry(targetPlayerId, [movedInstanceId]);
      context.moveLocalCardsFromHandToBattlefield(playerId, targetPlayerId, [movedInstanceId], resolvedBattlefieldPosition);
      if (landStackMove) {
        window.requestAnimationFrame(() => this.motion?.pulseLandStack(landStackMove.animatedInstanceIds, 'stack'));
      }
      if (attachmentStackMove) {
        window.requestAnimationFrame(() => this.motion?.pulseLandStack(attachmentStackMove.animatedInstanceIds, 'stack'));
      }
    }

    await context.command('card.moved', payload);
    if (attachmentStackMove) {
      await context.command('attachment.created', {
        equipmentInstanceId: movedInstanceId,
        attachedToInstanceId: attachmentStackMove.targetInstanceId,
      });
    }
    await context.recordCommanderCastIfNeeded(playerId, 'hand', toZone, targetPlayerId);
    context.clearSelectedCards();
  }

  private handLandStackMove(
    context: GameTableHandContext,
    playerId: string,
    sourceCard: GameCardInstance,
    dropPosition: { x: number; y: number },
  ): { readonly position: { x: number; y: number }; readonly animatedInstanceIds: readonly string[] } | null {
    const snapshot = context.snapshot();
    const battlefield = snapshot?.players[playerId]?.zones.battlefield ?? [];
    const battlefieldContext = context.battlefieldDragContext();
    const droppedCard = { ...sourceCard, zone: 'battlefield' as const, position: dropPosition };
    const target = landStackDropTarget(
      [...battlefield, droppedCard],
      sourceCard.instanceId,
      dropPosition,
      (card) => {
        if (card.instanceId === sourceCard.instanceId) {
          return dropPosition;
        }

        return battlefieldContext.cardPosition(card);
      },
      attachmentRelationInstanceIds(snapshot?.attachments ?? []),
    );
    if (!target) {
      return null;
    }

    const moves = createLandStackMoves(target, droppedCard, this.handLandStackTopPosition(target));
    const droppedMove = moves.find((move) => move.card.instanceId === sourceCard.instanceId);
    if (!droppedMove) {
      return null;
    }

    return {
      position: droppedMove.position,
      animatedInstanceIds: [
        ...(target.targetStack ? target.targetStack.members.map((member) => member.card.instanceId) : [target.targetCard.instanceId]),
        sourceCard.instanceId,
      ],
    };
  }

  private handLandStackTopPosition(target: LandStackDropTarget): { x: number; y: number } {
    return target.targetPosition;
  }

  private handAttachmentStackMove(
    context: GameTableHandContext,
    playerId: string,
    sourceCard: GameCardInstance,
    dropPosition: { x: number; y: number },
  ): { readonly position: { x: number; y: number }; readonly targetInstanceId: string; readonly animatedInstanceIds: readonly string[] } | null {
    const snapshot = context.snapshot();
    const battlefield = snapshot?.players[playerId]?.zones.battlefield ?? [];
    const battlefieldContext = context.battlefieldDragContext();
    const droppedCard = { ...sourceCard, zone: 'battlefield' as const, position: dropPosition };
    const cards = [...battlefield, droppedCard];
    const target = attachmentDropTarget(cards, snapshot?.attachments ?? [], sourceCard.instanceId, dropPosition, (card) => {
      if (card.instanceId === sourceCard.instanceId) {
        return dropPosition;
      }

      return battlefieldContext.cardPosition(card);
    });
    if (!target) {
      return null;
    }

    const moves = createAttachmentStackMoves(
      cards,
      snapshot?.attachments ?? [],
      sourceCard.instanceId,
      target.targetCard.instanceId,
      (card) => {
        if (card.instanceId === sourceCard.instanceId) {
          return dropPosition;
        }

        return battlefieldContext.cardPosition(card);
      },
    );
    const droppedMove = moves.find((move) => move.instanceId === sourceCard.instanceId);
    if (!droppedMove) {
      return null;
    }

    return {
      position: droppedMove.position,
      targetInstanceId: target.targetCard.instanceId,
      animatedInstanceIds: [
        target.targetCard.instanceId,
        ...moves.map((move) => move.instanceId),
      ],
    };
  }

  private async reorderHandCards(
    context: GameTableHandContext,
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
    if (movedCards.length !== movedIds.size || movedCards.some((card) => !context.canControlOwnedCard(playerId, card))) {
      context.setError('You can only reorder your own hand.');
      return;
    }

    const withoutMoved = hand.filter((card) => !movedIds.has(card.instanceId));
    const targetIndex = withoutMoved.findIndex((card) => card.instanceId === targetInstanceId);
    if (targetIndex < 0) {
      return;
    }

    const reordered = [...withoutMoved];
    reordered.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, ...movedCards);
    await context.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }

  private async moveSelectedHandCardsByPointer(
    context: GameTableHandContext,
    playerId: string,
    targetPlayerId: string,
    movedInstanceIds: readonly string[],
    toZone: GameZoneName,
    position?: GameCardPosition,
  ): Promise<void> {
    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedCards = movedInstanceIds
      .map((instanceId) => hand.find((card) => card.instanceId === instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));
    if (movedCards.length !== movedInstanceIds.length || movedCards.some((card) => !context.canControlOwnedCard(playerId, card))) {
      context.setError('You can only move your own cards.');
      return;
    }

    if (toZone === 'battlefield' && targetPlayerId !== playerId) {
      context.markPendingTransfer(playerId, 'hand', movedInstanceIds);
      context.setPendingBattlefieldMove({
        cardName: `${movedCards.length} cards`,
        targetPlayerName: context.playerName(targetPlayerId),
        commandType: 'cards.moved',
        payload: {
          playerId,
          fromZone: 'hand',
          toZone,
          targetPlayerId,
          instanceIds: movedInstanceIds,
        },
      });
      context.clearSelectedCards();
      return;
    }

    if (toZone === 'battlefield' && position) {
      context.markPendingBattlefieldEntry(targetPlayerId, movedInstanceIds);
      context.moveLocalCardsFromHandToBattlefield(playerId, targetPlayerId, movedInstanceIds, position);
      for (const instanceId of movedInstanceIds) {
        await context.command('card.moved', {
          playerId,
          fromZone: 'hand',
          toZone,
          targetPlayerId,
          instanceId,
          position,
        });
      }
      context.clearSelectedCards();
      return;
    }

    await context.command('cards.moved', {
      playerId,
      fromZone: 'hand',
      toZone,
      targetPlayerId,
      instanceIds: movedInstanceIds,
    });
    context.clearSelectedCards();
  }
}
