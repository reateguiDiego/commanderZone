import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

interface PointerCardDrag {
  playerId: string;
  instanceId: string;
  battlefield: HTMLElement;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  cardWidth: number;
  cardHeight: number;
  moved: boolean;
  position: { x: number; y: number };
}

interface DragPayload {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  instanceIds: string[];
}

interface DragImageGeometry {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface PointerDragPreviewGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointerDragResult {
  playerId: string;
  instanceId: string;
  moved: boolean;
  position: { x: number; y: number };
  dropZone: GameZoneName | null;
  battlefield: HTMLElement;
}

@Injectable()
export class GameTableDragService {
  private pointerCardDrag: PointerCardDrag | null = null;
  private suppressCardClickInstanceId: string | null = null;
  private dragImageGeometry: DragImageGeometry | null = null;

  hasActivePointerDrag(): boolean {
    return this.pointerCardDrag !== null;
  }

  pointerDragPreview(): PointerDragPreviewGeometry | null {
    const drag = this.pointerCardDrag;
    if (!drag) {
      return null;
    }

    return {
      x: Math.round(drag.clientX - drag.grabOffsetX),
      y: Math.round(drag.clientY - drag.grabOffsetY),
      width: drag.cardWidth,
      height: drag.cardHeight,
    };
  }

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): boolean {
    if (event.button !== 0) {
      return false;
    }

    const target = event.currentTarget as HTMLElement;
    const battlefield = target.closest('.battlefield') as HTMLElement | null;
    if (!battlefield) {
      return false;
    }
    target.setPointerCapture?.(event.pointerId);

    const cardBounds = target.getBoundingClientRect();
    const cardWidth = target.offsetWidth || cardBounds.width;
    const cardHeight = target.offsetHeight || cardBounds.height;
    const fieldBounds = battlefield.getBoundingClientRect();
    const current = card.position ?? {
      x: target.offsetLeft || Math.max(0, Math.round(cardBounds.left - fieldBounds.left)),
      y: target.offsetTop || Math.max(0, Math.round(cardBounds.top - fieldBounds.top)),
    };
    const grabOffset = this.pointerOffsetWithinBounds(event.clientX, event.clientY, cardBounds, cardWidth, cardHeight);
    this.pointerCardDrag = {
      playerId,
      instanceId: card.instanceId,
      battlefield,
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: grabOffset.x,
      grabOffsetY: grabOffset.y,
      cardWidth,
      cardHeight,
      moved: false,
      position: current,
    };

    return true;
  }

  moveCardPointerDrag(
    event: PointerEvent,
    updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void,
  ): string | null {
    if (!this.pointerCardDrag) {
      return null;
    }
    const position = this.pointerDragPosition(
      this.pointerCardDrag.battlefield,
      event.clientX,
      event.clientY,
      this.pointerCardDrag.grabOffsetX,
      this.pointerCardDrag.grabOffsetY,
      this.pointerCardDrag.cardWidth,
      this.pointerCardDrag.cardHeight,
    );
    const distance = Math.hypot(event.clientX - this.pointerCardDrag.startClientX, event.clientY - this.pointerCardDrag.startClientY);
    if (distance < 4 && !this.pointerCardDrag.moved) {
      this.pointerCardDrag = { ...this.pointerCardDrag, clientX: event.clientX, clientY: event.clientY };
      return null;
    }
    event.preventDefault();
    const positionChanged = Math.abs(position.x - this.pointerCardDrag.position.x) > 1
      || Math.abs(position.y - this.pointerCardDrag.position.y) > 1;
    this.pointerCardDrag = {
      ...this.pointerCardDrag,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: true,
      position: positionChanged ? position : this.pointerCardDrag.position,
    };

    if (positionChanged) {
      updateLocalPosition(this.pointerCardDrag.playerId, this.pointerCardDrag.instanceId, position);
    }

    return this.pointerCardDrag.instanceId;
  }

