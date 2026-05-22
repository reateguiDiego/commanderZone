import { inject, Injectable, signal } from '@angular/core';
import { GameCardInstance, GameCardPosition, GameSnapshot } from '../../../../../core/models/game.model';
import {
  BattlefieldSize,
  DEFAULT_BATTLEFIELD_CARD_SIZE,
  DEFAULT_BATTLEFIELD_SIZE,
  isRatioPosition,
  ratioBattlefieldPosition,
  sameBattlefieldPosition,
} from '../../utils/battlefield-position';
import { BattlefieldPositionCommand, ViewportClampedBattlefieldPosition } from '../../models/game-table-battlefield.model';
import {
  GameTableBattlefieldDragContext,
  GameTableBattlefieldDragCoordinatorService,
} from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { AlignmentGuide } from '../drag-drop/game-table-battlefield-drag.state';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';

export interface GameTableBattlefieldContext {
  readonly snapshot: () => GameSnapshot | null;
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly setError: (message: string) => void;
  readonly errorMessage: (error: unknown) => string;
  readonly battlefieldDragContext: () => GameTableBattlefieldDragContext;
  readonly alignmentGuideFor: (playerId: string) => AlignmentGuide | null;
}

@Injectable()
export class GameTableBattlefieldState {
  private battlefieldPositionQueue: Promise<void> = Promise.resolve();
  private readonly optimisticBattlefieldPositions = new Map<string, BattlefieldPositionCommand>();
  private readonly viewportClampedBattlefieldPositions = new Map<string, ViewportClampedBattlefieldPosition>();
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
  private readonly commands = inject(GameTableCommandService);
  private readonly selectors = inject(GameTableSnapshotSelectors);

  readonly layoutSize = signal<BattlefieldSize>(DEFAULT_BATTLEFIELD_SIZE);

  cardPosition(card: GameCardInstance): { x: number; y: number } | null {
    const playerId = card.controllerId ?? card.ownerId ?? '';
    const cardSize = isRatioPosition(card.position)
      ? this.battlefieldCardSize(playerId, card.instanceId)
      : undefined;

    return this.selectors.cardPosition(card, this.layoutSize(), cardSize);
  }

  setLayoutSize(size: BattlefieldSize): void {
    const current = this.layoutSize();
    if (current.width === size.width && current.height === size.height) {
      return;
    }

    this.layoutSize.set(size);
  }

