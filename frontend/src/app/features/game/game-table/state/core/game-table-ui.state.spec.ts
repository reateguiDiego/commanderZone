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

  it('does not show delayed hover previews while a context menu is open', () => {
    vi.useFakeTimers();
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(240, 200), { playerId: 'player-1', zone: 'hand', kind: 'card', card: gameCard() });
    state.showCardPreview(gameCard(), () => false, 'player-1', 'hand');
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);

    expect(state.hoveredCard()).toBeNull();
    expect(state.activeHoveredSelection()).toBeNull();
  });

  it('clears pending hover previews when a context menu opens', () => {
    vi.useFakeTimers();
    const state = new GameTableUiState();

    state.showCardPreview(gameCard(), () => false, 'player-1', 'hand');
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS - 1);
    state.openContextMenu(pointerEvent(240, 200), { playerId: 'player-1', zone: 'hand', kind: 'card', card: gameCard() });
    vi.advanceTimersByTime(1);

    expect(state.hoveredCard()).toBeNull();
    expect(state.activeHoveredSelection()).toBeNull();
  });

  it('keeps a pinned preview open when hover leave events arrive', () => {
    const state = new GameTableUiState();
    const card = gameCard();

    state.showPinnedCardPreview(card, () => false, 'player-1', 'battlefield');
    state.hideCardPreview();

    expect(state.hoveredCard()).toBe(card);
    expect(state.activeHoveredSelection()).toEqual({ playerId: 'player-1', zone: 'battlefield', card });
  });

  it('clears a pinned preview explicitly', () => {
    const state = new GameTableUiState();

    state.showPinnedCardPreview(gameCard(), () => false, 'player-1', 'battlefield');
    state.clearCardPreview();

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

  it('places narrow-screen context menus to the left of the pointer when there is room', () => {
    setViewport(420, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(360, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 92,
      y: 124,
      verticalOrigin: 'top',
    }));
  });

  it('opens card context menus to the left of the card when the default position would collide with the preview', () => {
    setViewport(900, 520);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(650, 120), {
      playerId: 'player-1',
      zone: 'battlefield',
      kind: 'card',
      card: gameCard(),
      sourceRect: {
        left: 650,
        top: 90,
        right: 760,
        bottom: 245,
        width: 110,
        height: 155,
      },
    });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 382,
      y: 124,
      verticalOrigin: 'top',
    }));
  });

  it('closes a card context menu when that same card starts dragging', () => {
    const state = new GameTableUiState();
    const card = gameCard();

    state.openContextMenu(pointerEvent(240, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card });
    state.closeContextMenuForCardDrag(card.instanceId);

    expect(state.contextMenu()).toBeNull();
  });

  it('keeps another card context menu open when a different card starts dragging', () => {
    const state = new GameTableUiState();
    const card = gameCard();

    state.openContextMenu(pointerEvent(240, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card });
    state.closeContextMenuForCardDrag('other-card');

    expect(state.contextMenu()).toEqual(expect.objectContaining({ card }));
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
