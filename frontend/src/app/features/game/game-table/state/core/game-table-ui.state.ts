import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { CARD_PREVIEW_HOVER_DELAY_MS, CardPreviewEvent } from '../../models/card-preview.model';

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
  kind?: 'zone' | 'card' | 'game' | 'player' | 'arrow' | 'counter';
}

export interface HoveredCardSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

@Injectable()
export class GameTableUiState {
  private readonly hoverPreviewDelayMs = CARD_PREVIEW_HOVER_DELAY_MS;
  private hoverPreviewSuppressedUntil = 0;

  readonly focusedPlayerId = signal<string | null>(null);
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly hoveredPreview = signal<CardPreviewEvent | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
  readonly floatingMinimized = signal(false);
  private floatingDragOffset: { x: number; y: number } | null = null;
  private hoveredSelection: HoveredCardSelection | null = null;
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
    const preview = this.normalizePreview(cardOrPreview, playerId, zone);
    const card = preview.card;
    if (card.hidden || isDragging() || Date.now() < this.hoverPreviewSuppressedUntil) {
      return;
    }

    const token = ++this.hoverPreviewToken;
    this.hoverPreviewHandle = window.setTimeout(() => {
      if (token !== this.hoverPreviewToken || isDragging()) {
        return;
      }

      this.hoveredCard.set(card);
      this.hoveredPreview.set(preview);
      this.hoveredSelection = preview.playerId && preview.zone ? { playerId: preview.playerId, zone: preview.zone, card } : null;
    }, this.hoverPreviewDelayMs);
  }

  hideCardPreview(): void {
    this.clearHoverPreviewTimer();
    this.hoveredCard.set(null);
    this.hoveredPreview.set(null);
    this.hoveredSelection = null;
  }

  activeHoveredSelection(): HoveredCardSelection | null {
    return this.hoveredSelection;
  }

  openContextMenu(event: MouseEvent, target: Omit<GameContextMenu, 'x' | 'y'>): void {
    this.contextMenu.set({ ...this.menuPosition(event.clientX, event.clientY), ...target });
  }

  openContextMenuAt(position: { x: number; y: number }, target: Omit<GameContextMenu, 'x' | 'y'>): void {
    this.contextMenu.set({ ...this.menuPosition(position.x, position.y), ...target });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  toggleFloatingMinimized(): void {
    this.floatingMinimized.update((value) => !value);
  }

  suppressCardPreview(durationMs: number): void {
    this.clearHoverPreviewTimer();
    this.hoveredCard.set(null);
    this.hoveredPreview.set(null);
    this.hoveredSelection = null;
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

  private menuPosition(clientX: number, clientY: number): Pick<GameContextMenu, 'x' | 'y' | 'verticalOrigin'> {
    const width = 260;
    const height = 360;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const edgeGap = 8;
    const clickGap = 4;
    const openUp = clientY + height + edgeGap > viewportHeight;
    const edgeOffset = openUp
      ? Math.max(edgeGap, viewportHeight - clientY + clickGap)
      : Math.max(edgeGap, clientY + clickGap);

    return {
      x: Math.max(edgeGap, Math.min(clientX, viewportWidth - width - edgeGap)),
      y: edgeOffset,
      verticalOrigin: openUp ? 'bottom' : 'top',
    };
  }
}
