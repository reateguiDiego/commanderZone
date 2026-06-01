import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MercureGameEvent } from '../../../../core/models/game.model';
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
      onRematchCreated: vi.fn(),
    };

    service.subscribe('game-1', handlers);
    events.next(event('room.rematch.created', { roomId: '' }, 4));
    events.next(event('room.rematch.created', { roomId: null }, 5));

    expect(handlers.onRematchCreated).not.toHaveBeenCalled();
    expect(handlers.onSnapshotInvalidated).not.toHaveBeenCalled();
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
