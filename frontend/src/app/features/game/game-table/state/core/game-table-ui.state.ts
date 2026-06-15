import { Injectable, signal } from '@angular/core';
import { GameCardDungeonMarker, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { CARD_PREVIEW_HOVER_DELAY_MS, CardPreviewEvent, CardPreviewSourceRect } from '../../models/card-preview.model';

const CONTEXT_MENU_WIDTH = 264;
const CONTEXT_MENU_COMPACT_WIDTH = 172;
const CONTEXT_MENU_ESTIMATED_HEIGHT = 360;
const CONTEXT_MENU_EDGE_GAP = 8;
const CONTEXT_MENU_CLICK_GAP = 4;
const PREVIEW_ESTIMATED_WIDTH = 288;
const PREVIEW_ESTIMATED_HEIGHT = 402;
const PREVIEW_ESTIMATED_MARGIN = 12;

export interface GameContextMenu {
  x: number;
  y: number;
  verticalOrigin?: 'top' | 'bottom';
  playerId: string;
  zone: GameZoneName;
  card?: GameCardInstance;
  arrowId?: string;
  counterKey?: string;
  suppressRandomSelect?: boolean;
  fromFixedZoneModal?: boolean;
  kind?: 'zone' | 'card' | 'game' | 'player' | 'arrow' | 'counter' | 'manaPool';
  sourceRect?: CardPreviewSourceRect | null;
}

export interface HoveredCardSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export interface DungeonMarkerPreviewOverride {
  readonly instanceId: string;
  readonly marker: GameCardDungeonMarker;
}

type CardPreviewMode = 'hover' | 'pinned';

@Injectable()
export class GameTableUiState {
  private readonly hoverPreviewDelayMs = CARD_PREVIEW_HOVER_DELAY_MS;
  private hoverPreviewSuppressedUntil = 0;

  readonly focusedPlayerId = signal<string | null>(null);
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly hoveredPreview = signal<CardPreviewEvent | null>(null);
  readonly dungeonMarkerPreviewOverride = signal<DungeonMarkerPreviewOverride | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
  readonly floatingMinimized = signal(false);
  private floatingDragOffset: { x: number; y: number } | null = null;
  private hoveredSelection: HoveredCardSelection | null = null;
  private cardPreviewMode: CardPreviewMode | null = null;
  private hoverPreviewHandle?: number;
  private hoverPreviewToken = 0;

  showCardPreview(preview: CardPreviewEvent, isDragging: () => boolean): void;
  showCardPreview(card: GameCardInstance, isDragging: () => boolean, playerId?: string, zone?: GameZoneName): void;
  showCardPreview(
    cardOrPreview: GameCardInstance | CardPreviewEvent,
    isDragging: () => boolean,
    playerId?: string,
    zone?: GameZoneName,
  ): void {
    this.clearHoverPreviewTimer();
    if (this.contextMenu()) {
      return;
    }

    const preview = this.normalizePreview(cardOrPreview, playerId, zone);
    const card = preview.card;
    if (card.hidden || isDragging() || Date.now() < this.hoverPreviewSuppressedUntil) {
      return;
    }

    const token = ++this.hoverPreviewToken;
    this.hoverPreviewHandle = window.setTimeout(() => {
      if (token !== this.hoverPreviewToken || isDragging() || this.contextMenu()) {
        return;
      }

      this.syncDungeonMarkerPreviewOverride(card);
      this.hoveredCard.set(card);
      this.hoveredPreview.set(preview);
      this.hoveredSelection = preview.playerId && preview.zone ? { playerId: preview.playerId, zone: preview.zone, card } : null;
      this.cardPreviewMode = 'hover';
    }, this.hoverPreviewDelayMs);
  }

  hideCardPreview(): void {
    if (this.cardPreviewMode === 'pinned') {
      this.clearHoverPreviewTimer();
      return;
    }

    this.clearCardPreview();
  }

  showPinnedCardPreview(preview: CardPreviewEvent, isDragging: () => boolean): void;
  showPinnedCardPreview(card: GameCardInstance, isDragging: () => boolean, playerId?: string, zone?: GameZoneName): void;
  showPinnedCardPreview(
    cardOrPreview: GameCardInstance | CardPreviewEvent,
    isDragging: () => boolean,
    playerId?: string,
    zone?: GameZoneName,
  ): void {
    this.clearHoverPreviewTimer();
    const preview = this.normalizePreview(cardOrPreview, playerId, zone);
    const card = preview.card;
    if (card.hidden || isDragging()) {
      return;
    }

    this.syncDungeonMarkerPreviewOverride(card);
    this.hoveredCard.set(card);
    this.hoveredPreview.set(preview);
    this.hoveredSelection = preview.playerId && preview.zone ? { playerId: preview.playerId, zone: preview.zone, card } : null;
    this.cardPreviewMode = 'pinned';
  }

  showImmediateCardPreview(preview: CardPreviewEvent, isDragging: () => boolean): void {
    this.clearHoverPreviewTimer();
    if (this.contextMenu()) {
      return;
    }

    const card = preview.card;
    if (card.hidden || isDragging()) {
      return;
    }

    this.syncDungeonMarkerPreviewOverride(card);
    this.hoveredCard.set(card);
    this.hoveredPreview.set(preview);
    this.hoveredSelection = preview.playerId && preview.zone ? { playerId: preview.playerId, zone: preview.zone, card } : null;
    this.cardPreviewMode = 'hover';
  }

  setDungeonMarkerPreviewOverride(override: DungeonMarkerPreviewOverride | null): void {
    this.dungeonMarkerPreviewOverride.set(override);
  }

  clearCardPreview(): void {
    this.clearHoverPreviewTimer();
    this.hoveredCard.set(null);
    this.hoveredPreview.set(null);
    this.dungeonMarkerPreviewOverride.set(null);
    this.hoveredSelection = null;
    this.cardPreviewMode = null;
  }

  activeHoveredSelection(): HoveredCardSelection | null {
    return this.hoveredSelection;
  }

  openContextMenu(event: MouseEvent, target: Omit<GameContextMenu, 'x' | 'y'>): void {
    this.clearCardPreview();
    this.contextMenu.set({ ...this.menuPosition(event.clientX, event.clientY, target), ...target });
  }

  openContextMenuAt(position: { x: number; y: number }, target: Omit<GameContextMenu, 'x' | 'y'>): void {
    this.clearCardPreview();
    this.contextMenu.set({ ...this.menuPosition(position.x, position.y, target), ...target });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  closeContextMenuForCardDrag(instanceId: string): void {
    const menu = this.contextMenu();
    if ((menu?.kind === 'card' || menu?.kind === 'counter') && menu.card?.instanceId === instanceId) {
      this.closeContextMenu();
    }
  }

  toggleFloatingMinimized(): void {
    this.floatingMinimized.update((value) => !value);
  }

  suppressCardPreview(durationMs: number): void {
    this.clearCardPreview();
    this.hoverPreviewSuppressedUntil = Date.now() + durationMs;
  }

  startFloatingDrag(event: PointerEvent): void {
    const panel = event.currentTarget as HTMLElement;
    const bounds = panel.getBoundingClientRect();
    this.floatingDragOffset = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    panel.setPointerCapture?.(event.pointerId);
  }

  moveFloatingPanel(event: PointerEvent): void {
    if (!this.floatingDragOffset) {
      return;
    }

    const width = 384;
    const height = 420;
    this.floatingPanel.set({
      x: Math.max(8, Math.min(event.clientX - this.floatingDragOffset.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY - this.floatingDragOffset.y, window.innerHeight - height - 8)),
    });
  }

  endFloatingDrag(): void {
    this.floatingDragOffset = null;
  }

  destroy(): void {
    this.clearHoverPreviewTimer();
  }

  private clearHoverPreviewTimer(): void {
    this.hoverPreviewToken++;
    if (this.hoverPreviewHandle !== undefined) {
      window.clearTimeout(this.hoverPreviewHandle);
      this.hoverPreviewHandle = undefined;
    }
  }

  private syncDungeonMarkerPreviewOverride(card: GameCardInstance): void {
    const override = this.dungeonMarkerPreviewOverride();
    if (override !== null && override.instanceId !== card.instanceId) {
      this.dungeonMarkerPreviewOverride.set(null);
    }
  }

  private normalizePreview(
    cardOrPreview: GameCardInstance | CardPreviewEvent,
    playerId?: string,
    zone?: GameZoneName,
  ): CardPreviewEvent {
    if ('card' in cardOrPreview) {
      return cardOrPreview;
    }

    return {
      card: cardOrPreview,
      playerId: playerId ?? '',
      zone: zone ?? 'battlefield',
      sourceRect: null,
    };
  }

  private menuPosition(
    clientX: number,
    clientY: number,
    target?: Pick<GameContextMenu, 'kind' | 'sourceRect'>,
  ): Pick<GameContextMenu, 'x' | 'y' | 'verticalOrigin'> {
    const width = target?.kind === 'counter' || target?.kind === 'arrow' ? CONTEXT_MENU_COMPACT_WIDTH : CONTEXT_MENU_WIDTH;
    const height = CONTEXT_MENU_ESTIMATED_HEIGHT;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const edgeGap = CONTEXT_MENU_EDGE_GAP;
    const clickGap = CONTEXT_MENU_CLICK_GAP;
    const openUp = clientY + height + edgeGap > viewportHeight;
    const edgeOffset = openUp
      ? Math.max(edgeGap, viewportHeight - clientY + clickGap)
      : Math.max(edgeGap, clientY + clickGap);
    const prefersLeftOfPointer = viewportWidth > 0 && viewportWidth < width * 2;
    const preferredX = this.shouldOpenLeftOfCard(clientX, edgeOffset, width, height, openUp, target)
      ? (target?.sourceRect?.left ?? clientX) - width - clickGap
      : prefersLeftOfPointer
        ? clientX - width - clickGap
        : clientX;

    return {
      x: Math.max(edgeGap, Math.min(preferredX, viewportWidth - width - edgeGap)),
      y: edgeOffset,
      verticalOrigin: openUp ? 'bottom' : 'top',
    };
  }

  private shouldOpenLeftOfCard(
    clientX: number,
    edgeOffset: number,
    width: number,
    height: number,
    openUp: boolean,
    target?: Pick<GameContextMenu, 'kind' | 'sourceRect'>,
  ): boolean {
    const source = target?.sourceRect;
    if (!source || (target?.kind !== 'card' && target?.kind !== 'counter')) {
      return false;
    }

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return false;
    }

    const top = openUp ? viewportHeight - edgeOffset - height : edgeOffset;
    const defaultMenuRect = {
      left: Math.max(CONTEXT_MENU_EDGE_GAP, Math.min(clientX, viewportWidth - width - CONTEXT_MENU_EDGE_GAP)),
      top,
      right: Math.max(CONTEXT_MENU_EDGE_GAP, Math.min(clientX, viewportWidth - width - CONTEXT_MENU_EDGE_GAP)) + width,
      bottom: top + height,
    };
    const estimatedPreviewRect = {
      left: Math.max(CONTEXT_MENU_EDGE_GAP, viewportWidth - PREVIEW_ESTIMATED_WIDTH - PREVIEW_ESTIMATED_MARGIN),
      top: Math.max(CONTEXT_MENU_EDGE_GAP, (viewportHeight - PREVIEW_ESTIMATED_HEIGHT) / 2),
      right: viewportWidth - PREVIEW_ESTIMATED_MARGIN,
      bottom: Math.max(CONTEXT_MENU_EDGE_GAP, (viewportHeight - PREVIEW_ESTIMATED_HEIGHT) / 2) + PREVIEW_ESTIMATED_HEIGHT,
    };

    return rectsOverlap(defaultMenuRect, estimatedPreviewRect);
  }
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
