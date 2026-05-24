import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  createGameDebugSnapshotMetricsChannel,
  GameDebugDeadLetterEvent,
  GameDebugQueueMetrics,
  isGameDebugSnapshotMetricsMessage,
} from './game-debug-snapshot-metrics.channel';
import type { GameDebugSnapshotMetric } from './game-debug-snapshot-metrics.channel';

@Injectable()
export class GameDebugSnapshotMetricsService implements OnDestroy {
  private static readonly MAX_METRICS = 500;
  private static readonly MAX_DEAD_LETTER = 100;

  private channel: BroadcastChannel | null = null;
  private observeTimer: number | null = null;
  private observedGameId: string | null = null;
  private metricOrder: string[] = [];

  readonly metrics = signal<Record<string, GameDebugSnapshotMetric>>({});
  readonly queueMetrics = signal<GameDebugQueueMetrics | null>(null);
  readonly deadLetterEvents = signal<GameDebugDeadLetterEvent[]>([]);

  ngOnDestroy(): void {
    this.stop();
  }

  observe(gameId: string): void {
    this.stop();
    this.metrics.set({});
    this.queueMetrics.set(null);
    this.deadLetterEvents.set([]);
    this.metricOrder = [];
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
    this.metricOrder = [];
    this.metrics.set({});
    this.queueMetrics.set(null);
    this.deadLetterEvents.set([]);
  }

  metricFor(clientActionId: string | null | undefined): GameDebugSnapshotMetric | null {
    if (!clientActionId) {
      return null;
    }

    return this.metrics()[clientActionId] ?? null;
  }

  private handleMessage(message: unknown): void {
    if (!isGameDebugSnapshotMetricsMessage(message) || message.gameId !== this.observedGameId) {
      return;
    }

    if (message.kind === 'snapshot_metric') {
      this.metrics.update((current) => ({
        ...current,
        [message.clientActionId]: message,
      }));
      this.trackMetricKey(message.clientActionId);
      return;
    }

    if (message.kind === 'queue_metrics') {
      this.queueMetrics.set(message);
      return;
    }

    if (message.kind === 'dead_letter_event') {
      this.deadLetterEvents.update((current) => {
        const next = [...current, message];
        while (next.length > GameDebugSnapshotMetricsService.MAX_DEAD_LETTER) {
          next.shift();
        }
        return next;
      });
    }
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

  private trackMetricKey(clientActionId: string): void {
    const existingIndex = this.metricOrder.indexOf(clientActionId);
    if (existingIndex >= 0) {
      this.metricOrder.splice(existingIndex, 1);
    }
    this.metricOrder.push(clientActionId);

    while (this.metricOrder.length > GameDebugSnapshotMetricsService.MAX_METRICS) {
      const removedClientActionId = this.metricOrder.shift();
      if (!removedClientActionId) {
        continue;
      }

      this.metrics.update((current) => {
        const next = { ...current };
        delete next[removedClientActionId];
        return next;
      });
    }
  }
}
