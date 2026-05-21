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
  visualWidth: number;
  visualHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  visualOffsetFromLogicalX: number;
  visualOffsetFromLogicalY: number;
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

interface DragPreviewSize {
  width: number;
  height: number;
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
  previewPosition?: { x: number; y: number };
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
      width: drag.visualWidth,
      height: drag.visualHeight,
    };
  }

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): boolean {
    if (event.button !== 0) {
      return false;
    }

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!target?.matches('[data-testid="game-card"][data-zone="battlefield"]')) {
      return false;
    }
    const visualBounds = this.cardVisualStartBounds(event);
    if (!visualBounds) {
      return false;
    }

    const battlefield = target.closest('.battlefield') as HTMLElement | null;
    if (!battlefield) {
      return false;
    }
    target.setPointerCapture?.(event.pointerId);

    const cardBounds = target.getBoundingClientRect();
    const visualWidth = visualBounds.width;
    const visualHeight = visualBounds.height;
    const logicalWidth = target.offsetWidth || cardBounds.width;
    const logicalHeight = target.offsetHeight || cardBounds.height;
    const fieldBounds = battlefield.getBoundingClientRect();
    const current = {
      x: target.offsetLeft,
      y: target.offsetTop,
    };
    const measuredVisualOffsetFromLogicalX = visualBounds.left - cardBounds.left;
    const measuredVisualOffsetFromLogicalY = visualBounds.top - cardBounds.top;
    const visualOffsetFromLogicalX = this.visualOffsetFromLogical(
      measuredVisualOffsetFromLogicalX,
      visualBounds.left,
      fieldBounds.left + current.x,
      visualWidth,
      logicalWidth,
    );
    const visualOffsetFromLogicalY = this.visualOffsetFromLogical(
      measuredVisualOffsetFromLogicalY,
      visualBounds.top,
      fieldBounds.top + current.y,
      visualHeight,
      logicalHeight,
    );
    const grabOffset = this.pointerOffsetWithinBounds(event.clientX, event.clientY, visualBounds, visualWidth, visualHeight);
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
      visualWidth,
      visualHeight,
      logicalWidth,
      logicalHeight,
      visualOffsetFromLogicalX,
      visualOffsetFromLogicalY,
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
    const position = this.pointerDragPositionFromVisualGeometry(
      this.pointerCardDrag.battlefield,
      event.clientX,
      event.clientY,
      this.pointerCardDrag.grabOffsetX,
      this.pointerCardDrag.grabOffsetY,
      this.pointerCardDrag.visualWidth,
      this.pointerCardDrag.visualHeight,
      this.pointerCardDrag.logicalWidth,
      this.pointerCardDrag.logicalHeight,
      this.pointerCardDrag.visualOffsetFromLogicalX,
      this.pointerCardDrag.visualOffsetFromLogicalY,
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
    if (!drag) {
      return null;
    }
    const previewPosition = this.pointerDragPreviewPosition(drag);

    const dropZone = event ? resolveDropZone(event, drag.playerId) : null;
    this.pointerCardDrag = null;
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
      ...(previewPosition ? { previewPosition } : {}),
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
    const rawY = manaLaneBounds
      ? Math.round(manaLaneBounds.bottom - bounds.top - cardHeight)
      : Math.round(clientY - bounds.top - offsetY);
    const availableHeight = manaLaneBounds ? Math.round(manaLaneBounds.bottom - bounds.top) : bounds.height;

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
    const topEdgeInLaneBand = cardTop >= bounds.top - topEdgeMagnetDistance && cardTop <= bounds.bottom;

    return horizontalOverlap && topEdgeInLaneBand ? manaLane : null;
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

  private pointerDragPositionFromVisualGeometry(
    battlefield: HTMLElement,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
    visualWidth: number,
    visualHeight: number,
    logicalWidth: number,
    logicalHeight: number,
    visualOffsetFromLogicalX: number,
    visualOffsetFromLogicalY: number,
  ): { x: number; y: number } {
    if (this.hasSameGeometry(visualWidth, visualHeight, logicalWidth, logicalHeight, visualOffsetFromLogicalX, visualOffsetFromLogicalY)) {
      return this.pointerDragPosition(battlefield, clientX, clientY, grabOffsetX, grabOffsetY, logicalWidth, logicalHeight);
    }

    const bounds = battlefield.getBoundingClientRect();
    let visualLeftViewport = clientX - grabOffsetX;
    let visualTopViewport = clientY - grabOffsetY;
    let visualBottomLimit = bounds.bottom;

    if (this.isInsideBounds(clientX, clientY, bounds)) {
      const manaLane = this.manaLaneForCardTop(battlefield, clientX, clientY, grabOffsetX, grabOffsetY, visualWidth);
      const manaLaneBounds = manaLane?.getBoundingClientRect();
      if (manaLaneBounds) {
        visualTopViewport = manaLaneBounds.bottom - visualHeight;
        visualBottomLimit = manaLaneBounds.bottom;
      }
    }

    const clampedVisualLeft = this.clampViewportPosition(visualLeftViewport, bounds.left, bounds.right - visualWidth);
    const clampedVisualTop = this.clampViewportPosition(visualTopViewport, bounds.top, visualBottomLimit - visualHeight);
    const logicalLeftViewport = clampedVisualLeft - visualOffsetFromLogicalX;
    const logicalTopViewport = clampedVisualTop - visualOffsetFromLogicalY;

    return {
      x: Math.round(logicalLeftViewport - bounds.left),
      y: Math.round(logicalTopViewport - bounds.top),
    };
  }

  private visualOffsetFromLogical(
    measuredOffset: number,
    visualStart: number,
    logicalStart: number,
    visualSize: number,
    logicalSize: number,
  ): number {
    if (visualSize !== logicalSize) {
      return visualStart - logicalStart;
    }

    return measuredOffset;
  }

  private hasSameGeometry(
    visualWidth: number,
    visualHeight: number,
    logicalWidth: number,
    logicalHeight: number,
    visualOffsetFromLogicalX: number,
    visualOffsetFromLogicalY: number,
  ): boolean {
    return visualOffsetFromLogicalX === 0
      && visualOffsetFromLogicalY === 0
      && visualWidth === logicalWidth
      && visualHeight === logicalHeight;
  }

  private clampViewportPosition(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(Math.max(min, max), value));
  }

  private isInsideBounds(clientX: number, clientY: number, bounds: DOMRect): boolean {
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  private cardVisualStartBounds(event: PointerEvent): DOMRect | null {
    const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const visual = current?.querySelector<HTMLElement>('.card-visual') ?? null;
    const visualBounds = visual?.getBoundingClientRect();
    if (visualBounds && visualBounds.width > 0 && visualBounds.height > 0) {
      return this.isInsideBounds(event.clientX, event.clientY, visualBounds) ? visualBounds : null;
    }

    const source = event.target instanceof Element ? event.target : null;
    if (source === null || source.closest('.card-visual') !== null) {
      return current?.getBoundingClientRect() ?? null;
    }

    return null;
  }

  private clampPosition(x: number, y: number, width: number, height: number, cardWidth: number, cardHeight: number): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(Math.round(width - cardWidth), x)),
      y: Math.max(0, Math.min(Math.round(height - cardHeight), y)),
    };
  }

  private setCardDragImage(event: DragEvent): void {
    try {
      this.trySetCardDragImage(event);
    } catch {
      this.dragImageGeometry = null;
    }
  }

  private trySetCardDragImage(event: DragEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.game-card, .hand-card, .zone-stack, .zone-art img, .zone-art .card-back, .zone-art')
      : null;
    const zoneArt = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>('.zone-art')
      ?? (target?.classList.contains('zone-stack') ? target.querySelector<HTMLElement>('.zone-art') : null);
    const source = this.dragImageSource(zoneArt) ?? target;
    if (!source || !event.dataTransfer) {
      return;
    }

    let preview: { element: HTMLElement; width: number; height: number } | null = null;
    const bounds = source.getBoundingClientRect();
    try {
      const normalizedSize = zoneArt ? this.battlefieldCardPreviewSize() : null;
      preview = this.createNativeCardDragPreview(source, normalizedSize);
      const offset = this.pointerOffsetForDragPreview(event.clientX, event.clientY, bounds, preview);
      this.dragImageGeometry = {
        width: preview.width,
        height: preview.height,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      event.dataTransfer.setDragImage(preview.element, this.dragImageGeometry.offsetX, this.dragImageGeometry.offsetY);
      window.setTimeout(() => preview?.element.remove(), 0);
    } catch (error) {
      preview?.element.remove();
      throw error;
    }
  }

  private dragImageSource(zoneArt: HTMLElement | null): HTMLElement | null {
    return zoneArt?.querySelector<HTMLElement>('.zone-card-stack-top')
      ?? zoneArt?.querySelector<HTMLElement>('.zone-card-image')
      ?? zoneArt?.querySelector<HTMLElement>('img')
      ?? zoneArt?.querySelector<HTMLElement>('.card-back')
      ?? null;
  }

  private createNativeCardDragPreview(source: HTMLElement, forcedSize: DragPreviewSize | null = null): { element: HTMLElement; width: number; height: number } {
    const sourceRect = source.getBoundingClientRect();
    const width = Math.max(1, forcedSize?.width ?? sourceRect.width);
    const height = Math.max(1, forcedSize?.height ?? sourceRect.height);
    const preview = document.createElement('div');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.position = 'fixed';
    preview.style.left = '-10000px';
    preview.style.top = '-10000px';
    preview.style.zIndex = '5000';
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    preview.style.overflow = 'visible';
    preview.style.boxShadow = [
      '0 20px 46px rgb(0 0 0 / 50%)',
      '0 0 0 1px rgb(255 255 255 / 10%)',
    ].join(', ');
    preview.style.filter = 'brightness(1.03) saturate(1.03)';
    preview.style.opacity = '1';
    preview.style.pointerEvents = 'none';
    preview.style.transform = 'none';
    preview.style.transformOrigin = '50% 50%';
    preview.appendChild(this.createNativeCardDragPreviewContent(source, { width, height }));
    document.body.appendChild(preview);

    return { element: preview, width, height };
  }

  private createNativeCardDragPreviewContent(source: HTMLElement, size: DragPreviewSize): HTMLElement {
    const sourceRect = source.getBoundingClientRect();
    const sourceStyle = window.getComputedStyle(source);
    const layoutWidth = Math.max(1, Math.round(size.width || source.offsetWidth || sourceRect.width));
    const layoutHeight = Math.max(1, Math.round(size.height || source.offsetHeight || sourceRect.height));
    const positioner = document.createElement('div');
    positioner.style.position = 'absolute';
    positioner.style.left = '50%';
    positioner.style.top = '50%';
    positioner.style.width = `${layoutWidth}px`;
    positioner.style.height = `${layoutHeight}px`;
    positioner.style.overflow = 'visible';
    positioner.style.pointerEvents = 'none';
    positioner.style.transform = 'translate(-50%, -50%)';
    positioner.style.transformOrigin = '50% 50%';

    const clone = source.cloneNode(true) as HTMLElement;
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('id');
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.transform = sourceStyle.transform === 'none' ? 'none' : sourceStyle.transform;
    clone.style.transformOrigin = sourceStyle.transformOrigin;

    for (const image of Array.from(clone.querySelectorAll('img'))) {
      image.draggable = false;
      image.style.pointerEvents = 'none';
      image.style.userSelect = 'none';
    }

    positioner.appendChild(clone);

    return positioner;
  }

  private pointerOffsetForDragPreview(
    clientX: number,
    clientY: number,
    sourceBounds: DOMRect,
    previewSize: DragPreviewSize = sourceBounds,
  ): { x: number; y: number } {
    const fallback = { x: previewSize.width / 2, y: previewSize.height / 2 };
    if (
      !Number.isFinite(clientX)
      || !Number.isFinite(clientY)
      || sourceBounds.width <= 0
      || sourceBounds.height <= 0
    ) {
      return fallback;
    }

    const sourceX = clientX - sourceBounds.left;
    const sourceY = clientY - sourceBounds.top;
    if (sourceX < 0 || sourceX > sourceBounds.width || sourceY < 0 || sourceY > sourceBounds.height) {
      return fallback;
    }

    return {
      x: (sourceX / sourceBounds.width) * previewSize.width,
      y: (sourceY / sourceBounds.height) * previewSize.height,
    };
  }

  private battlefieldCardPreviewSize(): DragPreviewSize {
    const battlefieldCard = document.querySelector<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"].game-card');
    const bounds = battlefieldCard?.getBoundingClientRect();
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      return { width: bounds.width, height: bounds.height };
    }

    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const width = rootFontSize * 7.2;

    return { width, height: width / 0.716 };
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

  private pointerDragPreviewPosition(drag: PointerCardDrag): { x: number; y: number } | null {
    const preview = this.pointerDragPreview();
    if (!preview) {
      return null;
    }

    const bounds = drag.battlefield.getBoundingClientRect();

    return this.clampPosition(
      Math.round(preview.x - bounds.left - drag.visualOffsetFromLogicalX),
      Math.round(preview.y - bounds.top - drag.visualOffsetFromLogicalY),
      bounds.width,
      bounds.height,
      drag.logicalWidth,
      drag.logicalHeight,
    );
  }
}
