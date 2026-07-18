import {
  captureSelectionVisualTargets,
  resolveSpatialSelectionTarget,
  type SelectionVisualTarget,
} from './selection-visual-target';

describe('selection visual targets', () => {
  it('captures visible actionable cards and relation identities once without duplicates', () => {
    const root = document.createElement('div');
    root.append(
      element('root', 10, 10, 100, 140, { kind: 'stack-group', groupId: 'stack-1', zIndex: '48' }),
      element('hidden', 20, 20, 100, 140, { hidden: true }),
      element('attachment', 120, 30, 100, 140, { kind: 'attachment' }),
    );

    const targets = captureSelectionVisualTargets(root, new Set(['root', 'hidden', 'attachment']));

    expect(targets.map((target) => ({ id: target.instanceId, kind: target.kind, group: target.groupId, actionable: target.actionable }))).toEqual([
      { id: 'root', kind: 'stack-group', group: 'stack-1', actionable: true },
      { id: 'attachment', kind: 'attachment', group: null, actionable: true },
    ]);
  });

  it('navigates the requested half-plane and uses z-index then id as deterministic ties', () => {
    const targets = [
      target('origin', 100, 100),
      target('right-low', 180, 100, 2),
      target('right-top', 180, 100, 9),
      target('down', 100, 220),
      target('left', 10, 100),
    ];

    expect(resolveSpatialSelectionTarget(targets, 'origin', 'right')?.instanceId).toBe('right-top');
    expect(resolveSpatialSelectionTarget(targets, 'origin', 'down')?.instanceId).toBe('down');
    expect(resolveSpatialSelectionTarget(targets, 'origin', 'left')?.instanceId).toBe('left');
  });

  it('resolves Home and End from visual geometry rather than DOM order', () => {
    const targets = [target('middle', 100, 100), target('end', 300, 200), target('home', 20, 10)];

    expect(resolveSpatialSelectionTarget(targets, 'middle', 'home')?.instanceId).toBe('home');
    expect(resolveSpatialSelectionTarget(targets, 'middle', 'end')?.instanceId).toBe('end');
  });

  it('keeps 50 navigation steps across 100 targets bounded and deterministic', () => {
    const targets = Array.from({ length: 100 }, (_, index) => target(
      `dense-${index.toString().padStart(3, '0')}`,
      (index % 10) * 100,
      Math.floor(index / 10) * 140,
    ));
    let focusedId = 'dense-000';
    const startedAt = performance.now();
    for (let step = 0; step < 50; step += 1) {
      const next = resolveSpatialSelectionTarget(targets, focusedId, step % 2 === 0 ? 'right' : 'left');
      expect(next).not.toBeNull();
      focusedId = next!.instanceId;
    }

    expect(focusedId).toBe('dense-000');
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('uses z-index then instance id deterministically across 20 overlapping candidates', () => {
    const overlaps = Array.from({ length: 20 }, (_, index) => target(
      `overlap-${index.toString().padStart(2, '0')}`,
      100,
      0,
      index % 5,
    ));

    expect(resolveSpatialSelectionTarget([target('origin', 0, 0), ...overlaps], 'origin', 'right')?.instanceId).toBe('overlap-04');
  });
});

function element(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  options: { kind?: string; groupId?: string; hidden?: boolean; zIndex?: string } = {},
): HTMLElement {
  const value = document.createElement('button');
  value.dataset['testid'] = 'game-card';
  value.setAttribute('data-testid', 'game-card');
  value.dataset['cardInstanceId'] = id;
  value.dataset['selectionTargetKind'] = options.kind ?? 'card';
  if (options.groupId) value.dataset['selectionGroupId'] = options.groupId;
  if (options.hidden) value.dataset['selectionHidden'] = 'true';
  value.style.zIndex = options.zIndex ?? '';
  value.getBoundingClientRect = () => rect(left, top, width, height);
  return value;
}

function target(instanceId: string, x: number, y: number, zIndex = 0): SelectionVisualTarget {
  const bounds = rect(x - 10, y - 10, 20, 20);
  return {
    instanceId, kind: 'card', groupId: null, bounds, center: { x, y }, zIndex,
    focusable: true, actionable: true, ariaLabel: instanceId, element: document.createElement('button'),
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}