  reflowBattlefieldCardPositions(context: GameTableBattlefieldContext): void {
    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

    let nextSnapshot: GameSnapshot | null = null;
    for (const battlefield of document.querySelectorAll<HTMLElement>('.battlefield[data-player-id]')) {
      const playerId = battlefield.dataset['playerId'];
      if (!playerId || !snapshot.players[playerId]) {
        continue;
      }

      const bounds = this.battlefieldLayoutBounds(battlefield);
      if (bounds.width <= 0 || bounds.height <= 0) {
        continue;
      }

      const cardElements = new Map(
        Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-card-instance-id]'))
          .map((element) => [element.dataset['cardInstanceId'] ?? '', element] as const)
          .filter(([instanceId]) => instanceId !== ''),
      );
      const sourceCards = (nextSnapshot ?? snapshot).players[playerId]?.zones.battlefield ?? [];
      for (const card of sourceCards) {
        const cardElement = cardElements.get(card.instanceId);
        const cardBounds = cardElement?.getBoundingClientRect();
        const cardWidth = Math.max(1, Math.round(cardElement?.offsetWidth || cardBounds?.width || 116));
        const cardHeight = Math.max(1, Math.round(cardElement?.offsetHeight || cardBounds?.height || 162));
        const cardSize = { width: cardWidth, height: cardHeight };
        const positionKey = this.battlefieldPositionKey({ playerId, instanceId: card.instanceId });

        if (isRatioPosition(card.position)) {
          const ratioPosition = this.selectors.cardPosition(card, { width: bounds.width, height: bounds.height }, cardSize);
          this.viewportClampedBattlefieldPositions.delete(positionKey);
          if (!ratioPosition) {
            continue;
          }

          const clamped = this.clampBattlefieldPosition(ratioPosition, bounds.width, bounds.height, cardWidth, cardHeight);
          if (this.samePosition(clamped, ratioPosition)) {
            continue;
          }

          const nextPosition = ratioBattlefieldPosition(clamped, { width: bounds.width, height: bounds.height }, cardSize);
          if (sameBattlefieldPosition(card.position, nextPosition)) {
            continue;
          }

          nextSnapshot ??= structuredClone(snapshot);
          const nextCard = nextSnapshot.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === card.instanceId);
          if (nextCard) {
            nextCard.position = nextPosition;
          }
          continue;
        }

        const position = this.selectors.cardPosition(card, { width: bounds.width, height: bounds.height });
        if (!position) {
          continue;
        }

        const existingClamp = this.viewportClampedBattlefieldPositions.get(positionKey);
        const sourcePosition = existingClamp && this.samePosition(existingClamp.clampedPosition, position)
          ? existingClamp.sourcePosition
          : position;
        const clamped = this.clampBattlefieldPosition(sourcePosition, bounds.width, bounds.height, cardWidth, cardHeight);
        if (this.samePosition(clamped, sourcePosition)) {
          this.viewportClampedBattlefieldPositions.delete(positionKey);
          if (this.samePosition(position, sourcePosition)) {
            continue;
          }
        } else {
          this.viewportClampedBattlefieldPositions.set(positionKey, {
            playerId,
            instanceId: card.instanceId,
            sourcePosition,
            clampedPosition: clamped,
          });
          if (this.samePosition(clamped, position)) {
            continue;
          }
        }

        if (this.samePosition(clamped, position)) {
          continue;
        }

        nextSnapshot ??= structuredClone(snapshot);
        const nextCard = nextSnapshot.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === card.instanceId);
        if (nextCard) {
          nextCard.position = clamped;
        }
      }
    }

    if (nextSnapshot) {
      context.setSnapshot(nextSnapshot);
    }
  }

  updateLocalCardPosition(context: GameTableBattlefieldContext, playerId: string, instanceId: string, position: { x: number; y: number }): void {
    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.position = this.ratioPositionForBattlefield(playerId, instanceId, position);
      context.setSnapshot(next);
    }
  }

  tryQueueBattlefieldPositionCommand(context: GameTableBattlefieldContext, gameId: string, payload: Record<string, unknown>): boolean {
    const positionCommand = this.battlefieldPositionCommand(payload);
    if (!positionCommand) {
      return false;
    }

    this.optimisticBattlefieldPositions.set(this.battlefieldPositionKey(positionCommand), positionCommand);
    this.battlefieldPositionQueue = this.battlefieldPositionQueue
      .catch(() => undefined)
      .then(() => this.persistBattlefieldPositionCommand(context, gameId, positionCommand, payload));

    return true;
  }

  applyOptimisticBattlefieldPositions(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticBattlefieldPositions.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const optimisticPosition of this.optimisticBattlefieldPositions.values()) {
      const card = next.players[optimisticPosition.playerId]?.zones.battlefield.find(
        (candidate) => candidate.instanceId === optimisticPosition.instanceId,
      );
      if (!card) {
        continue;
      }

      card.position = optimisticPosition.position;
      applied = true;
    }

    return applied ? next : snapshot;
  }

  applyViewportClampedBattlefieldPositions(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.viewportClampedBattlefieldPositions.size === 0) {
      return snapshot;
    }

    let next: GameSnapshot | null = null;
    for (const clamp of this.viewportClampedBattlefieldPositions.values()) {
      const card = (next ?? snapshot).players[clamp.playerId]?.zones.battlefield.find(
        (candidate) => candidate.instanceId === clamp.instanceId,
      );
      if (isRatioPosition(card?.position)) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      const position = card ? this.selectors.cardPosition(card, this.layoutSize()) : null;
      if (!card || !position) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      if (!this.samePosition(position, clamp.sourcePosition) && !this.samePosition(position, clamp.clampedPosition)) {
        this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey(clamp));
        continue;
      }

      if (this.samePosition(position, clamp.clampedPosition)) {
        continue;
      }

      next ??= structuredClone(snapshot);
      const nextCard = next.players[clamp.playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === clamp.instanceId);
      if (nextCard) {
        nextCard.position = clamp.clampedPosition;
      }
    }

    return next ?? snapshot;
  }

  moveLocalCardsFromHandToBattlefield(
    context: GameTableBattlefieldContext,
    playerId: string,
    targetPlayerId: string,
    movedInstanceIds: readonly string[],
    position?: GameCardPosition,
  ): boolean {
    const snapshot = context.snapshot();
    if (!snapshot || movedInstanceIds.length === 0 || !snapshot.players[playerId] || !snapshot.players[targetPlayerId]) {
      return false;
    }

    const movedIds = new Set(movedInstanceIds);
    const next = structuredClone(snapshot);
    const sourcePlayer = next.players[playerId];
    const targetPlayer = next.players[targetPlayerId];
    if (!sourcePlayer || !targetPlayer) {
      return false;
    }

    const movedCards = sourcePlayer.zones.hand.filter((card) => movedIds.has(card.instanceId));
    if (movedCards.length !== movedIds.size) {
      return false;
    }

    sourcePlayer.zones.hand = sourcePlayer.zones.hand.filter((card) => !movedIds.has(card.instanceId));
    targetPlayer.zones.battlefield = [
      ...targetPlayer.zones.battlefield.filter((card) => !movedIds.has(card.instanceId)),
      ...movedCards.map((card) => ({
        ...card,
        ...(position ? { position } : {}),
      })),
    ];

    if (sourcePlayer.zoneCounts) {
      sourcePlayer.zoneCounts = {
        ...sourcePlayer.zoneCounts,
        hand: sourcePlayer.zones.hand.length,
      };
    }
    if (targetPlayer.zoneCounts) {
      targetPlayer.zoneCounts = {
        ...targetPlayer.zoneCounts,
        battlefield: targetPlayer.zones.battlefield.length,
      };
    }

    context.setSnapshot(next);

    return true;
  }

  snappedBattlefieldPosition(
    context: GameTableBattlefieldContext,
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    rawZone?: string,
  ): GameCardPosition {
    const snapped = rawZone === 'mana'
      ? position
      : this.battlefieldDrag.positionWithAlignmentGuide(
        context.battlefieldDragContext(),
        playerId,
        instanceId,
        position,
        context.alignmentGuideFor(playerId)?.y ?? null,
      );

    return this.ratioPositionForBattlefield(playerId, instanceId, snapped);
  }

  ratioPositionForBattlefield(playerId: string, instanceId: string, position: { x: number; y: number }): GameCardPosition {
    return ratioBattlefieldPosition(
      position,
      this.battlefieldElementSize(playerId),
      this.battlefieldCardSize(playerId, instanceId),
    );
  }

  private async persistBattlefieldPositionCommand(
    context: GameTableBattlefieldContext,
    gameId: string,
    positionCommand: BattlefieldPositionCommand,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = await this.commands.send(gameId, 'card.position.changed', payload);
      this.clearOptimisticBattlefieldPosition(positionCommand);
      context.setSnapshot(snapshot);
    } catch (error) {
      this.clearOptimisticBattlefieldPosition(positionCommand);
      context.setError(context.errorMessage(error));
    }
  }

  private clearOptimisticBattlefieldPosition(positionCommand: BattlefieldPositionCommand): void {
    const key = this.battlefieldPositionKey(positionCommand);
    const current = this.optimisticBattlefieldPositions.get(key);
    if (current && this.samePosition(current.position, positionCommand.position)) {
      this.optimisticBattlefieldPositions.delete(key);
    }
  }

  private battlefieldPositionCommand(payload: Record<string, unknown>): BattlefieldPositionCommand | null {
    const playerId = this.stringPayload(payload, 'playerId');
    const zone = this.zonePayload(payload, 'zone');
    const instanceId = this.stringPayload(payload, 'instanceId');
    const position = this.positionPayload(payload['position']);
    if (!playerId || zone !== 'battlefield' || !instanceId || !position) {
      return null;
    }

    return { playerId, instanceId, position };
  }

  private positionPayload(value: unknown): GameCardPosition | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as { x?: unknown; y?: unknown; unit?: unknown };
    if (
      typeof candidate.x !== 'number'
      || !Number.isFinite(candidate.x)
      || typeof candidate.y !== 'number'
      || !Number.isFinite(candidate.y)
    ) {
      return null;
    }

    return candidate.unit === 'ratio'
      ? { x: candidate.x, y: candidate.y, unit: 'ratio' }
      : { x: candidate.x, y: candidate.y };
  }

  private stringPayload(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key];

    return typeof value === 'string' && value !== '' ? value : null;
  }

  private zonePayload(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key];

    return typeof value === 'string' && value !== '' ? value : null;
  }

  private battlefieldPositionKey(positionCommand: Pick<BattlefieldPositionCommand, 'playerId' | 'instanceId'>): string {
    return `${positionCommand.playerId}:${positionCommand.instanceId}`;
  }

  private samePosition(left: GameCardPosition, right: GameCardPosition): boolean {
    return sameBattlefieldPosition(left, right);
  }

  private clampBattlefieldPosition(
    position: { x: number; y: number },
    battlefieldWidth: number,
    battlefieldHeight: number,
    cardWidth: number,
    cardHeight: number,
  ): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(Math.round(battlefieldWidth - cardWidth), Math.round(position.x))),
      y: Math.max(0, Math.min(Math.round(battlefieldHeight - cardHeight), Math.round(position.y))),
    };
  }

  private battlefieldElementSize(playerId: string): BattlefieldSize {
    const battlefield = this.battlefieldElement(playerId);
    const bounds = battlefield ? this.battlefieldLayoutBounds(battlefield) : null;

    return bounds && bounds.width > 0 && bounds.height > 0
      ? { width: bounds.width, height: bounds.height }
      : this.layoutSize();
  }

  private battlefieldLayoutBounds(battlefield: HTMLElement): BattlefieldSize {
    const bounds = battlefield.getBoundingClientRect();

    return {
      width: Math.round(battlefield.clientWidth || bounds.width),
      height: Math.round(battlefield.clientHeight || bounds.height),
    };
  }

  private battlefieldCardSize(playerId: string, instanceId: string): { width: number; height: number } {
    const cardElement = Array.from(this.battlefieldElement(playerId)?.querySelectorAll<HTMLElement>(
      '[data-testid="game-card"][data-card-instance-id]',
    ) ?? []).find((element) => element.dataset['cardInstanceId'] === instanceId);
    const bounds = cardElement?.getBoundingClientRect();

    return {
      width: Math.max(1, Math.round(cardElement?.offsetWidth || bounds?.width || DEFAULT_BATTLEFIELD_CARD_SIZE.width)),
      height: Math.max(1, Math.round(cardElement?.offsetHeight || bounds?.height || DEFAULT_BATTLEFIELD_CARD_SIZE.height)),
    };
  }

  private battlefieldElement(playerId: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId) ?? null;
  }

}
