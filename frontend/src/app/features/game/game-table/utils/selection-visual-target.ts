export type SelectionVisualTargetKind = 'card' | 'attachment' | 'stack-group' | 'stack-member';
export type SpatialSelectionDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

export interface SelectionVisualTarget {
  readonly instanceId: string;
  readonly kind: SelectionVisualTargetKind;
  readonly groupId: string | null;
  readonly bounds: DOMRect;
  readonly center: { readonly x: number; readonly y: number };
  readonly zIndex: number;
  readonly focusable: boolean;
  readonly actionable: boolean;
  readonly ariaLabel: string;
  readonly element: HTMLElement;
}

/**
 * Captures the rendered selection geometry once. Marquee and spatial keyboard
 * navigation intentionally share this projection so relations cannot be hit
 * differently by the two input paths.
 */
export function captureSelectionVisualTargets(
  root: ParentNode,
  actionableIds?: ReadonlySet<string>,
): SelectionVisualTarget[] {
  const targets: SelectionVisualTarget[] = [];
  const seen = new Set<string>();

  for (const element of Array.from(root.querySelectorAll<HTMLElement>(
    '[data-testid="game-card"][data-card-instance-id]',
  ))) {
    const instanceId = element.dataset['cardInstanceId'] ?? '';
    if (
      !instanceId
      || seen.has(instanceId)
      || element.dataset['selectionHidden'] === 'true'
      || element.hidden
      || element.getAttribute('aria-hidden') === 'true'
      || element.hasAttribute('disabled')
      || actionableIds && !actionableIds.has(instanceId)
    ) {
      continue;
    }

    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }

    seen.add(instanceId);
    targets.push({
      instanceId,
      kind: selectionTargetKind(element.dataset['selectionTargetKind']),
      groupId: element.dataset['selectionGroupId'] || null,
      bounds,
      center: {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      },
      zIndex: resolvedZIndex(element),
      focusable: element.tabIndex >= 0,
      actionable: !actionableIds || actionableIds.has(instanceId),
      ariaLabel: element.getAttribute('aria-label') ?? '',
      element,
    });
  }

  return targets;
}

export function resolveSpatialSelectionTarget(
  targets: readonly SelectionVisualTarget[],
  currentInstanceId: string,
  direction: SpatialSelectionDirection,
): SelectionVisualTarget | null {
  const current = targets.find((candidate) => candidate.instanceId === currentInstanceId);
  if (!current || targets.length < 2) {
    return null;
  }

  if (direction === 'home' || direction === 'end') {
    const ordered = targets
      .filter((candidate) => candidate.instanceId !== currentInstanceId)
      .sort((left, right) => compareVisualEdge(left, right, direction));
    return ordered[0] ?? null;
  }

  const candidates = targets.filter((candidate) => isInDirectionalHalfPlane(current, candidate, direction));
  candidates.sort((left, right) => compareDirectionalCandidate(current, left, right, direction));

  return candidates[0] ?? null;
}

function selectionTargetKind(value: string | undefined): SelectionVisualTargetKind {
  return value === 'attachment' || value === 'stack-group' || value === 'stack-member' ? value : 'card';
}

function resolvedZIndex(element: HTMLElement): number {
  const inline = Number.parseInt(element.style.zIndex, 10);
  if (Number.isFinite(inline)) {
    return inline;
  }
  if (typeof getComputedStyle === 'undefined') {
    return 0;
  }

  const computed = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(computed) ? computed : 0;
}

function isInDirectionalHalfPlane(
  current: SelectionVisualTarget,
  candidate: SelectionVisualTarget,
  direction: Exclude<SpatialSelectionDirection, 'home' | 'end'>,
): boolean {
  const dx = candidate.center.x - current.center.x;
  const dy = candidate.center.y - current.center.y;
  switch (direction) {
    case 'left': return dx < -0.5;
    case 'right': return dx > 0.5;
    case 'up': return dy < -0.5;
    case 'down': return dy > 0.5;
  }
}

function compareDirectionalCandidate(
  current: SelectionVisualTarget,
  left: SelectionVisualTarget,
  right: SelectionVisualTarget,
  direction: Exclude<SpatialSelectionDirection, 'home' | 'end'>,
): number {
  const leftScore = directionalScore(current, left, direction);
  const rightScore = directionalScore(current, right, direction);
  return leftScore - rightScore
    || right.zIndex - left.zIndex
    || left.instanceId.localeCompare(right.instanceId);
}

function directionalScore(
  current: SelectionVisualTarget,
  candidate: SelectionVisualTarget,
  direction: Exclude<SpatialSelectionDirection, 'home' | 'end'>,
): number {
  const dx = Math.abs(candidate.center.x - current.center.x);
  const dy = Math.abs(candidate.center.y - current.center.y);
  const primary = direction === 'left' || direction === 'right' ? dx : dy;
  const perpendicular = direction === 'left' || direction === 'right' ? dy : dx;

  // Strongly favour the requested axis while still allowing navigation across
  // sparse free-form boards. The final terms make ties fully deterministic.
  return primary + perpendicular * 1.75 + Math.hypot(dx, dy) * 0.05;
}

function compareVisualEdge(
  left: SelectionVisualTarget,
  right: SelectionVisualTarget,
  direction: 'home' | 'end',
): number {
  const multiplier = direction === 'home' ? 1 : -1;
  return multiplier * (
    left.center.y - right.center.y
    || left.center.x - right.center.x
    || right.zIndex - left.zIndex
    || left.instanceId.localeCompare(right.instanceId)
  );
}
