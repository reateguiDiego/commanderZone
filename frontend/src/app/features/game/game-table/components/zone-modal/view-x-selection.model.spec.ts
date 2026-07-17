import {
  clearViewXSelection,
  emptyViewXSelection,
  focusViewXCard,
  reconcileViewXSelection,
  selectAllViewXCards,
  selectViewXRange,
  toggleViewXSelection,
} from './view-x-selection.model';

describe('View X local selection model', () => {
  const visibleIds = ['top', 'second', 'third', 'bottom'];

  it('toggles only visible IDs without duplicates and preserves interaction order', () => {
    let state = reconcileViewXSelection(emptyViewXSelection(), visibleIds, 'window-1');
    state = toggleViewXSelection(state, 'third', visibleIds, 'pointer');
    state = toggleViewXSelection(state, 'top', visibleIds, 'keyboard');
    state = toggleViewXSelection(state, 'third', visibleIds, 'pointer');
    state = toggleViewXSelection(state, 'missing', visibleIds, 'pointer');

    expect([...state.selectedIds]).toEqual(['top']);
    expect(state.selectionOrder).toEqual(['top']);
    expect(state.anchorId).toBe('third');
    expect(state.focusedId).toBe('third');
  });

  it('adds a visual-order shift range while retaining prior selection order', () => {
    let state = reconcileViewXSelection(emptyViewXSelection(), visibleIds, 'window-1');
    state = toggleViewXSelection(state, 'bottom', visibleIds, 'pointer');
    state = toggleViewXSelection(state, 'top', visibleIds, 'pointer');
    state = selectViewXRange(state, 'third', visibleIds, 'keyboard');

    expect(state.selectionOrder).toEqual(['bottom', 'top', 'second', 'third']);
    expect([...state.selectedIds]).toEqual(['bottom', 'top', 'second', 'third']);
  });

  it('selects and clears all visible cards without accepting duplicate IDs', () => {
    let state = reconcileViewXSelection(emptyViewXSelection(), visibleIds, 'window-1');
    state = selectAllViewXCards(state, ['top', 'second', 'top', '', 'third']);

    expect(state.selectionOrder).toEqual(['top', 'second', 'third']);
    expect(state.lastInteractionType).toBe('toolbar');

    state = clearViewXSelection(state);
    expect(state.selectionOrder).toEqual([]);
    expect(state.selectedIds.size).toBe(0);
    expect(state.anchorId).toBeNull();
  });

  it('prunes stale IDs and fully clears selection for a new window revision', () => {
    let state = reconcileViewXSelection(emptyViewXSelection(), visibleIds, 'window-1');
    state = toggleViewXSelection(state, 'second', visibleIds, 'pointer');
    state = toggleViewXSelection(state, 'third', visibleIds, 'pointer');
    state = reconcileViewXSelection(state, ['top', 'third'], 'window-1');

    expect(state.selectionOrder).toEqual(['third']);
    expect(state.anchorId).toBe('third');

    state = reconcileViewXSelection(state, visibleIds, 'window-2');
    expect(state.selectionOrder).toEqual([]);
    expect(state.focusedId).toBe('top');
    expect(state.selectionRevision).toBe('window-2');
  });

  it('moves local focus only to an authorized visible card', () => {
    const state = reconcileViewXSelection(emptyViewXSelection(), visibleIds, 'window-1');
    expect(focusViewXCard(state, 'third', visibleIds).focusedId).toBe('third');
    expect(focusViewXCard(state, 'private-id', visibleIds)).toBe(state);
  });
});
