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

export function rollOption(
  kind: RollKind,
  random: RandomSource = Math.random,
): RollResult {
  const option = ROLL_OPTIONS.find((candidate) => candidate.kind === kind) ?? ROLL_OPTIONS[0];
  const iterationCount = randomInteger(1, 10, random);
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

function rollOnce(kind: RollKind, random: RandomSource): string {
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

function randomInteger(minimum: number, maximum: number, random: RandomSource): number {
  const normalized = Math.min(Math.max(random(), 0), 0.999999999);
  return Math.floor(normalized * (maximum - minimum + 1)) + minimum;
}
import { runtimeTranslationFallback } from '../../localization/runtime-translate.pipe';
