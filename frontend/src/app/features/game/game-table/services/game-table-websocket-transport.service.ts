import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import {
  GameplayClientMessage,
  GameplayCommandAckMessage,
  GameplayErrorMessage,
  GameplayServerMessage,
} from '../../../../core/models/game-realtime.model';

export type GameTableWebsocketStatus = 'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error';

type JsonRecord = Record<string, unknown>;

export interface GameTableWebsocketConnectOptions {
  lastSeenVersion?: number | (() => number | null | undefined);
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
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
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
      websocketUrl = this.withLastSeenVersion((await firstValueFrom(this.gamesApi.websocketTicket(gameId))).websocketUrl);
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
      }
    };
    socket.onopen = handleOpen;
    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.handleIncomingData(event.data);
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.status.set('error');
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
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

  private withLastSeenVersion(websocketUrl: string): string {
    const lastSeenVersion = this.lastSeenVersion();
    if (lastSeenVersion === null) {
      return websocketUrl;
    }

    const url = new URL(websocketUrl);
    url.searchParams.set('lastSeenVersion', String(lastSeenVersion));

    return url.toString();
  }

  private lastSeenVersion(): number | null {
    const configured = this.connectOptions.lastSeenVersion;
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

    if (!this.isKnownServerMessage(parsed)) {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket message kind is not supported.', messageId);
      return;
    }

    const message = parsed as unknown as GameplayServerMessage;
    if (message.kind === 'command_ack' && !this.isValidCommandAck(message)) {
      this.emitLocalError('INVALID_MESSAGE', 'WebSocket command_ack status is not supported.', messageId);
      return;
    }

    this.messagesSubject.next(message);
  }

  private isKnownServerMessage(message: JsonRecord): boolean {
    return typeof message['kind'] === 'string'
      && [
        'command_ack',
        'game_patch',
        'resync_required',
        'error',
        'pong',
        'connection_state',
        'connection_joined',
        'connection_left',
      ].includes(message['kind']);
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

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
