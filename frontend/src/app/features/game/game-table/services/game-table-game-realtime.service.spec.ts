import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameControlPlaneState, MercureGameEvent } from '../../../../core/models/game.model';
import { MercureGameStreamMessage, MercureService } from '../../../../core/realtime/mercure.service';
import { GameTableGameRealtimeService } from './game-table-game-realtime.service';

describe('GameTableGameRealtimeService', () => {
  let service: GameTableGameRealtimeService;
  let events: Subject<MercureGameStreamMessage>;
  const mercure = {
    gameEventStream: vi.fn(),
  };

  beforeEach(() => {
    events = new Subject<MercureGameStreamMessage>();
    mercure.gameEventStream.mockReset();
    mercure.gameEventStream.mockReturnValue(events.asObservable());

    TestBed.configureTestingModule({
      providers: [
        GameTableGameRealtimeService,
        { provide: MercureService, useValue: mercure },
      ],
    });

    service = TestBed.inject(GameTableGameRealtimeService);
  });

  afterEach(() => {
    service.stop();
  });

  it('invalidates the snapshot for normal game events from the game Mercure stream', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    const lifeChanged = event('life.changed', { playerId: 'player-1' }, 2);
    events.next(message(lifeChanged));

    expect(mercure.gameEventStream).toHaveBeenCalledWith('game-1');
    expect(handlers.onSnapshotInvalidated).toHaveBeenCalledOnce();
    expect(handlers.onSnapshotInvalidated).toHaveBeenCalledWith(lifeChanged);
    expect(handlers.onRematchCreated).not.toHaveBeenCalled();
  });

  it('routes valid rematch-created events without invalidating the snapshot', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    events.next(message(event('room.rematch.created', { roomId: 'room-1' }, 4)));

    expect(handlers.onRematchCreated).toHaveBeenCalledOnce();
    expect(handlers.onRematchCreated).toHaveBeenCalledWith('room-1');
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('routes a terminal room deletion without invalidating or recovering gameplay', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    events.next(message(event('room.deleted', { roomId: 'room-1' }, 4)));

    expect(handlers.onRoomDeleted).toHaveBeenCalledOnce();
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
    expect(handlers.onControlPlaneState).not.toHaveBeenCalled();
  });

  it('ignores unversioned legacy rematch events instead of refetching gameplay', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    events.next(message(event('room.rematch.vote', { rematch: { votes: {} } }, 4)));

    expect(handlers.onControlPlaneState).not.toHaveBeenCalled();
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('applies a compact control-plane projection without invalidating gameplay', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    events.next(message(controlPlaneEvent('room.rematch.vote', 8, 3)));

    expect(handlers.onControlPlaneState).toHaveBeenCalledWith(expect.objectContaining({
      controlPlaneRevision: 3,
      status: 'finished',
      winnerPlayerId: 'player-1',
    }), expect.any(Object));
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('drops a stale out-of-order control-plane event by its own revision', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    events.next(message(controlPlaneEvent('room.rematch.vote', 8, 9)));
    events.next(message(controlPlaneEvent('room.rematch.vote', 99, 8)));

    expect(handlers.onControlPlaneState).toHaveBeenCalledTimes(1);
    expect(handlers.onControlPlaneState).toHaveBeenLastCalledWith(expect.objectContaining({ controlPlaneRevision: 9 }), expect.any(Object));
  });

  it('shares its cursor with an HTTP ACK so an equal Mercure event cannot reapply it', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);

    expect(service.acceptControlPlaneState(controlPlane(5))).toBe(true);
    events.next(message(controlPlaneEvent('room.rematch.vote', 8, 5)));

    expect(handlers.onControlPlaneState).not.toHaveBeenCalled();
  });

  it('requests exactly one compact recovery only after an error-to-open reconnect', () => {
    const handlers = baseHandlers();
    service.subscribe('game-1', handlers);
    service.seedControlPlaneRevision(7);

    events.next({ kind: 'connected', reconnected: false });
    events.next({ kind: 'connected', reconnected: true });

    expect(handlers.onControlPlaneReconnect).toHaveBeenCalledTimes(1);
    expect(handlers.onControlPlaneReconnect).toHaveBeenCalledWith(7);
  });
});

function baseHandlers() {
  return {
    onSnapshotInvalidated: vi.fn(),
    onControlPlaneState: vi.fn(),
    onControlPlaneReconnect: vi.fn(),
    onRematchCreated: vi.fn(),
    onRoomDeleted: vi.fn(),
  };
}

function message(event: MercureGameEvent): MercureGameStreamMessage {
  return { kind: 'event', event };
}

function event(type: string, payload: Record<string, unknown>, version: number): MercureGameEvent {
  return {
    gameId: 'game-1',
    version,
    event: {
      id: `${type}-event-${version}`,
      type,
      payload,
      createdBy: 'player-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function controlPlaneEvent(type: string, version: number, revision: number): MercureGameEvent {
  return {
    ...event(type, {}, version),
    controlPlane: controlPlane(revision),
  };
}

function controlPlane(controlPlaneRevision: number): GameControlPlaneState {
  return {
    controlPlaneRevision,
    status: 'finished',
    winnerPlayerId: 'player-1',
    finishedAt: '2026-01-01T00:00:05.000Z',
    finishReason: 'last_player_standing',
    allDisconnectedSince: null,
    nextLifecycleAt: '2026-01-01T00:01:05.000Z',
    ownerId: 'player-1',
    rematch: { votes: {}, deadlineAt: '2026-01-01T00:01:05.000Z' },
  };
}
