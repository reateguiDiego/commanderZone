import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameCommandType, GameSnapshot } from '../../../../core/models/game.model';
import {
  GameplayClientMessage,
  GameplayCommandAckMessage,
  GameplayErrorMessage,
  GameplayGamePatchMessage,
  GameplayPatchV2Message,
  GameplayMulliganCompletedMessage,
  GameplayMulliganErrorMessage,
  GameplayMulliganPrivateStateMessage,
  GameplayMulliganPublicStateMessage,
  GameplayResyncRequiredMessage,
  GameplayServerMessage,
  GameplayVersionConflict,
} from '../../../../core/models/game-realtime.model';
import {
  createGameDebugSnapshotMetricsChannel,
  GameDebugDeadLetterEvent,
  GameDebugGameplayEvent,
  GameDebugQueueDeadLetterReason,
  GameDebugQueueMetrics,
  isGameDebugSnapshotMetricsMessage,
} from '../../game-debug/game-debug-snapshot-metrics.channel';
import { applyGameSnapshotPatch } from '../state/realtime/game-snapshot-patch-reducer';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';
import { GameTableGameplayV2FlagsService } from './game-table-gameplay-v2-flags.service';
import { GameTableRealtimeAnimationBusService } from './game-table-realtime-animation-bus.service';
import { GameTableStaticCardResolverV2Service } from './game-table-static-card-resolver-v2.service';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';

export interface GameTableWebsocketGameplayContext {
  gameId(): string;
  snapshot(): GameSnapshot | null;
  setSnapshot(snapshot: GameSnapshot): void;
  refetch(force?: boolean): Promise<void>;
  setError(message: string | null): void;
  onMulliganPublicState?(message: GameplayMulliganPublicStateMessage): void;
  onMulliganPrivateState?(message: GameplayMulliganPrivateStateMessage): void;
  onMulliganError?(message: GameplayMulliganErrorMessage): void;
  onMulliganCompleted?(message: GameplayMulliganCompletedMessage): void;
  onMulliganPatchV2Applied?(patch: GameplayPatchV2Message, snapshot: GameSnapshot): void;
  onCommandBlocked?(
    reason: Extract<GameDebugQueueDeadLetterReason, 'circuit_blocked' | 'queue_full'>,
    type: GameWebsocketCommandType,
    payload: Record<string, unknown>,
  ): void;
}

interface PendingWebsocketCommand {
  messageId: string;
  clientActionId: string;
  type: GameWebsocketCommandType;
  payload: Record<string, unknown>;
  signature: string;
  context: GameTableWebsocketGameplayContext;
  retryCount: number;
  retryable: boolean;
  coalesceKey: string | null;
  resolve(): void;
  reject(error: Error): void;
  timeoutId: number;
}

interface QueueCounters {
  enqueueTotal: number;
  drainTotal: number;
  dropTotal: number;
  retryTotal: number;
  resyncTotal: number;
  lateAckIgnoredTotal: number;
  rejectedTotal: number;
  circuitBlockedTotal: number;
  queueFullTotal: number;
  coalescedPositionEvents: number;
  droppedEphemeralEvents: number;
  positionCommandsPerDrag: number;
}

interface QueueRates {
  enqueueTimestamps: number[];
  drainTimestamps: number[];
}

interface GameplayDebugCounters {
  refetchCount: number;
  refetchByReason: Record<string, number>;
  refetchBySource: Record<string, number>;
  patchV2ApplyOk: number;
  patchV2ApplyResyncRequired: number;
  patchV2ApplyVersionGap: number;
  patchV2ApplyMissingState: number;
  patchLegacyApplyFail: number;
  commandAckDuplicateResync: number;
}

interface GameplayDebugDetails {
  source: string;
  reason?: string | null;
  message?: GameplayServerMessage;
  patch?: GameplayGamePatchMessage | GameplayPatchV2Message;
  ack?: GameplayCommandAckMessage;
  command?: PendingWebsocketCommand | null;
  currentVersion?: number | null;
  result?: string | null;
  blocked?: boolean;
}

export type GameWebsocketCommandType = GameCommandType | 'disconnect.vote';

const WEBSOCKET_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'chat.message',
  'chat.reaction.toggled',
  'dice.rolled',
  'turn.changed',
  'card.position.changed',
  'card.dungeon_marker.changed',
  'cards.position.changed',
  'card.tapped',
  'card.moved',
  'cards.moved',
  'zone.changed',
  'zone.move_all',
  'zone.random_card.selected',
  'library.draw',
  'library.draw_many',
  'library.shuffle',
  'library.move_top',
  'library.reveal_top',
  'library.reveal',
  'library.view',
  'library.play_top_revealed',
  'library.reorder_top',
  'card.face_down.changed',
  'card.face.changed',
  'card.revealed',
  'card.counter.changed',
  'card.power_toughness.changed',
  'card.controller.changed',
  'battlefield.untap_all',
  'card.token.created',
  'card.token_copy.created',
  'stack.card_added',
  'stack.item_removed',
  'arrow.created',
  'arrow.removed',
  'attachment.created',
  'attachment.removed',
  'helper.created',
  'helper.updated',
  'helper.removed',
  'game.concede',
  'game.close',
  'disconnect.vote',
]);

const COALESCED_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'card.position.changed',
  'cards.position.changed',
]);
const POSITION_COMMANDS = new Set<GameWebsocketCommandType>([
  'card.position.changed',
  'cards.position.changed',
]);
const IN_FLIGHT_DEDUPED_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'card.position.changed',
  'cards.position.changed',
  'card.counter.changed',
]);
const RETRYABLE_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'card.position.changed',
  'card.dungeon_marker.changed',
  'cards.position.changed',
  'card.tapped',
  'card.moved',
  'cards.moved',
  'zone.changed',
  'zone.move_all',
  'zone.random_card.selected',
  'library.draw',
  'library.draw_many',
  'library.shuffle',
  'library.move_top',
  'library.reveal_top',
  'library.reveal',
  'library.view',
  'library.play_top_revealed',
  'library.reorder_top',
  'card.face_down.changed',
  'card.face.changed',
  'card.revealed',
  'card.counter.changed',
  'card.power_toughness.changed',
  'card.controller.changed',
  'battlefield.untap_all',
  'card.token.created',
  'card.token_copy.created',
  'stack.card_added',
  'stack.item_removed',
  'arrow.created',
  'arrow.removed',
  'attachment.created',
  'attachment.removed',
  'helper.created',
  'helper.updated',
  'helper.removed',
  'disconnect.vote',
]);
const MAX_RETRY_COUNT = 1;
const MAX_QUEUE_DEPTH = 200;
const MAX_DEAD_LETTER = 100;
const MAX_COMPLETED_COMMAND_IDS = 200;
const QUEUE_RATE_WINDOW_MS = 60_000;
const REJECTION_WINDOW_MS = 2_000;
const REJECTION_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 2_000;
const ERROR_THROTTLE_MS = 2_000;
const DEAD_LETTER_DEDUP_WINDOW_MS = 1_000;
const COMMAND_TIMEOUT_MS = 15_000;
const MULLIGAN_QUEUE_LIMIT = 8;
const REFETCH_GUARD_WINDOW_MS = 3_000;

