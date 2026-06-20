export type MulliganRule = 'LONDON' | 'VANCOUVER' | 'PARIS' | 'GENEROUS';

export type MulliganBottomOrderMode = 'NONE' | 'PLAYER_CHOSEN_ORDER' | 'RANDOM_SERVER_SIDE';

export interface CalculateMulliganStateInput {
  readonly rule: MulliganRule;
  readonly firstMulliganFree: boolean;
  readonly mulligansTaken: number;
}

export interface MulliganState {
  readonly rule: MulliganRule;
  readonly mulligansTaken: number;
  readonly effectiveMulligans: number;
  readonly drawCount: number;
  readonly bottomSelectionCount: number;
  readonly finalHandSize: number;
  readonly needsBottomSelection: boolean;
  readonly bottomOrderMode: MulliganBottomOrderMode;
  readonly needsScryAfterKeep: boolean;
  readonly canTakeAnotherMulligan: boolean;
}

const LONDON_HAND_SIZE = 7;
const GENEROUS_HAND_SIZE = 7;
const GENEROUS_BASE_DRAW_COUNT = 10;

export function calculateMulliganState(input: CalculateMulliganStateInput): MulliganState {
  const mulligansTaken = sanitizeMulligansTaken(input.mulligansTaken);
  const effectiveMulligans = calculateEffectiveMulligans(mulligansTaken, input.firstMulliganFree);
  const baseState = calculateBaseMulliganState(input.rule, mulligansTaken, effectiveMulligans);

  return {
    ...baseState,
    canTakeAnotherMulligan: canTakeNextMulligan(input.rule, input.firstMulliganFree, mulligansTaken, baseState),
  };
}

export function canKeepMulliganState(state: MulliganState, handLength: number): boolean {
  const normalizedHandLength = Number.isFinite(handLength) ? Math.max(0, Math.floor(handLength)) : 0;
  if (state.drawCount < 0 || state.bottomSelectionCount < 0 || state.finalHandSize < 0) {
    return false;
  }

  if (state.rule === 'LONDON' || state.rule === 'GENEROUS') {
    return state.bottomSelectionCount <= normalizedHandLength;
  }

  return true;
}

function calculateEffectiveMulligans(mulligansTaken: number, firstMulliganFree: boolean): number {
  return Math.max(0, mulligansTaken - (firstMulliganFree ? 1 : 0));
}

function calculateBaseMulliganState(
  rule: MulliganRule,
  mulligansTaken: number,
  effectiveMulligans: number,
): Omit<MulliganState, 'canTakeAnotherMulligan'> {
  switch (rule) {
    case 'LONDON': {
      const bottomSelectionCount = effectiveMulligans;
      return buildState({
        rule,
        mulligansTaken,
        effectiveMulligans,
        drawCount: LONDON_HAND_SIZE,
        bottomSelectionCount,
        finalHandSize: LONDON_HAND_SIZE - bottomSelectionCount,
        bottomOrderMode: 'PLAYER_CHOSEN_ORDER',
        needsScryAfterKeep: false,
      });
    }
    case 'VANCOUVER': {
      const drawCount = Math.max(0, LONDON_HAND_SIZE - effectiveMulligans);
      return buildState({
        rule,
        mulligansTaken,
        effectiveMulligans,
        drawCount,
        bottomSelectionCount: 0,
        finalHandSize: drawCount,
        bottomOrderMode: 'NONE',
        needsScryAfterKeep: effectiveMulligans > 0,
      });
    }
    case 'PARIS': {
      const drawCount = Math.max(0, LONDON_HAND_SIZE - effectiveMulligans);
      return buildState({
        rule,
        mulligansTaken,
        effectiveMulligans,
        drawCount,
        bottomSelectionCount: 0,
        finalHandSize: drawCount,
        bottomOrderMode: 'NONE',
        needsScryAfterKeep: false,
      });
    }
    case 'GENEROUS': {
      const drawCount = Math.max(0, GENEROUS_BASE_DRAW_COUNT - effectiveMulligans);
      const bottomSelectionCount = Math.max(0, drawCount - GENEROUS_HAND_SIZE);
      return buildState({
        rule,
        mulligansTaken,
        effectiveMulligans,
        drawCount,
        bottomSelectionCount,
        finalHandSize: drawCount - bottomSelectionCount,
        bottomOrderMode: 'RANDOM_SERVER_SIDE',
        needsScryAfterKeep: false,
      });
    }
  }
}

function buildState(
  state: Omit<MulliganState, 'needsBottomSelection' | 'canTakeAnotherMulligan'>,
): Omit<MulliganState, 'canTakeAnotherMulligan'> {
  return {
    ...state,
    needsBottomSelection: state.bottomSelectionCount > 0,
  };
}

function canTakeNextMulligan(
  rule: MulliganRule,
  firstMulliganFree: boolean,
  mulligansTaken: number,
  current: Omit<MulliganState, 'canTakeAnotherMulligan'>,
): boolean {
  const nextMulligansTaken = mulligansTaken + 1;
  const nextEffectiveMulligans = calculateEffectiveMulligans(nextMulligansTaken, firstMulliganFree);
  const next = calculateBaseMulliganState(rule, nextMulligansTaken, nextEffectiveMulligans);

  if (!isMulliganAttemptValid(next)) {
    return false;
  }

  if (next.effectiveMulligans === current.effectiveMulligans) {
    return next.mulligansTaken > current.mulligansTaken;
  }

  return hasGameplayRelevantMulliganChange(current, next);
}

function isMulliganAttemptValid(state: Omit<MulliganState, 'canTakeAnotherMulligan'>): boolean {
  return state.drawCount >= 0
    && state.bottomSelectionCount >= 0
    && state.finalHandSize >= 0
    && state.bottomSelectionCount <= state.drawCount;
}

function hasGameplayRelevantMulliganChange(
  current: Omit<MulliganState, 'canTakeAnotherMulligan'>,
  next: Omit<MulliganState, 'canTakeAnotherMulligan'>,
): boolean {
  return current.drawCount !== next.drawCount
    || current.bottomSelectionCount !== next.bottomSelectionCount
    || current.finalHandSize !== next.finalHandSize
    || current.needsBottomSelection !== next.needsBottomSelection
    || current.bottomOrderMode !== next.bottomOrderMode
    || current.needsScryAfterKeep !== next.needsScryAfterKeep;
}

function sanitizeMulligansTaken(mulligansTaken: number): number {
  if (!Number.isFinite(mulligansTaken)) {
    return 0;
  }

  return Math.max(0, Math.floor(mulligansTaken));
}
