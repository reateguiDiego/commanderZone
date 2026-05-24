import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  createGameDebugSnapshotMetricsChannel,
  isGameDebugSnapshotMetricsMessage,
} from './game-debug-snapshot-metrics.channel';
import type { GameDebugSnapshotMetric } from './game-debug-snapshot-metrics.channel';

@Injectable()
export class GameDebugSnapshotMetricsService implements OnDestroy {
  private channel: BroadcastChannel | null = null;
  private observeTimer: number | null = null;
  private observedGameId: string | null = null;

  readonly metrics = signal<Record<string, GameDebugSnapshotMetric>>({});

  ngOnDestroy(): void {
    this.stop();
  }

  observe(gameId: string): void {
    this.stop();
    this.observedGameId = gameId;
    this.channel = createGameDebugSnapshotMetricsChannel();
    if (!this.channel) {
      return;
    }

    this.channel.onmessage = (event) => this.handleMessage(event.data);
    this.announceObservation();
    this.observeTimer = window.setInterval(() => this.announceObservation(), 2000);
  }

  stop(): void {
    if (this.observeTimer !== null) {
      window.clearInterval(this.observeTimer);
      this.observeTimer = null;
    }

    if (this.channel && this.observedGameId) {
      this.channel.postMessage({
        kind: 'debug_unobserve',
        gameId: this.observedGameId,
      });
    }

    this.channel?.close();
    this.channel = null;
    this.observedGameId = null;
  }

  metricFor(clientActionId: string | null | undefined): GameDebugSnapshotMetric | null {
    if (!clientActionId) {
      return null;
    }

    return this.metrics()[clientActionId] ?? null;
  }

  private handleMessage(message: unknown): void {
    if (
      !isGameDebugSnapshotMetricsMessage(message)
      || message.kind !== 'snapshot_metric'
      || message.gameId !== this.observedGameId
    ) {
      return;
    }

    this.metrics.update((current) => ({
      ...current,
      [message.clientActionId]: message,
    }));
  }

  private announceObservation(): void {
    if (!this.channel || !this.observedGameId) {
      return;
    }

    this.channel.postMessage({
      kind: 'debug_observe',
      gameId: this.observedGameId,
      observedAt: new Date().toISOString(),
    });
  }
}
