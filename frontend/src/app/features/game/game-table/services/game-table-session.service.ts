import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableRealtimeService } from './game-table-realtime.service';

export interface GameTableSessionContext {
  gameId(): string;
  snapshot(): GameSnapshot | null;
  setSnapshot(snapshot: GameSnapshot): void;
  focusedPlayerId(): string | null;
  setFocusedPlayerId(playerId: string | null): void;
  ownPlayerId(snapshot: GameSnapshot): string | null;
  hasActivePointerDrag(): boolean;
  isPending(): boolean;
  setLoading(loading: boolean): void;
  setError(message: string | null): void;
}

@Injectable()
export class GameTableSessionService {
  private readonly gamesApi = inject(GamesApi);
  private readonly realtime = inject(GameTableRealtimeService);
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  readonly realtimeStatus = this.realtime.status;

  async load(context: GameTableSessionContext): Promise<void> {
    const gameId = context.gameId();
    if (!gameId) {
      context.setError('Missing game id.');
      context.setLoading(false);
      return;
    }

    try {
      await this.refetch(context, true);
      this.subscribeToRealtime(context, gameId);
      this.startPolling(context);
    } catch {
      context.setError('Could not load game snapshot.');
    } finally {
      context.setLoading(false);
    }
  }

  async refetch(context: GameTableSessionContext, force = false): Promise<void> {
    const gameId = context.gameId();
    if (!gameId) {
      return;
    }

    const response = await firstValueFrom(this.gamesApi.snapshot(gameId));
    const nextSnapshot = response.game.snapshot;
    const currentSnapshot = context.snapshot();
    if (!force && currentSnapshot?.version === nextSnapshot.version) {
      return;
    }
    if (!force && context.hasActivePointerDrag()) {
      this.deferredRemoteSnapshot = nextSnapshot;
      return;
    }

    this.applySnapshot(context, nextSnapshot);
  }

  applyDeferredRemoteSnapshot(context: GameTableSessionContext): void {
    const deferred = this.deferredRemoteSnapshot;
    this.deferredRemoteSnapshot = null;
    if (!deferred) {
      return;
    }

    const current = context.snapshot();
    if (!current || deferred.version > current.version) {
      this.applySnapshot(context, deferred);
    }
  }

  stop(): void {
    this.realtime.stop();
  }

  private subscribeToRealtime(context: GameTableSessionContext, gameId: string): void {
    this.realtime.subscribeToGame(gameId, () => {
      void this.refetch(context, false);
    });
  }

  private startPolling(context: GameTableSessionContext): void {
    this.realtime.startPolling(
      () => {
        void this.refetch(context, false);
      },
      () => !context.isPending(),
      4000,
    );
  }

  private applySnapshot(context: GameTableSessionContext, nextSnapshot: GameSnapshot): void {
    context.setSnapshot(nextSnapshot);
    if (!context.focusedPlayerId()) {
      context.setFocusedPlayerId(context.ownPlayerId(nextSnapshot) ?? nextSnapshot.turn.activePlayerId ?? Object.keys(nextSnapshot.players)[0] ?? null);
    }
  }
}
