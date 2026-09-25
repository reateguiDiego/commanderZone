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

  it('shows an immediate hover preview and clears the live dungeon marker override with the preview', () => {
    const state = new GameTableUiState();
    const card = { ...gameCard(), typeLine: 'Dungeon' };

    state.setDungeonMarkerPreviewOverride({ instanceId: card.instanceId, marker: { x: 0.6, y: 0.35 } });
    state.showImmediateCardPreview({
      card,
      playerId: 'player-1',
      zone: 'battlefield',
      sourceRect: null,
    }, () => false);

    expect(state.hoveredPreview()?.card).toBe(card);
    expect(state.dungeonMarkerPreviewOverride()).toEqual({ instanceId: card.instanceId, marker: { x: 0.6, y: 0.35 } });

    state.hideCardPreview();

    expect(state.hoveredPreview()).toBeNull();
    expect(state.dungeonMarkerPreviewOverride()).toBeNull();
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

  it('keeps the owner-only face-down inspection flag on a pinned preview', () => {
    const state = new GameTableUiState();
    const card = { ...gameCard(), faceDown: true };

    state.showPinnedCardPreview(card, () => false, 'player-1', 'battlefield', true);

    expect(state.hoveredPreview()).toEqual(expect.objectContaining({
      card,
      revealFaceDownCard: true,
    }));
  });

  it('opens an owner-authorized preview for a hidden face-down card', () => {
    const state = new GameTableUiState();
    const card = { ...gameCard(), hidden: true, faceDown: true };

    state.showPinnedCardPreview(card, () => false, 'player-1', 'battlefield', true);

    expect(state.hoveredPreview()).toEqual(expect.objectContaining({
      card,
      revealFaceDownCard: true,
    }));
  });

  it('does not show a face-down card from passive hover or a generic pinned preview', () => {
    vi.useFakeTimers();
    const state = new GameTableUiState();
    const card = { ...gameCard(), faceDown: true };

    state.showCardPreview(card, () => false, 'player-1', 'battlefield');
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    state.showImmediateCardPreview({ card, playerId: 'player-1', zone: 'battlefield', sourceRect: null }, () => false);
    state.showPinnedCardPreview(card, () => false, 'player-1', 'battlefield');

    expect(state.hoveredPreview()).toBeNull();
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
      x: 252,
      y: 44,
      verticalOrigin: 'bottom',
      horizontalPlacement: 'right',
      width: 264,
    }));
  });

  it('anchors upper-screen context menus downward near the pointer', () => {
    setViewport(1024, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(240, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 252,
      y: 124,
      verticalOrigin: 'top',
      horizontalPlacement: 'right',
      width: 264,
    }));
  });

  it('opens context menus to the left when the click is in the final viewport third', () => {
    setViewport(420, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(360, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 116,
      y: 124,
      verticalOrigin: 'top',
      horizontalPlacement: 'left',
      width: 232,
    }));
  });

  it('uses a narrower readable width on narrow viewports', () => {
    setViewport(680, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(120, 120), { playerId: 'player-1', zone: 'battlefield', kind: 'card', card: gameCard() });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      width: 232,
    }));
  });

  it('opens a card context menu to the left inside the final viewport third', () => {
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
      x: 374,
      y: 124,
      verticalOrigin: 'top',
      horizontalPlacement: 'left',
      width: 264,
    }));
  });

  it('keeps the main menu on the right inside the first two viewport thirds even for forced-left mechanics', () => {
    setViewport(900, 700);
    const state = new GameTableUiState();

    state.openContextMenu(pointerEvent(220, 120), {
      playerId: 'player-1',
      zone: 'battlefield',
      kind: 'card',
      card: gameCard(),
      forceOpenLeft: true,
      sourceRect: {
        left: 420,
        top: 90,
        right: 530,
        bottom: 245,
        width: 110,
        height: 155,
      },
    });

    expect(state.contextMenu()).toEqual(expect.objectContaining({
      x: 232,
      y: 124,
      verticalOrigin: 'top',
      horizontalPlacement: 'right',
      width: 264,
    }));
  });

  it('uses the same right placement across the first two viewport thirds', () => {
    setViewport(1000, 700);
    const state = new GameTableUiState();

    for (const clientX of [100, 499, 665]) {
      state.openContextMenu(pointerEvent(clientX, 120), {
        playerId: 'player-1',
        zone: 'battlefield',
        kind: 'card',
        card: gameCard(),
      });

      expect(state.contextMenu()).toEqual(expect.objectContaining({ horizontalPlacement: 'right' }));
    }

    state.openContextMenu(pointerEvent(667, 120), {
      playerId: 'player-1',
      zone: 'battlefield',
      kind: 'card',
      card: gameCard(),
    });

    expect(state.contextMenu()).toEqual(expect.objectContaining({ horizontalPlacement: 'left' }));
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
