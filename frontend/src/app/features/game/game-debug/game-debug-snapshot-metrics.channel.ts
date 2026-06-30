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
  | 'queue_full'
  | 'circuit_blocked'
  | 'disconnect';

export interface GameDebugQueueMetrics {
  kind: 'queue_metrics';
  gameId: string;
  queueDepth: number;
  'actor.queue_depth'?: number;
  inFlight: boolean;
  enqueueTotal: number;
  drainTotal: number;
  dropTotal: number;
  retryTotal: number;
  resyncTotal: number;
  lateAckIgnoredTotal: number;
  rejectedTotal?: number;
  circuitBlockedTotal?: number;
  queueFullTotal?: number;
  'position.commands_per_drag'?: number;
  dropped_ephemeral_events?: number;
  coalesced_position_events?: number;
  'gameplay.refetch.count'?: number;
  'gameplay.refetch.reason'?: Record<string, number>;
  'gameplay.refetch.source'?: Record<string, number>;
  'gameplay.patch_v2.apply.ok'?: number;
  'gameplay.patch_v2.apply.resync_required'?: number;
  'gameplay.patch_v2.apply.version_gap'?: number;
  'gameplay.patch_v2.apply.missing_state'?: number;
  'gameplay.patch_legacy.apply.fail'?: number;
  'gameplay.command_ack.duplicate_resync'?: number;
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

export interface GameDebugGameplayEvent {
  kind: 'gameplay_debug_event';
  gameId: string;
  source: string;
  reason: string | null;
  playerId: string | null;
  localSnapshotVersion: number | null;
  normalizedV2LastAppliedVersion: number | null;
  incomingMessageKind: string | null;
  incomingMessageType: string | null;
  incomingPatchVersion: number | null;
  ops: string[];
  clientActionId: string | null;
  commandType: string | null;
  currentVersion: number | null;
  result: string | null;
  blocked: boolean;
  measuredAt: string;
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
  | GameDebugDeadLetterEvent
  | GameDebugGameplayEvent;

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
    || kind === 'dead_letter_event'
    || kind === 'gameplay_debug_event';
}
