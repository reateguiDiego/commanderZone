import { GameCardInstance } from '../../../../../core/models/game.model';
import { CARD_PREVIEW_HOVER_DELAY_MS } from '../../models/card-preview.model';
import { GameTableUiState } from './game-table-ui.state';

describe('GameTableUiState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits before showing a hovered card preview', () => {
    vi.useFakeTimers();
    const state = new GameTableUiState();
    const card = gameCard();

    state.showCardPreview(card, () => false, 'player-1', 'hand');
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS - 1);

    expect(state.hoveredCard()).toBeNull();

    vi.advanceTimersByTime(1);

    expect(state.hoveredCard()).toBe(card);
    expect(state.activeHoveredSelection()).toEqual({ playerId: 'player-1', zone: 'hand', card });
  });

  it('cancels the delayed preview when hover ends first', () => {
    vi.useFakeTimers();
    const state = new GameTableUiState();

    state.showCardPreview(gameCard(), () => false, 'player-1', 'hand');
    vi.advanceTimersByTime(50);
    state.hideCardPreview();
    vi.advanceTimersByTime(50);

    expect(state.hoveredCard()).toBeNull();
    expect(state.activeHoveredSelection()).toBeNull();
  });

  it('anchors lower-screen context menus upward near the pointer', () => {
    setViewport(1024, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(240, 660), { playerId: 'player-1', zone: 'hand', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 240,
      y: 44,
      verticalOrigin: 'bottom',
    }));
  });

  it('anchors upper-screen context menus downward near the pointer', () => {
    setViewport(1024, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(240, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 240,
      y: 124,
      verticalOrigin: 'top',
    }));
  });
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function pointerEvent(clientX: number, clientY: number): MouseEvent {
  return new MouseEvent('contextmenu', { clientX, clientY });
}

function gameCard(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Arcane Signet',
    tapped: false,
  };
}
