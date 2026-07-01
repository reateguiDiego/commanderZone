import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { GameDebugWebsocketService } from './game-debug-websocket.service';
import { buildGameDebugWebsocketUrl } from './game-debug-websocket-url';

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

  constructor(readonly url: string) {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

describe('GameDebugWebsocketService', () => {
  let sockets: MockWebSocket[];
  let service: GameDebugWebsocketService;
  const gamesApi = {
    websocketTicket: vi.fn(),
  };

  beforeEach(() => {
    sockets = [];
    gamesApi.websocketTicket.mockReset();
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
        GameDebugWebsocketService,
        { provide: GamesApi, useValue: gamesApi },
      ],
    });
    service = TestBed.inject(GameDebugWebsocketService);
  });

  afterEach(() => {
    service.disconnect();
    vi.unstubAllGlobals();
  });

  it('keeps websocket base path prefix when building the debug endpoint URL', () => {
    const url = buildGameDebugWebsocketUrl('wss://api.commanderzone.com/ws-game', 'game-1', 'ticket-1');

    expect(url).toEqual({
      fullUrl: 'wss://api.commanderzone.com/ws-game/games/game-1/debug?ticket=ticket-1',
      displayUrl: 'wss://api.commanderzone.com/ws-game/games/game-1/debug',
    });
  });

  it('returns null when the debug websocket base URL is not configured', () => {
    expect(buildGameDebugWebsocketUrl('', 'game-1', 'ticket-1')).toBeNull();
  });

  it('opens the explicit PHP debug endpoint without deriving it from the gameplay runtime websocket URL', async () => {
    gamesApi.websocketTicket.mockReturnValue(of({
      ticket: 'ticket-1',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
      route: 'runtime_ws',
    }));

    await service.connect('game-1', vi.fn(), vi.fn());

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://127.0.0.1:8081/games/game-1/debug?ticket=ticket-1');
    expect(service.displayUrl()).toBe('ws://127.0.0.1:8081/games/game-1/debug');
  });

  it('sets connected state when the debug socket opens', async () => {
    gamesApi.websocketTicket.mockReturnValue(of({
      ticket: 'ticket-1',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
      route: 'runtime_ws',
    }));

    await service.connect('game-1', vi.fn(), vi.fn());
    sockets[0].readyState = MockWebSocket.OPEN;
    sockets[0].onopen?.({} as Event);

    expect(service.status()).toBe('connected');
  });
});
