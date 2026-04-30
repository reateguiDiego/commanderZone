import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';
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
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown })),
        { provide: TableAssistantApi, useValue: { get, action } },
        {
          provide: MercureService,
          useValue: { tableAssistantEvents: vi.fn().mockReturnValue(EMPTY) },
        },
        {
          provide: AuthStore,
          useValue: {
            user: signal({ id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] }),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'room-1' }),
              queryParamMap: convertToParamMap({}),
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('renders player panels without sharing metadata in single-device mode', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).not.toContain('Codigo LOCAL');
    expect(fixture.nativeElement.textContent).not.toContain('Asistente de Mesa');
    expect(fixture.nativeElement.textContent).toContain('Jugador 1');
    expect(fixture.nativeElement.textContent).toContain('Siguiente');
    expect(fixture.nativeElement.querySelectorAll('.active-turn-button')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector(
        '.player-panel.active .player-header app-table-assistant-turn-controls .active-turn-button',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.player-panel.active .turn-card.timer-enabled'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.table-logo-button')).not.toBeNull();
  });

  it('opens the centered logo exit menu without leaving the room immediately', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    fixture.nativeElement.querySelector('.table-logo-button')?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.table-exit-menu')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nueva partida');
    expect(fixture.nativeElement.textContent).toContain('Tirar dado');
    expect(fixture.nativeElement.textContent).toContain('Pantalla completa');
    expect(fixture.nativeElement.textContent).toContain('Salir al dashboard');
  });

  it('closes the centered menu when clicking outside', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    fixture.nativeElement.querySelector('.table-logo-button')?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.table-exit-menu')).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.table-exit-menu')).toBeNull();
  });

  it('opens replay setup from the centered menu without closing the room', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    fixture.nativeElement.querySelector('.table-logo-button')?.click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.table-exit-menu .primary')?.click();
    fixture.detectChanges();

    expect(action).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-table-assistant-replay-modal')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mesa y orden de jugadores');
    expect(fixture.nativeElement.textContent).toContain('Despues va Jugador 2');
  });

  it('opens the table arrangement modal after creating a room', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: 'room-1' }),
          queryParamMap: convertToParamMap({ arrange: '1' }),
        },
      },
    });
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('app-table-assistant-replay-modal')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mesa y orden de jugadores');
    expect(fixture.nativeElement.textContent).toContain('Sin jugador');
    expect(fixture.nativeElement.querySelector('.primary-action')?.disabled).toBe(true);
  });

  it('hides the active player name when five or more players are seated', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({ playerCount: 5 }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('.player-panel.active h2')).toBeNull();
    expect(fixture.nativeElement.querySelector('.player-panel:not(.active) h2')).not.toBeNull();
  });

  it('opens the roll modal from the centered menu', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource() }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    fixture.nativeElement.querySelector('.table-logo-button')?.click();
    fixture.detectChanges();
    [...fixture.nativeElement.querySelectorAll('.table-exit-menu .menu-action')]
      .find((button: Element) => button.textContent?.trim() === 'Tirar dado')
      ?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-table-assistant-roll-modal')).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('[aria-label="Dado de 20 caras"] img')
        ?.getAttribute('src'),
    ).toBe('/assets/icons/dice_20.png');
  });

  it('resets the current table with the selected turn order', async () => {
    const initial = roomResource();
    const reset = roomResource();
    reset.state.players[0] = { ...reset.state.players[0], life: 40 };
    get.mockReturnValue(of({ tableAssistantRoom: initial }));
    action.mockReturnValue(of({ tableAssistantRoom: reset, applied: true }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    await fixture.componentInstance.startNewTable();

    expect(action).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        type: 'game.reset',
        payload: {
          seatOrder: ['player-1', 'player-2', 'player-3', 'player-4'],
          turnOrder: ['player-1', 'player-2', 'player-3', 'player-4'],
        },
      }),
    );
  });

  it('sends the selected first turn player when starting a new table', async () => {
    const initial = roomResource();
    const reset = roomResource();
    get.mockReturnValue(of({ tableAssistantRoom: initial }));
    action.mockReturnValue(of({ tableAssistantRoom: reset, applied: true }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    await fixture.componentInstance.startNewTable({
      seatOrder: ['player-2', 'player-1', 'player-3', 'player-4'],
      turnOrder: ['player-3', 'player-1', 'player-2', 'player-4'],
    });

    expect(action).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        type: 'game.reset',
        payload: {
          seatOrder: ['player-2', 'player-1', 'player-3', 'player-4'],
          turnOrder: ['player-3', 'player-1', 'player-2', 'player-4'],
        },
      }),
    );
    expect(fixture.componentInstance.seatedPlayers().map((player) => player.id)).toEqual([
      'player-2',
      'player-1',
      'player-3',
      'player-4',
    ]);
    expect(fixture.componentInstance.state()?.turn.activePlayerId).toBe('player-3');
  });

  it('passes turn using the selected turn order even if the server returns the previous order', async () => {
    const initial = roomResource();
    const staleServerResponse = roomResource();
    get.mockReturnValue(of({ tableAssistantRoom: initial }));
    action.mockReturnValue(of({ tableAssistantRoom: staleServerResponse, applied: true }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    await fixture.componentInstance.startNewTable({
      seatOrder: ['player-2', 'player-1', 'player-3', 'player-4'],
      turnOrder: ['player-3', 'player-1', 'player-2', 'player-4'],
    });
    await fixture.componentInstance.passTurn();
    fixture.detectChanges();

    expect(fixture.componentInstance.turnOrderedPlayers().map((player) => player.id)).toEqual([
      'player-3',
      'player-1',
      'player-2',
      'player-4',
    ]);
    expect(fixture.componentInstance.activePlayerId()).toBe('player-1');
    expect(fixture.nativeElement.querySelector('.player-panel.active h2')?.textContent.trim()).toBe(
      'Jugador 1',
    );
  });

  it('shows sharing metadata only before the first room action in per-player mode', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({ mode: 'per-player-device' }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Codigo de sala');
    expect(fixture.nativeElement.textContent).toContain('LOCAL');
    expect(fixture.nativeElement.querySelector('.connected-count')?.textContent.trim()).toBe('1');

    const usedRoom = roomResource({ mode: 'per-player-device', hasActions: true });
    get.mockReturnValue(of({ tableAssistantRoom: usedRoom }));

    const usedFixture = TestBed.createComponent(TableAssistantRoomComponent);
    usedFixture.detectChanges();
    await settle(usedFixture);

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
    await settle(fixture);

    await fixture.componentInstance.changeLife(initial.state.players[0], -1);
    await fixture.componentInstance.passTurn();

    expect(action).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        type: 'life.changed',
        payload: { playerId: 'player-1', delta: -1 },
      }),
    );
    expect(action).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        type: 'turn.passed',
        payload: {},
      }),
    );
  });

  it('renders phase, timer, commander damage and active trackers', async () => {
    get.mockReturnValue(
      of({
        tableAssistantRoom: roomResource({
          phasesEnabled: true,
          timerMode: 'turn',
          timerDurationSeconds: 300,
          activeTrackerIds: ['commander-damage', 'poison', 'storm'],
        }),
      }),
    );

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Untap');
    expect(fixture.nativeElement.textContent).not.toContain('Timer de turno');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Iniciar temporizador"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timer-strip')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.player-panel.active .turn-card.timer-enabled'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('.player-panel.active .turn-card .active-turn-button')
        ?.textContent.trim(),
    ).toBe('Siguiente');
    expect(fixture.nativeElement.textContent).toContain('Storm');
    expect(fixture.nativeElement.textContent).toContain('Poison');
    expect(fixture.nativeElement.textContent).toContain('Extras');
    expect(
      fixture.nativeElement.querySelector('.player-panel.active .commander-damage-trigger'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.commander-damage-trigger')).toHaveLength(3);
  });

  it('shows eliminated state from zero life and disables player options', async () => {
    const resource = roomResource({ activeTrackerIds: ['commander-damage', 'poison'] });
    resource.state.players[0] = { ...resource.state.players[0], life: 0, eliminated: true };
    get.mockReturnValue(of({ tableAssistantRoom: resource }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('.elimination-overlay')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.skull-image')?.getAttribute('src')).toBe(
      '/assets/images/skull.png',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Vida manual');
    expect(fixture.nativeElement.textContent).not.toContain('Eliminar');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Aumentar Poison de Jugador 1"]')?.disabled,
    ).toBe(true);
  });

  it('uses player color gradients and caps long player names in the room board', async () => {
    get.mockReturnValue(
      of({
        tableAssistantRoom: roomResource({
          players: [{ name: 'Jugador con nombre larguisimo', color: 'grixis' }],
        }),
      }),
    );

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    const activePanel = fixture.nativeElement.querySelector('.player-panel.active') as HTMLElement;
    const activeName = activePanel.querySelector('h2')?.textContent?.trim();

    expect(activeName).toBe('Jugador con nom');
    expect(activePanel.style.getPropertyValue('--player-gradient')).toContain('#08070a');
    expect(activePanel.querySelector('.player-mana-symbols')).not.toBeNull();
  });

  it('places odd-numbered seats in the top row and even-numbered seats in the bottom row', async () => {
    get.mockReturnValue(
      of({
        tableAssistantRoom: roomResource({
          players: [
            { name: 'Jugador 1', color: 'white' },
            { name: 'Jugador 2', color: 'blue' },
            { name: 'Jugador 3', color: 'green' },
            { name: 'Jugador 4', color: 'red' },
            { name: 'Jugador 5', color: 'black' },
            { name: 'Jugador 6', color: 'grixis' },
          ],
          playerCount: 6,
        }),
      }),
    );

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    const topSeatPanels = [
      ...fixture.nativeElement.querySelectorAll('.player-panel.seat-row-top'),
    ] as HTMLElement[];
    const topSeatNames = topSeatPanels
      .map((seat) => seat.querySelector('h2')?.textContent?.trim())
      .filter(Boolean);
    const bottomSeatNames = [
      ...fixture.nativeElement.querySelectorAll('.player-panel.seat-row-bottom h2'),
    ].map((seat) => seat.textContent?.trim());
    const seatColumns = [
      ...fixture.nativeElement.querySelectorAll('.player-panel.single-device-seat'),
    ].map((seat) => (seat as HTMLElement).style.getPropertyValue('--seat-column'));

    expect(topSeatPanels).toHaveLength(3);
    expect(topSeatPanels[0].classList.contains('active')).toBe(true);
    expect(topSeatNames).toEqual(['Jugador 3', 'Jugador 5']);
    expect(bottomSeatNames).toEqual(['Jugador 2', 'Jugador 4', 'Jugador 6']);
    expect(seatColumns).toEqual(['1', '1', '2', '2', '3', '3']);
  });

  it('expands and rotates the last single-device seat when player count is odd', async () => {
    get.mockReturnValue(
      of({
        tableAssistantRoom: roomResource({
          players: [
            { name: 'Jugador 1', color: 'white' },
            { name: 'Jugador 2', color: 'blue' },
            { name: 'Jugador 3', color: 'green' },
            { name: 'Jugador 4', color: 'red' },
            { name: 'Jugador 5', color: 'black' },
          ],
          playerCount: 5,
        }),
      }),
    );

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    const oddLastSeat = fixture.nativeElement.querySelector(
      '.player-panel.seat-odd-last',
    ) as HTMLElement;
    const topSeatPanels = [
      ...fixture.nativeElement.querySelectorAll('.player-panel.seat-row-top'),
    ] as HTMLElement[];
    const topSeatNames = topSeatPanels
      .map((seat) => seat.querySelector('h2')?.textContent?.trim())
      .filter(Boolean);
    const bottomSeatNames = [
      ...fixture.nativeElement.querySelectorAll('.player-panel.seat-row-bottom h2'),
    ].map((seat) => seat.textContent?.trim());

    expect(oddLastSeat.querySelector('h2')?.textContent?.trim()).toBe('Jugador 5');
    expect(oddLastSeat.classList.contains('seat-row-top')).toBe(false);
    expect(oddLastSeat.classList.contains('seat-row-bottom')).toBe(false);
    expect(oddLastSeat.style.getPropertyValue('--seat-column')).toBe('3');
    expect(topSeatPanels).toHaveLength(2);
    expect(topSeatPanels[0].classList.contains('active')).toBe(true);
    expect(topSeatNames).toEqual(['Jugador 3']);
    expect(bottomSeatNames).toEqual(['Jugador 2', 'Jugador 4']);
  });

  it('keeps per-player-device panels readable without table-edge rotation', async () => {
    get.mockReturnValue(of({ tableAssistantRoom: roomResource({ mode: 'per-player-device' }) }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector('.single-device-seat, .seat-row-top, .seat-row-bottom'),
    ).toBeNull();
  });

  it('replaces the life controls with commander damage controls while opened', async () => {
    const resource = roomResource();
    get.mockReturnValue(of({ tableAssistantRoom: resource }));

    const fixture = TestBed.createComponent(TableAssistantRoomComponent);
    fixture.detectChanges();
    await settle(fixture);

    fixture.componentInstance.openCommanderDamage(resource.state.players[0]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.commander-damage-board')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.player-panel.active .life-row')).toBeNull();

    fixture.componentInstance.closeCommanderDamage();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-panel.active .life-row')).not.toBeNull();
  });
});

