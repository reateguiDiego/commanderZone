import {
  applySelectionModifier,
  exceedsMarqueeThreshold,
  intersectsSelectionRectByCenter,
  marqueeModifierMode,
  normalizeMarqueeRect,
  resolveMarqueeCandidates,
} from './marquee-selection';

describe('marquee selection geometry', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 80, y: 90 }],
    [{ x: 80, y: 20 }, { x: 10, y: 90 }],
    [{ x: 10, y: 90 }, { x: 80, y: 20 }],
    [{ x: 80, y: 90 }, { x: 10, y: 20 }],
  ])('normalizes all four drag directions', (start, current) => {
    expect(normalizeMarqueeRect(start, current)).toEqual({
      left: 10, top: 20, right: 80, bottom: 90, width: 70, height: 70,
    });
  });

  it('uses the visual center instead of any overlap or full containment', () => {
    const rect = normalizeMarqueeRect({ x: 10, y: 10 }, { x: 100, y: 100 });

    expect(intersectsSelectionRectByCenter(rect, bounds('center-inside', 80, 80, 120, 120))).toBe(true);
    expect(intersectsSelectionRectByCenter(rect, bounds('overlap-only', 95, 95, 145, 145))).toBe(false);
    expect(intersectsSelectionRectByCenter(rect, bounds('corner-center', 90, 90, 110, 110))).toBe(true);
    expect(intersectsSelectionRectByCenter(rect, bounds('outside', -50, -50, 0, 0))).toBe(false);
  });

  it('resolves overlapping, tapped and rotated DOM bounds independently in stable candidate order', () => {
    const rect = normalizeMarqueeRect({ x: 0, y: 0 }, { x: 100, y: 100 });
    const candidates = [
      bounds('bottom', 20, 20, 80, 80),
      bounds('top', 30, 30, 90, 90),
      bounds('rotated', 40, 0, 140, 60),
      bounds('outside', 101, 101, 151, 151),
    ];

    expect(resolveMarqueeCandidates(rect, candidates)).toEqual(['bottom', 'top', 'rotated']);
  });

  it('applies replace, Shift-add and Ctrl/Meta-toggle without duplicates', () => {
    expect(applySelectionModifier(['base'], ['candidate', 'candidate'], 'replace')).toEqual(['candidate']);
    expect(applySelectionModifier(['base'], ['base', 'candidate'], 'add')).toEqual(['base', 'candidate']);
    expect(applySelectionModifier(['base', 'out'], ['out', 'in'], 'toggle')).toEqual(['base', 'in']);
    expect(marqueeModifierMode({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe('add');
    expect(marqueeModifierMode({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('toggle');
    expect(marqueeModifierMode({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle');
  });

  it('does not start until the movement threshold is crossed', () => {
    expect(exceedsMarqueeThreshold({ x: 0, y: 0 }, { x: 2, y: 2 }, 5)).toBe(false);
    expect(exceedsMarqueeThreshold({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
  });
});

function bounds(instanceId: string, left: number, top: number, right: number, bottom: number) {
  return { instanceId, left, top, right, bottom };
}
