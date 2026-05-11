import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface PointerDropTarget {
  targetPlayerId: string;
  toZone: GameZoneName;
  kind: 'zone' | 'player';
  rawZone?: string;
  draggedInstanceId?: string;
  position?: { x: number; y: number };
}

export interface PointerCardSize {
  width: number;
  height: number;
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

  zoneTargetAt(event: PointerEvent, cardSize: PointerCardSize): PointerDropTarget | null {
    for (const element of this.elementsFromPoint(event.clientX, event.clientY)) {
      const playerTarget = element.closest<HTMLElement>('[data-player-drop-target]');
      const playerTargetId = playerTarget?.dataset['playerDropTarget'];
      if (playerTargetId) {
        return {
          targetPlayerId: playerTargetId,
          toZone: 'battlefield',
          kind: 'player',
        };
      }

      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const targetPlayerId = target?.dataset['playerId'];
      const rawZone = target?.dataset['zone'];
      if (!targetPlayerId || !rawZone || rawZone === 'hand') {
        continue;
      }

      const battlefield = target.classList.contains('battlefield')
        ? target
        : target.closest<HTMLElement>('.battlefield');
      const manaLane = rawZone === 'mana'
        ? target.closest<HTMLElement>('[data-mana-lane]')
        : this.manaLaneForPointerOrCard(battlefield, event.clientX, event.clientY, cardSize.width, cardSize.height);
      const effectiveRawZone = manaLane ? 'mana' : rawZone;
      const toZone = effectiveRawZone === 'mana' ? 'battlefield' : effectiveRawZone;
      if (!this.isGameZone(toZone)) {
        continue;
      }

      return {
        targetPlayerId,
        toZone,
        kind: 'zone',
        rawZone: effectiveRawZone,
        ...(toZone === 'battlefield'
          ? { position: this.battlefieldPointerPosition(manaLane ?? target, event, cardSize) }
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
    cardSize: PointerCardSize,
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
    const rawX = Math.round(event.clientX - bounds.left - cardSize.width / 2);
    const rawY = manaLaneBounds
      ? Math.round(manaLaneBounds.top - bounds.top + 8)
      : Math.round(event.clientY - bounds.top - cardSize.height / 2);

    return {
      x: Math.max(0, Math.min(Math.round(bounds.width - cardSize.width), rawX)),
      y: Math.max(0, Math.min(Math.round(bounds.height - cardSize.height), rawY)),
    };
  }

  private manaLaneForPointerOrCard(
    battlefield: HTMLElement | null,
    clientX: number,
    clientY: number,
    cardWidth: number,
    cardHeight: number,
  ): HTMLElement | null {
    const manaLane = battlefield?.querySelector<HTMLElement>('[data-mana-lane]');
    if (!manaLane) {
      return null;
    }

    const bounds = manaLane.getBoundingClientRect();
    const pointerInsideLane = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom + 16;
    if (pointerInsideLane) {
      return manaLane;
    }

    const cardBounds = {
      left: clientX - cardWidth / 2,
      right: clientX + cardWidth / 2,
      top: clientY - cardHeight / 2,
      bottom: clientY + cardHeight / 2,
    };
    const horizontalOverlap = cardBounds.right >= bounds.left && cardBounds.left <= bounds.right;
    const verticalOverlap = Math.min(cardBounds.bottom, bounds.bottom) - Math.max(cardBounds.top, bounds.top);

    return horizontalOverlap && verticalOverlap >= 12 ? manaLane : null;
  }

  private isGameZone(zone: string): zone is GameZoneName {
    return ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(zone);
  }
}
