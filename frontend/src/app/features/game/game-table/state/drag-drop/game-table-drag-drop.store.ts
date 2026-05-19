import { inject, Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { SelectedCard } from '../../models/game-table-card.model';
import {
  GameTableBattlefieldDragContext,
  GameTableBattlefieldDragCoordinatorService,
} from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import {
  GameTableDropActionContext,
  GameTableDropActionsService,
  PendingBattlefieldMove,
  PendingLibraryMove,
} from '../../services/game-table-drop-actions.service';
import { GameTablePointerDragActionContext, GameTablePointerDragActionsService } from '../../services/game-table-pointer-drag-actions.service';
import { PointerDropTarget } from '../../services/game-table-pointer-drag.service';
import { AlignmentGuide, GameTableBattlefieldDragState } from './game-table-battlefield-drag.state';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';
import { GameTablePendingTransferState } from '../core/game-table-pending-transfer.state';
import { PlayerView } from '../core/game-table-snapshot-selectors';

export interface GameTableDragDropContext {
  readonly zones: readonly GameZoneName[];
  readonly players: () => readonly PlayerView[];
  readonly selectedCards: () => readonly SelectedCard[];
  readonly setSelectedCards: (cards: SelectedCard[]) => void;
  readonly canControlOwnedCard: (playerId: string, card: GameCardInstance) => boolean;
  readonly battlefieldDragContext: () => GameTableBattlefieldDragContext;
  readonly pointerDragActionContext: () => GameTablePointerDragActionContext;
  readonly updateLocalCardPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void;
  readonly hideCardPreview: () => void;
  readonly suppressCardPreview: () => void;
  readonly clearHandDropPreview: () => void;
  readonly setError: (message: string) => void;
  readonly applyDeferredRemoteSnapshot: () => void;
}

export interface GameTablePendingMoveContext {
  readonly refetch: (force: boolean) => Promise<void>;
  readonly setPendingBattlefieldMove: (move: PendingBattlefieldMove | null) => void;
  readonly setPendingLibraryMove: (move: PendingLibraryMove | null) => void;
}

@Injectable()
export class GameTableDragDropStore {
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
  private readonly battlefieldDragState = inject(GameTableBattlefieldDragState);
  private readonly drag = inject(GameTableDragService);
  private readonly dropActions = inject(GameTableDropActionsService);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);
  private readonly pointerDragActions = inject(GameTablePointerDragActionsService);

  readonly draggingCardInstanceId = this.battlefieldDragState.draggingCardInstanceId;
  readonly manaLaneDropPlayerId = this.battlefieldDragState.manaLaneDropPlayerId;
  readonly handExternalRevealAllowed = this.battlefieldDragState.handExternalRevealAllowed;
  readonly alignmentGuide = this.battlefieldDragState.alignmentGuide;
  readonly activeDropTarget = this.battlefieldDragState.activeDropTarget;
  readonly activePlayerDropTarget = this.battlefieldDragState.activePlayerDropTarget;
  readonly pointerDragPreview = this.battlefieldDragState.pointerDragPreview;
  isCardDropSettling(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isCardDropSettling(playerId, zone, card.instanceId);
  }

  isManaDropSettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isManaDropSettling(playerId, card.instanceId);
  }

  isBattlefieldEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isBattlefieldEntrySettling(playerId, card.instanceId);
  }

  isCommanderEntrySettling(playerId: string, card: GameCardInstance): boolean {
    return this.dropFeedbackState.isCommanderEntrySettling(playerId, card.instanceId);
  }

  isZoneDropSettling(playerId: string, zone: GameZoneName): boolean {
    return this.dropFeedbackState.isZoneDropSettling(playerId, zone);
  }

  isCardTransferPending(playerId: string, zone: GameZoneName, card: GameCardInstance): boolean {
    return this.pendingTransferState.isCardPending(playerId, zone, card.instanceId);
  }

  isZoneTransferPending(playerId: string, zone: GameZoneName): boolean {
    return this.pendingTransferState.isZonePending(playerId, zone);
  }

  isManaLaneHighlighted(playerId: string): boolean {
    return this.battlefieldDragState.isManaLaneHighlighted(playerId);
  }

  isDropZoneHighlighted(playerId: string, zone: GameZoneName): boolean {
    return this.battlefieldDragState.isDropZoneHighlighted(playerId, zone);
  }

  isPlayerDropHighlighted(playerId: string): boolean {
    return this.battlefieldDragState.isPlayerDropHighlighted(playerId);
  }

  isPendingBattlefieldTransfer(card: GameCardInstance, pendingBattlefieldMove: PendingBattlefieldMove | null): boolean {
    const payload = pendingBattlefieldMove?.payload;
    const instanceIds = payload?.['instanceIds'];

    return payload?.['instanceId'] === card.instanceId
      || Array.isArray(instanceIds) && instanceIds.includes(card.instanceId);
  }

  alignmentGuideFor(playerId: string): AlignmentGuide | null {
    return this.battlefieldDragState.alignmentGuideFor(playerId);
  }

  clearForceRefreshState(): void {
    this.pendingTransferState.clear();
    this.dropFeedbackState.clearPendingBattlefieldEntries();
  }

  async dropOnZone(
    context: GameTableDropActionContext,
    event: DragEvent,
    targetPlayerId: string,
    toZone: GameZoneName,
  ): Promise<void> {
    await this.dropActions.dropOnZone(context, event, targetPlayerId, toZone);
  }

  async dropOnHand(context: GameTableDropActionContext, event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropActions.dropOnHand(context, event, targetPlayerId);
  }

  async dropOnHandCard(
    context: GameTableDropActionContext,
    event: DragEvent,
    targetPlayerId: string,
    targetCard: GameCardInstance,
  ): Promise<void> {
    await this.dropActions.dropOnHandCard(context, event, targetPlayerId, targetCard);
  }

  async dropOnPlayer(context: GameTableDropActionContext, event: DragEvent, targetPlayerId: string): Promise<void> {
    await this.dropActions.dropOnPlayer(context, event, targetPlayerId);
  }

  async confirmPendingBattlefieldMove(context: GameTableDropActionContext, pendingMove: PendingBattlefieldMove): Promise<void> {
    await this.dropActions.confirmPendingBattlefieldMove(context, pendingMove);
  }

  async confirmPendingLibraryMove(
    context: GameTableDropActionContext,
    pendingMove: PendingLibraryMove,
    position: 'top' | 'bottom',
    randomOrder = false,
  ): Promise<void> {
    await this.dropActions.confirmPendingLibraryMove(context, pendingMove, position, randomOrder);
  }

  async cancelPendingBattlefieldMove(context: GameTablePendingMoveContext): Promise<void> {
    this.pendingTransferState.clear();
    await context.refetch(true);
    context.setPendingBattlefieldMove(null);
  }

  async cancelPendingLibraryMove(context: GameTablePendingMoveContext): Promise<void> {
    this.pendingTransferState.clear();
    await context.refetch(true);
    context.setPendingLibraryMove(null);
  }

  startBattlefieldPointerDrag(context: GameTableDragDropContext, event: PointerEvent, playerId: string, card: GameCardInstance): void {
    if (!context.canControlOwnedCard(playerId, card)) {
      context.setError('You can only move your own cards.');
      return;
    }
    if (event.detail > 1 || event.shiftKey) {
      return;
    }

    this.drag.startBattlefieldPointerDrag(event, playerId, card);
  }

  moveCardPointerDrag(context: GameTableDragDropContext, event: PointerEvent): void {
    const draggingInstanceId = this.drag.moveCardPointerDrag(event, (playerId, instanceId, position) => {
      context.updateLocalCardPosition(playerId, instanceId, position);
    });
    if (draggingInstanceId && this.draggingCardInstanceId() !== draggingInstanceId) {
      this.beginCardDrag(context, draggingInstanceId);
    }
    if (draggingInstanceId) {
      this.ensureDraggingBattlefieldSelection(context, draggingInstanceId);
      this.battlefieldDrag.updateBattlefieldDragAid(event, draggingInstanceId, context.battlefieldDragContext());
      this.battlefieldDrag.updatePointerDropTarget(event, context.battlefieldDragContext());
      this.updatePointerDragPreview(context, draggingInstanceId);
    }
  }

  async endCardPointerDrag(context: GameTableDragDropContext, event?: PointerEvent): Promise<void> {
    await this.pointerDragActions.endCardPointerDrag(context.pointerDragActionContext(), event);
  }

  cancelCardPointerDrag(context: GameTableDragDropContext, event?: PointerEvent): void {
    this.drag.cancelCardPointerDrag(event);
    this.endCardDrag(context);
    context.setSelectedCards([]);
    context.applyDeferredRemoteSnapshot();
  }

  dragStart(context: GameTableDragDropContext, event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    if (!context.canControlOwnedCard(playerId, card)) {
      event.preventDefault();
      context.setError('You can only move your own cards.');
      return;
    }

    this.drag.dragStart(event, playerId, zone, card, this.selectedDragInstanceIds(context, playerId, zone, card.instanceId));
    this.beginCardDrag(context, card.instanceId);
  }

  dragEnd(context: GameTableDragDropContext): void {
    this.endCardDrag(context);
    context.clearHandDropPreview();
    context.setSelectedCards([]);
    context.suppressCardPreview();
  }

  allowDrop(context: GameTableDragDropContext, event: DragEvent): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, context.battlefieldDragContext());
  }

  previewDropOnHand(context: GameTableDragDropContext, event: DragEvent, targetPlayerId: string): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, context.battlefieldDragContext());
    this.battlefieldDrag.updateHandDropPreview(event, targetPlayerId, context.battlefieldDragContext());
  }

  updatePointerDropTarget(context: GameTableDragDropContext, target: PointerDropTarget | null): void {
    this.battlefieldDragState.clearHandDropPreview();
    if (!target) {
      this.battlefieldDragState.clearDropTargets();
      return;
    }

    if (target.rawZone === 'mana') {
      this.battlefieldDragState.setActivePlayerDropTarget(null);
      this.battlefieldDragState.setActiveDropTarget(null);
      this.battlefieldDragState.setManaLaneDropPlayer(target.targetPlayerId);
      this.battlefieldDragState.setAlignmentGuide(null);
      return;
    }

    this.battlefieldDragState.setManaLaneDropPlayer(null);
    if (target.kind === 'player') {
      this.battlefieldDragState.setActivePlayerDropTarget(target.targetPlayerId);
      this.battlefieldDragState.setActiveDropTarget(null);
      return;
    }

    this.battlefieldDragState.setActivePlayerDropTarget(null);
    this.battlefieldDragState.setActiveDropTarget({ playerId: target.targetPlayerId, zone: target.toZone });
    if (target.toZone === 'battlefield') {
      this.battlefieldDrag.updateExternalBattlefieldAlignmentGuide(
        context.battlefieldDragContext(),
        target.targetPlayerId,
        target.draggedInstanceId ?? '',
        target.position,
      );
    } else {
      this.battlefieldDragState.setAlignmentGuide(null);
    }
  }

  beginCardDrag(context: Pick<GameTableDragDropContext, 'hideCardPreview'>, instanceId: string): void {
    context.hideCardPreview();
    this.battlefieldDragState.beginCardDrag(instanceId);
  }

  endCardDrag(context: Pick<GameTableDragDropContext, 'hideCardPreview'>): void {
    context.hideCardPreview();
    this.battlefieldDragState.endCardDrag();
  }

  selectedDragInstanceIds(context: Pick<GameTableDragDropContext, 'selectedCards'>, playerId: string, zone: GameZoneName, instanceId: string): string[] {
    const selected = context.selectedCards();
    const canUseSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === instanceId)
      && selected.every((item) => item.playerId === playerId && item.zone === zone);

    return canUseSelection ? selected.map((item) => item.card.instanceId) : [instanceId];
  }

  private updatePointerDragPreview(context: GameTableDragDropContext, instanceId: string): void {
    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    const preview = this.drag.pointerDragPreview();
    if (!selected || !preview) {
      return;
    }

    this.battlefieldDragState.setPointerDragPreview({
      card: selected.card,
      x: preview.x,
      y: preview.y,
      width: preview.width,
      height: preview.height,
      count: this.selectedDragInstanceIds(context, selected.playerId, 'battlefield', instanceId).length,
    });
  }

  private ensureDraggingBattlefieldSelection(context: GameTableDragDropContext, instanceId: string): void {
    if (context.selectedCards().some((item) => item.card.instanceId === instanceId)) {
      return;
    }

    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    if (selected) {
      context.setSelectedCards([selected]);
    }
  }

  private battlefieldSelectionByInstanceId(context: Pick<GameTableDragDropContext, 'players'>, instanceId: string): SelectedCard | null {
    for (const player of context.players()) {
      const card = player.state.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return { playerId: player.id, zone: 'battlefield', card };
      }
    }

    return null;
  }
}
