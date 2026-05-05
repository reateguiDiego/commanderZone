import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../core/models/game.model';

interface PointerCardDrag {
  playerId: string;
  instanceId: string;
  battlefield: HTMLElement;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
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

    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const battlefield = target.closest('.battlefield') as HTMLElement | null;
    if (!battlefield) {
      return false;
    }

    const cardBounds = target.getBoundingClientRect();
    const fieldBounds = battlefield.getBoundingClientRect();
    const current = card.position ?? {
      x: Math.max(0, Math.round(cardBounds.left - fieldBounds.left)),
      y: Math.max(0, Math.round(cardBounds.top - fieldBounds.top)),
    };
    this.pointerCardDrag = {
      playerId,
      instanceId: card.instanceId,
      battlefield,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: event.clientX - cardBounds.left,
      offsetY: event.clientY - cardBounds.top,
      moved: false,
      position: current,
    };

    return true;
  }

  moveCardPointerDrag(
    event: PointerEvent,
    updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void,
  ): void {
    if (!this.pointerCardDrag) {
      return;
    }
    event.preventDefault();

    const bounds = this.pointerCardDrag.battlefield.getBoundingClientRect();
    const position = {
      x: Math.max(0, Math.round(event.clientX - bounds.left - this.pointerCardDrag.offsetX)),
      y: Math.max(0, Math.round(event.clientY - bounds.top - this.pointerCardDrag.offsetY)),
    };
    const distance = Math.hypot(event.clientX - this.pointerCardDrag.startClientX, event.clientY - this.pointerCardDrag.startClientY);
    if (distance < 4 && !this.pointerCardDrag.moved) {
      return;
    }
    if (Math.abs(position.x - this.pointerCardDrag.position.x) > 1 || Math.abs(position.y - this.pointerCardDrag.position.y) > 1) {
      this.pointerCardDrag = { ...this.pointerCardDrag, moved: true, position };
      updateLocalPosition(this.pointerCardDrag.playerId, this.pointerCardDrag.instanceId, position);
    }
  }

  endCardPointerDrag(
    event: PointerEvent | undefined,
    resolveDropZone: (event: PointerEvent, playerId: string) => GameZoneName | null,
    updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void,
  ): PointerDragResult | null {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      this.moveCardPointerDrag(event, updateLocalPosition);
    }
    const drag = this.pointerCardDrag;
    this.pointerCardDrag = null;
    if (!drag) {
      return null;
    }

    const dropZone = event ? resolveDropZone(event, drag.playerId) : null;
    if (drag.moved) {
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
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = element?.closest<HTMLElement>('[data-game-drop-zone]');
    const zone = target?.dataset['zone'] as GameZoneName | undefined;
    if (!target || target.dataset['playerId'] !== playerId || !zone || !zones.includes(zone)) {
      return null;
    }

    return zone;
  }

  dropPosition(event: DragEvent, zone: GameZoneName): { x: number; y: number } | null {
    if (zone !== 'battlefield' || !(event.currentTarget instanceof HTMLElement)) {
      return null;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    return {
      x: Math.max(0, Math.round(event.clientX - bounds.left - 58)),
      y: Math.max(0, Math.round(event.clientY - bounds.top - 82)),
    };
  }
}