@Injectable()
export class GameTableWebsocketGameplayService implements OnDestroy {
  private readonly transport = inject(GameTableWebsocketTransportService);
  private readonly gameplayV2Flags = inject(GameTableGameplayV2FlagsService);
  private readonly normalizedV2Store = inject(GameTableNormalizedV2Store);
  private readonly realtimeAnimationBus = inject(GameTableRealtimeAnimationBusService);
  private readonly staticCardResolver = inject(GameTableStaticCardResolverV2Service);
  private readonly commandQueue: PendingWebsocketCommand[] = [];
  private readonly mulliganQueue: GameplayClientMessage[] = [];
  private inFlightCommand: PendingWebsocketCommand | null = null;
  private subscription?: Subscription;
  private context: GameTableWebsocketGameplayContext | null = null;
  private resyncPromise: Promise<void> | null = null;
  private queuedResyncPromise: Promise<void> | null = null;
  private patchV2Chain: Promise<void> = Promise.resolve();
  private snapshotMetricsChannel: BroadcastChannel | null = null;
  private observedDebugGameId: string | null = null;
  private observedDebugUntil = 0;
  private readonly queueCounters: QueueCounters = {
    enqueueTotal: 0,
    drainTotal: 0,
    dropTotal: 0,
    retryTotal: 0,
    resyncTotal: 0,
    lateAckIgnoredTotal: 0,
    rejectedTotal: 0,
    circuitBlockedTotal: 0,
    queueFullTotal: 0,
    coalescedPositionEvents: 0,
    droppedEphemeralEvents: 0,
    positionCommandsPerDrag: 0,
  };
  private readonly queueRates: QueueRates = {
    enqueueTimestamps: [],
    drainTimestamps: [],
  };
  private readonly gameplayDebugCounters: GameplayDebugCounters = {
    refetchCount: 0,
    refetchByReason: {},
    refetchBySource: {},
    patchV2ApplyOk: 0,
    patchV2ApplyResyncRequired: 0,
    patchV2ApplyVersionGap: 0,
    patchV2ApplyMissingState: 0,
    patchLegacyApplyFail: 0,
    commandAckDuplicateResync: 0,
  };
  private readonly refetchGuardBySignature = new Map<string, number>();
  private readonly deadLetter: GameDebugDeadLetterEvent[] = [];
  private readonly deadLetterDedupeBySignature = new Map<string, number>();
  private readonly completedCommandIds: string[] = [];
  private readonly completedCommandIdSet = new Set<string>();
  private readonly rejectedBySignature = new Map<string, number[]>();
  private readonly blockedSignatures = new Map<string, number>();
  private readonly throttledErrors = new Map<string, number>();
  private readonly concedeSuppressedTurnChangeSignatures = new Set<string>();
  private connectionStateMessages = 0;

  readonly status = this.transport.status;
  readonly connected = signal(false);

  ngOnDestroy(): void {
    this.stop();
  }

  isMigratedCommand(type: GameWebsocketCommandType): boolean {
    return WEBSOCKET_COMMANDS.has(type);
  }

  start(context: GameTableWebsocketGameplayContext, gameId: string): void {
    this.stop();
    this.context = context;
    this.resetQueueTelemetry();
    this.openSnapshotMetricsChannel();
    this.subscription = this.transport.messages$.subscribe((message) => {
      void this.handleMessage(message);
    });
    void this.transport.connect(gameId, {
      lastAppliedVersion: () => this.lastAppliedVersion(context),
    }).catch(() => {
      this.connected.set(false);
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.context = null;
    this.resyncPromise = null;
    this.queuedResyncPromise = null;
    this.patchV2Chain = Promise.resolve();
    this.refetchGuardBySignature.clear();
    this.completedCommandIds.length = 0;
    this.completedCommandIdSet.clear();
    this.closeSnapshotMetricsChannel();
    this.connected.set(false);
    this.rejectInFlightCommand(
      new Error('WebSocket connection closed before the command completed.'),
      undefined,
      undefined,
      'disconnect',
    );
    this.rejectQueuedCommands(new Error('WebSocket connection closed before the command completed.'), 'disconnect');
    this.mulliganQueue.length = 0;
    this.transport.disconnect();
  }

  async sendCommand(context: GameTableWebsocketGameplayContext, type: GameWebsocketCommandType, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.isMigratedCommand(type) || this.transport.status() !== 'connected') {
      return false;
    }

    const snapshot = context.snapshot();
    const gameId = context.gameId();
    if (!snapshot || !gameId) {
      return false;
    }

    const commandPayload = this.websocketPayload(type, payload);
    if (!commandPayload) {
      return false;
    }

    this.pruneRejectionTelemetry();
    const signature = this.commandSignature(type, commandPayload);
    if (this.isCircuitBlocked(signature)) {
      const message = 'Action temporarily blocked after repeated command rejections.';
      this.queueCounters.circuitBlockedTotal += 1;
      this.recordAdhocDeadLetter(context.gameId(), type, 'circuit_blocked', message);
      this.setErrorThrottled(`${signature}:circuit`, 'Accion temporalmente limitada para evitar saturacion.');
      context.onCommandBlocked?.('circuit_blocked', type, commandPayload);
      throw new Error(message);
    }

    const dedupedInFlight = this.attachToInFlightCommand(type, signature);
    if (dedupedInFlight) {
      await dedupedInFlight;
      return true;
    }

    const pending = this.createPendingCommand(context, type, commandPayload);
    if (this.isPositionCommand(type)) {
      this.queueCounters.positionCommandsPerDrag += 1;
    }
    if (!this.enqueueCommand(pending)) {
      const message = 'WebSocket command dropped because the local queue is full.';
      this.queueCounters.queueFullTotal += 1;
      this.recordDeadLetter(pending, 'queue_full', message);
      this.setErrorThrottled(`${signature}:queue_full`, 'Accion temporalmente limitada para evitar saturacion.');
      context.onCommandBlocked?.('queue_full', type, commandPayload);
      pending.reject(new Error(message));
    }
    this.drainQueue();
    await pending.wait;
    return true;
  }

  prepareForLocalConcede(): void {
    this.resolveQueuedTurnChangedCommands();
    this.markInFlightTurnChangedForConcedeSuppression();
  }

  sendMulliganTake(gameId: string): boolean {
    return this.sendMulliganMessage({
      kind: 'mulligan.take',
      gameId,
      messageId: this.randomId('mulligan'),
    });
  }

  sendMulliganKeep(gameId: string, bottomCardInstanceIds?: readonly string[]): boolean {
    return this.sendMulliganMessage({
      kind: 'mulligan.keep',
      gameId,
      messageId: this.randomId('mulligan'),
      ...(bottomCardInstanceIds && bottomCardInstanceIds.length > 0 ? { bottomCardInstanceIds: [...bottomCardInstanceIds] } : {}),
    });
  }

  sendMulliganScryConfirm(gameId: string, destination: 'TOP' | 'BOTTOM'): boolean {
    return this.sendMulliganMessage({
      kind: 'mulligan.scry.confirm',
      gameId,
      messageId: this.randomId('mulligan'),
      destination,
    });
  }

  private async handleMessage(message: GameplayServerMessage): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }

    this.logGameplayDebug('debug', context, {
      source: 'message.received',
      message,
      reason: this.incomingMessageType(message),
    });

