import { Injectable, computed, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameControlPlaneState, GameSnapshot, MercureGameEvent } from '../../../../core/models/game.model';
import {
  GameplayMulliganCompletedMessage,
  GameplayMulliganErrorMessage,
  GameplayMulliganPrivateStateMessage,
  GameplayMulliganPublicStateMessage,
  GameplayPatchV2Message,
} from '../../../../core/models/game-realtime.model';
import { GameTableGameRealtimeService } from './game-table-game-realtime.service';
import { GameTableGameplayV2FlagsService } from './game-table-gameplay-v2-flags.service';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableStaticCardCacheV2Service } from './game-table-static-card-cache-v2.service';

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
  onMulliganPublicState?(message: GameplayMulliganPublicStateMessage): void;
  onMulliganPrivateState?(message: GameplayMulliganPrivateStateMessage): void;
  onMulliganError?(message: GameplayMulliganErrorMessage): void;
  onMulliganCompleted?(message: GameplayMulliganCompletedMessage): void;
  onMulliganPatchV2Applied?(patch: GameplayPatchV2Message, snapshot: GameSnapshot): void;
  onControlPlaneAccepted?(controlPlane: GameControlPlaneState): void;
  refreshViewerControlAccess?(): Promise<void>;
  navigateToRooms(): void;
  navigateToRoomsWithLoadError(): void;
  navigateToWaitingRoom(roomId: string): void;
}

function isControlPlaneRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

