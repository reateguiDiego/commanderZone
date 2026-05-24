import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameCommandType, GameSnapshot } from '../../../../core/models/game.model';
import {
  GameplayClientMessage,
  GameplayCommandAckMessage,
  GameplayErrorMessage,
  GameplayGamePatchMessage,
  GameplayResyncRequiredMessage,
  GameplayServerMessage,
} from '../../../../core/models/game-realtime.model';
import {
  createGameDebugSnapshotMetricsChannel,
  GameDebugDeadLetterEvent,
  GameDebugQueueDeadLetterReason,
  GameDebugQueueMetrics,
  isGameDebugSnapshotMetricsMessage,
} from '../../game-debug/game-debug-snapshot-metrics.channel';
import { applyGameSnapshotPatch } from '../state/realtime/game-snapshot-patch-reducer';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';

export interface GameTableWebsocketGameplayContext {
  gameId(): string;
  snapshot(): GameSnapshot | null;
  setSnapshot(snapshot: GameSnapshot): void;
  refetch(force?: boolean): Promise<void>;
  setError(message: string | null): void;
}

interface PendingWebsocketCommand {
  messageId: string;
  clientActionId: string;
  type: GameWebsocketCommandType;
  payload: Record<string, unknown>;
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
}

interface QueueRates {
  enqueueTimestamps: number[];
  drainTimestamps: number[];
}

export type GameWebsocketCommandType = GameCommandType | 'disconnect.vote';

const WEBSOCKET_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'chat.message',
  'dice.rolled',
  'turn.changed',
  'card.position.changed',
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
const RETRYABLE_COMMANDS = new Set<GameWebsocketCommandType>([
  'life.changed',
  'commander.damage.changed',
  'counter.changed',
  'card.position.changed',
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
  'disconnect.vote',
]);
const MAX_RETRY_COUNT = 1;
const MAX_QUEUE_DEPTH = 200;
const MAX_DEAD_LETTER = 100;
const QUEUE_RATE_WINDOW_MS = 60_000;

@Injectable()
export class GameTableWebsocketGameplayService implements OnDestroy {
  private readonly transport = inject(GameTableWebsocketTransportService);
  private readonly commandQueue: PendingWebsocketCommand[] = [];
  private inFlightCommand: PendingWebsocketCommand | null = null;
  private subscription?: Subscription;
  private context: GameTableWebsocketGameplayContext | null = null;
  private resyncPromise: Promise<void> | null = null;
  private queuedResyncPromise: Promise<void> | null = null;
  private snapshotMetricsChannel: BroadcastChannel | null = null;
  private observedDebugGameId: string | null = null;
  private observedDebugUntil = 0;
  private readonly queueCounters: QueueCounters = {
    enqueueTotal: 0,
    drainTotal: 0,
    dropTotal: 0,
    retryTotal: 0,
    resyncTotal: 0,
  };
  private readonly queueRates: QueueRates = {
    enqueueTimestamps: [],
    drainTimestamps: [],
  };
  private readonly deadLetter: GameDebugDeadLetterEvent[] = [];

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
      lastSeenVersion: () => context.snapshot()?.version ?? null,
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
    this.closeSnapshotMetricsChannel();
    this.connected.set(false);
    this.rejectInFlightCommand(
      new Error('WebSocket connection closed before the command completed.'),
      undefined,
      undefined,
      'disconnect',
    );
    this.rejectQueuedCommands(new Error('WebSocket connection closed before the command completed.'), 'disconnect');
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