    switch (message.kind) {
      case 'connection_state':
        const connectionSource = this.connectionStateMessages === 0 ? 'bootstrap' : 'reconnect';
        this.connectionStateMessages += 1;
        this.connected.set(message.status === 'connected');
        this.logGameplayDebug('info', context, {
          source: connectionSource,
          message,
          reason: 'connection_state',
          result: connectionSource === 'bootstrap' ? 'live' : 'reconnected',
        });
        if (message.status === 'connected') {
          this.drainMulliganQueue();
          this.drainQueue();
        }
        return;

      case 'game_patch':
        await this.handlePatch(context, message);
        return;

      case 'patch.v2':
        this.patchV2Chain = this.patchV2Chain
          .catch(() => undefined)
          .then(() => this.handlePatchV2(context, message));
        await this.patchV2Chain;
        return;

      case 'command_ack':
        await this.handleCommandAck(context, message);
        return;

      case 'resync_required':
        await this.handleResyncRequired(context, message);
        return;

      case 'error':
        this.handleError(message);
        return;

      case 'connection_joined':
      case 'connection_left':
      case 'pong':
      case 'player_presence_changed':
        return;

      case 'mulligan.public_state':
        context.onMulliganPublicState?.(message);
        return;

      case 'mulligan.private_state':
        context.onMulliganPrivateState?.(message);
        return;

      case 'mulligan.error':
        context.onMulliganError?.(message);
        this.setErrorThrottled(
          `${message.messageId ?? 'mulligan'}:${message.error.code}:${message.error.message}`,
          message.error.message || 'Mulligan action failed.',
        );
        return;

      case 'mulligan.completed':
        context.onMulliganCompleted?.(message);
        if (this.gameplayV2Flags.enabled()) {
          const synchronizedVersion = Math.max(
            context.snapshot()?.version ?? 0,
            this.normalizedV2Store.state()?.lastAppliedVersion ?? 0,
          );
          if ((message.version ?? 0) > synchronizedVersion) {
            await this.requestResync(context, {
              source: 'mulligan.completed',
              reason: 'client_behind',
              message,
              currentVersion: message.version,
            });
          } else {
            this.logGameplayDebug('debug', context, {
              source: 'mulligan.completed',
              reason: 'already_synchronized',
              message,
              currentVersion: message.version,
              result: 'no_refetch',
            });
          }
        }
        return;
    }
  }

  private sendMulliganMessage(message: GameplayClientMessage): boolean {
    const status = this.transport.status();
    if (status !== 'connected') {
      if (status === 'error' || this.mulliganQueue.length >= MULLIGAN_QUEUE_LIMIT) {
        return false;
      }

      this.mulliganQueue.push(message);
      return true;
    }

    return this.transport.send(message);
  }

  private drainMulliganQueue(): void {
    if (this.transport.status() !== 'connected') {
      return;
    }

    while (this.mulliganQueue.length > 0) {
      const message = this.mulliganQueue.shift();
      if (!message || !this.transport.send(message)) {
        if (message) {
          this.mulliganQueue.unshift(message);
        }
        return;
      }
    }
  }

  private async handlePatch(context: GameTableWebsocketGameplayContext, patch: GameplayGamePatchMessage): Promise<void> {
    const snapshot = context.snapshot();
    if (!snapshot) {
      await this.requestResync(context, {
        source: 'handlePatch',
        reason: 'missing_state',
        patch,
        currentVersion: patch.version,
      });
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    const previousSnapshotSize = this.snapshotSize(snapshot);
    const result = applyGameSnapshotPatch(snapshot, patch);
    if (result.status === 'applied') {
      const isLocalPatch = this.isPatchForInFlightCommand(patch);
      this.realtimeAnimationBus.emitPatchAnimation({
        previousSnapshot: snapshot,
        nextSnapshot: result.snapshot,
        patch,
        isLocalPatch,
      });
      context.setSnapshot(result.snapshot);
      this.publishSnapshotMetric(context.gameId(), patch, previousSnapshotSize, this.snapshotSize(result.snapshot));
      this.logGameplayDebug('debug', context, {
        source: 'handlePatch',
        reason: 'applied',
        patch,
        currentVersion: patch.version,
        result: 'applied',
      });
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    if (result.status === 'ignored') {
      this.logGameplayDebug('debug', context, {
        source: 'handlePatch',
        reason: result.reason,
        patch,
        currentVersion: patch.version,
        result: 'ignored',
      });
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    this.gameplayDebugCounters.patchLegacyApplyFail += 1;
    await this.requestResync(context, {
      source: 'handlePatch',
      reason: result.reason,
      patch,
      currentVersion: patch.version,
    });
    this.resolveInFlightCommand(patch.clientActionId);
    this.drainQueue();
  }

  private async handlePatchV2(context: GameTableWebsocketGameplayContext, patch: GameplayPatchV2Message): Promise<void> {
    if (!this.gameplayV2Flags.enabled()) {
      this.logGameplayDebug('warn', context, {
        source: 'handlePatchV2',
        reason: 'frontend_v2_disabled',
        patch,
        currentVersion: patch.version,
        result: 'ignored',
      });
      return;
    }

    const previousSnapshot = context.snapshot();
    const previousSnapshotSize = this.snapshotSize(previousSnapshot);
    this.logGameplayDebug('debug', context, {
      source: 'handlePatchV2',
      reason: this.patchV2VersionRelation(patch.version),
      patch,
      currentVersion: patch.version,
      result: 'received',
    });
    const hydratedPatch = await this.staticCardResolver.hydratePatch(patch, this.normalizedV2Store.state());
    const result = this.normalizedV2Store.applyPatch(hydratedPatch);
    if (result.status === 'applied') {
      this.gameplayDebugCounters.patchV2ApplyOk += 1;
      context.onMulliganPatchV2Applied?.(hydratedPatch, result.snapshot);
      context.setSnapshot(result.snapshot);
      this.publishSnapshotMetric(context.gameId(), hydratedPatch, previousSnapshotSize, this.snapshotSize(result.snapshot));
      this.logGameplayDebug('debug', context, {
        source: 'handlePatchV2',
        reason: 'applied',
        patch: hydratedPatch,
        currentVersion: hydratedPatch.version,
        result: 'applied',
      });
      this.resolveInFlightCommand(hydratedPatch.ackClientActionId ?? undefined);
      this.drainQueue();
      return;
    }

    if (result.status === 'ignored') {
      const snapshot = context.snapshot() ?? result.snapshot;
      if (snapshot) {
        context.onMulliganPatchV2Applied?.(hydratedPatch, snapshot);
      }
      this.logGameplayDebug('debug', context, {
        source: 'handlePatchV2',
        reason: result.reason,
        patch: hydratedPatch,
        currentVersion: hydratedPatch.version,
        result: 'ignored',
      });
      this.resolveInFlightCommand(hydratedPatch.ackClientActionId ?? undefined);
      this.drainQueue();
      return;
    }

    this.gameplayDebugCounters.patchV2ApplyResyncRequired += 1;
    if (result.reason === 'version_gap') {
      this.gameplayDebugCounters.patchV2ApplyVersionGap += 1;
    }
    if (result.reason === 'missing_state') {
      this.gameplayDebugCounters.patchV2ApplyMissingState += 1;
    }
    await this.requestResync(context, {
      source: 'handlePatchV2',
      reason: result.reason,
      patch: hydratedPatch,
      currentVersion: hydratedPatch.version,
    });
    const snapshot = context.snapshot();
    if (snapshot) {
      context.onMulliganPatchV2Applied?.(hydratedPatch, snapshot);
    }
    this.resolveInFlightCommand(hydratedPatch.ackClientActionId ?? undefined);
    this.drainQueue();
  }

  private isPatchForInFlightCommand(patch: GameplayGamePatchMessage): boolean {
    const inFlight = this.inFlightCommand;

    return Boolean(inFlight && this.matchesInFlight(inFlight, patch.clientActionId));
  }

  private async handleCommandAck(context: GameTableWebsocketGameplayContext, ack: GameplayCommandAckMessage): Promise<void> {
    if (!this.matchesInFlightCommandAck(ack)) {
      this.recordLateAckIgnored(context.gameId());
      return;
    }

    if (ack.status === 'rejected') {
      const inFlight = this.inFlightCommand;
      if (inFlight && this.shouldSuppressConcedeTurnChangedRejection(inFlight, ack)) {
        this.resolveInFlightCommand(ack.clientActionId, ack.messageId);
        this.drainQueue();
        return;
      }
      if (inFlight) {
        this.queueCounters.rejectedTotal += 1;
        this.trackRejectedSignature(inFlight.signature);
      }
      this.rejectInFlightCommand(
        new Error(ack.error?.message ?? 'WebSocket command rejected.'),
        ack.clientActionId,
        ack.messageId,
        'rejected',
      );
      this.drainQueue();
      return;
    }

    if (ack.status === 'duplicate') {
      this.resolveInFlightCommand(ack.clientActionId, ack.messageId);
      if (this.isClientSynchronizedAt(context, ack.version)) {
        this.logGameplayDebug('debug', context, {
          source: 'command_ack duplicate',
          reason: 'already_synchronized',
          ack,
          currentVersion: ack.version,
          result: 'no_refetch',
        });
      } else {
        this.gameplayDebugCounters.commandAckDuplicateResync += 1;
        await this.requestResync(context, {
          source: 'command_ack duplicate',
          reason: 'duplicate_ack',
          ack,
          currentVersion: ack.version,
        });
      }
      this.drainQueue();
      return;
    }

    await this.handleCommandResyncRequired(context, ack);
  }

  private async handleResyncRequired(context: GameTableWebsocketGameplayContext, message: GameplayResyncRequiredMessage): Promise<void> {
    this.resolveInFlightCommand(message.clientActionId);
    await this.requestResync(context, {
      source: 'resync_required',
      reason: message.reason,
      message,
      currentVersion: message.currentVersion,
    });
    this.drainQueue();
  }

  private handleError(message: GameplayErrorMessage): void {
    const clientActionId = message.clientActionId;
    if (this.isCompletedCommandMessage(clientActionId, message.messageId)) {
      this.recordLateAckIgnored(this.context?.gameId() ?? message.gameId ?? '');
      this.drainQueue();
      return;
    }

    const error = new Error(message.error.message || 'WebSocket gameplay error.');
    const rejected = this.rejectInFlightCommand(error, clientActionId, message.messageId);
    if (!rejected && (clientActionId || message.messageId)) {
      this.recordLateAckIgnored(this.context?.gameId() ?? message.gameId ?? '');
      this.drainQueue();
      return;
    }

    this.setErrorThrottled(
      `${clientActionId ?? 'global'}:${message.error.code}:${message.error.message}`,
      message.error.message || 'WebSocket gameplay error.',
    );
    this.drainQueue();
  }

  private requestResync(context: GameTableWebsocketGameplayContext, details: GameplayDebugDetails): Promise<void> {
    const refetchSignature = this.refetchGuardSignature(context, details);
    if (this.resyncPromise) {
      this.logGameplayDebug('debug', context, {
        ...details,
        result: 'coalesced_active_refetch',
      });
      return this.resyncPromise;
    }
    if (this.queuedResyncPromise) {
      this.logGameplayDebug('debug', context, {
        ...details,
        result: 'coalesced_queued_refetch',
      });
      return this.queuedResyncPromise;
    }
    if (!this.allowRefetch(refetchSignature)) {
      this.logGameplayDebug('warn', context, {
        ...details,
        blocked: true,
        result: 'blocked_repeated_refetch',
      });
      this.publishQueueMetrics(context.gameId());
      return Promise.resolve();
    }

    this.queuedResyncPromise = Promise.resolve().then(() => {
      this.queuedResyncPromise = null;
      this.queueCounters.resyncTotal += 1;
      this.recordRefetchStarted(context, details);
      this.publishQueueMetrics(context.gameId());
      this.logGameplayDebug('warn', context, {
        ...details,
        result: 'refetch_started',
      });
      this.resyncPromise ??= context.refetch(true).finally(() => {
        this.resyncPromise = null;
        this.drainQueue();
      });

      return this.resyncPromise;
    });

    return this.queuedResyncPromise;
  }

  private createPendingCommand(
    context: GameTableWebsocketGameplayContext,
    type: GameWebsocketCommandType,
    payload: Record<string, unknown>,
  ): PendingWebsocketCommand & { wait: Promise<void> } {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const wait = new Promise<void>((resolveCallback, rejectCallback) => {
      resolve = resolveCallback;
      reject = rejectCallback;
    });

    return {
      messageId: '',
      clientActionId: '',
      type,
      payload,
      signature: this.commandSignature(type, payload),
      context,
      retryCount: 0,
      retryable: RETRYABLE_COMMANDS.has(type),
      coalesceKey: this.coalesceKey(type, payload),
      resolve,
      reject,
      timeoutId: 0,
      wait,
    };
  }

  private enqueueCommand(command: PendingWebsocketCommand): boolean {
    if (command.coalesceKey !== null) {
      for (let index = this.commandQueue.length - 1; index >= 0; index -= 1) {
        const queued = this.commandQueue[index];
        if (queued.coalesceKey !== command.coalesceKey) {
          continue;
        }

        queued.payload = command.payload;
        queued.signature = this.commandSignature(queued.type, queued.payload);
        queued.context = command.context;
        if (this.isPositionCommand(command.type)) {
          this.queueCounters.coalescedPositionEvents += 1;
        }
        const previousResolve = queued.resolve;
        const previousReject = queued.reject;
        queued.resolve = () => {
          previousResolve();
          command.resolve();
        };
        queued.reject = (error) => {
          previousReject(error);
          command.reject(error);
        };
        return true;
      }
    }

    this.commandQueue.push(command);
    this.queueCounters.enqueueTotal += 1;
    this.recordRate(this.queueRates.enqueueTimestamps);
    this.enforceQueueDepthCap(command.context.gameId(), command);
    this.publishQueueMetrics(command.context.gameId());
    return this.commandQueue.includes(command);
  }

  private drainQueue(): void {
    if (this.inFlightCommand || this.commandQueue.length === 0 || this.isResyncing() || this.transport.status() !== 'connected') {
      return;
    }

    const queued = this.shiftNextCommand();
    if (!queued) {
      return;
    }

    const snapshot = queued.context.snapshot();
    const gameId = queued.context.gameId();
    if (!snapshot || !gameId) {
      queued.reject(new Error('WebSocket command could not be prepared because the local snapshot is unavailable.'));
      this.recordDeadLetter(queued, 'rejected', 'Local snapshot unavailable while draining queue.');
      this.publishQueueMetrics(queued.context.gameId());
      this.drainQueue();
      return;
    }

    const clientActionId = this.randomId('action');
    const messageId = this.randomId('message');
    const message = this.gameplayV2Flags.enabled()
      ? {
          kind: 'command.v2',
          gameId,
          messageId,
          type: queued.type,
          payload: queued.payload,
          clientActionId,
          baseVersion: snapshot.version,
        } satisfies GameplayClientMessage
      : {
          kind: 'command',
          gameId,
          messageId,
          command: {
            type: queued.type,
            payload: queued.payload,
            clientActionId,
            baseVersion: snapshot.version,
          },
        } satisfies GameplayClientMessage;

    queued.messageId = messageId;
    queued.clientActionId = clientActionId;
    queued.timeoutId = window.setTimeout(() => {
      this.logGameplayDebug('warn', queued.context, {
        source: 'timeout',
        reason: 'command_timeout',
        command: queued,
        currentVersion: queued.context.snapshot()?.version ?? null,
        result: 'rejected',
      });
      this.rejectInFlightCommand(new Error('WebSocket command timed out.'), clientActionId, messageId, 'timeout');
      this.drainQueue();
    }, COMMAND_TIMEOUT_MS);
    this.inFlightCommand = queued;
    this.queueCounters.drainTotal += 1;
    this.recordRate(this.queueRates.drainTimestamps);
    this.publishQueueMetrics(gameId);

    if (!this.transport.send(message)) {
      this.rejectInFlightCommand(new Error('WebSocket gameplay connection is not available.'), clientActionId, messageId, 'disconnect');
      this.drainQueue();
    }
  }

  private resolveInFlightCommand(clientActionId?: string, messageId?: string): boolean {
    const inFlight = this.inFlightCommand;
    if (!inFlight || !this.matchesInFlight(inFlight, clientActionId, messageId)) {
      return false;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    this.rememberCompletedCommand(inFlight.clientActionId, inFlight.messageId);
    inFlight.resolve();
    this.publishQueueMetrics(inFlight.context.gameId());
    return true;
  }

  private rejectInFlightCommand(
    error: Error,
    clientActionId?: string,
    messageId?: string,
    reason: GameDebugQueueDeadLetterReason = 'rejected',
  ): boolean {
    const inFlight = this.inFlightCommand;
    if (!inFlight || !this.matchesInFlight(inFlight, clientActionId, messageId)) {
      return false;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    this.recordDeadLetter(inFlight, reason, error.message);
    inFlight.reject(error);
    this.publishQueueMetrics(inFlight.context.gameId());
    return true;
  }

  private rejectQueuedCommands(error: Error, reason: GameDebugQueueDeadLetterReason = 'rejected'): void {
    while (this.commandQueue.length > 0) {
      const queued = this.commandQueue.shift();
      if (queued) {
        this.recordDeadLetter(queued, reason, error.message);
      }
      queued?.reject(error);
    }
    this.publishQueueMetrics(this.context?.gameId() ?? '');
  }

  private async handleCommandResyncRequired(
    context: GameTableWebsocketGameplayContext,
    ack?: GameplayCommandAckMessage,
  ): Promise<void> {
    const inFlight = this.inFlightCommand;
    if (!inFlight) {
      if (ack) {
        this.recordLateAckIgnored(context.gameId());
      } else {
        await this.requestResync(context, {
          source: 'resync_required',
          reason: 'missing_in_flight',
        });
      }
      this.drainQueue();
      return;
    }
    if (ack && !this.matchesInFlight(inFlight, ack.clientActionId, ack.messageId)) {
      this.recordLateAckIgnored(context.gameId());
      return;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;

    const fastRetry = this.canRetryWithoutResync(context, ack?.error?.conflict);
    if (!fastRetry) {
      await this.requestResync(context, {
        source: 'command_ack resync_required',
        reason: ack?.error?.code ?? 'resync_required',
        ack,
        command: inFlight,
        currentVersion: ack?.error?.conflict?.currentVersion ?? ack?.version ?? null,
      });
    } else {
      this.logGameplayDebug('debug', context, {
        source: 'command_ack resync_required',
        reason: 'concurrent_write_already_current',
        ack,
        command: inFlight,
        currentVersion: ack?.error?.conflict?.currentVersion ?? ack?.version ?? null,
        result: 'no_refetch',
      });
    }

    if (!inFlight.retryable || inFlight.retryCount >= MAX_RETRY_COUNT) {
      this.recordDeadLetter(inFlight, 'resync_retry_exhausted', 'Resync required and retry budget exhausted.');
      inFlight.reject(new Error('WebSocket command requires resync and cannot be retried automatically.'));
      this.publishQueueMetrics(inFlight.context.gameId());
      this.drainQueue();
      return;
    }

    inFlight.retryCount += 1;
    this.queueCounters.retryTotal += 1;
    inFlight.messageId = '';
    inFlight.clientActionId = '';
    inFlight.timeoutId = 0;
    this.commandQueue.unshift(inFlight);
    this.publishQueueMetrics(inFlight.context.gameId());
    this.drainQueue();
  }

  private matchesInFlight(inFlight: PendingWebsocketCommand, clientActionId?: string, messageId?: string): boolean {
    if (messageId) {
      return inFlight.messageId === messageId;
    }
    if (clientActionId) {
      return inFlight.clientActionId === clientActionId;
    }

    return true;
  }

  private matchesInFlightCommandAck(ack: GameplayCommandAckMessage): boolean {
    const inFlight = this.inFlightCommand;
    if (!inFlight) {
      return false;
    }

    return this.matchesInFlight(inFlight, ack.clientActionId, ack.messageId);
  }

  private isCompletedCommandMessage(clientActionId?: string, messageId?: string): boolean {
    return this.completedCommandId(clientActionId) || this.completedCommandId(messageId);
  }

  private completedCommandId(value?: string): boolean {
    return typeof value === 'string' && value.trim() !== '' && this.completedCommandIdSet.has(value);
  }

  private rememberCompletedCommand(clientActionId?: string, messageId?: string): void {
    this.rememberCompletedCommandId(clientActionId);
    this.rememberCompletedCommandId(messageId);
  }

  private rememberCompletedCommandId(value?: string): void {
    if (typeof value !== 'string' || value.trim() === '' || this.completedCommandIdSet.has(value)) {
      return;
    }

    this.completedCommandIdSet.add(value);
    this.completedCommandIds.push(value);
    while (this.completedCommandIds.length > MAX_COMPLETED_COMMAND_IDS) {
      const expired = this.completedCommandIds.shift();
      if (expired) {
        this.completedCommandIdSet.delete(expired);
      }
    }
  }

  private canRetryWithoutResync(
    context: GameTableWebsocketGameplayContext,
    conflict?: GameplayVersionConflict,
  ): boolean {
    if (!conflict || conflict.classification !== 'concurrent_write') {
      return false;
    }

    const snapshotVersion = context.snapshot()?.version;
    if (!snapshotVersion) {
      return false;
    }

    return snapshotVersion === conflict.currentVersion;
  }

  private attachToInFlightCommand(type: GameWebsocketCommandType, signature: string): Promise<void> | null {
    if (!IN_FLIGHT_DEDUPED_COMMANDS.has(type)) {
      return null;
    }

    const inFlight = this.inFlightCommand;
    if (!inFlight || inFlight.type !== type || inFlight.signature !== signature) {
      return null;
    }

    return new Promise<void>((resolve, reject) => {
      const previousResolve = inFlight.resolve;
      const previousReject = inFlight.reject;
      inFlight.resolve = () => {
        previousResolve();
        resolve();
      };
      inFlight.reject = (error) => {
        previousReject(error);
        reject(error);
      };
    });
  }

  private commandSignature(type: GameWebsocketCommandType, payload: Record<string, unknown>): string {
    return `${type}:${this.stableStringify(payload)}`;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();

      return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
    }

    const serialized = JSON.stringify(value);
    return serialized ?? 'null';
  }

  private trackRejectedSignature(signature: string): void {
    const now = Date.now();
    const current = this.rejectedBySignature.get(signature) ?? [];
    const recent = current.filter((timestamp) => now - timestamp <= REJECTION_WINDOW_MS);
    recent.push(now);
    this.rejectedBySignature.set(signature, recent);
    if (recent.length >= REJECTION_THRESHOLD) {
      this.blockedSignatures.set(signature, now + CIRCUIT_COOLDOWN_MS);
    }
  }

  private isCircuitBlocked(signature: string): boolean {
    const blockedUntil = this.blockedSignatures.get(signature);
    if (!blockedUntil) {
      return false;
    }

    if (blockedUntil <= Date.now()) {
      this.blockedSignatures.delete(signature);
      return false;
    }

    return true;
  }

  private pruneRejectionTelemetry(): void {
    const now = Date.now();
    for (const [signature, timestamps] of this.rejectedBySignature.entries()) {
      const recent = timestamps.filter((timestamp) => now - timestamp <= REJECTION_WINDOW_MS);
      if (recent.length === 0) {
        this.rejectedBySignature.delete(signature);
      } else {
        this.rejectedBySignature.set(signature, recent);
      }
    }

    for (const [signature, blockedUntil] of this.blockedSignatures.entries()) {
      if (blockedUntil <= now) {
        this.blockedSignatures.delete(signature);
      }
    }

    for (const [throttleKey, lastEmission] of this.throttledErrors.entries()) {
      if (now - lastEmission > ERROR_THROTTLE_MS) {
        this.throttledErrors.delete(throttleKey);
      }
    }
  }

  private setErrorThrottled(throttleKey: string, message: string): void {
    if (!this.context || message.trim() === '') {
      return;
    }

    const now = Date.now();
    const previous = this.throttledErrors.get(throttleKey) ?? 0;
    if (now - previous < ERROR_THROTTLE_MS) {
      return;
    }

    this.throttledErrors.set(throttleKey, now);
    this.context.setError(message);
  }

  private recordAdhocDeadLetter(gameId: string, commandType: GameWebsocketCommandType, reason: GameDebugQueueDeadLetterReason, details: string): void {
    this.recordDeadLetterEvent({
      kind: 'dead_letter_event',
      gameId,
      commandType,
      reason,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      details: details.trim() !== '' ? details : null,
    });
  }

  private recordLateAckIgnored(gameId: string): void {
    this.queueCounters.lateAckIgnoredTotal += 1;
    this.publishQueueMetrics(gameId);
  }

  private isClientSynchronizedAt(context: GameTableWebsocketGameplayContext, version: number | null | undefined): boolean {
    if (typeof version !== 'number' || !Number.isFinite(version)) {
      return false;
    }

    const snapshotVersion = context.snapshot()?.version ?? 0;
    if (!this.gameplayV2Flags.enabled()) {
      return snapshotVersion >= version;
    }

    const normalizedVersion = this.normalizedV2Store.state()?.lastAppliedVersion ?? 0;
    return snapshotVersion >= version && normalizedVersion >= version;
  }

  private lastAppliedVersion(context: GameTableWebsocketGameplayContext): number | null {
    const normalizedVersion = this.normalizedV2Store.state()?.lastAppliedVersion;
    if (this.gameplayV2Flags.enabled() && typeof normalizedVersion === 'number' && normalizedVersion >= 1) {
      return normalizedVersion;
    }

    return context.snapshot()?.version ?? null;
  }

  private patchV2VersionRelation(patchVersion: number): string {
    const lastAppliedVersion = this.normalizedV2Store.state()?.lastAppliedVersion;
    if (typeof lastAppliedVersion !== 'number') {
      return 'missing_state';
    }
    if (patchVersion === lastAppliedVersion + 1) {
      return 'next_version';
    }
    if (patchVersion <= lastAppliedVersion) {
      return 'duplicate_or_late_version';
    }

    return 'version_gap';
  }

  private refetchGuardSignature(context: GameTableWebsocketGameplayContext, details: GameplayDebugDetails): string {
    const gameId = context.gameId();
    const reason = details.reason ?? details.source;
    const version = this.debugCurrentVersion(context, details) ?? context.snapshot()?.version ?? 0;

    return `${gameId}|${reason}|${version}`;
  }

  private allowRefetch(signature: string): boolean {
    const now = Date.now();
    for (const [key, timestamp] of this.refetchGuardBySignature.entries()) {
      if (now - timestamp > REFETCH_GUARD_WINDOW_MS) {
        this.refetchGuardBySignature.delete(key);
      }
    }

    const previous = this.refetchGuardBySignature.get(signature);
    if (previous !== undefined && now - previous <= REFETCH_GUARD_WINDOW_MS) {
      return false;
    }

    this.refetchGuardBySignature.set(signature, now);
    return true;
  }

  private recordRefetchStarted(context: GameTableWebsocketGameplayContext, details: GameplayDebugDetails): void {
    const reason = details.reason ?? details.source;
    const source = details.source;
    this.gameplayDebugCounters.refetchCount += 1;
    this.gameplayDebugCounters.refetchByReason[reason] = (this.gameplayDebugCounters.refetchByReason[reason] ?? 0) + 1;
    this.gameplayDebugCounters.refetchBySource[source] = (this.gameplayDebugCounters.refetchBySource[source] ?? 0) + 1;
    this.logGameplayDebug('debug', context, {
      ...details,
      reason,
      result: 'counter_incremented',
    });
  }

  private isResyncing(): boolean {
    return this.resyncPromise !== null || this.queuedResyncPromise !== null;
  }

  private coalesceKey(type: GameWebsocketCommandType, payload: Record<string, unknown>): string | null {
    if (!COALESCED_COMMANDS.has(type)) {
      return null;
    }

    if (type === 'life.changed') {
      return typeof payload['playerId'] === 'string' ? `${type}:${payload['playerId']}` : null;
    }
    if (type === 'commander.damage.changed') {
      return typeof payload['targetPlayerId'] === 'string' && typeof payload['commanderInstanceId'] === 'string'
        ? `${type}:${payload['targetPlayerId']}:${payload['commanderInstanceId']}`
        : null;
    }
    if (type === 'counter.changed') {
      return typeof payload['scope'] === 'string' && typeof payload['key'] === 'string'
        ? `${type}:${payload['scope']}:${payload['key']}`
        : null;
    }
    if (type === 'card.position.changed') {
      return typeof payload['playerId'] === 'string'
        && typeof payload['zone'] === 'string'
        && typeof payload['instanceId'] === 'string'
        ? `${type}:${payload['playerId']}:${payload['zone']}:${payload['instanceId']}`
        : null;
    }
    if (type === 'cards.position.changed') {
      return typeof payload['playerId'] === 'string' && typeof payload['zone'] === 'string'
        ? `${type}:${payload['playerId']}:${payload['zone']}`
        : null;
    }

    return null;
  }

  private randomId(prefix: string): string {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private websocketPayload(type: GameWebsocketCommandType, payload: Record<string, unknown>): Record<string, unknown> | null {
    if (type !== 'zone.changed') {
      return payload;
    }

    const playerId = payload['playerId'];
    const zone = payload['zone'];
    const cards = payload['cards'];
    if (typeof playerId !== 'string' || playerId.trim() === '' || typeof zone !== 'string' || zone.trim() === '' || !Array.isArray(cards)) {
      return null;
    }

    const instanceIds = cards
      .map((card) => this.cardInstanceId(card))
      .filter((instanceId): instanceId is string => instanceId !== null);
    if (instanceIds.length !== cards.length) {
      return null;
    }

    return { playerId, zone, instanceIds };
  }

  private cardInstanceId(card: unknown): string | null {
    if (!card || typeof card !== 'object') {
      return null;
    }

    const instanceId = (card as { instanceId?: unknown }).instanceId;

    return typeof instanceId === 'string' && instanceId.trim() !== '' ? instanceId : null;
  }

  private enforceQueueDepthCap(gameId: string, incomingCommand?: PendingWebsocketCommand): void {
    while (this.totalQueueDepth() > MAX_QUEUE_DEPTH) {
      const dropIndex = this.findOldestDroppableQueueIndex();
      if (dropIndex < 0) {
        break;
      }

      const dropped = this.commandQueue.splice(dropIndex, 1)[0];
      if (!dropped) {
        break;
      }

      this.queueCounters.dropTotal += 1;
      this.recordDeadLetter(dropped, 'queue_dropped', 'Dropped coalescible command due to queue depth cap.');
      dropped.reject(new Error('WebSocket command dropped because the local queue is full.'));
    }

    if (incomingCommand && this.totalQueueDepth() >= MAX_QUEUE_DEPTH) {
      const incomingIndex = this.commandQueue.indexOf(incomingCommand);
      if (incomingIndex >= 0) {
        this.commandQueue.splice(incomingIndex, 1);
      }
    }

    this.publishQueueMetrics(gameId);
  }

  private findOldestDroppableQueueIndex(): number {
    for (let index = 0; index < this.commandQueue.length; index += 1) {
      if (this.isPositionCommand(this.commandQueue[index].type)) {
        return index;
      }
    }

    for (let index = 0; index < this.commandQueue.length; index += 1) {
      if (this.commandQueue[index].coalesceKey !== null) {
        return index;
      }
    }

    return -1;
  }

  private recordDeadLetter(command: PendingWebsocketCommand, reason: GameDebugQueueDeadLetterReason, details: string): void {
    this.recordDeadLetterEvent({
      kind: 'dead_letter_event',
      gameId: command.context.gameId(),
      commandType: command.type,
      reason,
      retryCount: command.retryCount,
      createdAt: new Date().toISOString(),
      details: details.trim() !== '' ? details : null,
    });
  }

  private recordDeadLetterEvent(event: GameDebugDeadLetterEvent): void {
    const now = Date.now();
    this.pruneDeadLetterDedup(now);
    const dedupeSignature = this.deadLetterSignature(event);
    const previous = this.deadLetterDedupeBySignature.get(dedupeSignature);
    if (previous !== undefined && now - previous < DEAD_LETTER_DEDUP_WINDOW_MS) {
      return;
    }
    this.deadLetterDedupeBySignature.set(dedupeSignature, now);

    this.deadLetter.push(event);
    while (this.deadLetter.length > MAX_DEAD_LETTER) {
      this.deadLetter.shift();
    }

    const channel = this.snapshotMetricsChannel;
    if (!channel || !this.shouldPublishDebugForGame(event.gameId)) {
      return;
    }

    channel.postMessage(event);
  }

  private publishQueueMetrics(gameId: string): void {
    this.pruneRejectionTelemetry();
    const channel = this.snapshotMetricsChannel;
    if (!channel || !this.shouldPublishDebugForGame(gameId)) {
      return;
    }

    const now = Date.now();
    this.pruneRateWindow(this.queueRates.enqueueTimestamps, now);
    this.pruneRateWindow(this.queueRates.drainTimestamps, now);

    const message: GameDebugQueueMetrics = {
      kind: 'queue_metrics',
      gameId,
      queueDepth: this.totalQueueDepth(),
      inFlight: this.inFlightCommand !== null,
      enqueueTotal: this.queueCounters.enqueueTotal,
      drainTotal: this.queueCounters.drainTotal,
      dropTotal: this.queueCounters.dropTotal,
      retryTotal: this.queueCounters.retryTotal,
      resyncTotal: this.queueCounters.resyncTotal,
      lateAckIgnoredTotal: this.queueCounters.lateAckIgnoredTotal,
      rejectedTotal: this.queueCounters.rejectedTotal,
      circuitBlockedTotal: this.queueCounters.circuitBlockedTotal,
      queueFullTotal: this.queueCounters.queueFullTotal,
      'actor.queue_depth': this.totalQueueDepth(),
      'position.commands_per_drag': this.queueCounters.positionCommandsPerDrag,
      dropped_ephemeral_events: this.queueCounters.droppedEphemeralEvents,
      coalesced_position_events: this.queueCounters.coalescedPositionEvents,
      'gameplay.refetch.count': this.gameplayDebugCounters.refetchCount,
      'gameplay.refetch.reason': { ...this.gameplayDebugCounters.refetchByReason },
      'gameplay.refetch.source': { ...this.gameplayDebugCounters.refetchBySource },
      'gameplay.patch_v2.apply.ok': this.gameplayDebugCounters.patchV2ApplyOk,
      'gameplay.patch_v2.apply.resync_required': this.gameplayDebugCounters.patchV2ApplyResyncRequired,
      'gameplay.patch_v2.apply.version_gap': this.gameplayDebugCounters.patchV2ApplyVersionGap,
      'gameplay.patch_v2.apply.missing_state': this.gameplayDebugCounters.patchV2ApplyMissingState,
      'gameplay.patch_legacy.apply.fail': this.gameplayDebugCounters.patchLegacyApplyFail,
      'gameplay.command_ack.duplicate_resync': this.gameplayDebugCounters.commandAckDuplicateResync,
      enqueueRate: Number((this.queueRates.enqueueTimestamps.length / (QUEUE_RATE_WINDOW_MS / 1000)).toFixed(2)),
      drainRate: Number((this.queueRates.drainTimestamps.length / (QUEUE_RATE_WINDOW_MS / 1000)).toFixed(2)),
      measuredAt: new Date(now).toISOString(),
    };

    channel.postMessage(message);
  }

  private logGameplayDebug(
    level: 'debug' | 'info' | 'warn' | 'error',
    context: GameTableWebsocketGameplayContext,
    details: GameplayDebugDetails,
  ): void {
    const event = this.gameplayDebugEvent(context, details);
    const logger = level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'info'
          ? console.info
          : console.debug;
    logger.call(console, '[CommanderZone gameplay realtime]', event);

    const channel = this.snapshotMetricsChannel;
    if (channel && this.shouldPublishDebugForGame(event.gameId)) {
      channel.postMessage(event);
    }
  }

  private gameplayDebugEvent(context: GameTableWebsocketGameplayContext, details: GameplayDebugDetails): GameDebugGameplayEvent {
    const patch = details.patch;
    const message = details.message;
    const ack = details.ack;
    const currentVersion = this.debugCurrentVersion(context, details);

    return {
      kind: 'gameplay_debug_event',
      gameId: context.gameId(),
      source: details.source,
      reason: details.reason ?? null,
      playerId: this.debugPlayerId(),
      localSnapshotVersion: context.snapshot()?.version ?? null,
      normalizedV2LastAppliedVersion: this.normalizedV2Store.state()?.lastAppliedVersion ?? null,
      incomingMessageKind: message?.kind ?? patch?.kind ?? ack?.kind ?? null,
      incomingMessageType: message ? this.incomingMessageType(message) : (patch ? this.incomingPatchType(patch) : (ack ? ack.status : null)),
      incomingPatchVersion: patch?.version ?? null,
      ops: patch ? this.patchOperationNames(patch) : [],
      clientActionId: this.debugClientActionId(details),
      commandType: details.command?.type ?? this.inFlightCommand?.type ?? null,
      currentVersion,
      result: details.result ?? null,
      blocked: details.blocked === true,
      measuredAt: new Date().toISOString(),
    };
  }

  private debugPlayerId(): string | null {
    return this.normalizedV2Store.state()?.game.viewerId ?? null;
  }

  private debugClientActionId(details: GameplayDebugDetails): string | null {
    if (details.patch?.kind === 'patch.v2') {
      return details.patch.ackClientActionId ?? null;
    }
    if (details.patch?.kind === 'game_patch') {
      return details.patch.clientActionId ?? null;
    }

    return details.ack?.clientActionId
      ?? (details.message && 'clientActionId' in details.message && typeof details.message.clientActionId === 'string' ? details.message.clientActionId : null)
      ?? details.command?.clientActionId
      ?? null;
  }

  private debugCurrentVersion(context: GameTableWebsocketGameplayContext, details: GameplayDebugDetails): number | null {
    if (typeof details.currentVersion === 'number') {
      return details.currentVersion;
    }
    if (details.message?.kind === 'resync_required') {
      return details.message.currentVersion;
    }
    if (details.message?.kind === 'mulligan.completed') {
      return details.message.version;
    }
    if (details.ack?.error?.conflict?.currentVersion) {
      return details.ack.error.conflict.currentVersion;
    }
    if (details.ack?.version) {
      return details.ack.version;
    }
    if (details.patch?.version) {
      return details.patch.version;
    }

    return context.snapshot()?.version ?? this.normalizedV2Store.state()?.lastAppliedVersion ?? null;
  }

  private incomingMessageType(message: GameplayServerMessage): string | null {
    if (message.kind === 'game_patch') {
      return message.event?.type ?? 'game_patch';
    }
    if (message.kind === 'patch.v2') {
      return this.incomingPatchType(message);
    }
    if (message.kind === 'command_ack') {
      return message.status;
    }
    if (message.kind === 'resync_required') {
      return message.reason;
    }
    if (message.kind === 'error') {
      return message.error.code;
    }

    return message.kind;
  }

  private incomingPatchType(patch: GameplayGamePatchMessage | GameplayPatchV2Message): string | null {
    if (patch.kind === 'patch.v2') {
      return patch.ops.map((operation) => operation.op).join(',') || 'patch.v2';
    }

    return patch.event?.type ?? (patch.operations.map((operation) => operation.op).join(',') || 'game_patch');
  }

  private patchOperationNames(patch: GameplayGamePatchMessage | GameplayPatchV2Message): string[] {
    return patch.kind === 'patch.v2'
      ? patch.ops.map((operation) => operation.op)
      : patch.operations.map((operation) => operation.op);
  }

  private shouldPublishDebugForGame(gameId: string): boolean {
    return gameId !== '' && this.observedDebugGameId === gameId && Date.now() <= this.observedDebugUntil;
  }

  private recordRate(target: number[]): void {
    const now = Date.now();
    target.push(now);
    this.pruneRateWindow(target, now);
  }

  private pruneRateWindow(target: number[], now: number): void {
    const threshold = now - QUEUE_RATE_WINDOW_MS;
    while (target.length > 0 && target[0] < threshold) {
      target.shift();
    }
  }

  private totalQueueDepth(): number {
    return this.commandQueue.length + (this.inFlightCommand ? 1 : 0);
  }

  private resetQueueTelemetry(): void {
    this.queueCounters.enqueueTotal = 0;
    this.queueCounters.drainTotal = 0;
    this.queueCounters.dropTotal = 0;
    this.queueCounters.retryTotal = 0;
    this.queueCounters.resyncTotal = 0;
    this.queueCounters.lateAckIgnoredTotal = 0;
    this.queueCounters.rejectedTotal = 0;
    this.queueCounters.circuitBlockedTotal = 0;
    this.queueCounters.queueFullTotal = 0;
    this.queueCounters.coalescedPositionEvents = 0;
    this.queueCounters.droppedEphemeralEvents = 0;
    this.queueCounters.positionCommandsPerDrag = 0;
    this.queueRates.enqueueTimestamps = [];
    this.queueRates.drainTimestamps = [];
    this.gameplayDebugCounters.refetchCount = 0;
    this.gameplayDebugCounters.refetchByReason = {};
    this.gameplayDebugCounters.refetchBySource = {};
    this.gameplayDebugCounters.patchV2ApplyOk = 0;
    this.gameplayDebugCounters.patchV2ApplyResyncRequired = 0;
    this.gameplayDebugCounters.patchV2ApplyVersionGap = 0;
    this.gameplayDebugCounters.patchV2ApplyMissingState = 0;
    this.gameplayDebugCounters.patchLegacyApplyFail = 0;
    this.gameplayDebugCounters.commandAckDuplicateResync = 0;
    this.refetchGuardBySignature.clear();
    this.deadLetter.length = 0;
    this.deadLetterDedupeBySignature.clear();
    this.rejectedBySignature.clear();
    this.blockedSignatures.clear();
    this.throttledErrors.clear();
    this.concedeSuppressedTurnChangeSignatures.clear();
    this.connectionStateMessages = 0;
  }

  private deadLetterSignature(event: GameDebugDeadLetterEvent): string {
    return `${event.gameId}|${event.commandType}|${event.reason}|${event.retryCount}|${event.details ?? ''}`;
  }

  private pruneDeadLetterDedup(now: number): void {
    for (const [signature, timestamp] of this.deadLetterDedupeBySignature.entries()) {
      if (now - timestamp > DEAD_LETTER_DEDUP_WINDOW_MS) {
        this.deadLetterDedupeBySignature.delete(signature);
      }
    }
  }

  private openSnapshotMetricsChannel(): void {
    this.closeSnapshotMetricsChannel();
    this.snapshotMetricsChannel = createGameDebugSnapshotMetricsChannel();
    if (!this.snapshotMetricsChannel) {
      return;
    }

    this.snapshotMetricsChannel.onmessage = (event) => {
      const message = event.data;
      if (!isGameDebugSnapshotMetricsMessage(message)) {
        return;
      }

      if (message.kind === 'debug_observe') {
        this.observedDebugGameId = message.gameId;
        this.observedDebugUntil = Date.now() + 5000;
        this.publishQueueMetrics(message.gameId);
        this.publishDeadLetterHistory(message.gameId);
      } else if (message.kind === 'debug_unobserve' && message.gameId === this.observedDebugGameId) {
        this.observedDebugGameId = null;
        this.observedDebugUntil = 0;
      }
    };
  }

  private closeSnapshotMetricsChannel(): void {
    this.observedDebugGameId = null;
    this.observedDebugUntil = 0;
    this.snapshotMetricsChannel?.close();
    this.snapshotMetricsChannel = null;
  }

  private publishSnapshotMetric(
    gameId: string,
    patch: GameplayGamePatchMessage | GameplayPatchV2Message,
    previousSize: { lines: number; characters: number } | null,
    nextSize: { lines: number; characters: number } | null,
  ): void {
    const channel = this.snapshotMetricsChannel;
    const clientActionId = patch.kind === 'patch.v2' ? patch.ackClientActionId : patch.clientActionId;
    const operationCount = patch.kind === 'patch.v2' ? patch.ops.length : patch.operations.length;
    if (!channel || !clientActionId || this.observedDebugGameId !== gameId || Date.now() > this.observedDebugUntil) {
      return;
    }

    channel.postMessage({
      kind: 'snapshot_metric',
      gameId,
      clientActionId,
      version: patch.version,
      previousLines: previousSize?.lines ?? 0,
      nextLines: nextSize?.lines ?? 0,
      lineDelta: (nextSize?.lines ?? 0) - (previousSize?.lines ?? 0),
      previousCharacters: previousSize?.characters ?? 0,
      nextCharacters: nextSize?.characters ?? 0,
      characterDelta: (nextSize?.characters ?? 0) - (previousSize?.characters ?? 0),
      operationCount,
      measuredAt: new Date().toISOString(),
    });
  }

  private snapshotSize(snapshot: GameSnapshot | null): { lines: number; characters: number } | null {
    if (!snapshot || !this.shouldMeasureSnapshotSize()) {
      return null;
    }

    const json = JSON.stringify(snapshot, null, 2);

    return {
      lines: json === '' ? 0 : json.split('\n').length,
      characters: json.length,
    };
  }

  private shouldMeasureSnapshotSize(): boolean {
    return this.observedDebugGameId !== null && Date.now() <= this.observedDebugUntil;
  }

  private publishDeadLetterHistory(gameId: string): void {
    const channel = this.snapshotMetricsChannel;
    if (!channel || !this.shouldPublishDebugForGame(gameId)) {
      return;
    }

    for (const event of this.deadLetter) {
      if (event.gameId !== gameId) {
        continue;
      }
      channel.postMessage(event);
    }
  }

  private resolveQueuedTurnChangedCommands(): void {
    for (let index = this.commandQueue.length - 1; index >= 0; index -= 1) {
      const queued = this.commandQueue[index];
      if (queued.type !== 'turn.changed') {
        continue;
      }

      this.commandQueue.splice(index, 1);
      queued.resolve();
      this.publishQueueMetrics(queued.context.gameId());
    }
  }

  private markInFlightTurnChangedForConcedeSuppression(): void {
    const inFlight = this.inFlightCommand;
    if (!inFlight || inFlight.type !== 'turn.changed') {
      return;
    }

    this.concedeSuppressedTurnChangeSignatures.add(this.inFlightCommandSignature(inFlight));
  }

  private shouldSuppressConcedeTurnChangedRejection(inFlight: PendingWebsocketCommand, ack: GameplayCommandAckMessage): boolean {
    if (inFlight.type !== 'turn.changed') {
      return false;
    }

    if (!this.concedeSuppressedTurnChangeSignatures.delete(this.inFlightCommandSignature(inFlight))) {
      return false;
    }

    const message = (ack.error?.message ?? '').toLowerCase();
    return message.includes('conceded players cannot perform game actions');
  }

  private inFlightCommandSignature(command: PendingWebsocketCommand): string {
    return `${command.clientActionId}|${command.messageId}|${command.signature}`;
  }

  private shiftNextCommand(): PendingWebsocketCommand | undefined {
    const gameplayIndex = this.commandQueue.findIndex((command) => !this.isPositionCommand(command.type));
    if (gameplayIndex >= 0) {
      return this.commandQueue.splice(gameplayIndex, 1)[0];
    }

    return this.commandQueue.shift();
  }

  private isPositionCommand(type: GameWebsocketCommandType): boolean {
    return POSITION_COMMANDS.has(type);
  }
}