@Injectable()
export class GameTableSessionService {
  private readonly gamesApi = inject(GamesApi);
  private readonly gameRealtime = inject(GameTableGameRealtimeService);
  private readonly gameplayV2Flags = inject(GameTableGameplayV2FlagsService);
  private readonly normalizedV2Store = inject(GameTableNormalizedV2Store);
  private readonly websocket = inject(GameTableWebsocketGameplayService);
  private readonly staticCardCacheV2 = inject(GameTableStaticCardCacheV2Service);
  private deferredRemoteSnapshot: GameSnapshot | null = null;
  private controlPlaneRecoveryInFlight: Promise<void> | null = null;
  private realtimeSubscriptionGeneration = 0;
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
      await this.refetch(context, true, 'initial_load');
      shouldRefreshViewerControlAccess = true;
      this.websocket.start({
        gameId: () => context.gameId(),
        snapshot: () => context.snapshot(),
        setSnapshot: (snapshot) => context.setSnapshot(snapshot),
        refetch: (force) => this.refetch(context, force, 'websocket.request_resync'),
        setError: (message) => context.setError(message),
        onMulliganPublicState: (message) => context.onMulliganPublicState?.(message),
        onMulliganPrivateState: (message) => context.onMulliganPrivateState?.(message),
        onMulliganError: (message) => context.onMulliganError?.(message),
        onMulliganCompleted: (message) => context.onMulliganCompleted?.(message),
        onMulliganPatchV2Applied: (patch, snapshot) => context.onMulliganPatchV2Applied?.(patch, snapshot),
      }, gameId);
      this.subscribeToGameRealtime(context, gameId);
    } catch (error) {
      if (this.isDeletedGameLoad(error)) {
        context.navigateToRooms();
      } else {
        context.navigateToRoomsWithLoadError();
      }
    } finally {
      context.setLoading(false);
      if (shouldRefreshViewerControlAccess) {
        await context.refreshViewerControlAccess?.();
      }
    }
  }

  private isDeletedGameLoad(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404;
  }

  async refetch(context: GameTableSessionContext, force = false, source = force ? 'forced_refetch' : 'passive_refetch'): Promise<void> {
    if (this.gameplayV2Flags.enabled()) {
      await this.refetchV2(context, force, source);
      return;
    }

    const gameId = context.gameId();
    if (!gameId) {
      return;
    }

    const response = await firstValueFrom(this.gamesApi.snapshot(gameId));
    const nextSnapshot = this.preserveNewerControlPlane(
      context.snapshot(),
      this.snapshotWithControlPlane(response.game.snapshot, response.game.controlPlane),
    );
    const currentSnapshot = context.snapshot();
    if (!force && currentSnapshot?.version === nextSnapshot.version && !this.hasProjectionMetadataChanged(currentSnapshot, nextSnapshot)) {
      this.logSessionDebug('info', context, {
        source: 'snapshot_reload',
        reason: source,
        result: 'unchanged',
        currentVersion: nextSnapshot.version,
      });
      return;
    }
    if (!force && context.hasActivePointerDrag()) {
      this.deferredRemoteSnapshot = nextSnapshot;
      this.logSessionDebug('info', context, {
        source: 'snapshot_reload',
        reason: source,
        result: 'deferred_pointer_drag',
        currentVersion: nextSnapshot.version,
      });
      return;
    }

    this.applySnapshot(context, nextSnapshot);
    this.logSessionDebug('info', context, {
      source: 'snapshot_reload',
      reason: source,
      result: 'applied',
      currentVersion: nextSnapshot.version,
    });
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
    this.realtimeSubscriptionGeneration += 1;
    this.websocket.stop();
    this.gameRealtime.stop();
  }

  /** Applies an HTTP ACK/recovery through the same state reducer as Mercure. */
  applyControlPlaneAcknowledgement(context: GameTableSessionContext, controlPlane: GameControlPlaneState): boolean {
    if (!this.gameRealtime.acceptControlPlaneState(controlPlane)) {
      return false;
    }

    this.applyAcceptedControlPlaneState(context, controlPlane);
    return true;
  }

  private subscribeToGameRealtime(context: GameTableSessionContext, gameId: string): void {
    const subscriptionGeneration = ++this.realtimeSubscriptionGeneration;
    this.gameRealtime.subscribe(gameId, {
      onSnapshotInvalidated: (event) => this.refetchIfSnapshotIsBehind(context, event),
      onControlPlaneState: (controlPlane) => this.applyAcceptedControlPlaneState(context, controlPlane),
      onControlPlaneReconnect: (afterRevision) => {
        if (subscriptionGeneration === this.realtimeSubscriptionGeneration) {
          void this.recoverControlPlaneAfterReconnect(context, gameId, afterRevision, subscriptionGeneration);
        }
      },
      onRematchCreated: (roomId) => {
        context.navigateToWaitingRoom(roomId);
      },
      onRoomDeleted: () => {
        // This is a terminal, post-commit control-plane notification. Stop
        // both transports before navigating so a deleted game cannot trigger
        // a reconnect/refetch loop while the router tears the table down.
        this.stop();
        context.navigateToRooms();
      },
    });
    this.gameRealtime.seedControlPlaneRevision(context.snapshot()?.controlPlaneRevision);
  }

  private refetchIfSnapshotIsBehind(context: GameTableSessionContext, event: MercureGameEvent): void {
    if (this.gameplayV2Flags.enabled() && this.websocket.status() === 'connected') {
      return;
    }

    const currentSnapshot = context.snapshot();
    if (typeof event.version === 'number' && currentSnapshot && currentSnapshot.version >= event.version) {
      return;
    }

    void this.refetch(context, false, 'mercure.snapshot_invalidated');
  }

  private applySnapshot(context: GameTableSessionContext, nextSnapshot: GameSnapshot): void {
    context.setSnapshot(nextSnapshot);
    this.gameRealtime.seedControlPlaneRevision(nextSnapshot.controlPlaneRevision);
    const controlPlane = this.controlPlaneFromSnapshot(nextSnapshot);
    if (controlPlane) {
      context.onControlPlaneAccepted?.(controlPlane);
    }
    if (!context.focusedPlayerId()) {
      context.setFocusedPlayerId(context.ownPlayerId(nextSnapshot) ?? nextSnapshot.turn.activePlayerId ?? Object.keys(nextSnapshot.players)[0] ?? null);
    }
  }

  private applyAcceptedControlPlaneState(context: GameTableSessionContext, controlPlane: GameControlPlaneState): void {
    if (this.gameplayV2Flags.enabled()) {
      const snapshot = this.normalizedV2Store.applyControlPlane(controlPlane);
      if (snapshot) {
        context.setSnapshot(snapshot);
        context.onControlPlaneAccepted?.(controlPlane);
      }
      return;
    }

    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

    context.setSnapshot({
      ...snapshot,
      controlPlaneRevision: controlPlane.controlPlaneRevision,
      status: controlPlane.status,
      winnerPlayerId: controlPlane.winnerPlayerId,
      finishedAt: controlPlane.finishedAt,
      finishReason: controlPlane.finishReason,
      allDisconnectedSince: controlPlane.allDisconnectedSince,
      nextLifecycleAt: controlPlane.nextLifecycleAt,
      ownerId: controlPlane.ownerId ?? undefined,
      rematch: {
        votes: { ...controlPlane.rematch.votes },
        deadlineAt: controlPlane.rematch.deadlineAt ?? null,
      },
    });
    context.onControlPlaneAccepted?.(controlPlane);
  }

  private async recoverControlPlaneAfterReconnect(
    context: GameTableSessionContext,
    gameId: string,
    afterRevision: number,
    subscriptionGeneration: number,
  ): Promise<void> {
    if (this.controlPlaneRecoveryInFlight !== null) {
      return;
    }

    const recovery = (async () => {
      try {
        const response = await firstValueFrom(this.gamesApi.controlPlane(gameId, afterRevision));
        if (subscriptionGeneration !== this.realtimeSubscriptionGeneration || response === null) {
          return;
        }

        this.applyControlPlaneAcknowledgement(context, response.controlPlane);
      } catch {
        // A later real EventSource reconnect gets one new recovery opportunity.
        // Never turn a temporary control-plane stream failure into polling.
      }
    })();

    this.controlPlaneRecoveryInFlight = recovery;
    try {
      await recovery;
    } finally {
      if (this.controlPlaneRecoveryInFlight === recovery) {
        this.controlPlaneRecoveryInFlight = null;
      }
    }
  }

  private async refetchV2(context: GameTableSessionContext, force = false, source = force ? 'forced_refetch' : 'passive_refetch'): Promise<void> {
    const gameId = context.gameId();
    if (!gameId) {
      return;
    }

    const bootstrap = await firstValueFrom(this.gamesApi.bootstrapV2(gameId, this.staticCardCacheV2.knownCatalogKeys()));
    let nextSnapshot = this.normalizedV2Store.applyBootstrap(this.staticCardCacheV2.mergeBootstrap(bootstrap));
    const currentControlPlane = this.controlPlaneFromSnapshot(context.snapshot());
    const incomingControlPlaneRevision = bootstrap.game.controlPlane?.controlPlaneRevision
      ?? bootstrap.game.controlPlaneRevision;
    if (
      currentControlPlane !== null
      && (!isControlPlaneRevision(incomingControlPlaneRevision) || incomingControlPlaneRevision < currentControlPlane.controlPlaneRevision)
    ) {
      nextSnapshot = this.normalizedV2Store.applyControlPlane(currentControlPlane) ?? nextSnapshot;
    }
    const currentSnapshot = context.snapshot();
    if (!force && currentSnapshot?.version === nextSnapshot.version && !this.hasProjectionMetadataChanged(currentSnapshot, nextSnapshot)) {
      this.logSessionDebug('info', context, {
        source: 'bootstrap',
        reason: source,
        result: 'unchanged',
        currentVersion: nextSnapshot.version,
      });
      return;
    }
    if (!force && context.hasActivePointerDrag()) {
      this.deferredRemoteSnapshot = nextSnapshot;
      this.logSessionDebug('info', context, {
        source: 'bootstrap',
        reason: source,
        result: 'deferred_pointer_drag',
        currentVersion: nextSnapshot.version,
      });
      return;
    }

    this.applySnapshot(context, nextSnapshot);
    this.logSessionDebug('info', context, {
      source: 'bootstrap',
      reason: source,
      result: 'applied',
      currentVersion: nextSnapshot.version,
    });
  }

  private hasProjectionMetadataChanged(current: GameSnapshot, next: GameSnapshot): boolean {
    if ((current.controlPlaneRevision ?? 0) !== (next.controlPlaneRevision ?? 0)) {
      return true;
    }

    const playerIds = new Set([...Object.keys(current.players), ...Object.keys(next.players)]);

    for (const playerId of playerIds) {
      if ((current.players[playerId]?.deckName ?? null) !== (next.players[playerId]?.deckName ?? null)) {
        return true;
      }
    }

    return false;
  }

  /** A stale gameplay bootstrap/snapshot must not roll back lifecycle UI. */
  private preserveNewerControlPlane(current: GameSnapshot | null, incoming: GameSnapshot): GameSnapshot {
    const currentControlPlane = this.controlPlaneFromSnapshot(current);
    if (
      currentControlPlane === null
      || (isControlPlaneRevision(incoming.controlPlaneRevision)
        && incoming.controlPlaneRevision >= currentControlPlane.controlPlaneRevision)
    ) {
      return incoming;
    }

    return {
      ...incoming,
      controlPlaneRevision: currentControlPlane.controlPlaneRevision,
      status: currentControlPlane.status,
      winnerPlayerId: currentControlPlane.winnerPlayerId,
      finishedAt: currentControlPlane.finishedAt,
      finishReason: currentControlPlane.finishReason,
      allDisconnectedSince: currentControlPlane.allDisconnectedSince,
      nextLifecycleAt: currentControlPlane.nextLifecycleAt,
      ownerId: currentControlPlane.ownerId ?? undefined,
      rematch: {
        votes: { ...currentControlPlane.rematch.votes },
        deadlineAt: currentControlPlane.rematch.deadlineAt ?? null,
      },
    };
  }

  private controlPlaneFromSnapshot(snapshot: GameSnapshot | null): GameControlPlaneState | null {
    if (!snapshot || !isControlPlaneRevision(snapshot.controlPlaneRevision) || !snapshot.rematch) {
      return null;
    }

    return {
      controlPlaneRevision: snapshot.controlPlaneRevision,
      status: snapshot.status ?? 'active',
      winnerPlayerId: snapshot.winnerPlayerId ?? null,
      finishedAt: snapshot.finishedAt ?? null,
      finishReason: snapshot.finishReason ?? null,
      allDisconnectedSince: snapshot.allDisconnectedSince ?? null,
      nextLifecycleAt: snapshot.nextLifecycleAt ?? null,
      ownerId: snapshot.ownerId ?? null,
      rematch: {
        votes: { ...snapshot.rematch.votes },
        deadlineAt: snapshot.rematch.deadlineAt ?? null,
      },
    };
  }

  /**
   * The legacy snapshot endpoint keeps gameplay in `snapshot` and returns the
   * Symfony-owned lifecycle projection beside it. Fold the compact projection
   * into the view model so a refresh preserves the rematch action cursor.
   */
  private snapshotWithControlPlane(snapshot: GameSnapshot, controlPlane?: GameControlPlaneState): GameSnapshot {
    if (!controlPlane || !isControlPlaneRevision(controlPlane.controlPlaneRevision)) {
      return snapshot;
    }

    return {
      ...snapshot,
      controlPlaneRevision: controlPlane.controlPlaneRevision,
      status: controlPlane.status,
      winnerPlayerId: controlPlane.winnerPlayerId,
      finishedAt: controlPlane.finishedAt,
      finishReason: controlPlane.finishReason,
      allDisconnectedSince: controlPlane.allDisconnectedSince,
      nextLifecycleAt: controlPlane.nextLifecycleAt,
      ownerId: controlPlane.ownerId ?? undefined,
      rematch: {
        votes: { ...controlPlane.rematch.votes },
        deadlineAt: controlPlane.rematch.deadlineAt ?? null,
      },
    };
  }

  private logSessionDebug(
    level: 'debug' | 'info' | 'warn',
    context: GameTableSessionContext,
    payload: {
      source: 'bootstrap' | 'snapshot_reload';
      reason: string;
      result: 'applied' | 'unchanged' | 'deferred_pointer_drag';
      currentVersion: number | null;
    },
  ): void {
    const logger = level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug;
    logger.call(console, '[CommanderZone gameplay sync]', {
      ...payload,
      gameId: context.gameId(),
      localSnapshotVersion: context.snapshot()?.version ?? null,
      measuredAt: new Date().toISOString(),
    });
  }
}
