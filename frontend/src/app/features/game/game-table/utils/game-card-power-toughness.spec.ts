import { GameCardInstance } from '../../../../core/models/game.model';
import { classifyPrintedStat, quickAdjustmentBase, selectCardPowerToughness } from './game-card-power-toughness';

describe('game card power toughness selectors', () => {
  it.each([
    ['0', 'NUMERIC', 0], ['+3', 'NUMERIC', 3], ['1.5', 'NUMERIC', 1.5], ['*', 'FORMULA', null],
    ['1+x', 'FORMULA', null], ['?', 'UNKNOWN_SYMBOLIC', null], ['∞', 'UNKNOWN_SYMBOLIC', null], [null, 'ABSENT', null],
  ] as const)('classifies %s without destructive conversion', (value, kind, numericValue) => {
    expect(classifyPrintedStat(value)).toMatchObject({ kind, numericValue });
  });

  it('preserves formula and shows counters separately when no numeric base exists', () => {
    const view = selectCardPowerToughness(card({ defaultPower: '*', defaultToughness: '1+*', power: 0, toughness: 0, counters: { '+1/+1': 2 } }));
    expect(view.displayPower).toBe('*');
    expect(view.displayToughness).toBe('1+*');
    expect(view.netPowerToughnessCounters).toBe(2);
    expect(view.effectiveNumericPower).toBeNull();
    expect(quickAdjustmentBase(card({ defaultPower: '*', power: 0 }), 'power')).toBeNull();
  });

  it('preserves explicit zero and applies counters only to the derived view', () => {
    const source = card({
      defaultPower: '*', defaultToughness: '*', counters: { '+1/+1': 2, '-1/-1': 1 },
      manualOverrides: { '0': { faceKey: '0', faceIndex: 0, power: 0, toughness: 0, provenance: 'manual' } },
    });
    const view = selectCardPowerToughness(source);
    expect(view.manualPowerOverride).toBe(0);
    expect(view.displayPower).toBe(1);
    expect(view.displayToughness).toBe(1);
    expect(source.manualOverrides?.['0']?.power).toBe(0);
  });

  it('keeps decimal values and independent axes', () => {
    const view = selectCardPowerToughness(card({
      defaultPower: '1.5', defaultToughness: '2.5',
      manualOverrides: { '0': { faceKey: '0', faceIndex: 0, power: 3.5, provenance: 'manual' } },
    }));
    expect(view.displayPower).toBe(3.5);
    expect(view.displayToughness).toBe(2.5);
  });

  it('selects overrides independently for each DFC face', () => {
    const source = card({
      activeFaceIndex: 1,
      cardFaces: [
        { name: 'A', power: '*', toughness: '*', oracleText: null, manaCost: null, typeLine: null, loyalty: null, colors: [], imageUris: {} },
        { name: 'B', power: '2', toughness: '3', oracleText: null, manaCost: null, typeLine: null, loyalty: null, colors: [], imageUris: {} },
      ],
      manualOverrides: {
        '0': { faceKey: '0', faceIndex: 0, power: 7, provenance: 'manual' },
        '1': { faceKey: '1', faceIndex: 1, toughness: 4, provenance: 'manual' },
      },
    });
    const view = selectCardPowerToughness(source);
    expect(view.displayPower).toBe(2);
    expect(view.displayToughness).toBe(4);
  });
});

function card(overrides: Partial<GameCardInstance>): GameCardInstance {
  return { instanceId: 'card-1', name: 'Test', tapped: false, ...overrides };
}
