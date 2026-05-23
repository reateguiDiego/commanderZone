import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MercureGameEvent } from '../../../../core/models/game.model';
import { MercureService } from '../../../../core/realtime/mercure.service';
import { GameTableRematchRealtimeService } from './game-table-rematch-realtime.service';

describe('GameTableRematchRealtimeService', () => {
  let service: GameTableRematchRealtimeService;
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
        GameTableRematchRealtimeService,
        { provide: MercureService, useValue: mercure },
      ],
    });

    service = TestBed.inject(GameTableRematchRealtimeService);
  });

  afterEach(() => {
    service.stop();
  });

  it('emits only room.rematch.created room ids from the game Mercure stream', () => {
    const onRematchCreated = vi.fn();

    service.subscribeToRematchCreated('game-1', onRematchCreated);
    events.next(event('life.changed', { playerId: 'player-1' }));
    events.next(event('room.rematch.created', { roomId: 'room-1' }));

    expect(mercure.gameEvents).toHaveBeenCalledWith('game-1');
    expect(onRematchCreated).toHaveBeenCalledOnce();
    expect(onRematchCreated).toHaveBeenCalledWith('room-1');
  });

  it('ignores invalid rematch payloads', () => {
    const onRematchCreated = vi.fn();

    service.subscribeToRematchCreated('game-1', onRematchCreated);
    events.next(event('room.rematch.created', { roomId: '' }));
    events.next(event('room.rematch.created', { roomId: null }));

    expect(onRematchCreated).not.toHaveBeenCalled();
  });
});

function event(type: string, payload: Record<string, unknown>): MercureGameEvent {
  return {
    gameId: 'game-1',
    version: 1,
    event: {
      id: `${type}-event`,
      type,
      payload,
      createdBy: 'player-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}
