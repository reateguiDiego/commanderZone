import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { MercureService } from '../../../../core/realtime/mercure.service';

@Injectable()
export class GameTableRematchRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private subscription?: Subscription;

  ngOnDestroy(): void {
    this.stop();
  }

  subscribeToRematchCreated(gameId: string, onRematchCreated: (roomId: string) => void): void {
    this.subscription?.unsubscribe();
    this.subscription = this.mercure.gameEvents(gameId).subscribe({
      next: (event) => {
        if (event.event.type !== 'room.rematch.created') {
          return;
        }

        const roomId = event.event.payload['roomId'];
        if (typeof roomId === 'string' && roomId.trim() !== '') {
          onRematchCreated(roomId);
        }
      },
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}
