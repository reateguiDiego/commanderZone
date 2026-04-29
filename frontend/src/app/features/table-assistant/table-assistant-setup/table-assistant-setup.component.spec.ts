import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { createInitialTableAssistantRoom } from '../domain/table-assistant-state';
import { TableAssistantSetupComponent } from './table-assistant-setup.component';

describe('TableAssistantSetupComponent', () => {
  const createApi = vi.fn();
  const invite = vi.fn();
  const navigate = vi.fn();

  beforeEach(async () => {
    createApi.mockReset();
    invite.mockReset();
    navigate.mockReset();

    await TestBed.configureTestingModule({
      imports: [TableAssistantSetupComponent],
      providers: [
        {
          provide: TableAssistantApi,
          useValue: { create: createApi },
        },
        {
          provide: RoomsApi,
          useValue: { invite },
        },
        {
          provide: FriendsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({
              data: [{
                id: 'friendship-1',
                status: 'accepted',
                requester: { id: 'user-1', displayName: 'Owner' },
                recipient: { id: 'user-2', displayName: 'Guest' },
                friend: { id: 'user-2', displayName: 'Guest', presence: 'online' },
                createdAt: '',
                updatedAt: '',
              }],
            })),
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();
  });

  it('applies defaults and hides phase timer while phases are disabled', () => {
    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.mode()).toBe('single-device');
    expect(fixture.componentInstance.initialLife()).toBe(40);
    expect(fixture.componentInstance.availableTimerModes()).toEqual(['none', 'turn']);
    expect(fixture.nativeElement.textContent).not.toContain('Por fase');
    expect(fixture.nativeElement.textContent).not.toContain('Compartir e invitar');
  });

  it('creates a per-player room and invites selected friends without blocking setup', async () => {
    const state = createInitialTableAssistantRoom({ mode: 'per-player-device' });
    createApi.mockReturnValue(of({
      tableAssistantRoom: {
        id: 'room-1',
        tableAssistantId: 'assistant-1',
        room: { id: 'room-1', owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner' }, status: 'waiting', visibility: 'private', players: [], gameId: null },
        state,
        version: 1,
        createdAt: '',
        updatedAt: '',
      },
    }));
    invite.mockReturnValue(of({ invite: {} }));

    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.selectMode('per-player-device');
    fixture.componentInstance.toggleFriend('user-2');
    await fixture.componentInstance.createRoom();

    expect(createApi).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'per-player-device',
      playerCount: 4,
      initialLife: 40,
      players: [
        { name: 'Jugador 1', color: 'white' },
        { name: 'Jugador 2', color: 'blue' },
        { name: 'Jugador 3', color: 'black' },
        { name: 'Jugador 4', color: 'red' },
      ],
    }));
    expect(invite).toHaveBeenCalledWith('room-1', 'user-2');
    expect(navigate).toHaveBeenCalledWith(['/table-assistant', 'room-1']);
  });
});
