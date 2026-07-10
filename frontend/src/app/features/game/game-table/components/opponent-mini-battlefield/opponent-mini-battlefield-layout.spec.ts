import { GameCardInstance } from '../../../../../core/models/game.model';
import { layoutOpponentMiniBattlefield } from './opponent-mini-battlefield-layout';

describe('layoutOpponentMiniBattlefield', () => {
  it('maps positioned battlefield cards through board space without drifting away from edges', () => {
    const layout = layoutOpponentMiniBattlefield(
      [
        card('left', 0, 420),
        card('right', 1848, 420),
        { ...card('ratio-center'), position: { x: 0.5, y: 0.5, unit: 'ratio' } },
      ],
      { width: 500, height: 260 },
      { boardSize: { width: 1948, height: 1360 } },
    );
    const left = layout.find((item) => item.instanceId === 'left')!;
    const right = layout.find((item) => item.instanceId === 'right')!;
    const ratioCenter = layout.find((item) => item.instanceId === 'ratio-center')!;

    expect(left.left).toBeCloseTo(8, 1);
    expect(right.left + right.width).toBeCloseTo(492, 1);
    expect(ratioCenter.left).toBeGreaterThan(left.left);
    expect(ratioCenter.left).toBeLessThan(right.left);

    const cards: GameCardInstance[] = [{ ...card('resolved'), position: { x: 0.1, y: 0.2, unit: 'ratio' } }];
    const resolvedLeft = layoutOpponentMiniBattlefield(cards, { width: 300, height: 180 }, {
      getPosition: () => ({ x: 0, y: 0 }),
    })[0]!;
    const resolvedRight = layoutOpponentMiniBattlefield(cards, { width: 300, height: 180 }, {
      getPosition: () => ({ x: 800, y: 360 }),
    })[0]!;

    expect(resolvedLeft.left).toBeLessThan(resolvedRight.left);
    expect(resolvedLeft.top).toBeLessThan(resolvedRight.top);
  });

  it('uses a stable fallback grid and keeps rotated cards inside the mini viewport', () => {
    const layout = layoutOpponentMiniBattlefield([card('a'), card('b'), card('c')], { width: 240, height: 170 });

    expect(layout.map((item) => item.instanceId)).toEqual(['a', 'b', 'c']);
    expect(new Set(layout.map((item) => `${item.left}:${item.top}`)).size).toBe(3);

    const [tapped] = layoutOpponentMiniBattlefield([{ ...card('tapped', 850, 450), tapped: true }], { width: 220, height: 160 });

    expect(tapped!.left).toBeGreaterThanOrEqual(0);
    expect(tapped!.top).toBeGreaterThanOrEqual(0);
    expect(tapped!.left + tapped!.height).toBeLessThanOrEqual(220);
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
