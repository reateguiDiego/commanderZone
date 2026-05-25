import { TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTableUiState } from '../state/core/game-table-ui.state';
import { GameTableToastState } from '../state/core/game-table-toast.state';
import { GameTableDragService } from './game-table-drag.service';
import { GameTableInteractionActionsService } from './game-table-interaction-actions.service';
import { GameTableSelectionService } from './game-table-selection.service';

describe('GameTableInteractionActionsService', () => {
  let service: GameTableInteractionActionsService;
  let uiState: { openContextMenu: ReturnType<typeof vi.fn>; openContextMenuAt: ReturnType<typeof vi.fn> };
  let toastState: { showTargetToast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    uiState = {
      openContextMenu: vi.fn(),
      openContextMenuAt: vi.fn(),
    };
    toastState = { showTargetToast: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        GameTableInteractionActionsService,
        GameTableSelectionService,
        { provide: GameTableUiState, useValue: uiState },
        { provide: GameTableDragService, useValue: { consumeSuppressedClick: vi.fn(() => false) } },
        { provide: GameTableToastState, useValue: toastState },
      ],
    });

    service = TestBed.inject(GameTableInteractionActionsService);
  });

  it('allows a player to control a card they received in hand without becoming the owner', () => {
    const card = handCard({
      ownerId: 'player-1',
      controllerId: 'player-2',
    });

    const canControl = service.canControlOwnedCard(
      { currentPlayer: () => ({ id: 'player-2', state: { status: 'active' } }) },
      'player-2',
      card,
    );

    expect(canControl).toBe(true);
  });

  it('does not allow a player to control another player hand card without controller access', () => {
    const card = handCard({
      ownerId: 'player-1',
      controllerId: 'player-1',
    });

    const canControl = service.canControlOwnedCard(
      { currentPlayer: () => ({ id: 'player-2', state: { status: 'active' } }) },
      'player-1',
      card,
    );

    expect(canControl).toBe(false);
  });

  it('does not open the library context menu for another player', () => {
    const event = contextMenuEvent();

    service.openZoneMenu({
      currentPlayer: () => ({ id: 'player-1', state: { status: 'active' } }),
      focusedPlayer: () => null,
      zoneCardCount: () => 10,
      setError: vi.fn(),
      playCard: vi.fn(),
    }, event, 'player-2', 'library');

    expect(uiState.openContextMenu).not.toHaveBeenCalled();
    expect(uiState.openContextMenuAt).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('opens the own library context menu from the pile top-left corner', () => {
    const event = contextMenuEvent();

    service.openZoneMenu({
      currentPlayer: () => ({ id: 'player-1', state: { status: 'active' } }),
      focusedPlayer: () => null,
      zoneCardCount: () => 10,
      setError: vi.fn(),
      playCard: vi.fn(),
    }, event, 'player-1', 'library');

    expect(uiState.openContextMenuAt).toHaveBeenCalledWith(
      { x: 120, y: 320 },
      { playerId: 'player-1', zone: 'library', kind: 'zone' },
    );
  });

  it('shows the homogeneous-zone selection toast when shift selection changes source', () => {
    const context = interactionContext();
    const battlefieldCard = handCard({ instanceId: 'battlefield-card', zone: 'battlefield' });
    const handCardInstance = handCard({ instanceId: 'hand-card', zone: 'hand' });

    service.toggleCardSelection(context, clickEvent(false), 'player-1', 'battlefield', battlefieldCard);
    service.toggleCardSelection(context, clickEvent(true), 'player-1', 'hand', handCardInstance);

    expect(toastState.showTargetToast).toHaveBeenCalledWith('La seleccion multiple solo puede ser con cartas de una misma zona.');
  });
});

function interactionContext() {
  return {
    currentPlayer: () => ({ id: 'player-1', state: { status: 'active' } }),
    focusedPlayer: () => null,
    zoneCardCount: () => 0,
    setError: vi.fn(),
    playCard: vi.fn(),
  };
}

function contextMenuEvent(): MouseEvent {
  const target = document.createElement('button');
  target.getBoundingClientRect = () => ({ left: 120, top: 320, right: 240, bottom: 480, width: 120, height: 160 } as DOMRect);

  return {
    currentTarget: target,
    clientX: 180,
    clientY: 380,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}

function clickEvent(shiftKey: boolean): MouseEvent {
  const target = document.createElement('button');

  return {
    currentTarget: target,
    shiftKey,
  } as unknown as MouseEvent;
}

function handCard(overrides: Partial<GameCardInstance>): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Gift Card',
    tapped: false,
    zone: 'hand',
    ...overrides,
  };
}
