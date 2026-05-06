import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

interface PointerCardDrag {
  playerId: string;
  instanceId: string;
  battlefield: HTMLElement;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
  cardWidth: number;
  cardHeight: number;
  moved: boolean;
  position: { x: number; y: number };
}

interface DragPayload {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
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

  hasActivePointerDrag(): boolean {
    return this.pointerCardDrag !== null;
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
    const fieldBounds = battlefield.getBoundingClientRect();
    const current = card.position ?? {
      x: target.offsetLeft || Math.max(0, Math.round(cardBounds.left - fieldBounds.left)),
      y: target.offsetTop || Math.max(0, Math.round(cardBounds.top - fieldBounds.top)),
    };
    const visualLeft = fieldBounds.left + current.x;
    const visualTop = fieldBounds.top + current.y;
    this.pointerCardDrag = {
      playerId,
      instanceId: card.instanceId,
      battlefield,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: event.clientX - visualLeft,
      offsetY: event.clientY - visualTop,
      cardWidth: target.offsetWidth || cardBounds.width,
      cardHeight: target.offsetHeight || cardBounds.height,
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
      document.elementFromPoint(event.clientX, event.clientY),
      this.pointerCardDrag.offsetX,
      this.pointerCardDrag.offsetY,
      this.pointerCardDrag.cardWidth,
      this.pointerCardDrag.cardHeight,
    );
    const distance = Math.hypot(event.clientX - this.pointerCardDrag.startClientX, event.clientY - this.pointerCardDrag.startClientY);
    if (distance < 4 && !this.pointerCardDrag.moved) {
      return null;
    }
    event.preventDefault();
    if (Math.abs(position.x - this.pointerCardDrag.position.x) > 1 || Math.abs(position.y - this.pointerCardDrag.position.y) > 1) {
      this.pointerCardDrag = { ...this.pointerCardDrag, moved: true, position };
      updateLocalPosition(this.pointerCardDrag.playerId, this.pointerCardDrag.instanceId, position);
      return this.pointerCardDrag.instanceId;
    }

    return this.pointerCardDrag.moved ? this.pointerCardDrag.instanceId : null;
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

  dragStart(event: DragEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    event.dataTransfer?.setData('application/json', JSON.stringify({ playerId, zone, instanceId: card.instanceId }));
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
      const payload = JSON.parse(raw) as { playerId?: string; zone?: string; instanceId?: string };
      if (!payload.playerId || !payload.instanceId || !zones.includes(payload.zone as GameZoneName)) {
        return null;
      }

      return { playerId: payload.playerId, zone: payload.zone as GameZoneName, instanceId: payload.instanceId };
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

    return battlefield ? this.positionInBattlefield(battlefield, event.clientX, event.clientY, event.currentTarget) : null;
  }

  pointerPosition(event: PointerEvent, battlefield: HTMLElement): { x: number; y: number } {
    return this.positionInBattlefield(battlefield, event.clientX, event.clientY, document.elementFromPoint(event.clientX, event.clientY));
  }

  private positionInBattlefield(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    eventTarget: EventTarget | Element | null,
    offsetX = 58,
    offsetY = 82,
    cardWidth = 116,
    cardHeight = 162,
  ): { x: number; y: number } {
    const bounds = battlefield.getBoundingClientRect();
    const target = eventTarget instanceof Element ? eventTarget : null;
    const manaLane = target?.closest<HTMLElement>('[data-mana-lane]');
    const manaLaneBounds = manaLane?.getBoundingClientRect();
    const rawY = manaLaneBounds ? Math.round(manaLaneBounds.top - bounds.top + 8) : Math.round(clientY - bounds.top - offsetY);
    const availableHeight = manaLaneBounds ? Math.round(manaLaneBounds.bottom - bounds.top - 8) : bounds.height;

    return this.clampPosition(Math.round(clientX - bounds.left - offsetX), rawY, bounds.width, availableHeight, cardWidth, cardHeight);
  }

  private pointerDragPosition(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    eventTarget: EventTarget | Element | null,
    offsetX: number,
    offsetY: number,
    cardWidth: number,
    cardHeight: number,
  ): { x: number; y: number } {
    const bounds = battlefield.getBoundingClientRect();
    if (this.isInsideBounds(clientX, clientY, bounds)) {
      return this.positionInBattlefield(battlefield, clientX, clientY, eventTarget, offsetX, offsetY, cardWidth, cardHeight);
    }

    return {
      x: Math.round(clientX - bounds.left - offsetX),
      y: Math.round(clientY - bounds.top - offsetY),
    };
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
    event.dataTransfer.setDragImage(source, bounds.width / 2, bounds.height / 2);
  }
}
