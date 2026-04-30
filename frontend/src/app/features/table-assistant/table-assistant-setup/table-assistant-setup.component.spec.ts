import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
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
            list: vi.fn().mockReturnValue(
              of({
                data: [
                  {
                    id: 'friendship-1',
                    status: 'accepted',
                    requester: { id: 'user-1', displayName: 'Owner' },
                    recipient: { id: 'user-2', displayName: 'Guest' },
                    friend: { id: 'user-2', displayName: 'Guest', presence: 'online' },
                    createdAt: '',
                    updatedAt: '',
                  },
                ],
              }),
            ),
          },
        },
        {
          provide: AuthStore,
          useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) },
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
    expect(fixture.nativeElement.textContent).not.toContain('Trackers');
    expect(fixture.nativeElement.textContent).not.toContain('Opciones avanzadas');
  });

  it('uses custom color and timer wheel controls instead of native selects for those settings', () => {
    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();

    fixture.componentInstance.toggleColorPicker(0);
    fixture.componentInstance.setTimerMode('turn');
    fixture.componentInstance.setTimerDurationMinutes(2);
    fixture.componentInstance.setTimerDurationRemainderSeconds(30);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.color-picker-list')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timer-wheel')).not.toBeNull();
    expect(fixture.componentInstance.timerDurationSeconds()).toBe(150);
    expect(fixture.nativeElement.textContent).toContain('2:30');

    const colorOptions = fixture.nativeElement.querySelectorAll(
      '.color-option',
    ) as NodeListOf<HTMLButtonElement>;
    colorOptions[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.playerColors()[0]).toBe('blue');
    expect(fixture.componentInstance.openColorPickerIndex()).toBeNull();
  });

  it('creates a per-player room and invites selected friends without blocking setup', async () => {
    const state = createInitialTableAssistantRoom({ mode: 'per-player-device' });
    createApi.mockReturnValue(
      of({
        tableAssistantRoom: {
          id: 'room-1',
          tableAssistantId: 'assistant-1',
          room: {
            id: 'room-1',
            owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner' },
            status: 'waiting',
            visibility: 'private',
            players: [],
            gameId: null,
          },
          state,
          version: 1,
          createdAt: '',
          updatedAt: '',
        },
      }),
    );
    invite.mockReturnValue(of({ invite: {} }));

    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.selectMode('per-player-device');
    fixture.componentInstance.updatePlayerFriend(1, 'user-2');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('input[aria-label="Nombre de jugador 1"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.player-name-preview')).toHaveLength(4);
    expect(fixture.nativeElement.textContent).toContain('Usuario CommanderZone');
    await fixture.componentInstance.createRoom();

    expect(createApi).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'per-player-device',
        playerCount: 4,
        initialLife: 40,
        players: [
          { name: 'Owner', color: 'white' },
          { name: 'Guest', color: 'blue' },
          { name: 'Jugador 3', color: 'black' },
          { name: 'Jugador 4', color: 'red' },
        ],
      }),
    );
    expect(invite).toHaveBeenCalledWith('room-1', 'user-2');
    expect(navigate).toHaveBeenCalledWith(['/table-assistant', 'room-1'], {
      queryParams: { arrange: '1' },
    });
  });
});
