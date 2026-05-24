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
    this.rejectInFlightCommand(new Error('WebSocket connection closed before the command completed.'));
    this.rejectQueuedCommands(new Error('WebSocket connection closed before the command completed.'));
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
      this.rejectInFlightCommand(new Error('WebSocket command timed out.'), clientActionId, messageId);
      this.drainQueue();
    }, 10000);
    this.inFlightCommand = queued;

    if (!this.transport.send(message)) {
      this.rejectInFlightCommand(new Error('WebSocket gameplay connection is not available.'), clientActionId, messageId);
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
  }

  private rejectInFlightCommand(error: Error, clientActionId?: string, messageId?: string): void {
    const inFlight = this.inFlightCommand;
    if (!inFlight || !this.matchesInFlight(inFlight, clientActionId, messageId)) {
      return;
    }

    window.clearTimeout(inFlight.timeoutId);
    this.inFlightCommand = null;
    inFlight.reject(error);
  }

  private rejectQueuedCommands(error: Error): void {
    while (this.commandQueue.length > 0) {
      const queued = this.commandQueue.shift();
      queued?.reject(error);
    }
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
      inFlight.reject(new Error('WebSocket command requires resync and cannot be retried automatically.'));
      this.drainQueue();
      return;
    }

    inFlight.retryCount += 1;
    inFlight.messageId = '';
    inFlight.clientActionId = '';
    inFlight.timeoutId = 0;
    this.commandQueue.unshift(inFlight);
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
}
