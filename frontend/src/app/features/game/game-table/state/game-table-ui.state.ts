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

@Injectable()
export class GameTableUiState {
  readonly focusedPlayerId = signal<string | null>(null);
  readonly hoveredCard = signal<GameCardInstance | null>(null);
  readonly contextMenu = signal<GameContextMenu | null>(null);
  readonly activeFloatingTab = signal<'chat' | 'log'>('log');
  readonly floatingPanel = signal({ x: 24, y: 120 });
  readonly floatingMinimized = signal(false);

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  toggleFloatingMinimized(): void {
    this.floatingMinimized.update((value) => !value);
  }
}

