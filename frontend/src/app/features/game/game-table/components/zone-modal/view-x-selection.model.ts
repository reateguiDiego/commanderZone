export type ViewXInteractionType = 'pointer' | 'keyboard' | 'toolbar' | null;

export interface ViewXSelectionState {
  readonly selectedIds: ReadonlySet<string>;
  readonly selectionOrder: readonly string[];
  readonly anchorId: string | null;
  readonly focusedId: string | null;
  readonly lastInteractionType: ViewXInteractionType;
  readonly selectionRevision: string;
}

export function emptyViewXSelection(selectionRevision = ''): ViewXSelectionState {
  return {
    selectedIds: new Set<string>(),
    selectionOrder: [],
    anchorId: null,
    focusedId: null,
    lastInteractionType: null,
    selectionRevision,
  };
}

export function reconcileViewXSelection(
  state: ViewXSelectionState,
  visibleIds: readonly string[],
  selectionRevision: string,
): ViewXSelectionState {
  const uniqueVisibleIds = uniqueIds(visibleIds);
  if (state.selectionRevision !== selectionRevision) {
    return {
      ...emptyViewXSelection(selectionRevision),
      focusedId: uniqueVisibleIds[0] ?? null,
    };
  }

  const visibleSet = new Set(uniqueVisibleIds);
  const selectionOrder = state.selectionOrder.filter((instanceId) => visibleSet.has(instanceId));
  return {
    ...state,
    selectedIds: new Set(selectionOrder),
    selectionOrder,
    anchorId: state.anchorId && visibleSet.has(state.anchorId) ? state.anchorId : null,
    focusedId: state.focusedId && visibleSet.has(state.focusedId)
      ? state.focusedId
      : uniqueVisibleIds[0] ?? null,
  };
}

export function toggleViewXSelection(
  state: ViewXSelectionState,
  instanceId: string,
  visibleIds: readonly string[],
  interaction: Exclude<ViewXInteractionType, null>,
): ViewXSelectionState {
  if (!uniqueIds(visibleIds).includes(instanceId)) {
    return state;
  }

  const selectedIds = new Set(state.selectedIds);
  const selectionOrder = [...state.selectionOrder];
  if (selectedIds.has(instanceId)) {
    selectedIds.delete(instanceId);
    const index = selectionOrder.indexOf(instanceId);
    if (index >= 0) {
      selectionOrder.splice(index, 1);
    }
  } else {
    selectedIds.add(instanceId);
    selectionOrder.push(instanceId);
  }

  return {
    ...state,
    selectedIds,
    selectionOrder,
    anchorId: instanceId,
    focusedId: instanceId,
    lastInteractionType: interaction,
  };
}

export function selectViewXRange(
  state: ViewXSelectionState,
  instanceId: string,
  visibleIds: readonly string[],
  interaction: Exclude<ViewXInteractionType, null>,
): ViewXSelectionState {
  const orderedIds = uniqueIds(visibleIds);
  const targetIndex = orderedIds.indexOf(instanceId);
  const anchorIndex = state.anchorId ? orderedIds.indexOf(state.anchorId) : -1;
  if (targetIndex < 0 || anchorIndex < 0) {
    return toggleViewXSelection(state, instanceId, orderedIds, interaction);
  }

  const selectedIds = new Set(state.selectedIds);
  const selectionOrder = [...state.selectionOrder];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  for (const rangeId of orderedIds.slice(start, end + 1)) {
    if (!selectedIds.has(rangeId)) {
      selectedIds.add(rangeId);
      selectionOrder.push(rangeId);
    }
  }

  return {
    ...state,
    selectedIds,
    selectionOrder,
    focusedId: instanceId,
    lastInteractionType: interaction,
  };
}

export function selectAllViewXCards(
  state: ViewXSelectionState,
  visibleIds: readonly string[],
): ViewXSelectionState {
  const selectionOrder = uniqueIds(visibleIds);
  return {
    ...state,
    selectedIds: new Set(selectionOrder),
    selectionOrder,
    anchorId: selectionOrder[0] ?? null,
    focusedId: state.focusedId && selectionOrder.includes(state.focusedId)
      ? state.focusedId
      : selectionOrder[0] ?? null,
    lastInteractionType: 'toolbar',
  };
}

export function clearViewXSelection(state: ViewXSelectionState): ViewXSelectionState {
  return {
    ...state,
    selectedIds: new Set<string>(),
    selectionOrder: [],
    anchorId: null,
    lastInteractionType: 'toolbar',
  };
}

export function focusViewXCard(
  state: ViewXSelectionState,
  instanceId: string,
  visibleIds: readonly string[],
): ViewXSelectionState {
  return uniqueIds(visibleIds).includes(instanceId)
    ? { ...state, focusedId: instanceId }
    : state;
}

function uniqueIds(instanceIds: readonly string[]): string[] {
  return [...new Set(instanceIds.map((instanceId) => instanceId.trim()).filter(Boolean))];
}
