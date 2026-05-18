import { GameCardInstance } from '../../../../core/models/game.model';
import { layoutOpponentMiniBattlefield } from './opponent-mini-battlefield-layout';

describe('layoutOpponentMiniBattlefield', () => {
  it('keeps a single positioned card visible within the board miniature', () => {
    const [layout] = layoutOpponentMiniBattlefield([card('card-1', 400, 200)], { width: 220, height: 160 });

    expect(layout).toEqual(expect.objectContaining({ instanceId: 'card-1' }));
    expect(layout!.left).toBeGreaterThan(0);
    expect(layout!.top).toBeGreaterThan(0);
    expect(layout!.left + layout!.width).toBeLessThanOrEqual(220);
    expect(layout!.top + layout!.height).toBeLessThanOrEqual(160);
  });

  it('preserves absolute left placement instead of centering the card cluster', () => {
    const layout = layoutOpponentMiniBattlefield([card('a', 0, 80), card('b', 90, 80), card('c', 180, 80)], { width: 300, height: 180 });

    expect(layout[0]!.left).toBeLessThan(20);
    expect(layout[2]!.left).toBeLessThan(90);
  });

  it('preserves absolute right placement for cards near the battlefield edge', () => {
    const layout = layoutOpponentMiniBattlefield([card('right', 790, 120)], { width: 300, height: 180 });
    const [right] = layout;

    expect(right!.left).toBeGreaterThan(220);
    expect(right!.left + right!.width).toBeLessThanOrEqual(300);
  });

  it('maps positioned cards against the measured battlefield size without horizontal letterboxing', () => {
    const layout = layoutOpponentMiniBattlefield(
      [card('left', 0, 420), card('right', 1848, 420)],
      { width: 500, height: 260 },
      { boardSize: { width: 1948, height: 1360 } },
    );
    const left = layout.find((item) => item.instanceId === 'left')!;
    const right = layout.find((item) => item.instanceId === 'right')!;

    expect(left.left).toBeCloseTo(8, 1);
    expect(right.left + right.width).toBeCloseTo(492, 1);
  });

  it('does not leave right-edge cards floating inward when the measured board is too wide', () => {
    const [layout] = layoutOpponentMiniBattlefield(
      [card('right-edge', 1700, 360)],
      { width: 500, height: 260 },
      { boardSize: { width: 2048, height: 980 } },
    );

    expect(layout!.left + layout!.width).toBeCloseTo(492, 1);
  });

  it('keeps left-side clusters anchored when they do not reach the board edge', () => {
    const layout = layoutOpponentMiniBattlefield(
      [card('a', 0, 80), card('b', 90, 80), card('c', 180, 80)],
      { width: 500, height: 260 },
      { boardSize: { width: 2048, height: 980 } },
    );

    expect(layout[0]!.left).toBeCloseTo(8, 1);
    expect(layout[2]!.left).toBeLessThan(90);
  });

  it('preserves relative horizontal order for separated positioned cards', () => {
    const layout = layoutOpponentMiniBattlefield([card('left', 20, 40), card('right', 720, 420)], { width: 240, height: 170 });
    const left = layout.find((item) => item.instanceId === 'left')!;
    const right = layout.find((item) => item.instanceId === 'right')!;

    expect(left.left).toBeLessThan(right.left);
    expect(left.top).toBeLessThan(right.top);
    expect(right.left + right.width).toBeLessThanOrEqual(240);
    expect(right.top + right.height).toBeLessThanOrEqual(170);
  });

  it('maps ratio positioned cards through the measured battlefield size', () => {
    const layout = layoutOpponentMiniBattlefield(
      [
        { ...card('center'), position: { x: 0.5, y: 0.5, unit: 'ratio' } },
        { ...card('right'), position: { x: 1, y: 0.5, unit: 'ratio' } },
      ],
      { width: 300, height: 180 },
      { boardSize: { width: 900, height: 520 } },
    );
    const center = layout.find((item) => item.instanceId === 'center')!;
    const right = layout.find((item) => item.instanceId === 'right')!;

    expect(center.left).toBeLessThan(right.left);
    expect(right.left + right.width).toBeLessThanOrEqual(300);
  });

  it('uses a stable fallback grid for cards without positions', () => {
    const layout = layoutOpponentMiniBattlefield([card('a'), card('b'), card('c')], { width: 240, height: 170 });

    expect(layout.map((item) => item.instanceId)).toEqual(['a', 'b', 'c']);
    expect(new Set(layout.map((item) => `${item.left}:${item.top}`)).size).toBe(3);
  });

  it('updates layout when a card position changes', () => {
    const before = layoutOpponentMiniBattlefield([card('moving', 0, 0), card('fixed', 120, 0)], { width: 240, height: 170 });
    const after = layoutOpponentMiniBattlefield([card('moving', 760, 420), card('fixed', 120, 0)], { width: 240, height: 170 });

    expect(before.find((item) => item.instanceId === 'moving')?.left)
      .not.toBe(after.find((item) => item.instanceId === 'moving')?.left);
  });

  it('keeps tapped card visual bounds inside the viewport', () => {
    const [layout] = layoutOpponentMiniBattlefield([{ ...card('tapped', 850, 450), tapped: true }], { width: 220, height: 160 });

    expect(layout!.left).toBeGreaterThanOrEqual(0);
    expect(layout!.top).toBeGreaterThanOrEqual(0);
    expect(layout!.left + layout!.height).toBeLessThanOrEqual(220);
  });
});

function card(instanceId: string, x?: number, y?: number): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name: instanceId,
    tapped: false,
    position: x === undefined || y === undefined ? undefined : { x, y },
    counters: {},
  };
}
