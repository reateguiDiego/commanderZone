import { CardCounterLayoutInput, resolveCardCounterLayout } from './card-counter-layout';

describe('resolveCardCounterLayout', () => {
  const base: CardCounterLayoutInput = {
    cardWidth: 116,
    cardHeight: 162,
    counterCount: 5,
    responsiveState: 'normal',
    tapped: false,
    relationRole: 'independent',
    availableRect: { width: 116, height: 162 },
  };

  it('keeps five counters in a complete vertical rail when the effective card has room', () => {
    expect(resolveCardCounterLayout(base)).toMatchObject({
      orientation: 'vertical',
      rows: 5,
      columns: 1,
      labelMode: 'full',
      overflowStrategy: 'contained-grid',
    });
  });

  it.each(['compact', 'aggressive', 'minimal'] as const)('fits five counters without a clipped fifth slot in %s', (responsiveState) => {
    const result = resolveCardCounterLayout({
      ...base,
      cardWidth: responsiveState === 'minimal' ? 60 : 82,
      cardHeight: responsiveState === 'minimal' ? 84 : 115,
      availableRect: { width: responsiveState === 'minimal' ? 60 : 82, height: responsiveState === 'minimal' ? 84 : 115 },
      responsiveState,
    });

    expect(result.rows * result.columns).toBeGreaterThanOrEqual(5);
    expect(result.orientation).toBe('grid');
    expect(result.hitSize).toBeGreaterThanOrEqual(22);
  });

  it('uses the tapped effective height and compacts a five-counter rail', () => {
    expect(resolveCardCounterLayout({ ...base, tapped: true })).toMatchObject({ orientation: 'grid', rows: 3, columns: 2 });
  });

  it.each(['independent', 'attachment', 'stack-root', 'stack-member'] as const)('returns a usable deterministic layout for %s', (relationRole) => {
    const result = resolveCardCounterLayout({ ...base, relationRole });

    expect(result.rows * result.columns).toBeGreaterThanOrEqual(5);
    expect(Number.isFinite(result.badgeSize)).toBe(true);
    expect(Number.isFinite(result.zIndex)).toBe(true);
  });

  it('sanitizes non-finite measurements and never returns NaN', () => {
    const result = resolveCardCounterLayout({
      ...base,
      cardWidth: Number.NaN,
      cardHeight: Number.POSITIVE_INFINITY,
      counterCount: Number.NaN,
      availableRect: { width: Number.NaN, height: Number.NaN },
    });

    expect(Object.values(result).every((value) => typeof value !== 'number' || Number.isFinite(value))).toBe(true);
  });
});
