import { GameCardInstance } from '../../../../core/models/game.model';
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
    vi.advanceTimersByTime(99);

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
});

function gameCard(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Arcane Signet',
    tapped: false,
  };
}
