import { Injectable, inject, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import {
  ZonePointerDragMove,
  ZonePointerDragSource,
  ZonePointerDropRequest,
  ZonePointerDropResult,
} from '../models/game-table-zone-pointer-drag.model';
import { GameTablePointerDragService, PointerCardSize, PointerDropTarget } from './game-table-pointer-drag.service';

interface ActiveZonePointerDrag {
  readonly source: ZonePointerDragSource;
  readonly knownCommanderInstanceIds: ReadonlySet<string>;
  readonly startX: number;
  readonly startY: number;
  readonly pointerTarget: HTMLElement | null;
  readonly dropCardSize: PointerCardSize;
  readonly battlefieldDropCardSize: PointerCardSize;
  readonly dragging: boolean;
}

interface ZonePointerDragStartOptions {
  readonly allowMouse?: boolean;
  readonly knownCommanderInstanceIds?: ReadonlySet<string>;
}

@Injectable()
export class GameTableZonePointerDragService {
  private readonly pointerDrag = inject(GameTablePointerDragService);
  private readonly dragThresholdPx = 12;
  private readonly cardAspectRatio = 0.716;
  private activeDrag: ActiveZonePointerDrag | null = null;

  readonly dragMove = signal<ZonePointerDragMove | null>(null);

  start(
    event: PointerEvent,
    playerId: string,
    fromZone: GameZoneName,
    card: GameCardInstance | null,
    options: ZonePointerDragStartOptions = {},
  ): boolean {
    if (!card || !this.canStartPointerDrag(event, options) || event.button !== 0) {
      return false;
    }

    const pointerTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const bounds = this.cardBounds(pointerTarget);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }
    const previewSize = this.previewCardSize(bounds);
    const offsetRatioX = this.clamp(event.clientX - bounds.left, 0, bounds.width) / bounds.width;
    const offsetRatioY = this.clamp(event.clientY - bounds.top, 0, bounds.height) / bounds.height;
    const dropCardSize = {
      width: bounds.width,
      height: bounds.height,
      offsetX: this.clamp(event.clientX - bounds.left, 0, bounds.width),
      offsetY: this.clamp(event.clientY - bounds.top, 0, bounds.height),
    };
    const battlefieldDropCardSize = {
      width: previewSize.width,
      height: previewSize.height,
      offsetX: this.clamp(offsetRatioX * previewSize.width, 0, previewSize.width),
      offsetY: this.clamp(offsetRatioY * previewSize.height, 0, previewSize.height),
    };

    pointerTarget?.setPointerCapture?.(event.pointerId);
    this.activeDrag = {
      source: {
        playerId,
        fromZone,
        card,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        cardWidth: previewSize.width,
        cardHeight: previewSize.height,
        offsetX: this.clamp(offsetRatioX * previewSize.width, 0, previewSize.width),
        offsetY: this.clamp(offsetRatioY * previewSize.height, 0, previewSize.height),
      },
      knownCommanderInstanceIds: options.knownCommanderInstanceIds ?? new Set<string>(),
      startX: event.clientX,
      startY: event.clientY,
      pointerTarget,
      dropCardSize,
      battlefieldDropCardSize,
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
    const target = this.dropTarget(
      event,
      active.source,
      active.knownCommanderInstanceIds,
      active.dropCardSize,
      active.battlefieldDropCardSize,
    );
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

  clearDropPreview(): void {
    this.dragMove.set(null);
  }

  private dropTarget(
    event: PointerEvent,
    source: ZonePointerDragSource,
    knownCommanderInstanceIds: ReadonlySet<string>,
    dropCardSize: PointerCardSize,
    battlefieldDropCardSize: PointerCardSize,
  ): PointerDropTarget | null {
    const target = this.pointerDrag.zoneTargetAt(event, dropCardSize, {
      includeHand: true,
      draggedCard: source.card,
      knownCommanderInstanceIds,
    });
    const normalizedBattlefieldTarget = target?.toZone === 'battlefield'
      ? this.pointerDrag.zoneTargetAt(event, battlefieldDropCardSize, {
          includeHand: true,
          draggedCard: source.card,
          knownCommanderInstanceIds,
        })
      : null;
    const resolvedTarget = normalizedBattlefieldTarget?.rawZone === 'mana'
      ? normalizedBattlefieldTarget
      : target;

    return resolvedTarget
      ? {
          ...resolvedTarget,
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

  private previewCardSize(bounds: DOMRect): { readonly width: number; readonly height: number } {
    const width = this.clamp(Math.round(bounds.width * 2.2), 88, 128);

    return {
      width,
      height: Math.round(width / this.cardAspectRatio),
    };
  }

  private releasePointer(active: ActiveZonePointerDrag, event: PointerEvent): void {
    active.pointerTarget?.releasePointerCapture?.(event.pointerId);
  }

  private isTouchLikePointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private canStartPointerDrag(event: PointerEvent, options: ZonePointerDragStartOptions): boolean {
    return this.isTouchLikePointer(event) || (options.allowMouse === true && event.pointerType === 'mouse');
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
