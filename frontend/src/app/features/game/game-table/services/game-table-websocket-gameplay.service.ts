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

@Injectable()
export class GameTableWebsocketGameplayService implements OnDestroy {
  private readonly transport = inject(GameTableWebsocketTransportService);
  private readonly pendingCommands = new Map<string, PendingWebsocketCommand>();
  private readonly messageIdToClientActionId = new Map<string, string>();
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
    for (const clientActionId of [...this.pendingCommands.keys()]) {
      this.rejectPending(clientActionId, new Error('WebSocket connection closed before the command completed.'));
    }
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

    const clientActionId = this.randomId('action');
    const messageId = this.randomId('message');
    const pending = this.createPendingCommand(clientActionId, messageId);
    const message = {
      kind: 'command',
      gameId,
      messageId,
      command: {
        type,
        payload: commandPayload,
        clientActionId,
        baseVersion: snapshot.version,
      },
    } satisfies GameplayClientMessage;

    if (!this.transport.send(message)) {
      this.resolvePending(clientActionId);
      return false;
    }

    await pending;
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
      this.resolvePending(patch.clientActionId);
      return;
    }

    const previousSnapshotSize = this.snapshotSize(snapshot);
    const result = applyGameSnapshotPatch(snapshot, patch);
    if (result.status === 'applied') {
      context.setSnapshot(result.snapshot);
      this.publishSnapshotMetric(context.gameId(), patch, previousSnapshotSize, this.snapshotSize(result.snapshot));
      this.resolvePending(patch.clientActionId);
      return;
    }

    if (result.status === 'ignored') {
      this.resolvePending(patch.clientActionId);
      return;
    }

    await this.requestResync(context);
    this.resolvePending(patch.clientActionId);
  }

  private async handleCommandAck(context: GameTableWebsocketGameplayContext, ack: GameplayCommandAckMessage): Promise<void> {
    if (ack.status === 'rejected') {
      this.rejectPending(ack.clientActionId, new Error(ack.error?.message ?? 'WebSocket command rejected.'));
      return;
    }

    await this.requestResync(context);
    this.resolvePending(ack.clientActionId);
  }

  private async handleResyncRequired(context: GameTableWebsocketGameplayContext, message: GameplayResyncRequiredMessage): Promise<void> {
    this.closePendingForResync(message.clientActionId);
    await this.requestResync(context);
  }

  private handleError(message: GameplayErrorMessage): void {
    const clientActionId = message.clientActionId
      ?? (message.messageId ? this.messageIdToClientActionId.get(message.messageId) : undefined);
    const error = new Error(message.error.message || 'WebSocket gameplay error.');
    if (clientActionId) {
      this.rejectPending(clientActionId, error);
    }
    this.context?.setError(message.error.message || 'WebSocket gameplay error.');
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
      });

      return this.resyncPromise;
    });

    return this.queuedResyncPromise;
  }

  private createPendingCommand(clientActionId: string, messageId: string): Promise<void> {
    const pending = new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.rejectPending(clientActionId, new Error('WebSocket command timed out.'));
      }, 10000);
      this.pendingCommands.set(clientActionId, {
        messageId,
        resolve,
        reject,
        timeoutId,
      });
      this.messageIdToClientActionId.set(messageId, clientActionId);
    });

    return pending;
  }

  private resolvePending(clientActionId: string | undefined): void {
    if (!clientActionId) {
      return;
    }

    const pending = this.pendingCommands.get(clientActionId);
    if (!pending) {
      return;
    }

    this.clearPending(clientActionId);
    pending.resolve();
  }

  private rejectPending(clientActionId: string, error: Error): void {
    const pending = this.pendingCommands.get(clientActionId);
    if (!pending) {
      return;
    }

    this.clearPending(clientActionId);
    pending.reject(error);
  }

  private clearPending(clientActionId: string): void {
    const pending = this.pendingCommands.get(clientActionId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    this.pendingCommands.delete(clientActionId);
    this.messageIdToClientActionId.delete(pending.messageId);
  }

  private closePendingForResync(clientActionId?: string): void {
    if (clientActionId) {
      this.resolvePending(clientActionId);
      return;
    }

    for (const pendingClientActionId of [...this.pendingCommands.keys()]) {
      this.resolvePending(pendingClientActionId);
    }
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
