import {
  GameCardInstance,
  GameManualStatsOverride,
  GamePowerToughnessValue,
  GamePrintedStatKind,
} from '../../../../core/models/game.model';

export interface ClassifiedPrintedStat {
  value: string | null;
  kind: GamePrintedStatKind;
  numericValue: number | null;
}

export interface CardPowerToughnessView {
  faceKey: string;
  faceIndex: number;
  printedPower: string | null;
  printedToughness: string | null;
  manualPowerOverride: number | string | null;
  manualToughnessOverride: number | string | null;
  basePower: number | string | null;
  baseToughness: number | string | null;
  effectiveNumericPower: number | null;
  effectiveNumericToughness: number | null;
  displayPower: GamePowerToughnessValue;
  displayToughness: GamePowerToughnessValue;
  netPowerToughnessCounters: number;
}

const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function classifyPrintedStat(value: unknown): ClassifiedPrintedStat {
  if (value === null || value === undefined) {
    return { value: null, kind: 'ABSENT', numericValue: null };
  }
  const normalized = String(value).trim().replaceAll('x', 'X');
  if (normalized === '') {
    return { value: null, kind: 'ABSENT', numericValue: null };
  }
  if (numericPattern.test(normalized)) {
    const numericValue = Number(normalized);
    return { value: normalized, kind: 'NUMERIC', numericValue: Number.isFinite(numericValue) ? numericValue : null };
  }
  if (normalized.includes('*') || normalized.includes('X')) {
    return { value: normalized, kind: 'FORMULA', numericValue: null };
  }
  return { value: normalized, kind: 'UNKNOWN_SYMBOLIC', numericValue: null };
}

export function selectCardPowerToughness(card: GameCardInstance): CardPowerToughnessView {
  const faceIndex = Number.isInteger(card.activeFaceIndex) ? Math.max(0, Number(card.activeFaceIndex)) : 0;
  const faceKey = String(faceIndex);
  const activeFace = card.cardFaces?.[faceIndex] ?? null;
  const explicitPrinted = card.printedStats?.[faceKey];
  const printedPower = classifyPrintedStat(explicitPrinted
    ? explicitPrinted.power
    : (activeFace ? activeFace.power ?? null : card.defaultPower ?? null));
  const printedToughness = classifyPrintedStat(explicitPrinted
    ? explicitPrinted.toughness
    : (activeFace ? activeFace.toughness ?? null : card.defaultToughness ?? null));
  const explicitOverride = card.manualOverrides?.[faceKey] ?? null;
  const manualPowerOverride = overrideAxis(card, explicitOverride, 'power', printedPower);
  const manualToughnessOverride = overrideAxis(card, explicitOverride, 'toughness', printedToughness);
  const powerBase = baseAxis(manualPowerOverride, explicitOverride, 'power', printedPower);
  const toughnessBase = baseAxis(manualToughnessOverride, explicitOverride, 'toughness', printedToughness);
  const netCounters = netPowerToughnessCounters(card.counters);
  const effectivePower = numericOverride(powerBase);
  const effectiveToughness = numericOverride(toughnessBase);

  return {
    faceKey,
    faceIndex,
    printedPower: printedPower.value,
    printedToughness: printedToughness.value,
    manualPowerOverride,
    manualToughnessOverride,
    basePower: powerBase,
    baseToughness: toughnessBase,
    effectiveNumericPower: effectivePower === null ? null : effectivePower + netCounters,
    effectiveNumericToughness: effectiveToughness === null ? null : effectiveToughness + netCounters,
    displayPower: displayAxis(powerBase, printedPower, effectivePower, netCounters),
    displayToughness: displayAxis(toughnessBase, printedToughness, effectiveToughness, netCounters),
    netPowerToughnessCounters: netCounters,
  };
}

export function netPowerToughnessCounters(counters: Record<string, number> | null | undefined): number {
  return finiteCounter(counters?.['+1/+1']) - finiteCounter(counters?.['-1/-1']);
}

export function quickAdjustmentBase(card: GameCardInstance, axis: 'power' | 'toughness'): number | null {
  const view = selectCardPowerToughness(card);
  return numericOverride(axis === 'power' ? view.basePower : view.baseToughness);
}

function overrideAxis(
  card: GameCardInstance,
  explicit: GameManualStatsOverride | null,
  axis: 'power' | 'toughness',
  printed: ClassifiedPrintedStat,
): number | string | null {
  if (explicit && Object.prototype.hasOwnProperty.call(explicit, axis)) {
    return normalizeOverride(explicit[axis]);
  }
  if (card.manualOverrides !== undefined) {
    return null;
  }
  if ((card.cardFaces?.length ?? 0) > 0 && (printed.kind === 'NUMERIC' || printed.kind === 'ABSENT')) {
    return null;
  }
  const legacy = normalizeOverride(card[axis]);
  if (legacy === null || legacyMatchesPrintedSentinel(legacy, printed)) {
    return null;
  }
  return legacy;
}

function baseAxis(
  override: number | string | null,
  explicit: GameManualStatsOverride | null,
  axis: 'power' | 'toughness',
  printed: ClassifiedPrintedStat,
): number | string | null {
  const hasExplicit = explicit !== null && Object.prototype.hasOwnProperty.call(explicit, axis);
  if (hasExplicit || override !== null) {
    return override;
  }
  return printed.kind === 'NUMERIC' ? printed.numericValue : printed.value;
}

function displayAxis(
  base: number | string | null,
  printed: ClassifiedPrintedStat,
  numericBase: number | null,
  counters: number,
): GamePowerToughnessValue {
  if (numericBase !== null) {
    return numericBase + counters;
  }
  if (base !== null) {
    return base;
  }
  return printed.value;
}

function normalizeOverride(value: unknown): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const classified = classifyPrintedStat(value);
  if (classified.value === null) {
    return null;
  }
  return classified.kind === 'NUMERIC' ? classified.numericValue : classified.value;
}

function numericOverride(value: number | string | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  return classifyPrintedStat(value).numericValue;
}

function legacyMatchesPrintedSentinel(value: number | string, printed: ClassifiedPrintedStat): boolean {
  const numeric = numericOverride(value);
  if ((printed.kind === 'FORMULA' || printed.kind === 'UNKNOWN_SYMBOLIC') && numeric === 0) {
    return true;
  }
  if (printed.kind === 'NUMERIC' && numeric !== null) {
    return numeric === printed.numericValue;
  }
  return String(value) === printed.value;
}

function finiteCounter(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
