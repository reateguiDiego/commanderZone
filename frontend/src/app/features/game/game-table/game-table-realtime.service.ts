import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { MercureService } from '../../../core/realtime/mercure.service';

@Injectable()
export class GameTableRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private realtimeSubscription?: Subscription;
  private pollHandle?: number;

  ngOnDestroy(): void {
    this.stop();
  }

  subscribeToGame(gameId: string, onEvent: () => void): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = this.mercure.gameEvents(gameId).subscribe({
      next: onEvent,
    });
  }

  startPolling(onTick: () => void, shouldPoll: () => boolean, intervalMs = 4000): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
    }

    this.pollHandle = window.setInterval(() => {
      if (shouldPoll()) {
        onTick();
      }
    }, intervalMs);
  }

  stop(): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = undefined;
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }
}
