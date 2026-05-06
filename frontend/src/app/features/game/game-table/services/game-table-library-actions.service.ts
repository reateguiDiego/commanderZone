import { Injectable } from '@angular/core';
import { GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../state/game-table-snapshot-selectors';

export interface GameTableLibraryActionContext {
  isCurrentPlayer(playerId: string): boolean;
  currentPlayer(): PlayerView | null;
  focusedPlayer(): PlayerView | null;
  focusPlayer(playerId: string): void;
  setError(message: string): void;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTableLibraryActionsService {
  async draw(context: GameTableLibraryActionContext, playerId: string, count = 1): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only draw from your own library.');
      return;
    }

    await context.command(count === 1 ? 'library.draw' : 'library.draw_many', { playerId, count });
  }

  async drawCurrent(context: GameTableLibraryActionContext, count = 1): Promise<void> {
    const player = context.currentPlayer() ?? context.focusedPlayer();
    if (!player) {
      return;
    }

    context.focusPlayer(player.id);
    await this.draw(context, player.id, count);
  }

  async shuffle(context: GameTableLibraryActionContext, playerId: string): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only shuffle your own library.');
      return;
    }

    await context.command('library.shuffle', { playerId });
  }

  async revealTop(context: GameTableLibraryActionContext, playerId: string): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only reveal from your own library.');
      return;
    }

    await context.command('library.reveal_top', { playerId, count: 1, to: 'all' });
  }

  async moveTop(context: GameTableLibraryActionContext, playerId: string, toZone: GameZoneName, count = 1): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only move cards from your own library.');
      return;
    }

    await context.command('library.move_top', { playerId, toZone, count: this.sanitizeCount(count) });
  }

  private sanitizeCount(count: number): number {
    return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  }
}
