import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { HandDropPreview } from '../state/game-table-battlefield-drag.state';
import { GameTableBattlefieldDragContext, GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { PendingBattlefieldMove, PendingLibraryMove } from './game-table-drop-actions.service';

export interface GameTablePointerDragActionContext {
  zones: readonly GameZoneName[];
  snapshot(): GameSnapshot | null;
  handDropPreview(): HandDropPreview | null;
  selectedCards(): readonly { playerId: string; zone: GameZoneName; card: GameCardInstance }[];
  battlefieldDragContext(): GameTableBattlefieldDragContext;
  alignmentGuideY(playerId: string): number | null;
  isManaLaneHighlighted(playerId: string): boolean;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  canControlPlayer(playerId: string): boolean;
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  playerName(playerId: string): string;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
  setPendingBattlefieldMove(move: PendingBattlefieldMove): void;
  setPendingLibraryMove(move: PendingLibraryMove): void;
  endCardDrag(): void;
  clearSelectedCards(): void;
  suppressCardPreview(): void;
  applyDeferredRemoteSnapshot(): void;
  refetch(force?: boolean): Promise<void>;
  markPendingManaDrop(playerId: string, instanceIds: readonly string[]): void;
  markPendingTransfer(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]): void;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTablePointerDragActionsService {
  private readonly drag = inject(GameTableDragService);
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);

  async endCardPointerDrag(context: GameTablePointerDragActionContext, event?: PointerEvent): Promise<void> {
    const drag = this.drag.endCardPointerDrag(
      event,
      (pointerEvent, playerId) => this.drag.pointerDropZone(pointerEvent, playerId, [...context.zones]),
      (playerId, instanceId, position) => context.updateLocalCardPosition(playerId, instanceId, position),
    );
    const activeGuideY = drag ? context.alignmentGuideY(drag.playerId) : null;
    const targetPlayerId = event && drag ? this.battlefieldDrag.playerDropTargetAt(event, drag.playerId) : null;
    const handPreview = drag?.dropZone === 'hand' ? context.handDropPreview() : null;
    const dragGroup = drag ? this.selectedBattlefieldDragGroup(context, drag.playerId, drag.instanceId) : [];
    const instanceIds = dragGroup.length > 0 ? dragGroup.map((item) => item.card.instanceId) : drag ? [drag.instanceId] : [];

    if (!drag || !drag.moved) {
      context.endCardDrag();
      context.applyDeferredRemoteSnapshot();
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
      context.markPendingTransfer(drag.playerId, 'battlefield', instanceIds);
      context.endCardDrag();
      context.clearSelectedCards();
      await this.moveBattlefieldCardsToZone(context, drag.playerId, instanceIds, drag.dropZone);
      if (drag.dropZone === 'hand') {
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

    const manaDrop = context.isManaLaneHighlighted(drag.playerId);
    if (manaDrop) {
      context.markPendingManaDrop(drag.playerId, instanceIds);
    }

    const position = manaDrop
      ? this.battlefieldDrag.positionWithManaLane(drag.playerId, drag.position)
      : this.battlefieldDrag.positionWithAlignmentGuide(
        context.battlefieldDragContext(),
        drag.playerId,
        drag.instanceId,
        drag.position,
        activeGuideY,
      );

    if (dragGroup.length > 1) {
      await this.moveSelectedBattlefieldPositions(context, dragGroup, drag.instanceId, position, manaDrop);
    } else {
      await context.command('card.position.changed', {
        playerId: drag.playerId,
        zone: 'battlefield',
        instanceId: drag.instanceId,
        position,
      });
    }
    context.endCardDrag();
    context.clearSelectedCards();
    context.applyDeferredRemoteSnapshot();
    context.suppressCardPreview();
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
    context.markPendingTransfer(playerId, 'battlefield', instanceIds);
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
    context.markPendingTransfer(playerId, 'battlefield', instanceIds);
    context.suppressCardPreview();
  }

  private async moveSelectedBattlefieldPositions(
    context: GameTablePointerDragActionContext,
    selected: readonly { playerId: string; zone: GameZoneName; card: GameCardInstance }[],
    draggedInstanceId: string,
    draggedPosition: { x: number; y: number },
    alignY = false,
  ): Promise<void> {
    const dragged = selected.find((item) => item.card.instanceId === draggedInstanceId);
    const origin = dragged?.card.position ?? { x: 0, y: 0 };
    const delta = {
      x: draggedPosition.x - origin.x,
      y: draggedPosition.y - origin.y,
    };

    const moves = selected.map((item) => {
      const current = item.card.position ?? { x: 0, y: 0 };
      return {
        item,
        position: {
          x: Math.max(0, current.x + delta.x),
          y: alignY ? draggedPosition.y : Math.max(0, current.y + delta.y),
        },
      };
    });

    for (const move of moves) {
      context.updateLocalCardPosition(move.item.playerId, move.item.card.instanceId, move.position);
    }

    for (const move of moves) {
      await context.command('card.position.changed', {
        playerId: move.item.playerId,
        zone: 'battlefield',
        instanceId: move.item.card.instanceId,
        position: move.position,
      });
    }
  }

  private selectedBattlefieldDragGroup(
    context: GameTablePointerDragActionContext,
    playerId: string,
    draggedInstanceId: string,
  ): readonly { playerId: string; zone: GameZoneName; card: GameCardInstance }[] {
    const selected = context.selectedCards();
    const canUseSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === draggedInstanceId)
      && selected.every((item) => item.playerId === playerId && item.zone === 'battlefield');

    if (!canUseSelection) {
      return [];
    }

    return selected.filter((item) => context.canControlOwnedCard(item.playerId, item.card));
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
