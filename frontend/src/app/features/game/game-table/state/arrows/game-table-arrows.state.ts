import { Injectable, signal } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PendingArrowSource } from '../../models/game-table-arrow.model';
import { GameTablePermanentRelationService } from '../../services/game-table-permanent-relation.service';
import { GameContextMenu } from '../core/game-table-ui.state';
import { GameTableCoreState } from '../core/game-table-core.state';

export interface GameTableArrowInteractionContext {
  readonly canControlOwnedCard: (playerId: string, card: GameCardInstance) => boolean;
  readonly setError: (message: string) => void;
  readonly closeContextMenu: () => void;
  readonly showArrowTargetProgressToast: (remainingTargets: number) => void;
  readonly showTargetToast: (message: string) => void;
  readonly clearTargetToast: () => void;
  readonly command: (type: 'arrow.created', payload: { fromInstanceId: string; toInstanceId: string; color: string }) => Promise<void>;
}

@Injectable()
export class GameTableArrowsState {
  private arrowCreationQueue: Promise<void> = Promise.resolve();
  readonly pendingArrowSource = signal<PendingArrowSource | null>(null);

  constructor(
    private readonly core: GameTableCoreState,
    private readonly permanentRelations: GameTablePermanentRelationService,
  ) {}

  clearPendingArrowSource(): void {
    this.pendingArrowSource.set(null);
  }

  startArrowFrom(context: GameTableArrowInteractionContext, menu: GameContextMenu, targetCount = 1): void {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!context.canControlOwnedCard(menu.playerId, menu.card)) {
      context.setError('You can only draw arrows from cards you control.');
      context.closeContextMenu();
      return;
    }

    const normalizedTargetCount = Math.max(1, Math.floor(Number.isFinite(targetCount) ? targetCount : 1));
    this.pendingArrowSource.set({
      instanceId: menu.card.instanceId,
      cardName: menu.card.name,
      color: this.arrowColorForCard(menu.card),
      targetCount: normalizedTargetCount,
      selectedTargetInstanceIds: [],
    });
    context.showArrowTargetProgressToast(normalizedTargetCount);
    context.closeContextMenu();
  }

  handleBattlefieldCardClick(
    context: GameTableArrowInteractionContext,
    event: MouseEvent,
    card: GameCardInstance,
  ): boolean {
    const pendingArrow = this.pendingArrowSource();
    if (!pendingArrow) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (pendingArrow.instanceId === card.instanceId) {
      this.pendingArrowSource.set(null);
      context.showTargetToast('Target selection cancelled.');
      return true;
    }
    if (pendingArrow.selectedTargetInstanceIds.includes(card.instanceId)) {
      context.showArrowTargetProgressToast(pendingArrow.targetCount - pendingArrow.selectedTargetInstanceIds.length);
      return true;
    }

    const selectedTargetInstanceIds = [...pendingArrow.selectedTargetInstanceIds, card.instanceId];
    const remainingTargets = pendingArrow.targetCount - selectedTargetInstanceIds.length;
    this.pendingArrowSource.set(remainingTargets > 0
      ? { ...pendingArrow, selectedTargetInstanceIds }
      : null);
    this.queueArrowCreatedCommand(context, {
      fromInstanceId: pendingArrow.instanceId,
      toInstanceId: card.instanceId,
      color: pendingArrow.color,
    });
    if (remainingTargets > 0) {
      context.showArrowTargetProgressToast(remainingTargets);
    } else {
      context.clearTargetToast();
    }

    return true;
  }

  ownedArrowIds(playerId: string): readonly string[] {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return [];
    }

    const sourceInstanceIds = this.permanentRelations.battlefieldInstanceIds(snapshot, playerId);

    return snapshot.arrows
      .filter((arrow) => arrow.ownerId === playerId || (!arrow.ownerId && sourceInstanceIds.has(arrow.fromInstanceId)))
      .map((arrow) => arrow.id);
  }

  ownedArrowCount(playerId: string): number {
    return this.ownedArrowIds(playerId).length;
  }

  arrowColorForCard(card: GameCardInstance): string {
    return this.arrowColorPalette(card.colorIdentity ?? [])[0] ?? 'yellow';
  }

  private arrowColorPalette(colorIdentity: readonly string[]): readonly string[] {
    const colorsByIdentity: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
    };
    const identityColors = ['W', 'U', 'B', 'R', 'G']
      .filter((color) => colorIdentity.includes(color))
      .map((color) => colorsByIdentity[color])
      .filter((color): color is string => Boolean(color));

    return identityColors.length > 0 ? identityColors : ['yellow'];
  }

  private queueArrowCreatedCommand(
    context: GameTableArrowInteractionContext,
    payload: { fromInstanceId: string; toInstanceId: string; color: string },
  ): void {
    this.arrowCreationQueue = this.arrowCreationQueue
      .then(() => context.command('arrow.created', payload))
      .catch(() => undefined);
  }
}
