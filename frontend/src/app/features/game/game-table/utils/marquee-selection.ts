import { SelectionModifierMode } from '../services/game-table-selection.service';

export interface MarqueePoint {
  readonly x: number;
  readonly y: number;
}

export interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface MarqueeCandidateBounds {
  readonly instanceId: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function normalizeMarqueeRect(start: MarqueePoint, current: MarqueePoint): MarqueeRect {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const right = Math.max(start.x, current.x);
  const bottom = Math.max(start.y, current.y);

  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function intersectsSelectionRectByCenter(rect: MarqueeRect, bounds: MarqueeCandidateBounds): boolean {
  const centerX = bounds.left + (bounds.right - bounds.left) / 2;
  const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;

  return centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
}

export function resolveMarqueeCandidates(
  rect: MarqueeRect,
  bounds: readonly MarqueeCandidateBounds[],
): string[] {
  return bounds
    .filter((candidate) => intersectsSelectionRectByCenter(rect, candidate))
    .map((candidate) => candidate.instanceId);
}

export function applySelectionModifier(
  baseSelection: readonly string[],
  candidateIds: readonly string[],
  mode: SelectionModifierMode,
): string[] {
  const base = uniqueIds(baseSelection);
  const candidates = uniqueIds(candidateIds);
  if (mode === 'replace') {
    return candidates;
  }

  const baseIds = new Set(base);
  if (mode === 'add') {
    return [...base, ...candidates.filter((instanceId) => !baseIds.has(instanceId))];
  }

  const candidateSet = new Set(candidates);
  return [
    ...base.filter((instanceId) => !candidateSet.has(instanceId)),
    ...candidates.filter((instanceId) => !baseIds.has(instanceId)),
  ];
}

export function marqueeModifierMode(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>): SelectionModifierMode {
  if (event.ctrlKey || event.metaKey) {
    return 'toggle';
  }
  return event.shiftKey ? 'add' : 'replace';
}

export function exceedsMarqueeThreshold(start: MarqueePoint, current: MarqueePoint, threshold: number): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((instanceId) => {
    if (!instanceId || seen.has(instanceId)) {
      return false;
    }
    seen.add(instanceId);
    return true;
  });
}
