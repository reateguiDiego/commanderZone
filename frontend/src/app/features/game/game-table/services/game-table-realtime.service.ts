import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';

@Injectable()
export class GameTableRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private realtimeSubscription?: Subscription;
  private connectWatchdogHandle?: number;
  readonly status = signal<'stopped' | 'connecting' | 'live' | 'degraded'>('stopped');

  ngOnDestroy(): void {
    this.stop();
  }

  subscribeToGame(gameId: string, onEvent: (event: MercureGameEvent) => void): void {
    this.realtimeSubscription?.unsubscribe();
    this.clearConnectWatchdog();
    this.status.set('connecting');
    this.connectWatchdogHandle = window.setTimeout(() => {
      if (this.status() === 'connecting') {
        this.status.set('degraded');
      }
    }, 3500);
    this.realtimeSubscription = this.mercure.gameEvents(gameId).subscribe({
      next: (event) => {
        this.clearConnectWatchdog();
        this.status.set('live');
        onEvent(event);
      },
      error: () => {
        this.clearConnectWatchdog();
        this.status.set('degraded');
      },
    });
  }

  stop(): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = undefined;
    this.clearConnectWatchdog();
    this.status.set('stopped');
  }

  private clearConnectWatchdog(): void {
    if (this.connectWatchdogHandle !== undefined) {
      window.clearTimeout(this.connectWatchdogHandle);
      this.connectWatchdogHandle = undefined;
    }
  }
}
