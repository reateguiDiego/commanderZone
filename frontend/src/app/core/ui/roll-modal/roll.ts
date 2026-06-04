export type RollKind = 'coin' | 'd4' | 'd6' | 'd10' | 'd20';

export interface RollOption {
  kind: RollKind;
  label: string;
}

export interface RollResult {
  kind: RollKind;
  label: string;
  iterationCount: number;
  finalResult: string;
}

export const ROLL_OPTIONS: readonly RollOption[] = [
  { kind: 'coin', label: 'modals.roll.options.coin' },
  { kind: 'd4', label: 'modals.roll.options.d4' },
  { kind: 'd6', label: 'modals.roll.options.d6' },
  { kind: 'd10', label: 'modals.roll.options.d10' },
  { kind: 'd20', label: 'modals.roll.options.d20' },
] as const;

export type RandomSource = () => number;

const RANDOM_UINT32_RANGE = 0x100000000;

export function randomRollIterationCount(random?: RandomSource): number {
  return randomInteger(1, 20, random);
}

export function rollOption(
  kind: RollKind,
  random?: RandomSource,
): RollResult {
  const option = ROLL_OPTIONS.find((candidate) => candidate.kind === kind) ?? ROLL_OPTIONS[0];
  const iterationCount = randomRollIterationCount(random);
  let finalResult = '';

  for (let index = 0; index < iterationCount; index++) {
    finalResult = rollOnce(option.kind, random);
  }

  return {
    kind: option.kind,
    label: runtimeTranslationFallback(option.label),
    iterationCount,
    finalResult,
  };
}

function rollOnce(kind: RollKind, random?: RandomSource): string {
  if (kind === 'coin') {
    return runtimeTranslationFallback(randomInteger(1, 2, random) === 1 ? 'modals.roll.results.heads' : 'modals.roll.results.tails');
  }

  return String(randomInteger(1, sidesFor(kind), random));
}

function sidesFor(kind: Exclude<RollKind, 'coin'>): number {
  const sides: Record<Exclude<RollKind, 'coin'>, number> = {
    d4: 4,
    d6: 6,
    d10: 10,
    d20: 20,
  };

  return sides[kind];
}

function randomInteger(minimum: number, maximum: number, random?: RandomSource): number {
  if (!random) {
    return cryptoRandomInteger(minimum, maximum);
  }

  const normalized = Math.min(Math.max(random(), 0), 0.999999999);
  return Math.floor(normalized * (maximum - minimum + 1)) + minimum;
}

function cryptoRandomInteger(minimum: number, maximum: number): number {
  const range = maximum - minimum + 1;
  const rejectionLimit = Math.floor(RANDOM_UINT32_RANGE / range) * range;
  const values = new Uint32Array(1);
  let value = 0;

  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0] ?? 0;
  } while (value >= rejectionLimit);

  return minimum + (value % range);
}
import { runtimeTranslationFallback } from '../../localization/runtime-translate.pipe';
