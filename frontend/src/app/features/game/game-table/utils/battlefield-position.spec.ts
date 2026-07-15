import {
  clampRatioPosition,
  clampRenderedCardToBattlefield,
  logicalRatioToRenderedPosition,
  renderedBattlefieldPosition,
  renderedPositionToLogicalRatio,
  resolveBattlefieldContentRect,
  resolveEffectiveCardSize,
  translateRatioPositionGroup,
} from './battlefield-position';

describe('canonical battlefield position transforms', () => {
  it.each([0.7, 1, 1.4])('round-trips top-left ratios without persisting battlefield zoom %s', (zoom) => {
    const board = { width: 960, height: 620 };
    const card = resolveEffectiveCardSize({ width: 100, height: 140 }, zoom);
    const logical = { x: 0.42123456789, y: 0.68123456789, unit: 'ratio' } as const;

    const rendered = logicalRatioToRenderedPosition(logical, board, card);
    const roundTrip = renderedPositionToLogicalRatio(rendered, board, card);

    expect(roundTrip).toEqual(logical);
    expect(roundTrip).not.toHaveProperty('zoom');
  });

  it('uses effective card size in the available top-left range', () => {
    const logical = { x: 1, y: 1, unit: 'ratio' } as const;

    expect(logicalRatioToRenderedPosition(logical, { width: 300, height: 220 }, { width: 100, height: 140 }))
      .toEqual({ x: 200, y: 80 });
    expect(logicalRatioToRenderedPosition(logical, { width: 600, height: 440 }, { width: 200, height: 280 }))
      .toEqual({ x: 400, y: 160 });
  });

  it('keeps canonical ratios independent of devicePixelRatio and rounds only the legacy render wrapper', () => {
    const before = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const logical = { x: 0.333333333, y: 0.666666667, unit: 'ratio' } as const;
    const rendered = logicalRatioToRenderedPosition(logical, { width: 901, height: 521 }, { width: 116, height: 162 });

    expect(rendered).toEqual({ x: 261.666666405, y: 239.333333453 });
    expect(renderedBattlefieldPosition(logical, { width: 901, height: 521 }, { width: 116, height: 162 }))
      .toEqual({ x: 262, y: 239 });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: before });
  });

  it('clamps rendered cards and malformed local ratios at the playable boundaries', () => {
    expect(clampRenderedCardToBattlefield(
      { x: -40, y: 200 },
      { width: 300, height: 220 },
      { width: 100, height: 140 },
    )).toEqual({ x: 0, y: 80 });
    expect(clampRatioPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY, unit: 'ratio' }))
      .toEqual({ x: 0, y: 0, unit: 'ratio' });
  });

  it('collectively clamps a batch and preserves its internal geometry at an edge', () => {
    const original = [
      { x: 0.7, y: 0.2, unit: 'ratio' } as const,
      { x: 0.9, y: 0.5, unit: 'ratio' } as const,
    ];

    const moved = translateRatioPositionGroup(original, { x: 0.4, y: -0.4 });

    expect(moved).toEqual([
      { x: 0.7999999999999999, y: 0, unit: 'ratio' },
      { x: 1, y: 0.3, unit: 'ratio' },
    ]);
    expect(moved[1]!.x - moved[0]!.x).toBeCloseTo(original[1]!.x - original[0]!.x, 12);
    expect(moved[1]!.y - moved[0]!.y).toBeCloseTo(original[1]!.y - original[0]!.y, 12);
  });

  it('resolves the battlefield content box including border, padding and scroll offsets', () => {
    const battlefield = document.createElement('section');
    battlefield.style.border = '2px solid transparent';
    battlefield.style.padding = '10px 12px 14px 16px';
    battlefield.getBoundingClientRect = () => ({
      x: 50, y: 80, left: 50, top: 80, right: 450, bottom: 380, width: 400, height: 300,
      toJSON: () => ({}),
    });
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 396 });
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 296 });
    Object.defineProperty(battlefield, 'scrollLeft', { configurable: true, value: 7 });
    Object.defineProperty(battlefield, 'scrollTop', { configurable: true, value: 11 });
    document.body.appendChild(battlefield);

    expect(resolveBattlefieldContentRect(battlefield)).toEqual({
      left: 68,
      top: 92,
      width: 368,
      height: 272,
      scrollLeft: 7,
      scrollTop: 11,
    });
  });
});
