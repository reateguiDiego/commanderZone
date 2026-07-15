import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameCommandType, GameSnapshot } from '../../../../../core/models/game.model';
import { GameContextMenu } from '../core/game-table-ui.state';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePermanentRelationService } from '../../services/game-table-permanent-relation.service';
import {
  buildAttachmentStackGroups,
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
    type: Extract<GameCommandType, 'attachment.created' | 'attachment.removed'>,
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
    const sourceGameplayError = this.permanentRelations.gameplayAttachmentError(menu.card, 'source');
    if (sourceGameplayError) {
      context.setError(sourceGameplayError);
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
    const targetGameplayError = this.permanentRelations.gameplayAttachmentError(targetLocation.card, 'target');
    if (targetGameplayError) {
      context.setError(targetGameplayError);
      return true;
    }

    this.pendingAttachmentSource.set(null);
    this.queueAttachmentCommand(context, {
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
    const detachedPosition = group?.members.find((member) => member.card.instanceId === equipment.instanceId)?.position
      ?? context.cardPosition(equipment);
    const position = detachedPosition
      ? context.battlefieldPosition(playerId, equipment.instanceId, detachedPosition)
      : undefined;
    if (detachedPosition) {
      context.updateLocalCardPosition(playerId, equipment.instanceId, detachedPosition);
    }

    await context.command('attachment.removed', {
      id: attachment.id,
      equipmentInstanceId: equipment.instanceId,
      ...(position ? { position } : {}),
    });
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

    for (const attachment of attachments) {
      const move = moves.find((candidate) => candidate.instanceId === attachment.equipmentInstanceId);
      const position = move
        ? context.battlefieldPosition(playerId, move.instanceId, move.position)
        : undefined;
      if (move) {
        context.updateLocalCardPosition(playerId, move.instanceId, move.position);
      }
      await context.command('attachment.removed', {
        id: attachment.id,
        equipmentInstanceId: attachment.equipmentInstanceId,
        ...(position ? { position } : {}),
      });
    }
  }

  private queueAttachmentCommand(
    context: GameTableAttachmentInteractionContext,
    payload: { equipmentInstanceId: string; attachedToInstanceId: string },
  ): void {
    this.attachmentCommandQueue = this.attachmentCommandQueue
      .then(async () => {
        await context.command('attachment.created', payload);
      })
      .catch(() => undefined);
  }
}