    const pending = this.createPendingCommand(context, type, commandPayload);
    this.enqueueCommand(pending);
    this.drainQueue();
    await pending.wait;
    return true;
  }

  private async handleMessage(message: GameplayServerMessage): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }

    switch (message.kind) {
      case 'connection_state':
        this.connected.set(message.status === 'connected');
        if (message.status === 'connected') {
          this.drainQueue();
        }
        return;

      case 'game_patch':
        await this.handlePatch(context, message);
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
    }
  }

  private async handlePatch(context: GameTableWebsocketGameplayContext, patch: GameplayGamePatchMessage): Promise<void> {
    const snapshot = context.snapshot();
    if (!snapshot) {
      await this.requestResync(context);
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    const previousSnapshotSize = this.snapshotSize(snapshot);
    const result = applyGameSnapshotPatch(snapshot, patch);
    if (result.status === 'applied') {
      context.setSnapshot(result.snapshot);
      this.publishSnapshotMetric(context.gameId(), patch, previousSnapshotSize, this.snapshotSize(result.snapshot));
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    if (result.status === 'ignored') {
      this.resolveInFlightCommand(patch.clientActionId);
      this.drainQueue();
      return;
    }

    await this.requestResync(context);
    this.resolveInFlightCommand(patch.clientActionId);
    this.drainQueue();
  }

  private async handleCommandAck(context: GameTableWebsocketGameplayContext, ack: GameplayCommandAckMessage): Promise<void> {
    if (ack.status === 'rejected') {
      this.rejectInFlightCommand(new Error(ack.error?.message ?? 'WebSocket command rejected.'));
      this.drainQueue();
      return;
    }

    if (ack.status === 'duplicate') {
      await this.requestResync(context);
      this.resolveInFlightCommand();
      this.drainQueue();
      return;
    }

    await this.handleCommandResyncRequired(context);
  }

  private async handleResyncRequired(context: GameTableWebsocketGameplayContext, message: GameplayResyncRequiredMessage): Promise<void> {
    this.resolveInFlightCommand(message.clientActionId);
    await this.requestResync(context);
    this.drainQueue();
  }

  private handleError(message: GameplayErrorMessage): void {
    const clientActionId = message.clientActionId;
    const error = new Error(message.error.message || 'WebSocket gameplay error.');
    this.rejectInFlightCommand(error, clientActionId, message.messageId);
    this.context?.setError(message.error.message || 'WebSocket gameplay error.');
    this.drainQueue();
  }

  private requestResync(context: GameTableWebsocketGameplayContext): Promise<void> {
    if (this.resyncPromise) {
      return this.resyncPromise;
    }
    if (this.queuedResyncPromise) {
      return this.queuedResyncPromise;
    }

    this.queuedResyncPromise = Promise.resolve().then(() => {
      this.queuedResyncPromise = null;
      this.queueCounters.resyncTotal += 1;
      this.publishQueueMetrics(context.gameId());
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

  private enqueueCommand(command: PendingWebsocketCommand): void {
    if (command.coalesceKey !== null) {
      for (let index = this.commandQueue.length - 1; index >= 0; index -= 1) {
        const queued = this.commandQueue[index];
        if (queued.coalesceKey !== command.coalesceKey) {
          continue;
        }

        queued.payload = command.payload;
        queued.context = command.context;
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
        return;
      }
    }

    this.commandQueue.push(command);
    this.queueCounters.enqueueTotal += 1;
    this.recordRate(this.queueRates.enqueueTimestamps);
    this.enforceQueueDepthCap(command.context.gameId());
    this.publishQueueMetrics(command.context.gameId());
  }

  private drainQueue(): void {
    if (this.inFlightCommand || this.commandQueue.length === 0 || this.isResyncing() || this.transport.status() !== 'connected') {
      return;
    }

    const queued = this.commandQueue.shift();
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
    const message = {
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
      this.rejectInFlightCommand(new Error('WebSocket command timed out.'), clientActionId, messageId, 'timeout');
      this.drainQueue();
    }, 10000);
    this.inFlightCommand = queued;
    this.queueCounters.drainTotal += 1;
    this.recordRate(this.queueRates.drainTimestamps);
    this.publishQueueMetrics(gameId);

    if (!this.transport.send(message)) {
      this.rejectInFlightCommand(new Error('WebSocket gameplay connection is not available.'), clientActionId, messageId, 'disconnect');
      this.drainQueue();
    }
  }

  private resolveInFlightCommand(clientActionId?: string, messageId?: string): void {
    const inFlight = this.inFlightCommand;
    if (!inFlight || !this.matchesInFlight(inFlight, clientActionId, messageId)) {
      return;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    inFlight.resolve();
    this.publishQueueMetrics(inFlight.context.gameId());
  }

  private rejectInFlightCommand(
    error: Error,
    clientActionId?: string,
    messageId?: string,
    reason: GameDebugQueueDeadLetterReason = 'rejected',
  ): void {
    const inFlight = this.inFlightCommand;
    if (!inFlight || !this.matchesInFlight(inFlight, clientActionId, messageId)) {
      return;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    this.recordDeadLetter(inFlight, reason, error.message);
    inFlight.reject(error);
    this.publishQueueMetrics(inFlight.context.gameId());
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
  ): Promise<void> {
    const inFlight = this.inFlightCommand;
    if (!inFlight) {
      await this.requestResync(context);
      this.drainQueue();
      return;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    await this.requestResync(context);

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
      return typeof payload['targetPlayerId'] === 'string' && typeof payload['sourcePlayerId'] === 'string'
        ? `${type}:${payload['targetPlayerId']}:${payload['sourcePlayerId']}`
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

  private enforceQueueDepthCap(gameId: string): void {
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

    this.publishQueueMetrics(gameId);
  }

  private findOldestDroppableQueueIndex(): number {
    for (let index = 0; index < this.commandQueue.length; index += 1) {
      if (this.commandQueue[index].coalesceKey !== null) {
        return index;
      }
    }

    return -1;
  }

  private recordDeadLetter(command: PendingWebsocketCommand, reason: GameDebugQueueDeadLetterReason, details: string): void {
    const event: GameDebugDeadLetterEvent = {
      kind: 'dead_letter_event',
      gameId: command.context.gameId(),
      commandType: command.type,
      reason,
      retryCount: command.retryCount,
      createdAt: new Date().toISOString(),
      details: details.trim() !== '' ? details : null,
    };

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
      enqueueRate: Number((this.queueRates.enqueueTimestamps.length / (QUEUE_RATE_WINDOW_MS / 1000)).toFixed(2)),
      drainRate: Number((this.queueRates.drainTimestamps.length / (QUEUE_RATE_WINDOW_MS / 1000)).toFixed(2)),
      measuredAt: new Date(now).toISOString(),
    };

    channel.postMessage(message);
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
    this.queueRates.enqueueTimestamps = [];
    this.queueRates.drainTimestamps = [];
    this.deadLetter.length = 0;
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
    patch: GameplayGamePatchMessage,
    previousSize: { lines: number; characters: number } | null,
    nextSize: { lines: number; characters: number } | null,
  ): void {
    const channel = this.snapshotMetricsChannel;
    if (!channel || !patch.clientActionId || this.observedDebugGameId !== gameId || Date.now() > this.observedDebugUntil) {
      return;
    }

    channel.postMessage({
      kind: 'snapshot_metric',
      gameId,
      clientActionId: patch.clientActionId,
      version: patch.version,
      previousLines: previousSize?.lines ?? 0,
      nextLines: nextSize?.lines ?? 0,
      lineDelta: (nextSize?.lines ?? 0) - (previousSize?.lines ?? 0),
      previousCharacters: previousSize?.characters ?? 0,
      nextCharacters: nextSize?.characters ?? 0,
      characterDelta: (nextSize?.characters ?? 0) - (previousSize?.characters ?? 0),
      operationCount: patch.operations.length,
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
}