async function settle(
  fixture: ReturnType<typeof TestBed.createComponent<TableAssistantRoomComponent>>,
): Promise<void> {
  await Promise.resolve();
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges();
}

function roomResource(
  options: {
    mode?: 'single-device' | 'per-player-device';
    phasesEnabled?: boolean;
    timerMode?: 'none' | 'turn' | 'phase';
    timerDurationSeconds?: number;
    activeTrackerIds?: Array<'commander-damage' | 'poison' | 'storm'>;
    hasActions?: boolean;
    players?: Array<{ name: string; color: string }>;
    playerCount?: number;
  } = {},
): TableAssistantRoomResource {
  const state = createInitialTableAssistantRoom({
    mode: options.mode ?? 'single-device',
    roomId: 'room-1',
    roomCode: 'LOCAL',
    hostUser: { id: 'user-1', email: 'owner@test', displayName: 'Owner' },
    playerCount: options.playerCount,
    phasesEnabled: options.phasesEnabled,
    timerMode: options.timerMode,
    timerDurationSeconds: options.timerDurationSeconds,
    activeTrackerIds: options.activeTrackerIds,
    players: options.players,
  });
  if (options.hasActions) {
    state.actionLog = [
      {
        id: 'action-1',
        type: 'life.changed',
        actorParticipantId: state.hostParticipantId,
        createdAt: '',
      },
    ];
  }

  return {
    id: 'room-1',
    tableAssistantId: 'assistant-1',
    room: {
      id: 'room-1',
      owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
      status: 'waiting',
      visibility: 'private',
      players: [
        {
          id: 'room-player-1',
          user: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
          deckId: null,
        },
      ],
      gameId: null,
    },
    state,
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
}
