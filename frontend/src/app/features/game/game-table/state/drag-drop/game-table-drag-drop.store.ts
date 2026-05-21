import { inject, Injectable } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
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
import { AlignmentGuide, GameTableBattlefieldDragState, LandStackDropPreview } from './game-table-battlefield-drag.state';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';
import { GameTablePendingTransferState } from '../core/game-table-pending-transfer.state';
import { PlayerView } from '../core/game-table-snapshot-selectors';
import {
  buildLandStackGroups,
  landStackDetachSource,
  landStackDropTarget,
  landStackGroupContaining,
} from '../../utils/land-stack';
import {
  attachmentDropTarget,
  attachmentRelationInstanceIds,
  attachmentStackDetachSource,
  attachmentStackGroupContaining,
  buildAttachmentStackGroups,
} from '../../utils/attachment-stack';

export const LAND_STACK_DROP_PREVIEW_DELAY_MS = 140;

export interface GameTableDragDropContext {
  readonly zones: readonly GameZoneName[];
  readonly snapshot: () => GameSnapshot | null;
  readonly players: () => readonly PlayerView[];
  readonly selectedCards: () => readonly SelectedCard[];
  readonly setSelectedCards: (cards: SelectedCard[]) => void;
  readonly canControlOwnedCard: (playerId: string, card: GameCardInstance) => boolean;
  readonly battlefieldDragContext: () => GameTableBattlefieldDragContext;
  readonly pointerDragActionContext: () => GameTablePointerDragActionContext;
  readonly cardPosition: (card: GameCardInstance) => { x: number; y: number } | null;
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
  private landStackDropPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLandStackDropPreview: LandStackDropPreview | null = null;
  private pendingTopLandStackSelection: SelectedCard[] | null = null;
  private pendingTopAttachmentStackSelection: SelectedCard[] | null = null;

  readonly draggingCardInstanceId = this.battlefieldDragState.draggingCardInstanceId;
  readonly manaLaneDropPlayerId = this.battlefieldDragState.manaLaneDropPlayerId;
  readonly handExternalRevealAllowed = this.battlefieldDragState.handExternalRevealAllowed;
  readonly alignmentGuide = this.battlefieldDragState.alignmentGuide;
  readonly activeDropTarget = this.battlefieldDragState.activeDropTarget;
  readonly activePlayerDropTarget = this.battlefieldDragState.activePlayerDropTarget;
  readonly pointerDragPreview = this.battlefieldDragState.pointerDragPreview;
  readonly landStackDropPreview = this.battlefieldDragState.landStackDropPreview;
  readonly landStackDetachSource = this.battlefieldDragState.landStackDetachSource;
  readonly attachmentStackDetachSource = this.battlefieldDragState.attachmentStackDetachSource;
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

    this.prepareStackDrag(context, playerId, card);
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
      this.updatePointerDragPreview(context, draggingInstanceId);
      if (this.isDraggingWholeLandStack(context, draggingInstanceId)) {
        this.updateWholeLandStackPointerDropTarget(event, context, draggingInstanceId);
        return;
      }

      this.battlefieldDrag.updatePointerDropTarget(event, context.battlefieldDragContext());
      const hasLandStackDropTarget = this.updateLandStackDropPreview(context, draggingInstanceId, false);
      if (hasLandStackDropTarget) {
        this.battlefieldDragState.clearManaLaneAndAlignment();
        return;
      }
      const hasAttachmentDropTarget = this.updateAttachmentDropPreview(context, draggingInstanceId, false);
      if (hasAttachmentDropTarget) {
        this.battlefieldDragState.clearManaLaneAndAlignment();
        return;
      }

