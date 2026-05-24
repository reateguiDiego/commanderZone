import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { GameDebugHealthResponse } from '../../../core/models/api-responses.model';

export type GameDebugWebsocketStatus = 'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error';

type GameDebugHealthPatch = Omit<GameDebugHealthResponse, 'context'>;

type GameDebugServerMessage =
  | ({ kind: 'debug_health' } & GameDebugHealthPatch)
  | {
      kind: 'debug_connection_state';
      gameId: string;
      connectionId: string;
      status: 'connected';
      serverTime: string;
    }
  | {
      kind: 'debug_error';
      gameId: string;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    }
  | {
      kind: 'debug_pong';
      gameId: string;
      serverTime: string;
    };

@Injectable()
export class GameDebugWebsocketService implements OnDestroy {
  private readonly gamesApi = inject(GamesApi);
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private closeRequested = false;
  private connectedGameId: string | null = null;
  private onHealth: ((report: GameDebugHealthPatch) => void) | null = null;
  private onError: ((message: string) => void) | null = null;

  readonly status = signal<GameDebugWebsocketStatus>('stopped');

  ngOnDestroy(): void {
    this.disconnect();
  }

  async connect(gameId: string, onHealth: (report: GameDebugHealthPatch) => void, onError: (message: string) => void): Promise<void> {
    this.disconnect();
    this.connectedGameId = gameId;
    this.onHealth = onHealth;
    this.onError = onError;
    this.closeRequested = false;

    await this.openSocket(gameId);
  }

  disconnect(): void {
    this.closeRequested = true;
    this.connectedGameId = null;
    this.onHealth = null;
    this.onError = null;
    this.clearReconnectTimer();
    this.stopPing();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }

    this.status.set('stopped');
  }

  private async openSocket(gameId: string): Promise<void> {
    this.status.set('connecting');

    let websocketUrl: string;
    try {
      websocketUrl = this.debugWebsocketUrl((await firstValueFrom(this.gamesApi.websocketTicket(gameId))).websocketUrl, gameId);
    } catch (error) {
      this.status.set('error');
      this.emitError('No se pudo crear el ticket WebSocket de debug.');
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
      this.emitError('No se pudo abrir el WebSocket de debug.');
      throw error;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) {
        this.status.set('connected');
        this.startPing();
      }
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.handleMessage(event.data);
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.status.set('error');
        this.emitError('Error en el WebSocket de debug.');
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.stopPing();
      if (this.closeRequested) {
        this.status.set('stopped');
        return;
      }

      this.status.set('disconnected');
      this.scheduleReconnect(gameId);
    };
  }

  private scheduleReconnect(gameId: string): void {
    if (this.closeRequested || this.connectedGameId !== gameId || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closeRequested && this.connectedGameId === gameId) {
        void this.openSocket(gameId).catch(() => this.scheduleReconnect(gameId));
      }
    }, 2000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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

    socket.send(JSON.stringify({ kind: 'debug_ping' }));
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      this.emitError('El WebSocket de debug ha recibido un mensaje no textual.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.emitError('El WebSocket de debug ha recibido JSON invalido.');
      return;
    }

    if (!this.isDebugServerMessage(parsed)) {
      this.emitError('El WebSocket de debug ha recibido un mensaje no soportado.');
      return;
    }

    if (parsed.kind === 'debug_health') {
      this.onHealth?.({
        gameId: parsed.gameId,
        enabled: parsed.enabled,
        health: parsed.health,
        generatedAt: parsed.generatedAt,
        updatedAt: parsed.updatedAt,
      });
    } else if (parsed.kind === 'debug_error') {
      this.emitError(parsed.error.message);
    }
  }

  private debugWebsocketUrl(websocketUrl: string, gameId: string): string {
    const url = new URL(websocketUrl);
    const basePath = url.pathname.replace(/\/games\/[^/]+\/?$/, '');
    const nextPath = `${basePath}/games/${encodeURIComponent(gameId)}/debug`;
    url.pathname = nextPath.replace(/\/{2,}/g, '/');
    url.searchParams.delete('lastSeenVersion');

    return url.toString();
  }

  private emitError(message: string): void {
    this.onError?.(message);
  }

  private isDebugServerMessage(value: unknown): value is GameDebugServerMessage {
    if (typeof value !== 'object' || value === null || !('kind' in value)) {
      return false;
    }

    return [
      'debug_health',
      'debug_connection_state',
      'debug_error',
      'debug_pong',
    ].includes(String((value as { kind: unknown }).kind));
  }
}
