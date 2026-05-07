import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { createInitialTableAssistantRoom } from '../domain/table-assistant-state';
import { TableAssistantSetupComponent } from './table-assistant-setup.component';

describe('TableAssistantSetupComponent', () => {
  const createApi = vi.fn();
  const navigate = vi.fn();

  beforeEach(async () => {
    createApi.mockReset();
    navigate.mockReset();

    await TestBed.configureTestingModule({
      imports: [TableAssistantSetupComponent],
      providers: [
        {
          provide: TableAssistantApi,
          useValue: { create: createApi },
        },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();
  });

  it('applies single-device defaults and hides removed setup options', () => {
    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.initialLife()).toBe(40);
    expect(fixture.componentInstance.playerNames()).toEqual(['', '', '', '']);
    expect(fixture.componentInstance.canCreateRoom()).toBe(false);
    const createButton = fixture.nativeElement.querySelector(
      '.primary-button',
    ) as HTMLButtonElement | null;
    expect(createButton?.disabled).toBe(true);
    expect(fixture.componentInstance.availableTimerModes()).toEqual(['none', 'turn']);
    expect(fixture.nativeElement.textContent).not.toContain('Por fase');
    expect(fixture.nativeElement.textContent).not.toContain('Un movil por jugador');
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

  it('closes the open color picker when clicking outside it', () => {
    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();

    fixture.componentInstance.toggleColorPicker(0);
    fixture.detectChanges();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.openColorPickerIndex()).toBeNull();
    expect(fixture.nativeElement.querySelector('.color-picker-list')).toBeNull();
  });

  it('creates a single-device room with configured players', async () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    createApi.mockReturnValue(
      of({
        tableAssistantRoom: {
          id: 'room-1',
          tableAssistantId: 'assistant-1',
          room: {
            id: 'room-1',
            name: 'Mesa de Owner',
            owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner' },
            status: 'waiting',
            visibility: 'private',
            format: 'commander',
            maxPlayers: 4,
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

    const fixture = TestBed.createComponent(TableAssistantSetupComponent);
    fixture.detectChanges();

    fixture.componentInstance.updatePlayerName(0, 'Owner');
    fixture.componentInstance.updatePlayerName(1, 'Guest');
    fixture.componentInstance.updatePlayerName(2, 'Third');
    fixture.componentInstance.updatePlayerName(3, 'Fourth');
    expect(fixture.componentInstance.canCreateRoom()).toBe(true);
    await fixture.componentInstance.createRoom();

    expect(createApi).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'single-device',
        playerCount: 4,
        initialLife: 40,
        players: [
          { name: 'Owner', color: 'white' },
          { name: 'Guest', color: 'blue' },
          { name: 'Third', color: 'black' },
          { name: 'Fourth', color: 'red' },
        ],
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/table-assistant', 'room-1'], {
      queryParams: { arrange: '1' },
    });
  });
});
