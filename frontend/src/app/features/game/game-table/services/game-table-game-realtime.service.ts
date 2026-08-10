import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameControlPlaneState, GameRematchState, MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';

export interface GameTableRealtimeHandlers {
  onSnapshotInvalidated(event: MercureGameEvent): void;
  onControlPlaneState?(controlPlane: GameControlPlaneState, event: MercureGameEvent): void;
  onRematchState(rematch: GameRematchState): void;
  onRematchCreated(roomId: string): void;
}

@Injectable()
export class GameTableGameRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private subscription?: Subscription;
  private controlPlaneCursor: ControlPlaneCursor | null = null;

  ngOnDestroy(): void {
    this.stop();
  }

  subscribe(gameId: string, handlers: GameTableRealtimeHandlers): void {
    this.subscription?.unsubscribe();
    this.controlPlaneCursor = null;
    this.subscription = this.mercure.gameEvents(gameId).subscribe({
      next: (event) => this.handleGameEvent(event, handlers),
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  private handleGameEvent(event: MercureGameEvent, handlers: GameTableRealtimeHandlers): void {
    if (event.event.type === 'room.rematch.created') {
      const roomId = event.event.payload['roomId'];
      if (typeof roomId === 'string' && roomId.trim() !== '') {
        handlers.onRematchCreated(roomId);
      }

      return;
    }

    if (this.isControlPlaneState(event.controlPlane)) {
      if (this.isStaleControlPlaneEvent(event)) {
        return;
      }

      handlers.onControlPlaneState?.(event.controlPlane, event);
      return;
    }

    if (event.event.type === 'room.rematch.vote') {
      const rematch = event.event.payload['rematch'];
      if (this.isRematchState(rematch)) {
        handlers.onRematchState(rematch);
      }

      return;
    }

    handlers.onSnapshotInvalidated(event);
  }

  private isRematchState(value: unknown): value is GameRematchState {
    return typeof value === 'object' && value !== null && 'votes' in value
      && typeof (value as { votes: unknown }).votes === 'object';
  }

  private isControlPlaneState(value: unknown): value is GameControlPlaneState {
    return typeof value === 'object' && value !== null
      && typeof (value as { status?: unknown }).status === 'string'
      && this.isRematchState((value as { rematch?: unknown }).rematch);
  }

  private isStaleControlPlaneEvent(event: MercureGameEvent): boolean {
    const cursor: ControlPlaneCursor = {
      gameplayVersion: event.version ?? -1,
      createdAtMs: Date.parse(event.event.createdAt) || 0,
      eventId: event.event.id,
    };
    const previous = this.controlPlaneCursor;
    if (previous && compareControlPlaneCursor(cursor, previous) <= 0) {
      return true;
    }

    this.controlPlaneCursor = cursor;
    return false;
  }
}

interface ControlPlaneCursor {
  readonly gameplayVersion: number;
  readonly createdAtMs: number;
  readonly eventId: string;
}

function compareControlPlaneCursor(left: ControlPlaneCursor, right: ControlPlaneCursor): number {
  if (left.gameplayVersion !== right.gameplayVersion) {
    return left.gameplayVersion - right.gameplayVersion;
  }
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }

  return left.eventId.localeCompare(right.eventId);
}
