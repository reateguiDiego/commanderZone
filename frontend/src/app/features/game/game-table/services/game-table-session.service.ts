import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot, MercureGameEvent } from '../../../../core/models/game.model';
import { GameTableGameRealtimeService } from './game-table-game-realtime.service';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';

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
  refreshViewerControlAccess?(): Promise<void>;
  navigateToRoomsWithLoadError(): void;
  navigateToWaitingRoom(roomId: string): void;
}

@Injectable()
export class GameTableSessionService {
  private readonly gamesApi = inject(GamesApi);
  private readonly gameRealtime = inject(GameTableGameRealtimeService);
  private readonly websocket = inject(GameTableWebsocketGameplayService);
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  readonly realtimeStatus = computed<'connecting' | 'live' | 'degraded'>(() => {
    const status = this.websocket.status();

    return status === 'connected' ? 'live' : status === 'error' ? 'degraded' : 'connecting';
  });

  async load(context: GameTableSessionContext): Promise<void> {
    const gameId = context.gameId();
    let shouldRefreshViewerControlAccess = false;
    if (!gameId) {
      context.setError('Missing game id.');
      context.setLoading(false);
      return;
    }

    try {
      await this.refetch(context, true);
      shouldRefreshViewerControlAccess = true;
      this.websocket.start({
        gameId: () => context.gameId(),
        snapshot: () => context.snapshot(),
        setSnapshot: (snapshot) => context.setSnapshot(snapshot),
        refetch: (force) => this.refetch(context, force),
        setError: (message) => context.setError(message),
      }, gameId);
      this.subscribeToGameRealtime(context, gameId);
    } catch {
      context.navigateToRoomsWithLoadError();
    } finally {
      context.setLoading(false);
      if (shouldRefreshViewerControlAccess) {
        await context.refreshViewerControlAccess?.();
      }
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
    if (!force && currentSnapshot?.version === nextSnapshot.version && !this.hasProjectionMetadataChanged(currentSnapshot, nextSnapshot)) {
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
    this.websocket.stop();
    this.gameRealtime.stop();
  }

  private subscribeToGameRealtime(context: GameTableSessionContext, gameId: string): void {
    this.gameRealtime.subscribe(gameId, {
      onSnapshotInvalidated: (event) => this.refetchIfSnapshotIsBehind(context, event),
      onRematchCreated: (roomId) => {
        context.navigateToWaitingRoom(roomId);
      },
    });
  }

  private refetchIfSnapshotIsBehind(context: GameTableSessionContext, event: MercureGameEvent): void {
    const currentSnapshot = context.snapshot();
    if (typeof event.version === 'number' && currentSnapshot && currentSnapshot.version >= event.version) {
      return;
    }

    void this.refetch(context, false);
  }

  private applySnapshot(context: GameTableSessionContext, nextSnapshot: GameSnapshot): void {
    context.setSnapshot(nextSnapshot);
    if (!context.focusedPlayerId()) {
      context.setFocusedPlayerId(context.ownPlayerId(nextSnapshot) ?? nextSnapshot.turn.activePlayerId ?? Object.keys(nextSnapshot.players)[0] ?? null);
    }
  }

  private hasProjectionMetadataChanged(current: GameSnapshot, next: GameSnapshot): boolean {
    const playerIds = new Set([...Object.keys(current.players), ...Object.keys(next.players)]);

    for (const playerId of playerIds) {
      if ((current.players[playerId]?.deckName ?? null) !== (next.players[playerId]?.deckName ?? null)) {
        return true;
      }
    }

    return false;
  }
}
