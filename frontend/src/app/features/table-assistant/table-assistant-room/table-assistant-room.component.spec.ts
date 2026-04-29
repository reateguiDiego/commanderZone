import { signal } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { MercureService } from '../../../core/realtime/mercure.service';
import { TableAssistantApi, TableAssistantRoomResource } from '../data-access/table-assistant.api';
import { createInitialTableAssistantRoom } from '../domain/table-assistant-state';
import { TableAssistantRoomComponent } from './table-assistant-room.component';

describe('TableAssistantRoomComponent', () => {
  const get = vi.fn();
  const action = vi.fn();

  beforeEach(async () => {
    get.mockReset();
    action.mockReset();

    await TestBed.configureTestingModule({
      imports: [TableAssistantRoomComponent],
      providers: [
        { provide: TableAssistantApi, useValue: { get, action } },
        { provide: MercureService, useValue: { tableAssistantEvents: vi.fn().mockReturnValue(EMPTY) } },
        {
          provide: AuthStore,
          useValue: { user: signal({ id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] }) },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'room-1' }) } },
        },
      ],
    }).compileComponents();
  });

  it('renders player panels without sharing metadata in single-device mode', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Codigo LOCAL');
    expect(fixture.nativeElement.textContent).not.toContain('Asistente de Mesa');
    expect(fixture.nativeElement.textContent).toContain('Jugador 1');
    expect(fixture.nativeElement.textContent).toContain('Pasar turno');
    expect(fixture.nativeElement.querySelectorAll('.active-turn-button')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.player-panel.active .active-turn-button')).not.toBeNull();
  });

  it('shows sharing metadata only before the first room action in per-player mode', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({ mode: 'per-player-device' }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Codigo de sala');
    expect(fixture.nativeElement.textContent).toContain('LOCAL');
    expect(fixture.nativeElement.querySelector('.connected-count')?.textContent.trim()).toBe('1');

    const usedRoom = roomResource({ mode: 'per-player-device', hasActions: true });
    get.mockReturnValue(of({ tableAssistantRoom: usedRoom }));

    const usedFixture = TestBed.createComponent(TableAssistantRoomComponent);
    usedFixture.detectChanges();
    await usedFixture.whenStable();
    usedFixture.detectChanges();

    expect(usedFixture.nativeElement.textContent).not.toContain('Codigo LOCAL');
    expect(usedFixture.nativeElement.querySelector('.connected-count')).toBeNull();
  });

  it('sends life and turn actions', async () => {
    const initial = roomResource();
    const changed = roomResource();
    changed.state.players[0] = { ...changed.state.players[0], life: 39 };
    changed.version = 2;
    changed.state.version = 2;

    get.mockReturnValue(of({ tableAssistantRoom: initial }));
    action.mockReturnValue(of({ tableAssistantRoom: changed, applied: true }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.changeLife(initial.state.players[0], -1);
    await fixture.componentInstance.passTurn();

    expect(action).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'life.changed',
      payload: { playerId: 'player-1', delta: -1 },
    }));
    expect(action).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'turn.passed',
      payload: {},
    }));
  });

  it('renders phase, timer, commander damage and active trackers', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({
      phasesEnabled: true,
      timerMode: 'turn',
      timerDurationSeconds: 300,
      activeTrackerIds: ['commander-damage', 'poison', 'storm'],
    }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Untap');
    expect(fixture.nativeElement.textContent).not.toContain('Timer de turno');
    expect(fixture.nativeElement.querySelector('[aria-label="Iniciar temporizador"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timer-strip')).toBeNull();
    expect(fixture.nativeElement.querySelector('.player-panel.active .player-timer-card')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Storm');
    expect(fixture.nativeElement.textContent).toContain('Poison');
    expect(fixture.nativeElement.textContent).toContain('Daño de comandante');
  });

  it('shows eliminated state from zero life and disables player options', async () => {
    const resource = roomResource({ activeTrackerIds: ['commander-damage', 'poison'] });
    resource.state.players[0] = { ...resource.state.players[0], life: 0, eliminated: true };
    get.mockReturnValue(of({ tableAssistantRoom: resource }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.elimination-overlay')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.friendly-skull')?.getAttribute('src')).toBe('/assets/skull.png');
    expect(fixture.nativeElement.textContent).not.toContain('Vida manual');
    expect(fixture.nativeElement.textContent).not.toContain('Eliminar');
    expect(fixture.nativeElement.querySelector('[aria-label="Aumentar Poison de Jugador 1"]')?.disabled).toBe(true);
  });

  it('uses player color gradients and caps long player names in the room board', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({
      players: [{ name: 'Jugador con nombre larguisimo', color: 'grixis' }],
    }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const activePanel = fixture.nativeElement.querySelector('.player-panel.active') as HTMLElement;
    const activeName = activePanel.querySelector('h2')?.textContent?.trim();

    expect(activeName).toBe('Jugador con nom');
    expect(activePanel.style.getPropertyValue('--player-gradient')).toContain('#020617');
  });
});

function roomResource(options: {
  mode?: 'single-device' | 'per-player-device';
  phasesEnabled?: boolean;
  timerMode?: 'none' | 'turn' | 'phase';
  timerDurationSeconds?: number;
  activeTrackerIds?: Array<'commander-damage' | 'poison' | 'storm'>;
  hasActions?: boolean;
  players?: Array<{ name: string; color: string }>;
} = {}): TableAssistantRoomResource {
  const state = createInitialTableAssistantRoom({
    mode: options.mode ?? 'single-device',
    roomId: 'room-1',
    roomCode: 'LOCAL',
    hostUser: { id: 'user-1', email: 'owner@test', displayName: 'Owner' },
    phasesEnabled: options.phasesEnabled,
    timerMode: options.timerMode,
    timerDurationSeconds: options.timerDurationSeconds,
    activeTrackerIds: options.activeTrackerIds,
    players: options.players,
  });
  if (options.hasActions) {
    state.actionLog = [{
      id: 'action-1',
      type: 'life.changed',
      actorParticipantId: state.hostParticipantId,
      createdAt: '',
    }];
  }

  return {
    id: 'room-1',
    tableAssistantId: 'assistant-1',
    room: {
      id: 'room-1',
      owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
      status: 'waiting',
      visibility: 'private',
      players: [{ id: 'room-player-1', user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] }, deckId: null }],
      gameId: null,
    },
    state,
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
}
