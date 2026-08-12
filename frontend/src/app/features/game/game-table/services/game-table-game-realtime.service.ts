import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameControlPlaneState, MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';

export interface GameTableRealtimeHandlers {
  onSnapshotInvalidated(event: MercureGameEvent): void;
  onControlPlaneState?(controlPlane: GameControlPlaneState, event: MercureGameEvent): void;
  /** Invoked only after EventSource error -> open, never during the initial connection. */
  onControlPlaneReconnect?(afterRevision: number): void;
  onRematchCreated(roomId: string): void;
  /** The terminal lifecycle removed this room; the table must leave its dead topic. */
  onRoomDeleted(): void;
}

@Injectable()
export class GameTableGameRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private subscription?: Subscription;
  private controlPlaneRevision: number | null = null;

  ngOnDestroy(): void {
    this.stop();
  }

  subscribe(gameId: string, handlers: GameTableRealtimeHandlers): void {
    this.subscription?.unsubscribe();
    this.controlPlaneRevision = null;
    this.subscription = this.mercure.gameEventStream(gameId).subscribe({
      next: (message) => {
        if (message.kind === 'connected') {
          if (message.reconnected) {
            handlers.onControlPlaneReconnect?.(this.controlPlaneRevision ?? 0);
          }
          return;
        }

        this.handleGameEvent(message.event, handlers);
      },
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  /** Seeds the cursor from bootstrap/snapshot without applying a projection. */
  seedControlPlaneRevision(revision: number | null | undefined): void {
    if (!isControlPlaneRevision(revision)) {
      return;
    }

    if (this.controlPlaneRevision === null || revision > this.controlPlaneRevision) {
      this.controlPlaneRevision = revision;
    }
  }

  /**
   * Accepts an authoritative HTTP ACK or recovery response into the same
   * cursor used for Mercure. Equal and lower revisions are already applied.
   */
  acceptControlPlaneState(controlPlane: GameControlPlaneState): boolean {
    const revision = controlPlane.controlPlaneRevision;
    if (!isControlPlaneRevision(revision)) {
      return false;
    }
    if (this.controlPlaneRevision !== null && revision <= this.controlPlaneRevision) {
      return false;
    }

    this.controlPlaneRevision = revision;
    return true;
  }

  private handleGameEvent(event: MercureGameEvent, handlers: GameTableRealtimeHandlers): void {
    if (event.event.type === 'room.deleted') {
      handlers.onRoomDeleted();
      return;
    }

    if (event.event.type === 'room.rematch.created') {
      if (this.isControlPlaneState(event.controlPlane) && this.acceptControlPlaneState(event.controlPlane)) {
        handlers.onControlPlaneState?.(event.controlPlane, event);
      }
      const roomId = event.event.payload['roomId'];
      if (typeof roomId === 'string' && roomId.trim() !== '') {
        handlers.onRematchCreated(roomId);
      }

      return;
    }

    if (this.isControlPlaneState(event.controlPlane)) {
      if (!this.acceptControlPlaneState(event.controlPlane)) {
        return;
      }

      handlers.onControlPlaneState?.(event.controlPlane, event);
      return;
    }

    // Rematch state is control-plane only. Do not use an unversioned legacy
    // event to overwrite a newer compact projection or refetch gameplay.
    if (event.event.type === 'room.rematch.vote') {
      return;
    }

    handlers.onSnapshotInvalidated(event);
  }

  private isControlPlaneState(value: unknown): value is GameControlPlaneState {
    return typeof value === 'object' && value !== null
      && isControlPlaneRevision((value as { controlPlaneRevision?: unknown }).controlPlaneRevision)
      && typeof (value as { status?: unknown }).status === 'string'
      && isRematchState((value as { rematch?: unknown }).rematch);
  }
}

function isControlPlaneRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRematchState(value: unknown): value is { votes: Record<string, unknown> } {
  return typeof value === 'object' && value !== null
    && 'votes' in value
    && typeof (value as { votes?: unknown }).votes === 'object';
}
