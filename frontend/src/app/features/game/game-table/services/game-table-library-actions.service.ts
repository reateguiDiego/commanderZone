import { Injectable } from '@angular/core';
import { GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../state/core/game-table-snapshot-selectors';

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

    const sanitizedCount = this.sanitizeCount(count);
    if (sanitizedCount === 1) {
      await context.command('library.draw', { playerId, count: 1 });
      return;
    }

    await context.command('library.draw_many', { playerId, count: sanitizedCount });
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

  async shuffleRevealedLibrary(context: GameTableLibraryActionContext, playerId: string): Promise<void> {
    await context.command('library.shuffle', { playerId, reason: 'revealed-library-closed' });
  }

  async revealTop(context: GameTableLibraryActionContext, playerId: string, target = 'all'): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only reveal from your own library.');
      return;
    }

    await context.command('library.reveal_top', { playerId, count: 1, to: target });
  }

  async setPlayTopRevealed(context: GameTableLibraryActionContext, playerId: string, enabled: boolean): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only reveal your own library.');
      return;
    }

    await context.command('library.play_top_revealed', { playerId, enabled });
  }

  async revealLibrary(context: GameTableLibraryActionContext, playerId: string, targetPlayerId: string): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only reveal your own library.');
      return;
    }

    if (!targetPlayerId || targetPlayerId === playerId) {
      context.setError('Choose another player to reveal your library.');
      return;
    }

    await context.command('library.reveal', { playerId, to: targetPlayerId });
  }

  async moveTop(
    context: GameTableLibraryActionContext,
    playerId: string,
    toZone: GameZoneName,
    count = 1,
    options: { targetPlayerId?: string; position?: 'top' | 'bottom' } = {},
  ): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only move cards from your own library.');
      return;
    }

    await context.command('library.move_top', {
      playerId,
      toZone,
      count: this.sanitizeCount(count),
      ...(options.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
      ...(options.position ? { position: options.position } : {}),
    });
  }

  async view(context: GameTableLibraryActionContext, playerId: string, count?: number): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only view your own library.');
      return;
    }

    await context.command('library.view', {
      playerId,
      ...(count !== undefined ? { count: this.sanitizeCount(count) } : {}),
    });
  }

  async reorderTop(context: GameTableLibraryActionContext, playerId: string, instanceIds: readonly string[]): Promise<void> {
    if (!context.isCurrentPlayer(playerId)) {
      context.setError('You can only reorder your own library.');
      return;
    }

    const sanitizedIds = instanceIds
      .map((instanceId) => instanceId.trim())
      .filter((instanceId) => instanceId !== '');
    if (sanitizedIds.length <= 1) {
      return;
    }

    await context.command('library.reorder_top', { playerId, instanceIds: sanitizedIds });
  }

  private sanitizeCount(count: number): number {
    return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  }
}
