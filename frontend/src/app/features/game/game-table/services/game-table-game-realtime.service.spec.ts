import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameControlPlaneState, MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';
import { GameTableGameRealtimeService } from './game-table-game-realtime.service';

describe('GameTableGameRealtimeService', () => {
  let service: GameTableGameRealtimeService;
  let events: Subject<MercureGameEvent>;
  const mercure = {
    gameEvents: vi.fn(),
  };

  beforeEach(() => {
    events = new Subject<MercureGameEvent>();
    mercure.gameEvents.mockReset();
    mercure.gameEvents.mockReturnValue(events.asObservable());

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
    const handlers = {
      onSnapshotInvalidated: vi.fn(),
      onRematchState: vi.fn(),
      onRematchCreated: vi.fn(),
    };

    service.subscribe('game-1', handlers);
    const lifeChanged = event('life.changed', { playerId: 'player-1' }, 2);
    events.next(lifeChanged);

    expect(mercure.gameEvents).toHaveBeenCalledWith('game-1');
    expect(handlers.onSnapshotInvalidated).toHaveBeenCalledOnce();
    expect(handlers.onSnapshotInvalidated).toHaveBeenCalledWith(lifeChanged);
    expect(handlers.onRematchCreated).not.toHaveBeenCalled();
  });

  it('routes valid rematch events without invalidating the snapshot', () => {
    const handlers = {
      onSnapshotInvalidated: vi.fn(),
      onRematchState: vi.fn(),
      onRematchCreated: vi.fn(),
    };

    service.subscribe('game-1', handlers);
    events.next(event('room.rematch.created', { roomId: 'room-1' }, 4));

    expect(handlers.onRematchCreated).toHaveBeenCalledOnce();
    expect(handlers.onRematchCreated).toHaveBeenCalledWith('room-1');
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('ignores invalid rematch payloads', () => {
    const handlers = {
      onSnapshotInvalidated: vi.fn(),
      onRematchState: vi.fn(),
      onRematchCreated: vi.fn(),
    };

    service.subscribe('game-1', handlers);
    events.next(event('room.rematch.created', { roomId: '' }, 4));
    events.next(event('room.rematch.created', { roomId: null }, 5));

    expect(handlers.onRematchCreated).not.toHaveBeenCalled();
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('applies compact rematch control-plane state without invalidating gameplay', () => {
    const handlers = { onSnapshotInvalidated: vi.fn(), onRematchState: vi.fn(), onRematchCreated: vi.fn() };
    service.subscribe('game-1', handlers);
    events.next(event('room.rematch.vote', { rematch: { votes: {}, deadlineAt: '2026-01-01T00:01:00+00:00' } }, 4));

    expect(handlers.onRematchState).toHaveBeenCalledOnce();
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('applies the newest Symfony control-plane projection without invalidating gameplay', () => {
    const handlers = {
      onSnapshotInvalidated: vi.fn(),
      onControlPlaneState: vi.fn(),
      onRematchState: vi.fn(),
      onRematchCreated: vi.fn(),
    };
    service.subscribe('game-1', handlers);
    events.next(controlPlaneEvent('game.finished', 8, '2026-01-01T00:00:10.000Z'));

    expect(handlers.onControlPlaneState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'finished',
      winnerPlayerId: 'player-1',
    }), expect.any(Object));
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it('drops a stale out-of-order control-plane event', () => {
    const handlers = {
      onSnapshotInvalidated: vi.fn(),
      onControlPlaneState: vi.fn(),
      onRematchState: vi.fn(),
      onRematchCreated: vi.fn(),
    };
    service.subscribe('game-1', handlers);
    events.next(controlPlaneEvent('room.rematch.vote', 8, '2026-01-01T00:00:20.000Z'));
    events.next(controlPlaneEvent('room.rematch.vote', 8, '2026-01-01T00:00:10.000Z'));

    expect(handlers.onControlPlaneState).toHaveBeenCalledTimes(1);
  });
});

function event(type: string, payload: Record<string, unknown>, version: number): MercureGameEvent {
  return {
    gameId: 'game-1',
    version,
    event: {
      id: `${type}-event`,
      type,
      payload,
      createdBy: 'player-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function controlPlaneEvent(type: string, version: number, createdAt: string): MercureGameEvent {
  return {
    ...event(type, {}, version),
    event: {
      ...event(type, {}, version).event,
      id: `${type}-${createdAt}`,
      createdAt,
    },
    controlPlane: controlPlane(),
  };
}

function controlPlane(): GameControlPlaneState {
  return {
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
