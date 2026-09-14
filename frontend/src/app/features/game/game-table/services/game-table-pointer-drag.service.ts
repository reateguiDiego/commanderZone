import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { canDropCardOnZone } from '../utils/command-zone-drop';

export interface PointerDropTarget {
  targetPlayerId: string;
  toZone: GameZoneName;
  kind: 'zone' | 'player';
  rawZone?: string;
  draggedInstanceId?: string;
  position?: { x: number; y: number };
  pointerClient?: { x: number; y: number };
}

export interface PointerCardSize {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
}

export interface PointerDropTargetOptions {
  includeHand?: boolean;
  sourcePlayerId?: string;
  draggedCard?: GameCardInstance | null;
  knownCommanderInstanceIds?: ReadonlySet<string>;
  useBattlefieldCardSize?: boolean;
}

export interface HandPointerDropPreview {
  targetInstanceId: string;
  placement: 'before' | 'after';
}

interface HandCardPosition {
  card: GameCardInstance;
  index: number;
  midpoint: number;
}

@Injectable()
export class GameTablePointerDragService {
  handDropPreviewAt(
    root: ParentNode,
    playerId: string,
    clientX: number,
    cards: readonly GameCardInstance[],
    draggedInstanceId: string,
  ): HandPointerDropPreview | null {
    const positions = this.handCardPositions(root, playerId, cards, draggedInstanceId);
    if (positions.length === 0) {
      return null;
    }

    const beforeTarget = positions.find((position) => clientX < position.midpoint);
    if (beforeTarget) {
      return { targetInstanceId: beforeTarget.card.instanceId, placement: 'before' };
    }

    const afterTarget = positions.at(-1);

    return afterTarget ? { targetInstanceId: afterTarget.card.instanceId, placement: 'after' } : null;
  }

  zoneTargetAt(event: PointerEvent, cardSize: PointerCardSize, options: PointerDropTargetOptions = {}): PointerDropTarget | null {
    for (const element of this.elementsFromPoint(event.clientX, event.clientY)) {
      const playerTarget = element.closest<HTMLElement>('[data-player-drop-target]');
      const playerTargetId = playerTarget?.dataset['playerDropTarget'];
      if (playerTargetId && playerTargetId !== options.sourcePlayerId) {
        return {
          targetPlayerId: playerTargetId,
          toZone: 'battlefield',
          kind: 'player',
        };
      }

      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const targetPlayerId = target?.dataset['playerId'];
      const rawZone = target?.dataset['zone'];
      if (!targetPlayerId || !rawZone || rawZone === 'hand' && options.includeHand !== true) {
        continue;
      }

      const battlefield = target.classList.contains('battlefield')
        ? target
        : target.closest<HTMLElement>('.battlefield');
      const battlefieldCardSize = options.useBattlefieldCardSize === true
        ? this.battlefieldCardSize(battlefield, cardSize)
        : cardSize;
      const manaLane = this.manaLaneForCardTop(battlefield, event.clientX, event.clientY, battlefieldCardSize, cardSize);
      const effectiveRawZone = manaLane ? 'mana' : rawZone;
      const toZone = effectiveRawZone === 'mana' ? 'battlefield' : effectiveRawZone;
      if (!this.isGameZone(toZone) || !canDropCardOnZone(toZone, options.draggedCard ?? null, options.knownCommanderInstanceIds)) {
        continue;
      }

      return {
        targetPlayerId,
        toZone,
        kind: 'zone',
        rawZone: effectiveRawZone,
        ...(toZone === 'battlefield'
          ? { position: this.battlefieldPointerPosition(manaLane ?? target, event, cardSize, battlefieldCardSize) }
          : {}),
      };
    }

    return null;
  }

  isHandTargetAt(event: PointerEvent, playerId: string): boolean {
    return this.elementsFromPoint(event.clientX, event.clientY).some((element) => {
      const target = element.closest<HTMLElement>('[data-game-drop-zone]');

      return target?.dataset['playerId'] === playerId && target.dataset['zone'] === 'hand';
    });
  }

  elementsFromPoint(clientX: number, clientY: number): Element[] {
    if (typeof document.elementsFromPoint === 'function') {
      return document.elementsFromPoint(clientX, clientY);
    }

    const element = document.elementFromPoint?.(clientX, clientY);

    return element ? [element] : [];
  }

