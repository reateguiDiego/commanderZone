import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameCommandType, GameSnapshot } from '../../../../../core/models/game.model';
import { GameContextMenu } from '../core/game-table-ui.state';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePermanentRelationService } from '../../services/game-table-permanent-relation.service';
import {
  buildAttachmentStackGroups,
  createAttachmentStackMoves,
  detachAttachmentStackMoves,
  removeAttachmentStackMoves,
} from '../../utils/attachment-stack';

export interface PendingAttachmentSource {
  readonly instanceId: string;
  readonly cardName: string;
}

export interface GameTableAttachmentInteractionContext {
  readonly snapshot: () => GameSnapshot | null;
  readonly canControlOwnedCard: (playerId: string, card: GameCardInstance) => boolean;
  readonly battlefieldCards: (playerId: string) => readonly GameCardInstance[];
  readonly cardPosition: (card: GameCardInstance) => { x: number; y: number } | null;
  readonly battlefieldPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => unknown;
  readonly updateLocalCardPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void;
  readonly setError: (message: string) => void;
  readonly closeContextMenu: () => void;
  readonly showTargetToast: (message: string) => void;
  readonly clearTargetToast: () => void;
  readonly command: (
    type: Extract<GameCommandType, 'attachment.created' | 'attachment.removed' | 'cards.position.changed'>,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

@Injectable()
export class GameTableAttachmentsState {
  private attachmentCommandQueue: Promise<void> = Promise.resolve();
  readonly pendingAttachmentSource = signal<PendingAttachmentSource | null>(null);

  constructor(
    private readonly core: GameTableCoreState,
    private readonly permanentRelations: GameTablePermanentRelationService,
  ) {}

  clearPendingAttachmentSource(): void {
    this.pendingAttachmentSource.set(null);
  }

  startAttachmentFrom(context: GameTableAttachmentInteractionContext, menu: GameContextMenu): void {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!context.canControlOwnedCard(menu.playerId, menu.card)) {
      context.setError('You can only attach cards you control.');
      context.closeContextMenu();
      return;
    }
    if (this.permanentRelations.isLandPermanent(menu.card)) {
      context.setError('Lands cannot be attached to another permanent.');
      context.closeContextMenu();
      return;
    }
    if (!this.permanentRelations.canAttachSource(context.snapshot(), menu.card)) {
      context.setError('Cards with attached permanents cannot be attached to another permanent.');
      context.closeContextMenu();
      return;
    }

    this.pendingAttachmentSource.set({
      instanceId: menu.card.instanceId,
      cardName: menu.card.name,
    });
    context.showTargetToast(`Choose a permanent to attach ${menu.card.name} to.`);
    context.closeContextMenu();
  }

  handleBattlefieldCardClick(
    context: GameTableAttachmentInteractionContext,
    event: MouseEvent,
    card: GameCardInstance,
  ): boolean {
    const pendingAttachment = this.pendingAttachmentSource();
    if (!pendingAttachment) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (pendingAttachment.instanceId === card.instanceId) {
      this.pendingAttachmentSource.set(null);
      context.showTargetToast('Attach target selection cancelled.');
      return true;
    }
    if (!this.permanentRelations.relationHasBattlefieldEndpoints(this.core.snapshot(), pendingAttachment.instanceId, card.instanceId)) {
      context.setError('Attachment target must be on the battlefield.');
      return true;
    }
    const snapshot = context.snapshot();
    const sourceLocation = this.permanentRelations.battlefieldCard(snapshot, pendingAttachment.instanceId);
    const targetLocation = this.permanentRelations.battlefieldCard(snapshot, card.instanceId);
    if (!sourceLocation || !targetLocation || sourceLocation.playerId !== targetLocation.playerId) {
      context.setError('Attachments must stay on the same battlefield.');
      return true;
    }
    if (!this.permanentRelations.canAttachSource(snapshot, sourceLocation.card)) {
      context.setError('Cards with attached permanents cannot be attached to another permanent.');
      return true;
    }

    this.pendingAttachmentSource.set(null);
    this.queueAttachmentCommand(context, sourceLocation.playerId, targetLocation.playerId, {
      equipmentInstanceId: pendingAttachment.instanceId,
      attachedToInstanceId: card.instanceId,
    });
    context.clearTargetToast();

    return true;
  }

  isAttachedEquipment(instanceId: string): boolean {
    return this.permanentRelations.isAttachedEquipment(this.core.snapshot(), instanceId);
  }

  isAttachmentTarget(instanceId: string): boolean {
    return this.permanentRelations.attachmentsForTarget(this.core.snapshot(), instanceId).length > 0;
  }

  async removeAttachment(context: GameTableAttachmentInteractionContext, playerId: string, equipment: GameCardInstance): Promise<void> {
    const snapshot = context.snapshot();
    const attachment = this.permanentRelations.attachmentForEquipment(snapshot, equipment.instanceId);
    if (!attachment) {
      return;
    }

    const groups = buildAttachmentStackGroups(
      context.battlefieldCards(playerId),
      snapshot?.attachments ?? [],
      context.cardPosition,
    );
    const group = groups.find((candidate) => candidate.members.some((member) => member.card.instanceId === equipment.instanceId)) ?? null;
    const source = group ? {
      playerId,
      detachedInstanceId: equipment.instanceId,
      attachmentId: attachment.id,
      members: group.members.map((member) => ({
        instanceId: member.card.instanceId,
        x: member.position.x,
        y: member.position.y,
        layer: member.layer,
      })),
    } : null;
    const moves = source ? detachAttachmentStackMoves(source) : [];

    if (moves.length > 0) {
      for (const move of moves) {
        context.updateLocalCardPosition(playerId, move.instanceId, move.position);
      }
      await context.command('cards.position.changed', {
        playerId,
        zone: 'battlefield',
        positions: moves.map((move) => ({
          instanceId: move.instanceId,
          position: context.battlefieldPosition(playerId, move.instanceId, move.position),
        })),
      });
    }

    await context.command('attachment.removed', { equipmentInstanceId: equipment.instanceId });
  }

  async removeAttachmentsFromTarget(context: GameTableAttachmentInteractionContext, playerId: string, target: GameCardInstance): Promise<void> {
    const snapshot = context.snapshot();
    const attachments = this.permanentRelations.attachmentsForTarget(snapshot, target.instanceId);
    if (attachments.length === 0) {
      return;
    }

    const groups = buildAttachmentStackGroups(
      context.battlefieldCards(playerId),
      snapshot?.attachments ?? [],
      context.cardPosition,
    );
    const group = groups.find((candidate) => candidate.targetCard.instanceId === target.instanceId) ?? null;
    const moves = group ? removeAttachmentStackMoves(group) : [];

    if (moves.length > 0) {
      for (const move of moves) {
        context.updateLocalCardPosition(playerId, move.instanceId, move.position);
      }
      await context.command('cards.position.changed', {
        playerId,
        zone: 'battlefield',
        positions: moves.map((move) => ({
          instanceId: move.instanceId,
          position: context.battlefieldPosition(playerId, move.instanceId, move.position),
        })),
      });
    }

    for (const attachment of attachments) {
      await context.command('attachment.removed', { id: attachment.id });
    }
  }

  private queueAttachmentCommand(
    context: GameTableAttachmentInteractionContext,
    sourcePlayerId: string | null,
    targetPlayerId: string | null,
    payload: { equipmentInstanceId: string; attachedToInstanceId: string },
  ): void {
    this.attachmentCommandQueue = this.attachmentCommandQueue
      .then(async () => {
        if (sourcePlayerId && sourcePlayerId === targetPlayerId) {
          const moves = createAttachmentStackMoves(
            context.battlefieldCards(sourcePlayerId),
            context.snapshot()?.attachments ?? [],
            payload.equipmentInstanceId,
            payload.attachedToInstanceId,
            context.cardPosition,
          );
          if (moves.length > 0) {
            for (const move of moves) {
              context.updateLocalCardPosition(sourcePlayerId, move.instanceId, move.position);
            }
            await context.command('cards.position.changed', {
              playerId: sourcePlayerId,
              zone: 'battlefield',
              positions: moves.map((move) => ({
                instanceId: move.instanceId,
                position: context.battlefieldPosition(sourcePlayerId, move.instanceId, move.position),
              })),
            });
          }
        }

        await context.command('attachment.created', payload);
      })
      .catch(() => undefined);
  }
}
