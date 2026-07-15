export const GAME_TABLE_RESPONSIVE_STATES = ['normal', 'compact', 'aggressive', 'minimal'] as const;

export type GameTableResponsiveState = (typeof GAME_TABLE_RESPONSIVE_STATES)[number];
export type GameTableOrientation = 'landscape' | 'portrait';

export interface GameTableVisiblePanels {
  readonly opponents: boolean;
  readonly activity: boolean;
}

export interface GameTableResponsiveInput {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly playerCount: number;
  readonly visiblePanels: GameTableVisiblePanels;
  readonly orientation: GameTableOrientation;
  readonly previousState?: GameTableResponsiveState | null;
}

export interface GameTableResponsiveResolution {
  readonly state: GameTableResponsiveState;
  readonly supported: boolean;
  readonly usableWidth: number;
  readonly usableHeight: number;
}

export const MIN_SUPPORTED_GAME_TABLE_WIDTH = 480;
export const MIN_SUPPORTED_GAME_TABLE_HEIGHT = 360;

const NORMAL_WIDTH = 1280;
const NORMAL_HEIGHT = 820;
const COMPACT_WIDTH = 960;
const COMPACT_HEIGHT = 650;
const AGGRESSIVE_WIDTH = 720;
const AGGRESSIVE_HEIGHT = 520;
const WIDTH_HYSTERESIS = 64;
const HEIGHT_HYSTERESIS = 40;

const STATE_ORDER: Readonly<Record<GameTableResponsiveState, number>> = {
  normal: 0,
  compact: 1,
  aggressive: 2,
  minimal: 3,
};

export function resolveGameTableResponsiveState(input: GameTableResponsiveInput): GameTableResponsiveResolution {
  const width = nonNegativeFinite(input.containerWidth);
  const height = nonNegativeFinite(input.containerHeight);
  const playerCount = clampInteger(input.playerCount, 2, 6);
  const playerWidthCost = Math.max(0, playerCount - 2) * 48;
  const playerHeightCost = Math.max(0, playerCount - 4) * 18;
  const panelWidthCost = input.visiblePanels.opponents ? 72 : 0;
  const panelHeightCost = input.visiblePanels.activity ? 24 : 0;
  const portraitWidthCost = input.orientation === 'portrait' ? 48 : 0;
  const usableWidth = Math.max(0, width - playerWidthCost - panelWidthCost - portraitWidthCost);
  const usableHeight = Math.max(0, height - playerHeightCost - panelHeightCost);
  const candidate = classify(usableWidth, usableHeight);
  const state = resolveWithHysteresis(candidate, input.previousState ?? null, usableWidth, usableHeight);

  return {
    state,
    supported: width >= MIN_SUPPORTED_GAME_TABLE_WIDTH && height >= MIN_SUPPORTED_GAME_TABLE_HEIGHT,
    usableWidth,
    usableHeight,
  };
}

export function isGameTableResponsiveState(value: unknown): value is GameTableResponsiveState {
  return typeof value === 'string' && GAME_TABLE_RESPONSIVE_STATES.includes(value as GameTableResponsiveState);
}

function classify(width: number, height: number): GameTableResponsiveState {
  if (width >= NORMAL_WIDTH && height >= NORMAL_HEIGHT) {
    return 'normal';
  }
  if (width >= COMPACT_WIDTH && height >= COMPACT_HEIGHT) {
    return 'compact';
  }
  if (width >= AGGRESSIVE_WIDTH && height >= AGGRESSIVE_HEIGHT) {
    return 'aggressive';
  }
  return 'minimal';
}

function resolveWithHysteresis(
  candidate: GameTableResponsiveState,
  previous: GameTableResponsiveState | null,
  width: number,
  height: number,
): GameTableResponsiveState {
  if (previous === null || STATE_ORDER[candidate] >= STATE_ORDER[previous]) {
    return candidate;
  }
  if (STATE_ORDER[previous] - STATE_ORDER[candidate] > 1) {
    return candidate;
  }

  const threshold = entryThreshold(candidate);
  return width >= threshold.width + WIDTH_HYSTERESIS && height >= threshold.height + HEIGHT_HYSTERESIS
    ? candidate
    : previous;
}

function entryThreshold(state: GameTableResponsiveState): { width: number; height: number } {
  switch (state) {
    case 'normal':
      return { width: NORMAL_WIDTH, height: NORMAL_HEIGHT };
    case 'compact':
      return { width: COMPACT_WIDTH, height: COMPACT_HEIGHT };
    case 'aggressive':
      return { width: AGGRESSIVE_WIDTH, height: AGGRESSIVE_HEIGHT };
    case 'minimal':
      return { width: 0, height: 0 };
  }
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
