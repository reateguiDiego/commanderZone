export const GAME_DEBUG_SNAPSHOT_METRICS_CHANNEL = 'commanderzone.game-debug.snapshot-metrics';

export interface GameDebugSnapshotMetric {
  kind: 'snapshot_metric';
  gameId: string;
  clientActionId: string;
  version: number;
  previousLines: number;
  nextLines: number;
  lineDelta: number;
  previousCharacters: number;
  nextCharacters: number;
  characterDelta: number;
  operationCount: number;
  measuredAt: string;
}

export type GameDebugQueueDeadLetterReason =
  | 'timeout'
  | 'rejected'
  | 'resync_retry_exhausted'
  | 'queue_dropped'
  | 'disconnect';

export interface GameDebugQueueMetrics {
  kind: 'queue_metrics';
  gameId: string;
  queueDepth: number;
  inFlight: boolean;
  enqueueTotal: number;
  drainTotal: number;
  dropTotal: number;
  retryTotal: number;
  resyncTotal: number;
  lateAckIgnoredTotal: number;
  enqueueRate: number;
  drainRate: number;
  measuredAt: string;
}

export interface GameDebugDeadLetterEvent {
  kind: 'dead_letter_event';
  gameId: string;
  commandType: string;
  reason: GameDebugQueueDeadLetterReason;
  retryCount: number;
  createdAt: string;
  details: string | null;
}

export type GameDebugSnapshotMetricsMessage =
  | {
      kind: 'debug_observe';
      gameId: string;
      observedAt: string;
    }
  | {
      kind: 'debug_unobserve';
      gameId: string;
    }
  | GameDebugSnapshotMetric
  | GameDebugQueueMetrics
  | GameDebugDeadLetterEvent;

export function createGameDebugSnapshotMetricsChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  return new BroadcastChannel(GAME_DEBUG_SNAPSHOT_METRICS_CHANNEL);
}

export function isGameDebugSnapshotMetricsMessage(value: unknown): value is GameDebugSnapshotMetricsMessage {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }

  const kind = String((value as { kind: unknown }).kind);

  return kind === 'debug_observe'
    || kind === 'debug_unobserve'
    || kind === 'snapshot_metric'
    || kind === 'queue_metrics'
    || kind === 'dead_letter_event';
}
