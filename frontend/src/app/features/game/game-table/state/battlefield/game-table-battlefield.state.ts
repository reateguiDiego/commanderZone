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
import { BattlefieldPositionBatchCommand, BattlefieldPositionCommand, ViewportClampedBattlefieldPosition } from '../../models/game-table-battlefield.model';
import {
  GameTableBattlefieldDragContext,
  GameTableBattlefieldDragCoordinatorService,
} from '../../services/game-table-battlefield-drag-coordinator.service';
import { AlignmentGuide } from '../drag-drop/game-table-battlefield-drag.state';
import { GameTableSnapshotSelectors } from '../core/game-table-snapshot-selectors';
import { buildAttachmentStackGroups } from '../../utils/attachment-stack';
import { buildLandStackGroups } from '../../utils/land-stack';

export interface GameTableBattlefieldContext {
  readonly snapshot: () => GameSnapshot | null;
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly setError: (message: string) => void;
  readonly errorMessage: (error: unknown) => string;
  readonly battlefieldDragContext: () => GameTableBattlefieldDragContext;
  readonly alignmentGuideFor: (playerId: string) => AlignmentGuide | null;
}

interface MeasuredBattlefieldCard {
  readonly card: GameCardInstance;
  readonly currentPosition: { x: number; y: number };
  readonly sourcePosition: { x: number; y: number };
  readonly cardSize: { width: number; height: number };
}

@Injectable()
export class GameTableBattlefieldState {
  private battlefieldPositionQueue: Promise<void> = Promise.resolve();
  private readonly optimisticBattlefieldPositions = new Map<string, BattlefieldPositionCommand>();
  private readonly viewportClampedBattlefieldPositions = new Map<string, ViewportClampedBattlefieldPosition>();
  private readonly battlefieldDrag = inject(GameTableBattlefieldDragCoordinatorService);
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
      const measuredCards = new Map<string, MeasuredBattlefieldCard>();
      for (const card of sourceCards) {
        const cardElement = cardElements.get(card.instanceId);
        const cardBounds = cardElement?.getBoundingClientRect();
        const cardWidth = Math.max(1, Math.round(cardElement?.offsetWidth || cardBounds?.width || 116));
        const cardHeight = Math.max(1, Math.round(cardElement?.offsetHeight || cardBounds?.height || 162));
        const cardSize = { width: cardWidth, height: cardHeight };
        const currentPosition = this.selectors.cardPosition(card, { width: bounds.width, height: bounds.height }, isRatioPosition(card.position) ? cardSize : undefined);
        if (!currentPosition) {
          continue;
        }

        const positionKey = this.battlefieldPositionKey({ playerId, instanceId: card.instanceId });
        if (isRatioPosition(card.position)) {
          this.viewportClampedBattlefieldPositions.delete(positionKey);
        } else {
          const existingClamp = this.viewportClampedBattlefieldPositions.get(positionKey);
          const sourcePosition = existingClamp && this.samePosition(existingClamp.clampedPosition, currentPosition)
            ? existingClamp.sourcePosition
            : currentPosition;
          measuredCards.set(card.instanceId, { card, currentPosition, sourcePosition, cardSize });
          continue;
        }

        measuredCards.set(card.instanceId, { card, currentPosition, sourcePosition: currentPosition, cardSize });
      }

      const sourcePositionFor = (card: GameCardInstance): { x: number; y: number } | null =>
        measuredCards.get(card.instanceId)?.sourcePosition ?? null;
      const processed = new Set<string>();

