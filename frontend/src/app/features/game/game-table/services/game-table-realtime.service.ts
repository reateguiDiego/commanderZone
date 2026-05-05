import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { MercureService } from '../../../../core/realtime/mercure.service';

@Injectable()
export class GameTableRealtimeService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private realtimeSubscription?: Subscription;
  private pollHandle?: number;
  private connectWatchdogHandle?: number;
  readonly status = signal<'stopped' | 'connecting' | 'live' | 'degraded'>('stopped');

  ngOnDestroy(): void {
    this.stop();
  }

  subscribeToGame(gameId: string, onEvent: () => void): void {
    this.realtimeSubscription?.unsubscribe();
    this.clearConnectWatchdog();
    this.status.set('connecting');
    this.connectWatchdogHandle = window.setTimeout(() => {
      if (this.status() === 'connecting') {
        this.status.set('degraded');
      }
    }, 3500);
    this.realtimeSubscription = this.mercure.gameEvents(gameId).subscribe({
      next: () => {
        this.clearConnectWatchdog();
        this.status.set('live');
        onEvent();
      },
      error: () => {
        this.clearConnectWatchdog();
        this.status.set('degraded');
      },
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
    this.clearConnectWatchdog();
    this.status.set('stopped');
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  private clearConnectWatchdog(): void {
    if (this.connectWatchdogHandle !== undefined) {
      window.clearTimeout(this.connectWatchdogHandle);
      this.connectWatchdogHandle = undefined;
    }
  }
}
