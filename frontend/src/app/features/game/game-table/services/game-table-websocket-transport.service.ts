import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import {
  GameplayClientMessage,
  GameplayCommandAckMessage,
  GameplayErrorMessage,
  GameplayPingMessage,
  GameplayServerMessage,
} from '../../../../core/models/game-realtime.model';

export type GameTableWebsocketStatus = 'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type GameTableWebsocketRoute = 'runtime_ws' | 'php_gateway_ws' | 'legacy_ws';

type JsonRecord = Record<string, unknown>;

export interface GameTableWebsocketConnectOptions {
  lastAppliedVersion?: number | (() => number | null | undefined);
}

@Injectable()
export class GameTableWebsocketTransportService implements OnDestroy {
  private readonly gamesApi = inject(GamesApi);
  private readonly messagesSubject = new Subject<GameplayServerMessage>();
  private socket: WebSocket | null = null;
  private connectedGameId: string | null = null;
  private closeRequested = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private connectOptions: GameTableWebsocketConnectOptions = {};
  private pingTimer: number | null = null;
  private activeRoute: GameTableWebsocketRoute | null = null;

  readonly status = signal<GameTableWebsocketStatus>('stopped');
  readonly messages$ = this.messagesSubject.asObservable();

  ngOnDestroy(): void {
    this.disconnect();
    this.messagesSubject.complete();
  }

  async connect(gameId: string, options: GameTableWebsocketConnectOptions = {}): Promise<void> {
    this.disconnect();
    this.connectOptions = options;
    this.reconnectAttempts = 0;
    this.connectedGameId = gameId;
    this.closeRequested = false;

    await this.openSocket(gameId);
  }

  disconnect(): void {
    this.closeRequested = true;
    this.connectedGameId = null;
    this.activeRoute = null;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.stopPing();
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
    this.status.set('stopped');
  }

  send(message: GameplayClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  private async openSocket(gameId: string): Promise<void> {
    this.status.set('connecting');

    let websocketUrl: string;
    try {
      const ticket = await firstValueFrom(this.gamesApi.websocketTicket(gameId));
      this.activeRoute = this.requireRuntimeRoute(ticket.route);
      websocketUrl = this.withLastAppliedVersion(ticket.websocketUrl);
      this.logTransportDebug('info', {
        source: this.reconnectAttempts > 0 ? 'reconnect' : 'connect',
        gameId,
        route: this.activeRoute,
        'gameplay.ws.route': this.activeRoute,
        websocketUrl: this.sanitizedUrl(websocketUrl),
      });
    } catch (error) {
      if (this.connectedGameId === gameId) {
        this.status.set('error');
      }
      throw error;
    }

    if (this.connectedGameId !== gameId) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl);
    } catch (error) {
      this.status.set('error');
      throw error;
    }

