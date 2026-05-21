import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCardPosition, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { HandDropPreview } from '../state/drag-drop/game-table-battlefield-drag.state';
import { GameTableBattlefieldDragContext, GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { MarkPendingTransferOptions, PendingBattlefieldMove, PendingLibraryMove } from './game-table-drop-actions.service';
import {
  createLandStackMoves,
  detachLandStackMoves,
  fullLandStackDropTarget,
  LandStackDetachSource,
  buildLandStackGroups,
  isLandCard,
  landStackOffsetX,
  landStackOffsetY,
  landStackDropTarget,
  landStackGroupContaining,
} from '../utils/land-stack';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from '../utils/battlefield-position';
import { GameTableMotionService } from './game-table-motion.service';
import {
  AttachmentStackDetachSource,
  attachmentDropTarget,
  attachmentRelationInstanceIds,
  createAttachmentStackMoves,
  detachAttachmentStackMoves,
} from '../utils/attachment-stack';

type BattlefieldSelection = { playerId: string; zone: GameZoneName; card: GameCardInstance };
type BattlefieldSelectionMove = { item: BattlefieldSelection; position: { x: number; y: number } };

export interface GameTablePointerDragActionContext {
  zones: readonly GameZoneName[];
  snapshot(): GameSnapshot | null;
  handDropPreview(): HandDropPreview | null;
  selectedCards(): readonly BattlefieldSelection[];
  battlefieldDragContext(): GameTableBattlefieldDragContext;
  alignmentGuideY(playerId: string): number | null;
  isManaLaneHighlighted(playerId: string): boolean;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  cardPosition(card: GameCardInstance): { x: number; y: number } | null;
  landStackDetachSource(): LandStackDetachSource | null;
  attachmentStackDetachSource(): AttachmentStackDetachSource | null;
  canControlPlayer(playerId: string): boolean;
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  playerName(playerId: string): string;
  battlefieldPosition(playerId: string, instanceId: string, position: { x: number; y: number }): GameCardPosition;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
  setPendingBattlefieldMove(move: PendingBattlefieldMove): void;
  setPendingLibraryMove(move: PendingLibraryMove): void;
  endCardDrag(): void;
  clearSelectedCards(): void;
  suppressCardPreview(): void;
  setError(message: string): void;
  applyDeferredRemoteSnapshot(): void;
  refetch(force?: boolean): Promise<void>;
  markPendingManaDrop(playerId: string, instanceIds: readonly string[]): void;
  markPendingTransfer(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[], options?: MarkPendingTransferOptions): void;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTablePointerDragActionsService {
  private readonly drag = inject(GameTableDragService);
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
  private readonly motion = inject(GameTableMotionService, { optional: true });

  async endCardPointerDrag(context: GameTablePointerDragActionContext, event?: PointerEvent): Promise<void> {
    const drag = this.drag.endCardPointerDrag(
      event,
      (pointerEvent, playerId) => this.battlefieldDrag.pointerDropZone(pointerEvent, playerId, context.battlefieldDragContext()),
      (playerId, instanceId, position) => context.updateLocalCardPosition(playerId, instanceId, position),
    );
    const activeGuideY = drag ? context.alignmentGuideY(drag.playerId) : null;
    const targetPlayerId = event && drag ? this.battlefieldDrag.playerDropTargetAt(event, drag.playerId) : null;
    const handPreview = drag?.dropZone === 'hand' ? context.handDropPreview() : null;
    const dragGroup = drag ? this.selectedBattlefieldDragGroup(context, drag.playerId, drag.instanceId) : [];
    const instanceIds = dragGroup.length > 0 ? dragGroup.map((item) => item.card.instanceId) : drag ? [drag.instanceId] : [];
    const detachSource = drag ? context.landStackDetachSource() : null;
    const attachmentDetachSource = drag ? context.attachmentStackDetachSource() : null;
    const isDetachingLandStackCard = Boolean(drag && detachSource);
    const isDetachingAttachmentStackCard = Boolean(drag && attachmentDetachSource);
    const draggingWholeLandStack = Boolean(drag && this.isDraggingWholeLandStack(context, drag.playerId, drag.instanceId, instanceIds));

    if (!drag || !drag.moved) {
      context.endCardDrag();
      context.applyDeferredRemoteSnapshot();
      return;
    }

    if (draggingWholeLandStack && (targetPlayerId || !drag.dropZone || drag.dropZone === 'battlefield')) {
      const stackPosition = context.isManaLaneHighlighted(drag.playerId)
        ? this.manaLanePositionForDrag(drag.playerId, drag.position)
        : drag.position;
      await this.moveSelectedBattlefieldPositions(context, dragGroup, drag.instanceId, stackPosition, false);
      context.endCardDrag();
      context.clearSelectedCards();
      context.applyDeferredRemoteSnapshot();
      context.suppressCardPreview();
      return;
    }

    if (targetPlayerId) {
      this.prepareBattlefieldTransfer(context, drag.playerId, instanceIds, targetPlayerId);
      context.endCardDrag();
      context.clearSelectedCards();
      return;
    }

    if (drag.dropZone && drag.dropZone !== 'battlefield') {
      if (!context.canControlPlayer(drag.playerId)) {
        context.endCardDrag();
        context.applyDeferredRemoteSnapshot();
        return;
      }
      if (drag.dropZone === 'library') {
        this.prepareLibraryMove(context, drag.playerId, instanceIds);
        context.endCardDrag();
        context.clearSelectedCards();
        context.applyDeferredRemoteSnapshot();
        return;
      }
      const shouldApplyOwnHandPreview = drag.dropZone === 'hand'
        && this.cardsReturnToSamePlayer(context, drag.playerId, instanceIds);
      this.notifyBorrowedCardsReturnToOwner(context, drag.playerId, drag.dropZone, instanceIds);
      context.markPendingTransfer(drag.playerId, 'battlefield', instanceIds);
      context.endCardDrag();
      context.clearSelectedCards();
      await this.moveBattlefieldCardsToZone(context, drag.playerId, instanceIds, drag.dropZone);
      if (shouldApplyOwnHandPreview) {
        await this.applyHandDropPreview(context, drag.playerId, instanceIds, handPreview);
      }
      context.suppressCardPreview();
      context.applyDeferredRemoteSnapshot();
      return;
    }

    if (!drag.dropZone && (!event || !this.battlefieldDrag.isPointerInsidePlayerBattlefield(event, drag.playerId))) {
      context.endCardDrag();
      context.clearSelectedCards();
      await context.refetch(true);
      context.applyDeferredRemoteSnapshot();
      return;
    }

    if (!isDetachingLandStackCard && !isDetachingAttachmentStackCard && dragGroup.length <= 1 && await this.tryCreateLandStack(context, drag.playerId, drag.instanceId, drag.position)) {
      context.endCardDrag();
      context.clearSelectedCards();
      context.applyDeferredRemoteSnapshot();
      context.suppressCardPreview();
      return;
    }

    if (!isDetachingLandStackCard && !isDetachingAttachmentStackCard && dragGroup.length <= 1 && this.isBlockedFullLandStackDrop(context, drag.playerId, drag.instanceId, drag.position)) {
      context.endCardDrag();
      context.clearSelectedCards();
      await context.refetch(true);
      context.applyDeferredRemoteSnapshot();
      context.suppressCardPreview();
      return;
    }

    if (!isDetachingLandStackCard && !isDetachingAttachmentStackCard && dragGroup.length <= 1 && await this.tryCreateAttachmentStack(context, drag.playerId, drag.instanceId, drag.position)) {
      context.endCardDrag();
      context.clearSelectedCards();
      context.applyDeferredRemoteSnapshot();
      context.suppressCardPreview();
      return;
    }

    const detachedManaDrop = (isDetachingLandStackCard || isDetachingAttachmentStackCard) && context.isManaLaneHighlighted(drag.playerId);
    const manaDrop = !isDetachingLandStackCard && !isDetachingAttachmentStackCard && context.isManaLaneHighlighted(drag.playerId);
    if (manaDrop) {
      context.markPendingManaDrop(drag.playerId, instanceIds);
    }

    const detachedDropPosition = isDetachingLandStackCard
      ? this.detachedLandStackDropPosition(drag, detachSource, event)
      : drag.position;
    const detachedAttachmentDropPosition = isDetachingAttachmentStackCard
      ? this.detachedAttachmentStackDropPosition(drag, attachmentDetachSource, event)
      : drag.position;
    if (isDetachingLandStackCard && detachSource) {
      const movedToStack = await this.tryMoveDetachedLandStackCardToLandStack(
        context,
        drag.playerId,
        drag.instanceId,
        detachedDropPosition,
        detachSource,
      );
      if (movedToStack) {
        context.endCardDrag();
        context.clearSelectedCards();
        context.applyDeferredRemoteSnapshot();
        context.suppressCardPreview();
        return;
      }
    }

    const position = manaDrop
      ? this.manaLanePositionForDrag(drag.playerId, drag.position)
      : isDetachingLandStackCard
        ? detachedManaDrop
          ? this.manaLanePositionForDrag(drag.playerId, detachedDropPosition)
          : this.battlefieldDrag.positionWithAlignmentGuide(
            context.battlefieldDragContext(),
            drag.playerId,
            drag.instanceId,
            detachedDropPosition,
            activeGuideY,
          )
        : isDetachingAttachmentStackCard
          ? detachedManaDrop
            ? this.manaLanePositionForDrag(drag.playerId, detachedAttachmentDropPosition)
            : this.battlefieldDrag.positionWithAlignmentGuide(
              context.battlefieldDragContext(),
              drag.playerId,
              drag.instanceId,
              detachedAttachmentDropPosition,
              activeGuideY,
            )
      : this.battlefieldDrag.positionWithAlignmentGuide(
        context.battlefieldDragContext(),
        drag.playerId,
        drag.instanceId,
        drag.position,
        activeGuideY,
      );

    if (dragGroup.length > 1) {
      await this.moveSelectedBattlefieldPositions(context, dragGroup, drag.instanceId, position, manaDrop);
    } else if (isDetachingLandStackCard && detachSource) {
      await this.moveDetachedLandStackCard(context, drag, detachSource, position);
    } else if (isDetachingAttachmentStackCard && attachmentDetachSource) {
      await this.moveDetachedAttachmentStackCard(context, drag, attachmentDetachSource, position);
    } else {
      await context.command('card.position.changed', {
        playerId: drag.playerId,
        zone: 'battlefield',
        instanceId: drag.instanceId,
        position: context.battlefieldPosition(drag.playerId, drag.instanceId, position),
      });
    }
    context.endCardDrag();
    context.clearSelectedCards();
    context.applyDeferredRemoteSnapshot();
    context.suppressCardPreview();
  }

  private async tryCreateLandStack(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
  ): Promise<boolean> {
    const battlefield = context.snapshot()?.players[playerId]?.zones.battlefield ?? [];
    const dragged = battlefield.find((card) => card.instanceId === draggedInstanceId);
    if (!dragged || !context.canControlOwnedCard(playerId, dragged)) {
      return false;
    }

    const target = landStackDropTarget(
      battlefield,
      draggedInstanceId,
      draggedPosition,
      context.cardPosition,
      attachmentRelationInstanceIds(context.snapshot()?.attachments ?? []),
    );
    if (!target) {
      return false;
    }

    const stackTopPosition = target.nextSize === 3 && this.battlefieldDrag.isManaLanePosition(playerId, target.targetPosition)
      ? this.manaLanePositionForDrag(playerId, target.targetPosition)
      : target.targetPosition;
    const moves = createLandStackMoves(target, dragged, stackTopPosition);
    if (moves.length === 0) {
      return false;
    }

    for (const move of moves) {
      context.updateLocalCardPosition(playerId, move.card.instanceId, move.position);
    }

    const animatedInstanceIds = this.landStackPulseInstanceIds(
      target.targetStack ? target.targetStack.members.map((member) => member.card.instanceId) : [target.targetCard.instanceId],
      moves.map((move) => move.card.instanceId),
    );
    window.requestAnimationFrame(() => this.motion?.pulseLandStack(animatedInstanceIds, 'stack'));

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(context, playerId, moves));

    return true;
  }

  private isDraggingWholeLandStack(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
    instanceIds: readonly string[],
  ): boolean {
    if (instanceIds.length <= 1) {
      return false;
    }

    const selectedCards = context.selectedCards()
      .filter((item) => item.playerId === playerId && item.zone === 'battlefield' && instanceIds.includes(item.card.instanceId))
      .map((item) => item.card);
    if (selectedCards.length === instanceIds.length && this.cardsFormDraggedLandStack(selectedCards, draggedInstanceId, instanceIds, context.cardPosition)) {
      return true;
    }

    const battlefield = context.snapshot()?.players[playerId]?.zones.battlefield ?? [];
    return this.cardsFormDraggedLandStack(battlefield, draggedInstanceId, instanceIds, context.cardPosition);
  }

  private cardsFormDraggedLandStack(
    cards: readonly GameCardInstance[],
    draggedInstanceId: string,
    instanceIds: readonly string[],
    positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  ): boolean {
    const group = landStackGroupContaining(buildLandStackGroups(cards, positionFor), draggedInstanceId);
    if (!group || group.topCard.instanceId !== draggedInstanceId || group.members.length !== instanceIds.length) {
      return false;
    }

    return group.members.every((member) => instanceIds.includes(member.card.instanceId));
  }

  private async tryMoveDetachedLandStackCardToLandStack(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
    detachSource: LandStackDetachSource,
  ): Promise<boolean> {
    const battlefield = context.snapshot()?.players[playerId]?.zones.battlefield ?? [];
    const dragged = battlefield.find((card) => card.instanceId === draggedInstanceId);
    if (!dragged || !context.canControlOwnedCard(playerId, dragged)) {
      return false;
    }

    const target = landStackDropTarget(
      battlefield,
      draggedInstanceId,
      draggedPosition,
      context.cardPosition,
      attachmentRelationInstanceIds(context.snapshot()?.attachments ?? []),
    );
    if (!target || this.isOriginalDetachStackTarget(detachSource, target.targetCard.instanceId)) {
      return false;
    }

    const stackTopPosition = target.nextSize === 3 && this.battlefieldDrag.isManaLanePosition(playerId, target.targetPosition)
      ? this.manaLanePositionForDrag(playerId, target.targetPosition)
      : target.targetPosition;
    const stackMoves = createLandStackMoves(target, dragged, stackTopPosition);
    if (stackMoves.length === 0) {
      return false;
    }

    const compactMoves = detachLandStackMoves(detachSource);
    const moves = [
      ...stackMoves.map((move) => ({ instanceId: move.card.instanceId, position: move.position })),
      ...compactMoves.filter((move) => !stackMoves.some((stackMove) => stackMove.card.instanceId === move.instanceId)),
    ];

    for (const move of moves) {
      context.updateLocalCardPosition(playerId, move.instanceId, move.position);
    }

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(context, playerId, moves));

    this.motion?.pulseLandStack(
      this.landStackPulseInstanceIds(
        target.targetStack ? target.targetStack.members.map((member) => member.card.instanceId) : [target.targetCard.instanceId],
        moves.map((move) => move.instanceId),
      ),
      'detach',
    );

    return true;
  }

  private isOriginalDetachStackTarget(detachSource: LandStackDetachSource, targetInstanceId: string): boolean {
    return detachSource.members
      .filter((member) => member.instanceId !== detachSource.detachedInstanceId)
      .some((member) => member.instanceId === targetInstanceId);
  }

  private landStackPulseInstanceIds(visibleStackInstanceIds: readonly string[], movedInstanceIds: readonly string[]): readonly string[] {
    return [...new Set([...visibleStackInstanceIds, ...movedInstanceIds])];
  }

  private detachedLandStackDropPosition(
    drag: {
      instanceId: string;
      position: { x: number; y: number };
      previewPosition?: { x: number; y: number };
      battlefield: HTMLElement;
    },
    detachSource: LandStackDetachSource | null,
    event: PointerEvent | undefined,
  ): { x: number; y: number } {
    const origin = detachSource?.members.find((member) => member.instanceId === drag.instanceId);
    if (drag.previewPosition && (!origin || !this.samePosition(drag.previewPosition, origin))) {
      return drag.previewPosition;
    }

    return event ? this.drag.pointerPosition(event, drag.battlefield) : drag.position;
  }

  private detachedAttachmentStackDropPosition(
    drag: {
      instanceId: string;
      position: { x: number; y: number };
      previewPosition?: { x: number; y: number };
      battlefield: HTMLElement;
    },
    detachSource: AttachmentStackDetachSource | null,
    event: PointerEvent | undefined,
  ): { x: number; y: number } {
    const origin = detachSource?.members.find((member) => member.instanceId === drag.instanceId);
    if (drag.previewPosition && (!origin || !this.samePosition(drag.previewPosition, origin))) {
      return drag.previewPosition;
    }

    return event ? this.drag.pointerPosition(event, drag.battlefield) : drag.position;
  }

  private samePosition(position: { x: number; y: number }, origin: { x: number; y: number }): boolean {
    return Math.abs(position.x - origin.x) <= 1 && Math.abs(position.y - origin.y) <= 1;
  }

  private isBlockedFullLandStackDrop(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
  ): boolean {
    const battlefield = context.snapshot()?.players[playerId]?.zones.battlefield ?? [];

    return fullLandStackDropTarget(battlefield, draggedInstanceId, draggedPosition, context.cardPosition) !== null;
  }

  private async tryCreateAttachmentStack(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
  ): Promise<boolean> {
    const snapshot = context.snapshot();
    const battlefield = snapshot?.players[playerId]?.zones.battlefield ?? [];
    const dragged = battlefield.find((card) => card.instanceId === draggedInstanceId);
    if (!dragged || !context.canControlOwnedCard(playerId, dragged)) {
      return false;
    }

    const target = attachmentDropTarget(
      battlefield,
      snapshot?.attachments ?? [],
      draggedInstanceId,
      draggedPosition,
      context.cardPosition,
    );
    if (!target) {
      return false;
    }

    const moves = createAttachmentStackMoves(
      battlefield,
      snapshot?.attachments ?? [],
      draggedInstanceId,
      target.targetCard.instanceId,
      context.cardPosition,
    );
    if (moves.length === 0) {
      return false;
    }

    for (const move of moves) {
      context.updateLocalCardPosition(playerId, move.instanceId, move.position);
    }

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(context, playerId, moves));
    await context.command('attachment.created', {
      equipmentInstanceId: draggedInstanceId,
      attachedToInstanceId: target.targetCard.instanceId,
    });

    window.requestAnimationFrame(() => this.motion?.pulseLandStack(
      moves.map((move) => move.instanceId),
      'stack',
    ));

    return true;
  }

  private async moveDetachedLandStackCard(
    context: GameTablePointerDragActionContext,
    drag: { playerId: string; instanceId: string },
    detachSource: LandStackDetachSource,
    detachedPosition: { x: number; y: number },
  ): Promise<void> {
    const compactMoves = detachLandStackMoves(detachSource);
    const moves = [
      { instanceId: drag.instanceId, position: detachedPosition },
      ...compactMoves,
    ];

    for (const move of moves) {
      context.updateLocalCardPosition(drag.playerId, move.instanceId, move.position);
    }

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(context, drag.playerId, moves));

    this.motion?.pulseLandStack(moves.map((move) => move.instanceId), 'detach');
  }

  private async moveDetachedAttachmentStackCard(
    context: GameTablePointerDragActionContext,
    drag: { playerId: string; instanceId: string },
    detachSource: AttachmentStackDetachSource,
    detachedPosition: { x: number; y: number },
  ): Promise<void> {
    const compactMoves = detachAttachmentStackMoves(detachSource);
    const moves = [
      { instanceId: drag.instanceId, position: detachedPosition },
      ...compactMoves,
    ];

    for (const move of moves) {
      context.updateLocalCardPosition(drag.playerId, move.instanceId, move.position);
    }

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(context, drag.playerId, moves));
    await context.command('attachment.removed', { id: detachSource.attachmentId });

    this.motion?.pulseLandStack(moves.map((move) => move.instanceId), 'detach');
  }

  private prepareBattlefieldTransfer(
    context: GameTablePointerDragActionContext,
    playerId: string,
    instanceIds: readonly string[],
    targetPlayerId: string,
  ): void {
    const sourceCard = context.findCard(playerId, 'battlefield', instanceIds[0] ?? '');
    if (!sourceCard || !context.canControlOwnedCard(playerId, sourceCard)) {
      return;
    }

    context.setPendingBattlefieldMove({
      cardName: instanceIds.length > 1 ? `${instanceIds.length} cards` : sourceCard.name,
      targetPlayerName: context.playerName(targetPlayerId),
      commandType: instanceIds.length > 1 ? 'cards.moved' : 'card.moved',
      payload: {
        playerId,
        fromZone: 'battlefield',
        toZone: 'battlefield',
        targetPlayerId,
        ...(instanceIds.length > 1 ? { instanceIds } : { instanceId: instanceIds[0] }),
      },
    });
    context.markPendingTransfer(playerId, 'battlefield', instanceIds, { expires: false });
  }

  private async moveBattlefieldCardsToZone(
    context: GameTablePointerDragActionContext,
    playerId: string,
    instanceIds: readonly string[],
    toZone: GameZoneName,
  ): Promise<void> {
    if (instanceIds.length > 1) {
      await context.command('cards.moved', {
        playerId,
        fromZone: 'battlefield',
        toZone,
        instanceIds,
      });
      return;
    }

    await context.command('card.moved', {
      playerId,
      fromZone: 'battlefield',
      toZone,
      instanceId: instanceIds[0],
    });
  }

  private prepareLibraryMove(
    context: GameTablePointerDragActionContext,
    playerId: string,
    instanceIds: readonly string[],
  ): void {
    const sourceCard = context.findCard(playerId, 'battlefield', instanceIds[0] ?? '');
    if (!sourceCard || !context.canControlOwnedCard(playerId, sourceCard)) {
      return;
    }

    context.setPendingLibraryMove({
      cardName: instanceIds.length > 1 ? `${instanceIds.length} cards` : sourceCard.name,
      commandType: instanceIds.length > 1 ? 'cards.moved' : 'card.moved',
      payload: {
        playerId,
        fromZone: 'battlefield',
        toZone: 'library',
        ...(instanceIds.length > 1 ? { instanceIds } : { instanceId: instanceIds[0] }),
      },
    });
    context.markPendingTransfer(playerId, 'battlefield', instanceIds, { expires: false });
    context.suppressCardPreview();
  }

  private async moveSelectedBattlefieldPositions(
    context: GameTablePointerDragActionContext,
    selected: readonly BattlefieldSelection[],
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
    alignY = false,
  ): Promise<void> {
    const dragged = selected.find((item) => item.card.instanceId === draggedInstanceId);
    const origin = dragged ? context.cardPosition(dragged.card) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const delta = {
      x: draggedPosition.x - origin.x,
      y: draggedPosition.y - origin.y,
    };
    const shouldAlignY = alignY && !this.isMovingWholeLandStack(selected, draggedInstanceId);

    const moves = this.wholeLandStackMoves(context, selected, draggedInstanceId, draggedPosition) ?? selected.map((item) => {
      const current = context.cardPosition(item.card) ?? { x: 0, y: 0 };
      return {
        item,
        position: {
          x: Math.max(0, current.x + delta.x),
          y: shouldAlignY ? draggedPosition.y : Math.max(0, current.y + delta.y),
        },
      };
    });

    for (const move of moves) {
      context.updateLocalCardPosition(move.item.playerId, move.item.card.instanceId, move.position);
    }

    const firstPlayerId = moves[0]?.item.playerId;
    if (!firstPlayerId) {
      return;
    }

    await context.command('cards.position.changed', this.battlefieldPositionsPayload(
      context,
      firstPlayerId,
      moves.map((move) => ({
        instanceId: move.item.card.instanceId,
        position: move.position,
      })),
    ));
  }

  private wholeLandStackMoves(
    context: GameTablePointerDragActionContext,
    selected: readonly BattlefieldSelection[],
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
  ): readonly BattlefieldSelectionMove[] | null {
    if (!this.isMovingWholeLandStack(selected, draggedInstanceId)) {
      return null;
    }

    const groups = buildLandStackGroups(selected.map((item) => item.card), context.cardPosition);
    const group = landStackGroupContaining(groups, draggedInstanceId);
    const draggedMember = group?.members.find((member) => member.card.instanceId === draggedInstanceId);
    if (!group || !draggedMember) {
      return null;
    }

    const selectedById = new Map(selected.map((item) => [item.card.instanceId, item]));
    const topPosition = {
      x: draggedPosition.x - landStackOffsetX() * draggedMember.layer,
      y: draggedPosition.y + landStackOffsetY() * draggedMember.layer,
    };

    return group.members.map((member) => {
      const item = selectedById.get(member.card.instanceId);

      return item
        ? {
            item,
            position: {
              x: Math.max(0, topPosition.x + landStackOffsetX() * member.layer),
              y: Math.max(0, topPosition.y - landStackOffsetY() * member.layer),
            },
          }
        : null;
    }).filter((move): move is BattlefieldSelectionMove => move !== null);
  }

  private battlefieldPositionsPayload(
    context: GameTablePointerDragActionContext,
    playerId: string,
    moves: readonly { instanceId?: string; card?: GameCardInstance; position: { x: number; y: number } }[],
  ): Record<string, unknown> {
    return {
      playerId,
      zone: 'battlefield',
      positions: moves.map((move) => {
        const instanceId = move.instanceId ?? move.card?.instanceId ?? '';

        return {
          instanceId,
          position: context.battlefieldPosition(playerId, instanceId, move.position),
        };
      }),
    };
  }

  private manaLanePositionForDrag(
    playerId: string,
    position: { x: number; y: number },
  ): { x: number; y: number } {
    return this.battlefieldDrag.positionWithManaLaneBottom(
      playerId,
      position,
      DEFAULT_BATTLEFIELD_CARD_SIZE.height,
    );
  }

  private isMovingWholeLandStack(
    selected: readonly BattlefieldSelection[],
    draggedInstanceId: string,
  ): boolean {
    const first = selected[0];
    if (!first || selected.length < 2 || selected.length > 3) {
      return false;
    }

    return selected.some((item) => item.card.instanceId === draggedInstanceId)
      && selected.every((item) => item.playerId === first.playerId && item.zone === 'battlefield' && isLandCard(item.card));
  }

  private selectedBattlefieldDragGroup(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
  ): readonly BattlefieldSelection[] {
    const selected = context.selectedCards();
    const canUseSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === draggedInstanceId)
      && selected.every((item) => item.playerId === playerId && item.zone === 'battlefield');

    if (!canUseSelection) {
      return [];
    }

    return selected.filter((item) => context.canControlOwnedCard(item.playerId, item.card));
  }

  private cardsReturnToSamePlayer(
    context: GameTablePointerDragActionContext,
    playerId: string,
    instanceIds: readonly string[],
  ): boolean {
    return instanceIds.every((instanceId) => {
      const card = context.findCard(playerId, 'battlefield', instanceId);

      return card !== null && (card.ownerId ?? playerId) === playerId;
    });
  }

  private notifyBorrowedCardsReturnToOwner(
    context: Pick<GameTablePointerDragActionContext, 'findCard' | 'playerName' | 'setError'>,
    controllerId: string,
    toZone: GameZoneName,
    instanceIds: readonly string[],
  ): void {
    if (toZone === 'battlefield') {
      return;
    }

    const cards = instanceIds
      .map((instanceId) => context.findCard(controllerId, 'battlefield', instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));
    const ownerIds = [...new Set(
      cards
        .map((card) => card.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId) && ownerId !== controllerId),
    )];
    if (ownerIds.length === 0) {
      return;
    }

    const ownerLabel = ownerIds.length === 1 ? context.playerName(ownerIds[0]!) : 'their deck owners';
    const cardLabel = cards.length === 1 ? 'This borrowed card' : 'Borrowed cards';
    context.setError(`${cardLabel} will return to ${ownerLabel}'s ${toZone}.`);
  }

  private async applyHandDropPreview(
    context: GameTablePointerDragActionContext,
    playerId: string,
    movedInstanceIds: readonly string[],
    preview: HandDropPreview | null,
  ): Promise<void> {
    const movedIds = new Set(movedInstanceIds);
    if (preview?.playerId !== playerId || movedIds.has(preview.targetInstanceId)) {
      return;
    }

    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const movedCards = hand.filter((card) => movedIds.has(card.instanceId));
    if (movedCards.length !== movedIds.size) {
      return;
    }

    const withoutMoved = hand.filter((card) => !movedIds.has(card.instanceId));
    const targetIndex = withoutMoved.findIndex((card) => card.instanceId === preview.targetInstanceId);
    if (targetIndex < 0) {
      return;
    }

    const reordered = [...withoutMoved];
    reordered.splice(preview.placement === 'after' ? targetIndex + 1 : targetIndex, 0, ...movedCards);
    if (hand.length === reordered.length && hand.every((card, index) => card.instanceId === reordered[index]?.instanceId)) {
      return;
    }

    await context.command('zone.changed', {
      playerId,
      zone: 'hand',
      cards: reordered,
    });
  }
}
