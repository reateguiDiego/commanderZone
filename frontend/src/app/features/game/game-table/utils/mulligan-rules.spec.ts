import { MulliganRule, calculateMulliganState, canKeepMulliganState } from './mulligan-rules';

describe('mulligan rules', () => {
  it('calculates London mulligans with a free first mulligan', () => {
    expectState('LONDON', true, 0, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('LONDON', true, 1, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('LONDON', true, 2, { draw: 7, bottom: 1, final: 6, scry: false });
  });

  it('calculates London mulligans without a free first mulligan', () => {
    expectState('LONDON', false, 1, { draw: 7, bottom: 1, final: 6, scry: false });
  });

  it('calculates Vancouver mulligans with a free first mulligan', () => {
    expectState('VANCOUVER', true, 0, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('VANCOUVER', true, 1, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('VANCOUVER', true, 2, { draw: 6, bottom: 0, final: 6, scry: true });
    expectState('VANCOUVER', true, 3, { draw: 5, bottom: 0, final: 5, scry: true });
  });

  it('never uses bottom selection for Vancouver', () => {
    for (let mulligansTaken = 0; mulligansTaken <= 7; mulligansTaken++) {
      const state = calculateMulliganState({ rule: 'VANCOUVER', firstMulliganFree: true, mulligansTaken });

      expect(state.bottomSelectionCount).toBe(0);
      expect(state.needsBottomSelection).toBe(false);
      expect(state.bottomOrderMode).toBe('NONE');
    }
  });

  it('calculates Paris mulligans with a free first mulligan and never scries or bottoms', () => {
    expectState('PARIS', true, 0, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('PARIS', true, 1, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('PARIS', true, 2, { draw: 6, bottom: 0, final: 6, scry: false });

    for (let mulligansTaken = 0; mulligansTaken <= 7; mulligansTaken++) {
      const state = calculateMulliganState({ rule: 'PARIS', firstMulliganFree: true, mulligansTaken });

      expect(state.bottomSelectionCount).toBe(0);
      expect(state.needsBottomSelection).toBe(false);
      expect(state.bottomOrderMode).toBe('NONE');
      expect(state.needsScryAfterKeep).toBe(false);
    }
  });

  it('calculates Generous mulligans with a free first mulligan', () => {
    expectState('GENEROUS', true, 0, { draw: 10, bottom: 3, final: 7, scry: false });
    expectState('GENEROUS', true, 1, { draw: 10, bottom: 3, final: 7, scry: false });
    expectState('GENEROUS', true, 2, { draw: 9, bottom: 2, final: 7, scry: false });
    expectState('GENEROUS', true, 3, { draw: 8, bottom: 1, final: 7, scry: false });
    expectState('GENEROUS', true, 4, { draw: 7, bottom: 0, final: 7, scry: false });
    expectState('GENEROUS', true, 5, { draw: 6, bottom: 0, final: 6, scry: false });
  });

  it('calculates Generous mulligans without a free first mulligan', () => {
    expectState('GENEROUS', false, 0, { draw: 10, bottom: 3, final: 7, scry: false });
    expectState('GENEROUS', false, 1, { draw: 9, bottom: 2, final: 7, scry: false });
    expectState('GENEROUS', false, 2, { draw: 8, bottom: 1, final: 7, scry: false });
  });

  it('uses player-chosen bottom order for London', () => {
    const state = calculateMulliganState({ rule: 'LONDON', firstMulliganFree: false, mulligansTaken: 2 });

    expect(state.bottomOrderMode).toBe('PLAYER_CHOSEN_ORDER');
    expect(state.needsBottomSelection).toBe(true);
  });

  it('uses server-side random bottom order for Generous when cards go to bottom', () => {
    for (const mulligansTaken of [0, 1, 2, 3]) {
      const state = calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: true, mulligansTaken });

      expect(state.bottomSelectionCount).toBeGreaterThan(0);
      expect(state.bottomOrderMode).toBe('RANDOM_SERVER_SIDE');
      expect(state.needsBottomSelection).toBe(true);
    }
  });

  it('never uses scry for Generous', () => {
    for (let mulligansTaken = 0; mulligansTaken <= 12; mulligansTaken++) {
      expect(calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: true, mulligansTaken }).needsScryAfterKeep)
        .toBe(false);
    }
  });

  it('allows the free first mulligan even when effective mulligans do not change', () => {
    expect(calculateMulliganState({ rule: 'LONDON', firstMulliganFree: true, mulligansTaken: 0 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'VANCOUVER', firstMulliganFree: true, mulligansTaken: 0 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'PARIS', firstMulliganFree: true, mulligansTaken: 0 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: true, mulligansTaken: 0 }).canTakeAnotherMulligan)
      .toBe(true);
  });

  it('allows reaching a zero-card hand but blocks mulligan attempts that cannot change gameplay state', () => {
    expect(calculateMulliganState({ rule: 'VANCOUVER', firstMulliganFree: false, mulligansTaken: 6 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'VANCOUVER', firstMulliganFree: false, mulligansTaken: 7 }).canTakeAnotherMulligan)
      .toBe(false);

    expect(calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: false, mulligansTaken: 9 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: false, mulligansTaken: 10 }).canTakeAnotherMulligan)
      .toBe(false);
  });

  it('blocks London once the next mulligan would require bottoming more cards than were drawn', () => {
    expect(calculateMulliganState({ rule: 'LONDON', firstMulliganFree: false, mulligansTaken: 6 }).canTakeAnotherMulligan)
      .toBe(true);
    expect(calculateMulliganState({ rule: 'LONDON', firstMulliganFree: false, mulligansTaken: 7 }).canTakeAnotherMulligan)
      .toBe(false);
  });

  it('validates keep against current hand length for bottom-selection rules', () => {
    const london = calculateMulliganState({ rule: 'LONDON', firstMulliganFree: false, mulligansTaken: 3 });
    const generous = calculateMulliganState({ rule: 'GENEROUS', firstMulliganFree: false, mulligansTaken: 1 });
    const vancouver = calculateMulliganState({ rule: 'VANCOUVER', firstMulliganFree: false, mulligansTaken: 7 });

    expect(canKeepMulliganState(london, 2)).toBe(false);
    expect(canKeepMulliganState(london, 3)).toBe(true);
    expect(canKeepMulliganState(generous, 1)).toBe(false);
    expect(canKeepMulliganState(generous, 2)).toBe(true);
    expect(canKeepMulliganState(vancouver, 0)).toBe(true);
    expect(canKeepMulliganState(london, Number.NaN)).toBe(false);
  });
});

function expectState(
  rule: MulliganRule,
  firstMulliganFree: boolean,
  mulligansTaken: number,
  expected: { draw: number; bottom: number; final: number; scry: boolean },
): void {
  const state = calculateMulliganState({ rule, firstMulliganFree, mulligansTaken });
  const effectiveMulligans = Math.max(0, mulligansTaken - (firstMulliganFree ? 1 : 0));

  expect(state.rule).toBe(rule);
  expect(state.mulligansTaken).toBe(mulligansTaken);
  expect(state.effectiveMulligans).toBe(effectiveMulligans);
  expect(state.drawCount).toBe(expected.draw);
  expect(state.bottomSelectionCount).toBe(expected.bottom);
  expect(state.finalHandSize).toBe(expected.final);
  expect(state.needsBottomSelection).toBe(expected.bottom > 0);
  expect(state.needsScryAfterKeep).toBe(expected.scry);
}