    this.socket = socket;
    const handleOpen = () => {
      if (this.socket === socket) {
        this.reconnectAttempts = 0;
        this.status.set('connected');
        this.startPing();
      }
    };
    socket.onopen = handleOpen;
    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.handleIncomingData(event.data);
      }
    };
    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }

      this.status.set('error');
      if (socket.readyState === WebSocket.OPEN || this.closeRequested) {
        return;
      }

      this.socket = null;
      this.stopPing();
      this.status.set('disconnected');
      this.scheduleReconnect(gameId);
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.stopPing();
      if (this.closeRequested) {
        this.connectedGameId = null;
        this.status.set('stopped');
      } else {
        this.status.set('disconnected');
        this.scheduleReconnect(gameId);
      }
    };

    if (socket.readyState === WebSocket.OPEN) {
      handleOpen();
    }
  }

  private scheduleReconnect(gameId: string): void {
    if (this.closeRequested || this.connectedGameId !== gameId || this.reconnectTimer !== null) {
      return;
    }

    if (this.reconnectAttempts >= 5) {
      this.status.set('error');
      return;
    }

    const delayMs = Math.min(250 * 2 ** this.reconnectAttempts, 2000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closeRequested || this.connectedGameId !== gameId) {
        return;
      }

      void this.openSocket(gameId).catch(() => {
        if (!this.closeRequested && this.connectedGameId === gameId) {
          this.status.set('disconnected');
          this.scheduleReconnect(gameId);
        }
      });
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private withLastAppliedVersion(websocketUrl: string): string {
    const lastAppliedVersion = this.lastAppliedVersion();
    if (lastAppliedVersion === null) {
      return websocketUrl;
    }

    const url = new URL(websocketUrl);
    url.searchParams.set('lastAppliedVersion', String(lastAppliedVersion));

    return url.toString();
  }

  private lastAppliedVersion(): number | null {
    const configured = this.connectOptions.lastAppliedVersion;
    const value = typeof configured === 'function' ? configured() : configured;

    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
  }

  private handleIncomingData(data: unknown): void {
    if (typeof data !== 'string') {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket message data must be text.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.status.set('error');
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket message must be valid JSON.');
      return;
    }

    if (!this.isRecord(parsed)) {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket message must be an object.');
      return;
    }

    const messageId = this.optionalString(parsed['messageId']);
    const messageGameId = this.optionalString(parsed['gameId']);
    if (messageGameId && messageGameId !== this.connectedGameId) {
      this.emitLocalError('GAME_ID_MISMATCH', 'WebSocket message gameId does not match the connected game.', messageId);
      return;
    }

    const normalized = this.normalizeServerMessage(parsed);
    if (!normalized) {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket message kind is not supported.', messageId);
      return;
    }
    const normalizedGameId = this.optionalString(normalized['gameId']);
    if (normalizedGameId && normalizedGameId !== this.connectedGameId) {
      this.emitLocalError('GAME_ID_MISMATCH', 'WebSocket message gameId does not match the connected game.', messageId);
      return;
    }

    const message = normalized as unknown as GameplayServerMessage;
    if (message.kind === 'command_ack' && !this.isValidCommandAck(message)) {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket command_ack status is not supported.', messageId);
      return;
    }

    this.logTransportDebug('debug', {
      source: 'message.received',
      gameId: normalizedGameId ?? messageGameId ?? this.connectedGameId,
      route: this.activeRoute,
      'gameplay.ws.route': this.activeRoute ?? 'runtime_ws',
      kind: message.kind,
      type: this.messageType(message),
      patchV2: message.kind === 'patch.v2',
      gamePatch: message.kind === 'game_patch',
      resyncRequired: message.kind === 'resync_required',
    });
    this.messagesSubject.next(message);
  }

  private normalizeServerMessage(message: JsonRecord): JsonRecord | null {
    if (typeof message['kind'] === 'string') {
      return [
        'command_ack',
        'game_patch',
        'patch.v2',
        'resync_required',
        'error',
        'pong',
        'connection_state',
        'connection_joined',
        'connection_left',
        'player_presence_changed',
        'mulligan.public_state',
        'mulligan.private_state',
        'mulligan.error',
        'mulligan.completed',
      ].includes(message['kind'])
        ? message
        : null;
    }

    return this.adaptLegacyTypeServerMessage(message);
  }

  private adaptLegacyTypeServerMessage(message: JsonRecord): JsonRecord | null {
    const type = this.optionalString(message['type']);
    if (!type) {
      return null;
    }

    const patch = message['patch'];
    if (type === 'patch' && this.isRecord(patch)) {
      return {
        ...patch,
        kind: 'patch.v2',
      };
    }

    if (type === 'resync.required') {
      return {
        kind: 'resync_required',
        gameId: this.optionalString(message['gameId']) ?? this.connectedGameId ?? '',
        currentVersion: typeof message['currentVersion'] === 'number' ? message['currentVersion'] : 0,
        reason: 'version_gap',
      };
    }

    if (type === 'error') {
      return {
        kind: 'error',
        gameId: this.optionalString(message['gameId']) ?? this.connectedGameId ?? undefined,
        clientActionId: this.optionalString(message['ackClientActionId']),
        error: {
          code: this.optionalString(message['code']) ?? 'RUNTIME_ERROR',
          message: this.optionalString(message['error']) ?? 'Runtime websocket error.',
          retryable: false,
        },
      };
    }

    return null;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.sendPing(), 15000);
  }

  private stopPing(): void {
    if (this.pingTimer === null) {
      return;
    }

    window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendPing(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const ping: GameplayPingMessage = {
      kind: 'ping',
      gameId: this.connectedGameId ?? undefined,
      messageId: this.randomId('ping'),
      sentAt: new Date().toISOString(),
    };
    socket.send(JSON.stringify(ping));
  }

  private isValidCommandAck(message: GameplayCommandAckMessage): boolean {
    return message.status === 'rejected' || message.status === 'duplicate' || message.status === 'resync_required';
  }

  private emitLocalError(code: string, message: string, messageId?: string): void {
    const errorMessage: GameplayErrorMessage = {
      kind: 'error',
      gameId: this.connectedGameId ?? undefined,
      messageId,
      error: {
        code,
        message,
        retryable: false,
      },
    };
    this.messagesSubject.next(errorMessage);
  }

  private requireRuntimeRoute(route: unknown): GameTableWebsocketRoute {
    if (route === 'runtime_ws') {
      return route;
    }

    if (route === 'php_gateway_ws' || route === 'legacy_ws') {
      throw new Error(`Gameplay websocket route ${route} is disabled for runtime gameplay.`);
    }

    throw new Error('Gameplay websocket route is missing or unsupported.');
  }

  private sanitizedUrl(websocketUrl: string): string {
    try {
      const url = new URL(websocketUrl);
      url.searchParams.delete('ticket');

      return url.toString();
    } catch {
      return '<invalid-websocket-url>';
    }
  }

  private messageType(message: GameplayServerMessage): string | null {
    if (message.kind === 'command_ack') {
      return message.status;
    }
    if (message.kind === 'resync_required') {
      return message.reason;
    }
    if (message.kind === 'error') {
      return message.error.code;
    }
    if (message.kind === 'game_patch') {
      return message.event?.type ?? 'game_patch';
    }
    if (message.kind === 'patch.v2') {
      return message.ops.map((operation) => operation.op).join(',') || 'patch.v2';
    }

    return message.kind;
  }

  private logTransportDebug(level: 'debug' | 'info' | 'warn', payload: Record<string, unknown>): void {
    const logger = level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug;
    logger.call(console, '[CommanderZone gameplay transport]', {
      ...payload,
      measuredAt: new Date().toISOString(),
    });
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private randomId(prefix: string): string {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