  endCardPointerDrag(
    event: PointerEvent | undefined,
    resolveDropZone: (event: PointerEvent, playerId: string) => GameZoneName | null,
    updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void,
  ): PointerDragResult | null {
    if (event) {
      this.moveCardPointerDrag(event, updateLocalPosition);
    }
    const drag = this.pointerCardDrag;
    this.pointerCardDrag = null;
    if (!drag) {
      return null;
    }

    const dropZone = event ? resolveDropZone(event, drag.playerId) : null;
    if (drag.moved) {
      event?.preventDefault();
      event?.stopPropagation();
      this.suppressCardClickInstanceId = drag.instanceId;
      window.setTimeout(() => {
        if (this.suppressCardClickInstanceId === drag.instanceId) {
          this.suppressCardClickInstanceId = null;
        }
      }, 250);
    }

    return {
      playerId: drag.playerId,
      instanceId: drag.instanceId,
      moved: drag.moved,
      position: drag.position,
      dropZone,
      battlefield: drag.battlefield,
    };
  }

  cancelCardPointerDrag(event?: PointerEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.pointerCardDrag = null;
  }

  consumeSuppressedClick(instanceId: string): boolean {
    if (this.suppressCardClickInstanceId !== instanceId) {
      return false;
    }
    this.suppressCardClickInstanceId = null;
    return true;
  }

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance, instanceIds: readonly string[] = [card.instanceId]): void {
    const uniqueInstanceIds = [...new Set(instanceIds.length > 0 ? instanceIds : [card.instanceId])];
    this.dragImageGeometry = null;
    event.dataTransfer?.setData('application/json', JSON.stringify({
      playerId,
      zone,
      instanceId: card.instanceId,
      instanceIds: uniqueInstanceIds,
    }));
    event.dataTransfer?.setData('text/plain', card.instanceId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      this.setCardDragImage(event);
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  dragPayload(event: DragEvent, zones: GameZoneName[]): DragPayload | null {
    const raw = event.dataTransfer?.getData('application/json');
    if (!raw) {
      return null;
    }

    try {
      const payload = JSON.parse(raw) as { playerId?: string; zone?: string; instanceId?: string; instanceIds?: unknown };
      if (!payload.playerId || !payload.instanceId || !zones.includes(payload.zone as GameZoneName)) {
        return null;
      }

      const instanceIds = Array.isArray(payload.instanceIds)
        ? payload.instanceIds.filter((instanceId): instanceId is string => typeof instanceId === 'string' && instanceId !== '')
        : [];

      return {
        playerId: payload.playerId,
        zone: payload.zone as GameZoneName,
        instanceId: payload.instanceId,
        instanceIds: instanceIds.length > 0 ? [...new Set(instanceIds)] : [payload.instanceId],
      };
    } catch {
      return null;
    }
  }

  pointerDropZone(event: PointerEvent, playerId: string, zones: GameZoneName[]): GameZoneName | null {
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const zone = target?.dataset['zone'] as GameZoneName | undefined;
      if (target?.dataset['playerId'] === playerId && zone && zones.includes(zone)) {
        return zone;
      }
    }

    return null;
  }

  dropPosition(event: DragEvent, zone: GameZoneName): { x: number; y: number } | null {
    if (zone !== 'battlefield' || !(event.currentTarget instanceof HTMLElement)) {
      return null;
    }

    const battlefield = event.currentTarget.classList.contains('battlefield')
      ? event.currentTarget
      : event.currentTarget.closest<HTMLElement>('.battlefield');

    const geometry = this.dragImageGeometry;

    return battlefield
      ? this.positionInBattlefield(
        battlefield,
        event.clientX,
        event.clientY,
        geometry?.offsetX,
        geometry?.offsetY,
        geometry?.width,
        geometry?.height,
      )
      : null;
  }

  pointerPosition(event: PointerEvent, battlefield: HTMLElement): { x: number; y: number } {
    return this.positionInBattlefield(battlefield, event.clientX, event.clientY);
  }

  private positionInBattlefield(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    offsetX = 58,
    offsetY = 82,
    cardWidth = 116,
    cardHeight = 162,
  ): { x: number; y: number } {
    const bounds = battlefield.getBoundingClientRect();
    const manaLane = this.manaLaneForCardTop(battlefield, clientX, clientY, offsetX, offsetY, cardWidth);
    const manaLaneBounds = manaLane?.getBoundingClientRect();
    const rawY = manaLaneBounds ? Math.round(manaLaneBounds.top - bounds.top + 8) : Math.round(clientY - bounds.top - offsetY);
    const availableHeight = manaLaneBounds ? Math.round(manaLaneBounds.bottom - bounds.top - 8) : bounds.height;

    return this.clampPosition(Math.round(clientX - bounds.left - offsetX), rawY, bounds.width, availableHeight, cardWidth, cardHeight);
  }

  private manaLaneForCardTop(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
    cardWidth: number,
  ): HTMLElement | null {
    const manaLane = battlefield.querySelector<HTMLElement>('[data-mana-lane]');
    if (!manaLane) {
      return null;
    }

    const bounds = manaLane.getBoundingClientRect();
    const cardLeft = clientX - offsetX;
    const cardTop = clientY - offsetY;
    const cardRight = cardLeft + cardWidth;
    const horizontalOverlap = cardRight >= bounds.left && cardLeft <= bounds.right;
    const topEdgeMagnetDistance = 12;
    const topEdgeNearLane = Math.abs(cardTop - bounds.top) <= topEdgeMagnetDistance;

    return horizontalOverlap && topEdgeNearLane ? manaLane : null;
  }

  private pointerDragPosition(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
    cardWidth: number,
    cardHeight: number,
  ): { x: number; y: number } {
    const bounds = battlefield.getBoundingClientRect();
    if (this.isInsideBounds(clientX, clientY, bounds)) {
      return this.positionInBattlefield(battlefield, clientX, clientY, offsetX, offsetY, cardWidth, cardHeight);
    }

    return this.clampPosition(
      Math.round(clientX - bounds.left - offsetX),
      Math.round(clientY - bounds.top - offsetY),
      bounds.width,
      bounds.height,
      cardWidth,
      cardHeight,
    );
  }

  private isInsideBounds(clientX: number, clientY: number, bounds: DOMRect): boolean {
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  private clampPosition(x: number, y: number, width: number, height: number, cardWidth: number, cardHeight: number): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(Math.round(width - cardWidth), x)),
      y: Math.max(0, Math.min(Math.round(height - cardHeight), y)),
    };
  }

  private setCardDragImage(event: DragEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.game-card, .hand-card, .zone-stack, .zone-art img, .zone-art .card-back, .zone-art')
      : null;
    const zoneArt = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>('.zone-art')
      ?? (target?.classList.contains('zone-stack') ? target.querySelector<HTMLElement>('.zone-art') : null);
    const source = zoneArt?.querySelector<HTMLElement>('img, .card-back') ?? target;
    if (!source || !event.dataTransfer) {
      return;
    }

    const bounds = source.getBoundingClientRect();
    const offset = this.pointerOffsetWithinBounds(event.clientX, event.clientY, bounds, bounds.width, bounds.height);
    this.dragImageGeometry = {
      width: bounds.width,
      height: bounds.height,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    event.dataTransfer.setDragImage(source, this.dragImageGeometry.offsetX, this.dragImageGeometry.offsetY);
  }

  private pointerOffsetWithinBounds(clientX: number, clientY: number, bounds: DOMRect, width: number, height: number): { x: number; y: number } {
    const fallback = { x: width / 2, y: height / 2 };
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || width <= 0 || height <= 0) {
      return fallback;
    }

    const rawX = clientX - bounds.left;
    const rawY = clientY - bounds.top;
    if (rawX < 0 || rawX > width || rawY < 0 || rawY > height) {
      return fallback;
    }

    return { x: rawX, y: rawY };
  }
}
