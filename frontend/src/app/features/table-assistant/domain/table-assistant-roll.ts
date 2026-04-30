export type TableAssistantRollKind = 'coin' | 'd4' | 'd6' | 'd10' | 'd20';

export interface TableAssistantRollOption {
  kind: TableAssistantRollKind;
  label: string;
}

export interface TableAssistantRollResult {
  kind: TableAssistantRollKind;
  label: string;
  iterationCount: number;
  finalResult: string;
}

export const TABLE_ASSISTANT_ROLL_OPTIONS: readonly TableAssistantRollOption[] = [
  { kind: 'coin', label: 'Moneda' },
  { kind: 'd4', label: 'Dado de 4 caras' },
  { kind: 'd6', label: 'Dado de 6 caras' },
  { kind: 'd10', label: 'Dado de 10 caras' },
  { kind: 'd20', label: 'Dado de 20 caras' },
] as const;

export type TableAssistantRandomSource = () => number;

export function rollTableAssistantOption(
  kind: TableAssistantRollKind,
  random: TableAssistantRandomSource = Math.random,
): TableAssistantRollResult {
  const option = TABLE_ASSISTANT_ROLL_OPTIONS.find((candidate) => candidate.kind === kind) ?? TABLE_ASSISTANT_ROLL_OPTIONS[0];
  const iterationCount = randomInteger(1, 10, random);
  let finalResult = '';

  for (let index = 0; index < iterationCount; index++) {
    finalResult = rollOnce(option.kind, random);
  }

  return {
    kind: option.kind,
    label: option.label,
    iterationCount,
    finalResult,
  };
}

function rollOnce(kind: TableAssistantRollKind, random: TableAssistantRandomSource): string {
  if (kind === 'coin') {
    return randomInteger(1, 2, random) === 1 ? 'Cara' : 'Cruz';
  }

  return String(randomInteger(1, sidesFor(kind), random));
}

function sidesFor(kind: Exclude<TableAssistantRollKind, 'coin'>): number {
  const sides: Record<Exclude<TableAssistantRollKind, 'coin'>, number> = {
    d4: 4,
    d6: 6,
    d10: 10,
    d20: 20,
  };

  return sides[kind];
}

function randomInteger(minimum: number, maximum: number, random: TableAssistantRandomSource): number {
  const normalized = Math.min(Math.max(random(), 0), 0.999999999);
  return Math.floor(normalized * (maximum - minimum + 1)) + minimum;
}
