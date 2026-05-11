import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragContext, GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { PendingBattlefieldMove } from './game-table-drop-actions.service';

export interface GameTablePointerDragActionContext {
  zones: readonly GameZoneName[];
  battlefieldDragContext(): GameTableBattlefieldDragContext;
  alignmentGuideY(playerId: string): number | null;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  canControlPlayer(playerId: string): boolean;
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  playerName(playerId: string): string;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
  setPendingBattlefieldMove(move: PendingBattlefieldMove): void;
  endCardDrag(): void;
  clearSelectedCards(): void;
  applyDeferredRemoteSnapshot(): void;
  refetch(force?: boolean): Promise<void>;
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

    context.endCardDrag();
    if (!drag || !drag.moved) {
      context.applyDeferredRemoteSnapshot();
      return;
    }

    context.clearSelectedCards();

    if (targetPlayerId) {
      this.prepareBattlefieldTransfer(context, drag.playerId, drag.instanceId, targetPlayerId);
      return;
    }

    if (drag.dropZone && drag.dropZone !== 'battlefield') {
      if (!context.canControlPlayer(drag.playerId)) {
        context.applyDeferredRemoteSnapshot();
        return;
      }
      await context.command('card.moved', {
        playerId: drag.playerId,
        fromZone: 'battlefield',
        toZone: drag.dropZone,
        instanceId: drag.instanceId,
      });
      context.applyDeferredRemoteSnapshot();
      return;
    }

    if (!drag.dropZone && (!event || !this.battlefieldDrag.isPointerInsidePlayerBattlefield(event, drag.playerId))) {
      await context.refetch(true);
      context.applyDeferredRemoteSnapshot();
      return;
    }

    const position = this.battlefieldDrag.positionWithAlignmentGuide(
      context.battlefieldDragContext(),
      drag.playerId,
      drag.instanceId,
      drag.position,
      activeGuideY,
    );

    await context.command('card.position.changed', {
      playerId: drag.playerId,
      zone: 'battlefield',
      instanceId: drag.instanceId,
      position,
    });
    context.applyDeferredRemoteSnapshot();
  }

  private prepareBattlefieldTransfer(
    context: GameTablePointerDragActionContext,
    playerId: string,
    instanceId: string,
    targetPlayerId: string,
  ): void {
    const sourceCard = context.findCard(playerId, 'battlefield', instanceId);
    if (!sourceCard || !context.canControlOwnedCard(playerId, sourceCard)) {
      return;
    }

    context.setPendingBattlefieldMove({
      cardName: sourceCard.name,
      targetPlayerName: context.playerName(targetPlayerId),
      payload: {
        playerId,
        fromZone: 'battlefield',
        toZone: 'battlefield',
        targetPlayerId,
        instanceId,
      },
    });
  }
}
