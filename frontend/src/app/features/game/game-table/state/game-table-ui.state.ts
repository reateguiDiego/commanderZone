import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface GameContextMenu {
  x: number;
  y: number;
  playerId: string;
  zone: GameZoneName;
  card?: GameCardInstance;
  kind?: 'zone' | 'card' | 'game' | 'player';
}

export interface HoveredCardSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

@Injectable()
export class GameTableUiState {
  readonly focusedPlayerId = signal<string | null>(null);
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
  readonly floatingMinimized = signal(false);
  private floatingDragOffset: { x: number; y: number } | null = null;
  private hoveredSelection: HoveredCardSelection | null = null;
  private hoverPreviewHandle?: number;
  private hoverPreviewToken = 0;

  showCardPreview(card: GameCardInstance, isDragging: () => boolean, playerId?: string, zone?: GameZoneName): void {
    this.clearHoverPreviewTimer();
    if (card.hidden || isDragging()) {
      return;
    }

    const token = ++this.hoverPreviewToken;
    this.hoverPreviewHandle = window.setTimeout(() => {
      if (token !== this.hoverPreviewToken || isDragging()) {
        return;
      }

      this.hoveredCard.set(card);
      this.hoveredSelection = playerId && zone ? { playerId, zone, card } : null;
    }, 130);
  }

  hideCardPreview(): void {
    this.clearHoverPreviewTimer();
    this.hoveredCard.set(null);
    this.hoveredSelection = null;
  }

  activeHoveredSelection(): HoveredCardSelection | null {
    return this.hoveredSelection;
  }

  openContextMenu(event: MouseEvent, target: Omit<GameContextMenu, 'x' | 'y'>): void {
    this.contextMenu.set({ ...this.menuPosition(event), ...target });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  toggleFloatingMinimized(): void {
    this.floatingMinimized.update((value) => !value);
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

  private menuPosition(event: MouseEvent): { x: number; y: number } {
    const width = 260;
    const height = 360;

    return {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    };
  }
}