      this.clearLandStackDropPreview();
      this.battlefieldDrag.updateBattlefieldDragAid(event, draggingInstanceId, context.battlefieldDragContext());
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
    if (this.updateNativeBattlefieldDropPreview(context, event)) {
      this.battlefieldDragState.setAlignmentGuide(null);
    }
  }

  previewDropOnHand(context: GameTableDragDropContext, event: DragEvent, targetPlayerId: string): void {
    this.drag.allowDrop(event);
    this.battlefieldDrag.updateActiveDropTarget(event, context.battlefieldDragContext());
    this.battlefieldDrag.updateHandDropPreview(event, targetPlayerId, context.battlefieldDragContext());
  }

  updatePointerDropTarget(context: GameTableDragDropContext, target: PointerDropTarget | null): void {
    this.battlefieldDragState.clearHandDropPreview();
    if (!target) {
      this.clearLandStackDropPreview();
      this.battlefieldDragState.clearDropTargets();
      return;
    }

    if (target.rawZone === 'mana') {
      if (this.updateExternalPointerBattlefieldDropPreview(context, target)) {
        this.battlefieldDragState.setActivePlayerDropTarget(null);
        this.battlefieldDragState.setActiveDropTarget(null);
        this.battlefieldDragState.setManaLaneDropPlayer(null);
        this.battlefieldDragState.setAlignmentGuide(null);
        return;
      }

      this.battlefieldDragState.setActivePlayerDropTarget(null);
      this.battlefieldDragState.setActiveDropTarget(null);
      this.battlefieldDragState.setManaLaneDropPlayer(target.targetPlayerId);
      this.battlefieldDragState.setAlignmentGuide(null);
      this.clearLandStackDropPreview();
      return;
    }

    this.battlefieldDragState.setManaLaneDropPlayer(null);
    this.clearLandStackDropPreview();
    if (target.kind === 'player') {
      this.battlefieldDragState.setActivePlayerDropTarget(target.targetPlayerId);
      this.battlefieldDragState.setActiveDropTarget(null);
      return;
    }

    this.battlefieldDragState.setActivePlayerDropTarget(null);
    this.battlefieldDragState.setActiveDropTarget({ playerId: target.targetPlayerId, zone: target.toZone });
    if (target.toZone === 'battlefield') {
      if (this.updateExternalPointerBattlefieldDropPreview(context, target)) {
        this.battlefieldDragState.setActiveDropTarget(null);
        this.battlefieldDragState.setAlignmentGuide(null);
        return;
      }

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
    this.clearLandStackDropPreview();
    this.pendingTopLandStackSelection = null;
    this.pendingTopAttachmentStackSelection = null;
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

  private prepareStackDrag(context: GameTableDragDropContext, playerId: string, card: GameCardInstance): void {
    this.clearLandStackDropPreview();
    this.battlefieldDragState.setLandStackDetachSource(null);
    this.battlefieldDragState.setAttachmentStackDetachSource(null);
    this.pendingTopLandStackSelection = null;
    this.pendingTopAttachmentStackSelection = null;
    const player = context.players().find((candidate) => candidate.id === playerId);
    if (!player) {
      return;
    }

    const groups = buildLandStackGroups(player.state.zones.battlefield, context.cardPosition);
    const group = landStackGroupContaining(groups, card.instanceId);
    if (!group) {
      this.prepareAttachmentStackDrag(context, playerId, card, player.state.zones.battlefield);
      return;
    }

    if (group.topCard.instanceId === card.instanceId) {
      this.pendingTopLandStackSelection = group.members.map((member) => ({ playerId, zone: 'battlefield', card: member.card }));
    } else {
      const detachSource = landStackDetachSource(playerId, group, card.instanceId);
      this.battlefieldDragState.setLandStackDetachSource(detachSource);
      context.setSelectedCards([{ playerId, zone: 'battlefield', card }]);
    }

    this.prepareAttachmentStackDrag(context, playerId, card, player.state.zones.battlefield);
  }

  private prepareAttachmentStackDrag(
    context: GameTableDragDropContext,
    playerId: string,
    card: GameCardInstance,
    battlefield: readonly GameCardInstance[],
  ): void {
    const groups = buildAttachmentStackGroups(
      battlefield,
      context.snapshot()?.attachments ?? [],
      context.cardPosition,
    );
    const group = attachmentStackGroupContaining(groups, card.instanceId);
    if (!group) {
      return;
    }

    if (group.targetCard.instanceId === card.instanceId) {
      this.pendingTopAttachmentStackSelection = this.mergeSelections(
        this.pendingTopLandStackSelection ?? [],
        group.members.map((member) => ({ playerId, zone: 'battlefield' as const, card: member.card })),
      );
      return;
    }

    const detachSource = attachmentStackDetachSource(playerId, context.snapshot()?.attachments ?? [], group, card.instanceId);
    this.battlefieldDragState.setAttachmentStackDetachSource(detachSource);
    context.setSelectedCards([{ playerId, zone: 'battlefield', card }]);
  }

  private updateLandStackDropPreview(context: GameTableDragDropContext, instanceId: string, clearOnMiss = true): boolean {
    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    const position = selected ? context.cardPosition(selected.card) : null;
    if (!selected || !position || this.selectedDragInstanceIds(context, selected.playerId, 'battlefield', instanceId).length > 1) {
      if (clearOnMiss) {
        this.clearLandStackDropPreview();
      }
      return false;
    }

    const player = context.players().find((candidate) => candidate.id === selected.playerId);
    const blockedByAttachments = attachmentRelationInstanceIds(context.snapshot()?.attachments ?? []);
    const target = player
      ? landStackDropTarget(player.state.zones.battlefield, instanceId, position, context.cardPosition, blockedByAttachments)
      : null;

    if (!target || this.isOriginalDetachStackTarget(target.targetCard.instanceId)) {
      if (clearOnMiss) {
        this.clearLandStackDropPreview();
      }
      return false;
    }

    this.scheduleLandStackDropPreview({
      playerId: selected.playerId,
      targetInstanceId: target.targetCard.instanceId,
      kind: 'land',
      nextSize: target.nextSize,
    });
    return true;
  }

  private updateAttachmentDropPreview(context: GameTableDragDropContext, instanceId: string, clearOnMiss = true): boolean {
    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    const position = selected ? context.cardPosition(selected.card) : null;
    if (!selected || !position || this.selectedDragInstanceIds(context, selected.playerId, 'battlefield', instanceId).length > 1) {
      if (clearOnMiss) {
        this.clearLandStackDropPreview();
      }
      return false;
    }

    const player = context.players().find((candidate) => candidate.id === selected.playerId);
    const target = player
      ? attachmentDropTarget(
        player.state.zones.battlefield,
        context.snapshot()?.attachments ?? [],
        instanceId,
        position,
        context.cardPosition,
      )
      : null;

    if (!target || this.isOriginalAttachmentDetachTarget(target.targetCard.instanceId)) {
      if (clearOnMiss) {
        this.clearLandStackDropPreview();
      }
      return false;
    }

    this.scheduleLandStackDropPreview({
      playerId: selected.playerId,
      targetInstanceId: target.targetCard.instanceId,
      kind: 'attachment',
    });
    return true;
  }

  private updateNativeBattlefieldDropPreview(context: GameTableDragDropContext, event: DragEvent): boolean {
    const payload = this.drag.dragPayload(event, [...context.zones]);
    const targetPlayerId = this.nativeBattlefieldDropPlayerId(event);
    const dropPosition = targetPlayerId ? this.drag.dropPosition(event, 'battlefield') : null;
    if (
      !payload
      || payload.zone === 'battlefield'
      || payload.instanceIds.length !== 1
      || !targetPlayerId
      || targetPlayerId !== payload.playerId
      || !dropPosition
    ) {
      this.clearLandStackDropPreview();
      return false;
    }

    const player = context.players().find((candidate) => candidate.id === payload.playerId);
    const sourceCard = player?.state.zones[payload.zone].find((card) => card.instanceId === payload.instanceId) ?? null;
    if (!player || !sourceCard) {
      this.clearLandStackDropPreview();
      return false;
    }

    const droppedCard = { ...sourceCard, zone: 'battlefield' as const, position: dropPosition };
    const cards = [...player.state.zones.battlefield, droppedCard];
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
      attachmentRelationInstanceIds(context.snapshot()?.attachments ?? []),
    );
    if (landTarget) {
      this.scheduleLandStackDropPreview({
        playerId: player.id,
        targetInstanceId: landTarget.targetCard.instanceId,
        kind: 'land',
        nextSize: landTarget.nextSize,
      });
      return true;
    }

    const attachmentTarget = attachmentDropTarget(
      cards,
      context.snapshot()?.attachments ?? [],
      sourceCard.instanceId,
      dropPosition,
      positionFor,
    );
    if (attachmentTarget) {
      this.scheduleLandStackDropPreview({
        playerId: player.id,
        targetInstanceId: attachmentTarget.targetCard.instanceId,
        kind: 'attachment',
      });
      return true;
    }

    this.clearLandStackDropPreview();
    return false;
  }

  private updateExternalPointerBattlefieldDropPreview(context: GameTableDragDropContext, target: PointerDropTarget): boolean {
    const sourceInstanceId = target.draggedInstanceId;
    if (
      target.kind !== 'zone'
      || target.toZone !== 'battlefield'
      || !sourceInstanceId
      || !target.position
    ) {
      this.clearLandStackDropPreview();
      return false;
    }

    const player = context.players().find((candidate) => candidate.id === target.targetPlayerId);
    const source = player ? this.nonBattlefieldSourceCard(player, sourceInstanceId) : null;
    if (
      !player
      || !source
      || this.selectedDragInstanceIds(context, player.id, source.zone, sourceInstanceId).length !== 1
    ) {
      this.clearLandStackDropPreview();
      return false;
    }

    const droppedCard = { ...source.card, zone: 'battlefield' as const, position: target.position };
    const cards = [...player.state.zones.battlefield, droppedCard];
    const positionFor = (card: GameCardInstance): { x: number; y: number } | null => {
      if (card.instanceId === source.card.instanceId) {
        return target.position ?? null;
      }

      return context.cardPosition(card);
    };
    const landTarget = landStackDropTarget(
      cards,
      source.card.instanceId,
      target.position,
      positionFor,
      attachmentRelationInstanceIds(context.snapshot()?.attachments ?? []),
    );
    if (landTarget) {
      this.scheduleLandStackDropPreview({
        playerId: player.id,
        targetInstanceId: landTarget.targetCard.instanceId,
        kind: 'land',
        nextSize: landTarget.nextSize,
      });
      return true;
    }

    const attachmentTarget = attachmentDropTarget(
      cards,
      context.snapshot()?.attachments ?? [],
      source.card.instanceId,
      target.position,
      positionFor,
    );
    if (attachmentTarget) {
      this.scheduleLandStackDropPreview({
        playerId: player.id,
        targetInstanceId: attachmentTarget.targetCard.instanceId,
        kind: 'attachment',
      });
      return true;
    }

    this.clearLandStackDropPreview();
    return false;
  }

  private nativeBattlefieldDropPlayerId(event: DragEvent): string | null {
    const target = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest<HTMLElement>('[data-game-drop-zone="battlefield"]')
      : null;

    return target?.dataset['playerId'] ?? null;
  }

  private scheduleLandStackDropPreview(preview: LandStackDropPreview): void {
    if (this.sameLandStackDropPreview(this.battlefieldDragState.landStackDropPreview(), preview)) {
      return;
    }

    if (this.sameLandStackDropPreview(this.pendingLandStackDropPreview, preview)) {
      return;
    }

    this.clearLandStackDropPreviewTimer();
    this.pendingLandStackDropPreview = preview;
    this.landStackDropPreviewTimer = setTimeout(() => {
      this.battlefieldDragState.setLandStackDropPreview(preview);
      this.pendingLandStackDropPreview = null;
      this.landStackDropPreviewTimer = null;
    }, LAND_STACK_DROP_PREVIEW_DELAY_MS);
  }

  private clearLandStackDropPreview(): void {
    this.clearLandStackDropPreviewTimer();
    this.battlefieldDragState.setLandStackDropPreview(null);
  }

  private clearLandStackDropPreviewTimer(): void {
    if (this.landStackDropPreviewTimer !== null) {
      clearTimeout(this.landStackDropPreviewTimer);
      this.landStackDropPreviewTimer = null;
    }
    this.pendingLandStackDropPreview = null;
  }

  private sameLandStackDropPreview(left: LandStackDropPreview | null, right: LandStackDropPreview | null): boolean {
    return left?.playerId === right?.playerId
      && left?.targetInstanceId === right?.targetInstanceId
      && left?.kind === right?.kind
      && left?.nextSize === right?.nextSize;
  }

  private ensureDraggingBattlefieldSelection(context: GameTableDragDropContext, instanceId: string): void {
    const attachmentStackSelection = this.topAttachmentStackSelection(instanceId);
    if (attachmentStackSelection) {
      context.setSelectedCards(attachmentStackSelection);
      return;
    }

    const stackSelection = this.topLandStackSelection(context, instanceId);
    if (stackSelection) {
      context.setSelectedCards(stackSelection);
      return;
    }

    if (context.selectedCards().some((item) => item.card.instanceId === instanceId)) {
      return;
    }

    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    if (selected) {
      context.setSelectedCards([selected]);
    }
  }

  private updateWholeLandStackPointerDropTarget(event: PointerEvent, context: GameTableDragDropContext, instanceId: string): void {
    this.battlefieldDrag.updateBattlefieldDragAid(event, instanceId, context.battlefieldDragContext());
    this.battlefieldDrag.updatePointerDropTarget(event, context.battlefieldDragContext());
    this.clearLandStackDropPreview();
    this.battlefieldDragState.setActivePlayerDropTarget(null);
    this.battlefieldDragState.setAlignmentGuide(null);

    const target = this.battlefieldDragState.activeDropTarget();
    if (target?.zone === 'battlefield') {
      this.battlefieldDragState.setActiveDropTarget(null);
    }
  }

  private topLandStackSelection(context: GameTableDragDropContext, instanceId: string): SelectedCard[] | null {
    if (this.pendingTopLandStackSelection?.some((item) => item.card.instanceId === instanceId)) {
      return this.pendingTopLandStackSelection;
    }

    return null;
  }

  private topAttachmentStackSelection(instanceId: string): SelectedCard[] | null {
    if (this.pendingTopAttachmentStackSelection?.some((item) => item.card.instanceId === instanceId)) {
      return this.pendingTopAttachmentStackSelection;
    }

    return null;
  }

  private isDraggingWholeLandStack(context: GameTableDragDropContext, instanceId: string): boolean {
    const selected = this.battlefieldSelectionByInstanceId(context, instanceId);
    if (!selected) {
      return false;
    }

    const selectedIds = this.selectedDragInstanceIds(context, selected.playerId, 'battlefield', instanceId);
    if (selectedIds.length <= 1) {
      return false;
    }

    if (this.pendingTopLandStackSelection?.some((item) => item.card.instanceId === instanceId)) {
      const pendingIds = this.pendingTopLandStackSelection.map((item) => item.card.instanceId);

      return pendingIds.length === selectedIds.length && pendingIds.every((pendingId) => selectedIds.includes(pendingId));
    }

    return false;
  }

  private mergeSelections(left: readonly SelectedCard[], right: readonly SelectedCard[]): SelectedCard[] {
    const byId = new Map<string, SelectedCard>();
    for (const item of [...left, ...right]) {
      byId.set(item.card.instanceId, item);
    }

    return [...byId.values()];
  }

  private isOriginalDetachStackTarget(targetInstanceId: string): boolean {
    const detachSource = this.battlefieldDragState.landStackDetachSource();
    if (!detachSource) {
      return false;
    }

    return detachSource.members
      .filter((member) => member.instanceId !== detachSource.detachedInstanceId)
      .some((member) => member.instanceId === targetInstanceId);
  }

  private isOriginalAttachmentDetachTarget(targetInstanceId: string): boolean {
    const detachSource = this.battlefieldDragState.attachmentStackDetachSource();
    if (!detachSource) {
      return false;
    }

    return detachSource.members
      .filter((member) => member.instanceId !== detachSource.detachedInstanceId)
      .some((member) => member.instanceId === targetInstanceId);
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

  private nonBattlefieldSourceCard(player: PlayerView, instanceId: string): { readonly zone: GameZoneName; readonly card: GameCardInstance } | null {
    for (const zone of ['hand', 'graveyard', 'exile', 'command', 'library'] as const) {
      const card = player.state.zones[zone].find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return { zone, card };
      }
    }

    return null;
  }
}
