import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';

export interface GameTableRealtimeHandlers {
  onSnapshotInvalidated(event: MercureGameEvent): void;
  onRematchCreated(roomId: string): void;
}

@Injectable()
export class GameTableGameRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private subscription?: Subscription;

  ngOnDestroy(): void {
    this.stop();
  }

  subscribe(gameId: string, handlers: GameTableRealtimeHandlers): void {
    this.subscription?.unsubscribe();
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

    handlers.onSnapshotInvalidated(event);
  }
}