      for (const group of buildLandStackGroups(sourceCards, sourcePositionFor)) {
        for (const member of group.members) {
          processed.add(member.card.instanceId);
          this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey({ playerId, instanceId: member.card.instanceId }));
        }
      }
      for (const group of buildAttachmentStackGroups(sourceCards, snapshot.attachments ?? [], sourcePositionFor)) {
        for (const member of group.members) {
          processed.add(member.card.instanceId);
          this.viewportClampedBattlefieldPositions.delete(this.battlefieldPositionKey({ playerId, instanceId: member.card.instanceId }));
        }
      }

      for (const measured of measuredCards.values()) {
        if (processed.has(measured.card.instanceId)) {
          continue;
        }

        const clamped = this.clampBattlefieldPosition(
          measured.sourcePosition,
          bounds.width,
          bounds.height,
          measured.cardSize.width,
          measured.cardSize.height,
        );
        nextSnapshot = this.applyReflowedPosition(snapshot, nextSnapshot, playerId, bounds, measured, measured.sourcePosition, clamped);
      }
    }

    if (nextSnapshot) {
      context.setSnapshot(nextSnapshot);
    }
  }

  private applyReflowedPosition(
    snapshot: GameSnapshot,
    nextSnapshot: GameSnapshot | null,
    playerId: string,
    bounds: BattlefieldSize,
    measured: MeasuredBattlefieldCard,
    sourcePosition: { x: number; y: number },
    nextPosition: { x: number; y: number },
  ): GameSnapshot | null {
    const positionKey = this.battlefieldPositionKey({ playerId, instanceId: measured.card.instanceId });

    if (isRatioPosition(measured.card.position)) {
      this.viewportClampedBattlefieldPositions.delete(positionKey);
      const ratioPosition = ratioBattlefieldPosition(nextPosition, bounds, measured.cardSize);
      if (sameBattlefieldPosition(measured.card.position, ratioPosition)) {
        return nextSnapshot;
      }

      nextSnapshot ??= structuredClone(snapshot);
      const nextCard = nextSnapshot.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === measured.card.instanceId);
      if (nextCard) {
        nextCard.position = ratioPosition;
      }

      return nextSnapshot;
    }

    if (this.samePosition(nextPosition, sourcePosition)) {
      this.viewportClampedBattlefieldPositions.delete(positionKey);
      if (this.samePosition(measured.currentPosition, sourcePosition)) {
        return nextSnapshot;
      }
    } else {
      this.viewportClampedBattlefieldPositions.set(positionKey, {
        playerId,
        instanceId: measured.card.instanceId,
        sourcePosition,
        clampedPosition: nextPosition,
      });
      if (this.samePosition(measured.currentPosition, nextPosition)) {
        return nextSnapshot;
      }
    }

    nextSnapshot ??= structuredClone(snapshot);
    const nextCard = nextSnapshot.players[playerId]?.zones.battlefield.find((candidate) => candidate.instanceId === measured.card.instanceId);
    if (nextCard) {
      nextCard.position = nextPosition;
    }

    return nextSnapshot;
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

  tryQueueBattlefieldPositionCommand(
    context: GameTableBattlefieldContext,
    _gameId: string,
    payload: Record<string, unknown>,
    persist: () => Promise<void>,
  ): boolean {
    const positionBatch = this.battlefieldPositionBatchCommand(payload);
    if (!positionBatch) {
      return false;
    }

    for (const positionCommand of positionBatch.positions) {
      this.optimisticBattlefieldPositions.set(this.battlefieldPositionKey(positionCommand), positionCommand);
    }
    this.battlefieldPositionQueue = this.battlefieldPositionQueue
      .catch(() => undefined)
      .then(() => this.persistBattlefieldPositionCommand(context, positionBatch, persist));

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
    positionBatch: BattlefieldPositionBatchCommand,
    persist: () => Promise<void>,
  ): Promise<void> {
    try {
      await persist();
      this.clearOptimisticBattlefieldPositions(positionBatch);
    } catch (error) {
      this.clearOptimisticBattlefieldPositions(positionBatch);
      context.setError(context.errorMessage(error));
    }
  }

  private clearOptimisticBattlefieldPositions(positionBatch: BattlefieldPositionBatchCommand): void {
    for (const positionCommand of positionBatch.positions) {
      this.clearOptimisticBattlefieldPosition(positionCommand);
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

  private battlefieldPositionBatchCommand(payload: Record<string, unknown>): BattlefieldPositionBatchCommand | null {
    const single = this.battlefieldPositionCommand(payload);
    if (single) {
      return { playerId: single.playerId, positions: [single] };
    }

    const playerId = this.stringPayload(payload, 'playerId');
    const zone = this.zonePayload(payload, 'zone');
    const positions = payload['positions'];
    if (!playerId || zone !== 'battlefield' || !Array.isArray(positions) || positions.length === 0) {
      return null;
    }

    const normalized = positions
      .map((entry) => this.battlefieldPositionCommand({
        playerId,
        zone,
        ...(entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}),
      }))
      .filter((entry): entry is BattlefieldPositionCommand => entry !== null);
    if (normalized.length !== positions.length) {
      return null;
    }

    return { playerId, positions: normalized };
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
