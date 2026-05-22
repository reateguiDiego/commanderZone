import { Injectable, inject, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import {
  ZonePointerDragMove,
  ZonePointerDragSource,
  ZonePointerDropRequest,
  ZonePointerDropResult,
} from '../models/game-table-zone-pointer-drag.model';
import { GameTablePointerDragService, PointerDropTarget } from './game-table-pointer-drag.service';

interface ActiveZonePointerDrag {
  readonly source: ZonePointerDragSource;
  readonly startX: number;
  readonly startY: number;
  readonly pointerTarget: HTMLElement | null;
  readonly dragging: boolean;
}

@Injectable()
export class GameTableZonePointerDragService {
  private readonly pointerDrag = inject(GameTablePointerDragService);
  private readonly dragThresholdPx = 12;
  private activeDrag: ActiveZonePointerDrag | null = null;

  readonly dragMove = signal<ZonePointerDragMove | null>(null);

  start(event: PointerEvent, playerId: string, fromZone: GameZoneName, card: GameCardInstance | null): boolean {
    if (!card || !this.isTouchLikePointer(event) || event.button !== 0) {
      return false;
    }

    const pointerTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const bounds = this.cardBounds(pointerTarget);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    pointerTarget?.setPointerCapture?.(event.pointerId);
    this.activeDrag = {
      source: {
        playerId,
        fromZone,
        card,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        cardWidth: bounds.width,
        cardHeight: bounds.height,
        offsetX: this.clamp(event.clientX - bounds.left, 0, bounds.width),
        offsetY: this.clamp(event.clientY - bounds.top, 0, bounds.height),
      },
      startX: event.clientX,
      startY: event.clientY,
      pointerTarget,
      dragging: false,
    };
    this.dragMove.set(null);

    return true;
  }

  move(event: PointerEvent): ZonePointerDragMove | null {
    const active = this.activeDrag;
    if (!active || event.pointerId !== active.source.pointerId) {
      return null;
    }

    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.dragging && distance < this.dragThresholdPx) {
      return null;
    }

    event.preventDefault();
    const dragging = true;
    const target = this.dropTarget(event, active.source);
    const move = this.dragMoveAt(event, active.source, target, dragging);
    this.activeDrag = { ...active, dragging };
    this.dragMove.set(move);

    return move;
  }

  end(event: PointerEvent): ZonePointerDropResult | null {
    const active = this.activeDrag;
    if (!active || event.pointerId !== active.source.pointerId) {
      return null;
    }

    const move = this.move(event) ?? this.dragMove();
    const moved = Boolean(this.activeDrag?.dragging || move?.dragging);
    this.releasePointer(active, event);
    this.activeDrag = null;
    this.dragMove.set(null);

    if (!moved) {
      return { source: active.source, request: null, moved: false };
    }

    event.preventDefault();
    event.stopPropagation();

    return {
      source: active.source,
      request: move?.target ? this.dropRequest(active.source, move.target) : null,
      moved: true,
    };
  }

  cancel(event: PointerEvent): ZonePointerDropResult | null {
    const active = this.activeDrag;
    if (!active || event.pointerId !== active.source.pointerId) {
      return null;
    }

    this.releasePointer(active, event);
    this.activeDrag = null;
    this.dragMove.set(null);

    return { source: active.source, request: null, moved: active.dragging };
  }

  private dropTarget(event: PointerEvent, source: ZonePointerDragSource): PointerDropTarget | null {
    const target = this.pointerDrag.zoneTargetAt(event, {
      width: source.cardWidth,
      height: source.cardHeight,
      offsetX: source.offsetX,
      offsetY: source.offsetY,
    }, { includeHand: true });

    return target
      ? {
          ...target,
          draggedInstanceId: source.card.instanceId,
          pointerClient: { x: event.clientX, y: event.clientY },
        }
      : null;
  }

  private dragMoveAt(
    event: PointerEvent,
    source: ZonePointerDragSource,
    target: PointerDropTarget | null,
    dragging: boolean,
  ): ZonePointerDragMove {
    return {
      source,
      x: event.clientX - source.offsetX,
      y: event.clientY - source.offsetY,
      target,
      dragging,
    };
  }

  private dropRequest(source: ZonePointerDragSource, target: PointerDropTarget): ZonePointerDropRequest {
    return {
      playerId: source.playerId,
      targetPlayerId: target.targetPlayerId,
      fromZone: source.fromZone,
      toZone: target.toZone,
      instanceId: source.card.instanceId,
      ...(target.rawZone ? { rawZone: target.rawZone } : {}),
      ...(target.position ? { position: target.position } : {}),
    };
  }

  private cardBounds(pointerTarget: HTMLElement | null): DOMRect | null {
    return pointerTarget?.querySelector<HTMLElement>('.zone-art')?.getBoundingClientRect()
      ?? pointerTarget?.getBoundingClientRect()
      ?? null;
  }

  private releasePointer(active: ActiveZonePointerDrag, event: PointerEvent): void {
    active.pointerTarget?.releasePointerCapture?.(event.pointerId);
  }

  private isTouchLikePointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