  private handCardPositions(
    root: ParentNode,
    playerId: string,
    cards: readonly GameCardInstance[],
    draggedInstanceId: string,
  ): HandCardPosition[] {
    const visibleCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
    const elements = Array.from(root.querySelectorAll<HTMLElement>(
      `[data-player-id="${playerId}"] [data-testid="game-card"][data-zone="hand"]`,
    ));

    return visibleCards
      .map((card, index) => {
        const element = elements.find((candidate) => candidate.dataset['cardInstanceId'] === card.instanceId);
        const bounds = element?.getBoundingClientRect();

        return {
          card,
          index,
          midpoint: bounds ? bounds.left + bounds.width / 2 : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => a.midpoint - b.midpoint || a.index - b.index);
  }

  private battlefieldPointerPosition(
    target: HTMLElement,
    event: PointerEvent,
    sourceCardSize: PointerCardSize,
    battlefieldCardSize: PointerCardSize,
  ): { x: number; y: number } | undefined {
    const battlefield = target.classList.contains('battlefield')
      ? target
      : target.closest<HTMLElement>('.battlefield');
    if (!battlefield) {
      return undefined;
    }

    const bounds = battlefield.getBoundingClientRect();
    const manaLane = target.closest<HTMLElement>('[data-mana-lane]');
    const manaLaneBounds = manaLane?.getBoundingClientRect();
    const offsetX = sourceCardSize.offsetX ?? sourceCardSize.width / 2;
    const offsetY = sourceCardSize.offsetY ?? sourceCardSize.height / 2;
    const rawX = Math.round(event.clientX - bounds.left - offsetX);
    const rawY = manaLaneBounds
      ? Math.round(manaLaneBounds.bottom - bounds.top - battlefieldCardSize.height)
      : Math.round(event.clientY - bounds.top - offsetY);

    return {
      x: Math.max(0, Math.min(Math.round(bounds.width - battlefieldCardSize.width), rawX)),
      y: Math.max(0, Math.min(Math.round(bounds.height - battlefieldCardSize.height), rawY)),
    };
  }

  private manaLaneForCardTop(
    battlefield: HTMLElement | null,
    clientX: number,
    clientY: number,
    cardSize: PointerCardSize,
    sourceCardSize: PointerCardSize = cardSize,
  ): HTMLElement | null {
    const manaLane = battlefield?.querySelector<HTMLElement>('[data-mana-lane]');
    if (!manaLane) {
      return null;
    }

    const bounds = manaLane.getBoundingClientRect();
    const offsetX = sourceCardSize.offsetX ?? sourceCardSize.width / 2;
    const offsetY = sourceCardSize.offsetY ?? sourceCardSize.height / 2;
    const cardLeft = clientX - offsetX;
    const cardTop = clientY - offsetY;
    const cardRight = cardLeft + cardSize.width;
    const horizontalOverlap = cardRight >= bounds.left && cardLeft <= bounds.right;
    const topEdgeMagnetDistance = 12;
    const topEdgeInLaneBand = cardTop >= bounds.top - topEdgeMagnetDistance && cardTop <= bounds.bottom;

    return horizontalOverlap && topEdgeInLaneBand ? manaLane : null;
  }

  private battlefieldCardSize(battlefield: HTMLElement | null, fallback: PointerCardSize): PointerCardSize {
    const card = battlefield?.querySelector<HTMLElement>('[data-testid="game-card"][data-card-instance-id]');
    const bounds = card?.getBoundingClientRect();
    if (card && bounds && bounds.width > 0 && bounds.height > 0) {
      return {
        width: Math.max(1, Math.round(card.offsetWidth || bounds.width)),
        height: Math.max(1, Math.round(card.offsetHeight || bounds.height)),
      };
    }

    const configuredWidth = battlefield
      ? this.cssLengthInPixels(getComputedStyle(battlefield).getPropertyValue('--battlefield-card-width'))
      : null;
    if (!configuredWidth) {
      return fallback;
    }

    return {
      width: configuredWidth,
      height: Math.max(1, Math.round(configuredWidth / 0.716)),
    };
  }

  private cssLengthInPixels(value: string): number | null {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    if (value.trim().endsWith('px')) {
      return Math.round(parsed);
    }

    if (value.trim().endsWith('rem')) {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

      return Number.isFinite(rootFontSize) && rootFontSize > 0
        ? Math.round(parsed * rootFontSize)
        : null;
    }

    return null;
  }

  private isGameZone(zone: string): zone is GameZoneName {
    return ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(zone);
  }

}
