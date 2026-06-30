import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameplayClientMessage, GameplayErrorMessage, GameplayServerMessage } from '../../../../core/models/game-realtime.model';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  });
  readonly send = vi.fn((message: string) => {
    this.sent.push(message);
  });

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  emitText(message: string): void {
    this.onmessage?.({ data: message } as MessageEvent<string>);
  }

  fail(): void {
    this.onerror?.({} as Event);
  }

  remoteClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

describe('GameTableWebsocketTransportService', () => {
  let sockets: MockWebSocket[];
  let service: GameTableWebsocketTransportService;
  const gamesApi = {
    snapshot: vi.fn(),
    websocketTicket: vi.fn(),
  };

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sockets = [];
    gamesApi.snapshot.mockReset();
    gamesApi.websocketTicket.mockReset();
    gamesApi.websocketTicket.mockReturnValue(of({
      ticket: 'ticket-1',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
      route: 'runtime_ws',
    }));
    const WebSocketMock = vi.fn(function webSocketMock(url: string) {
      const socket = new MockWebSocket(url);
      sockets.push(socket);

      return socket;
    });
    Object.assign(WebSocketMock, {
      CONNECTING: MockWebSocket.CONNECTING,
      OPEN: MockWebSocket.OPEN,
      CLOSING: MockWebSocket.CLOSING,
      CLOSED: MockWebSocket.CLOSED,
    });
    vi.stubGlobal('WebSocket', WebSocketMock as unknown as typeof WebSocket);

    TestBed.configureTestingModule({
      providers: [
        GameTableWebsocketTransportService,
        { provide: GamesApi, useValue: gamesApi },
      ],
    });
    service = TestBed.inject(GameTableWebsocketTransportService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests a ticket and opens the returned websocket URL without loading a snapshot', async () => {
    await service.connect('game-1');

    expect(gamesApi.websocketTicket).toHaveBeenCalledWith('game-1');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://127.0.0.1:8091/ws?ticket=ticket-1');
    expect(gamesApi.snapshot).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith('[CommanderZone gameplay transport]', expect.objectContaining({
      source: 'connect',
      reason: 'initial_connect',
      result: 'ticket_received',
      gameId: 'game-1',
      route: 'runtime_ws',
      'gameplay.ws.route': 'runtime_ws',
      lastAppliedVersion: null,
      websocketUrl: 'ws://127.0.0.1:8091/ws',
    }));
  });

  it('rejects disabled legacy websocket routes instead of falling back silently', async () => {
    gamesApi.websocketTicket.mockReturnValueOnce(of({
      ticket: 'ticket-legacy',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8081/games/game-1?ticket=ticket-legacy',
      route: 'legacy_ws',
    }));

    await expect(service.connect('game-1')).rejects.toThrow('legacy_ws');

    expect(sockets).toHaveLength(0);
    expect(service.status()).toBe('error');
  });

  it('logs incoming websocket message format without exposing the ticket', async () => {
    await service.connect('game-1');
    sockets[0].emitMessage({
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });

    expect(console.debug).toHaveBeenCalledWith('[CommanderZone gameplay transport]', expect.objectContaining({
      source: 'message.received',
      gameId: 'game-1',
      route: 'runtime_ws',
      'gameplay.ws.route': 'runtime_ws',
      kind: 'patch.v2',
      type: 'player.life.set',
      patchV2: true,
      gamePatch: false,
      resyncRequired: false,
    }));
    expect(JSON.stringify((console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain('ticket-1');
  });

  it('adapts legacy runtime type patch messages into explicit kind patch.v2 messages', async () => {
    const messages = receivedMessages(service);

    await service.connect('game-1');
    sockets[0].emitMessage({
      type: 'patch',
      patch: {
        gameId: 'game-1',
        version: 2,
        visibility: 'player:player-1',
        ops: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('patch.v2');
  });

  it('adds lastAppliedVersion and reconnects remote closes with the latest version', async () => {
    vi.useFakeTimers();
    try {
      let lastAppliedVersion = 4;
      gamesApi.websocketTicket
        .mockReturnValueOnce(of({
          ticket: 'ticket-1',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
          route: 'runtime_ws',
        }))
        .mockReturnValueOnce(of({
          ticket: 'ticket-2',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-2',
          route: 'runtime_ws',
        }));

      await service.connect('game-1', { lastAppliedVersion: () => lastAppliedVersion });
      expect(sockets[0].url).toBe('ws://127.0.0.1:8091/ws?ticket=ticket-1&lastAppliedVersion=4');
      sockets[0].open();

      lastAppliedVersion = 8;
      sockets[0].remoteClose();
      expect(service.status()).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(250);

      expect(sockets).toHaveLength(2);
      expect(sockets[1].url).toBe('ws://127.0.0.1:8091/ws?ticket=ticket-2&lastAppliedVersion=8');
      expect(service.status()).toBe('connecting');
      expect(console.info).toHaveBeenCalledWith('[CommanderZone gameplay transport]', expect.objectContaining({
        source: 'reconnect',
        reason: 'socket_reconnect',
        result: 'ticket_received',
        lastAppliedVersion: 8,
        websocketUrl: 'ws://127.0.0.1:8091/ws?lastAppliedVersion=8',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects after a non-intentional socket error closes the connection', async () => {
    vi.useFakeTimers();
    try {
      gamesApi.websocketTicket
        .mockReturnValueOnce(of({
          ticket: 'ticket-1',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
          route: 'runtime_ws',
        }))
        .mockReturnValueOnce(of({
          ticket: 'ticket-2',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-2',
          route: 'runtime_ws',
        }));

      await service.connect('game-1');
      sockets[0].open();

      sockets[0].fail();
      expect(service.status()).toBe('error');
      sockets[0].remoteClose();
      expect(service.status()).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(250);

      expect(sockets).toHaveLength(2);
      expect(sockets[1].url).toBe('ws://127.0.0.1:8091/ws?ticket=ticket-2');
      expect(service.status()).toBe('connecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates status while connecting, connected, disconnected and stopped', async () => {
    const connectPromise = service.connect('game-1');
    expect(service.status()).toBe('connecting');

    await connectPromise;
    sockets[0].open();
    expect(service.status()).toBe('connected');

    sockets[0].remoteClose();
    expect(service.status()).toBe('disconnected');

    await service.connect('game-1');
    sockets[1].open();
    service.disconnect();
    expect(service.status()).toBe('stopped');
    expect(sockets[1].close).toHaveBeenCalled();
  });

  it('marks the transport as error when the ticket request or socket fails', async () => {
    gamesApi.websocketTicket.mockReturnValueOnce(throwError(() => new Error('ticket failed')));

    await expect(service.connect('game-1')).rejects.toThrow('ticket failed');
    expect(service.status()).toBe('error');

      gamesApi.websocketTicket.mockReturnValueOnce(of({
        ticket: 'ticket-2',
        expiresAt: '2026-01-01T00:00:30+00:00',
        websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-2',
        route: 'runtime_ws',
      }));
    await service.connect('game-1');
    sockets[0].fail();
    expect(service.status()).toBe('disconnected');
  });

  it('reconnects when the socket errors before it ever opens, even if close is not emitted', async () => {
    vi.useFakeTimers();
    try {
      gamesApi.websocketTicket
        .mockReturnValueOnce(of({
          ticket: 'ticket-1',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
          route: 'runtime_ws',
        }))
        .mockReturnValueOnce(of({
          ticket: 'ticket-2',
          expiresAt: '2026-01-01T00:00:30+00:00',
          websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-2',
          route: 'runtime_ws',
        }));

      await service.connect('game-1');
      sockets[0].fail();
      expect(service.status()).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(250);

      expect(sockets).toHaveLength(2);
      expect(sockets[1].url).toBe('ws://127.0.0.1:8091/ws?ticket=ticket-2');
      expect(service.status()).toBe('connecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('processes connection_state, pong and error messages', async () => {
    const messages = receivedMessages(service);

    await service.connect('game-1');
    sockets[0].emitMessage({
      kind: 'connection_state',
      gameId: 'game-1',
      connectionId: 'connection-1',
      status: 'connected',
      serverTime: '2026-01-01T00:00:00+00:00',
    });
    sockets[0].emitMessage({
      kind: 'pong',
      gameId: 'game-1',
      messageId: 'ping-1',
      serverTime: '2026-01-01T00:00:01+00:00',
    });
    sockets[0].emitMessage({
      kind: 'error',
      gameId: 'game-1',
      messageId: 'message-1',
      error: { code: 'COMMANDS_NOT_ENABLED', message: 'Disabled', retryable: false },
    });

    expect(messages.map((message) => message.kind)).toEqual(['connection_state', 'pong', 'error']);
  });

  it('rejects messages from another game without forwarding the original message', async () => {
    const messages = receivedMessages(service);

    await service.connect('game-1');
    sockets[0].emitMessage({
      kind: 'pong',
      gameId: 'game-2',
      messageId: 'ping-1',
      serverTime: '2026-01-01T00:00:01+00:00',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('error');
    expect(messages[0].gameId).toBe('game-1');
    expect((messages[0] as GameplayErrorMessage).messageId).toBe('ping-1');
    expect((messages[0] as GameplayErrorMessage).error.code).toBe('GAME_ID_MISMATCH');
  });

  it('does not forward command_ack accepted as a successful command response', async () => {
    const messages = receivedMessages(service);

    await service.connect('game-1');
    sockets[0].emitMessage({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: 'message-1',
      clientActionId: 'action-1',
      status: 'accepted',
      version: 8,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('error');
    expect((messages[0] as GameplayErrorMessage).error.code).toBe('INVALID_MESSAGE');
  });

  it('sends raw gameplay messages only when the socket is open', async () => {
    const ping = {
      kind: 'ping',
      gameId: 'game-1',
      messageId: 'ping-1',
      sentAt: '2026-01-01T00:00:00+00:00',
    } satisfies GameplayClientMessage;

    await service.connect('game-1');
    expect(service.send(ping)).toBe(false);

    sockets[0].open();
    expect(service.send(ping)).toBe(true);
    expect(sockets[0].sent).toEqual([JSON.stringify(ping)]);
  });

  it('turns invalid JSON into a local error and error status', async () => {
    const messages = receivedMessages(service);

    await service.connect('game-1');
    sockets[0].emitText('{not-json');

    expect(service.status()).toBe('error');
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('error');
    expect((messages[0] as GameplayErrorMessage).error.code).toBe('INVALID_MESSAGE');
  });
});

function receivedMessages(service: GameTableWebsocketTransportService): GameplayServerMessage[] {
  const messages: GameplayServerMessage[] = [];
  service.messages$.subscribe((message) => messages.push(message));

  return messages;
}
