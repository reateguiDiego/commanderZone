import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { MercureService } from '../../../core/realtime/mercure.service';
import { TableAssistantApi, TableAssistantRealtimeEvent } from './table-assistant.api';
import { TableAssistantSyncService } from './table-assistant-sync.service';
import { createInitialTableAssistantRoom } from '../domain/table-assistant-state';

describe('TableAssistantSyncService', () => {
  it('refreshes room state when realtime events arrive', async () => {
    const events = new Subject<TableAssistantRealtimeEvent>();
    const room = {
      id: 'room-1',
      tableAssistantId: 'assistant-1',
      room: { id: 'room-1', owner: { id: 'u1', email: 'u@test', displayName: 'User', roles: [] }, status: 'waiting' as const, visibility: 'private' as const, players: [], gameId: null },
      state: createInitialTableAssistantRoom({ mode: 'single-device', roomId: 'room-1' }),
      version: 2,
      createdAt: '',
      updatedAt: '',
    };
    const applyRoom = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        TableAssistantSyncService,
        { provide: MercureService, useValue: { tableAssistantEvents: vi.fn().mockReturnValue(events) } },
        { provide: TableAssistantApi, useValue: { get: vi.fn().mockReturnValue(of({ tableAssistantRoom: room })) } },
      ],
    });

    const service = TestBed.inject(TableAssistantSyncService);
    service.connect('room-1', applyRoom);
    events.next({ roomId: 'room-1', type: 'action.applied', state: room.state, version: 2, payload: {} });
    await Promise.resolve();

    expect(service.status()).toBe('connected');
    expect(applyRoom).toHaveBeenCalledWith(room);
  });

  it('marks sync offline when reconnect refresh fails', async () => {
    const events = new Subject<TableAssistantRealtimeEvent>();
    TestBed.configureTestingModule({
      providers: [
        TableAssistantSyncService,
        { provide: MercureService, useValue: { tableAssistantEvents: vi.fn().mockReturnValue(events) } },
        { provide: TableAssistantApi, useValue: { get: vi.fn().mockReturnValue(throwError(() => new Error('offline'))) } },
      ],
    });

    const service = TestBed.inject(TableAssistantSyncService);
    service.connect('room-1', vi.fn());
    events.error(new Error('lost'));
    await Promise.resolve();

    expect(service.status()).toBe('offline');
  });
});
