import { GameCardPosition, GameCardRatioPosition } from '../../../../core/models/game.model';

export interface BattlefieldSize {
  readonly width: number;
  readonly height: number;
}

export interface BattlefieldCardSize {
  readonly width: number;
  readonly height: number;
}

export interface BattlefieldPixelPosition {
  readonly x: number;
  readonly y: number;
}

export interface BattlefieldContentRect extends BattlefieldSize {
  readonly left: number;
  readonly top: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface RatioPositionDelta {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_BATTLEFIELD_SIZE: BattlefieldSize = { width: 900, height: 520 };
export const DEFAULT_BATTLEFIELD_CARD_SIZE: BattlefieldCardSize = { width: 116, height: 162 };
export const CENTER_BATTLEFIELD_RATIO_POSITION: GameCardRatioPosition = { x: 0.5, y: 0.5, unit: 'ratio' };

export function isRatioPosition(position: GameCardPosition | null | undefined): position is GameCardRatioPosition {
  return position?.unit === 'ratio';
}

export function renderedBattlefieldPosition(
  position: GameCardPosition | null | undefined,
  battlefieldSize: BattlefieldSize = DEFAULT_BATTLEFIELD_SIZE,
  cardSize: BattlefieldCardSize = DEFAULT_BATTLEFIELD_CARD_SIZE,
): BattlefieldPixelPosition | null {
  if (!position || (!isRatioPosition(position) && position.x <= 0 && position.y <= 0)) {
    return null;
  }

  if (!isRatioPosition(position)) {
    return { x: position.x, y: position.y };
  }

  const rendered = logicalRatioToRenderedPosition(position, battlefieldSize, cardSize);
  return {
    x: Math.round(rendered.x),
    y: Math.round(rendered.y),
  };
}

export function ratioBattlefieldPosition(
  position: BattlefieldPixelPosition,
  battlefieldSize: BattlefieldSize = DEFAULT_BATTLEFIELD_SIZE,
  cardSize: BattlefieldCardSize = DEFAULT_BATTLEFIELD_CARD_SIZE,
): GameCardRatioPosition {
  return renderedPositionToLogicalRatio(position, battlefieldSize, cardSize);
}

/** Canonical top-left ratio to local CSS coordinates. No shared state is mutated. */
export function logicalRatioToRenderedPosition(
  position: GameCardRatioPosition,
  battlefieldSize: BattlefieldSize,
  cardSize: BattlefieldCardSize,
): BattlefieldPixelPosition {
  const canonical = clampRatioPosition(position);

  return {
    x: canonical.x * availableAxis(battlefieldSize.width, cardSize.width),
    y: canonical.y * availableAxis(battlefieldSize.height, cardSize.height),
  };
}

/** Local CSS coordinates to the canonical top-left ratio. No early rounding. */
export function renderedPositionToLogicalRatio(
  position: BattlefieldPixelPosition,
  battlefieldSize: BattlefieldSize,
  cardSize: BattlefieldCardSize,
): GameCardRatioPosition {
  return clampRatioPosition({
    x: position.x / availableAxis(battlefieldSize.width, cardSize.width),
    y: position.y / availableAxis(battlefieldSize.height, cardSize.height),
    unit: 'ratio',
  });
}

export function clampRenderedCardToBattlefield(
  position: BattlefieldPixelPosition,
  battlefieldSize: BattlefieldSize,
  cardSize: BattlefieldCardSize,
): BattlefieldPixelPosition {
  return {
    x: clampFinite(position.x, 0, availableAxis(battlefieldSize.width, cardSize.width)),
    y: clampFinite(position.y, 0, availableAxis(battlefieldSize.height, cardSize.height)),
  };
}

export function clampRatioPosition(position: GameCardRatioPosition): GameCardRatioPosition {
  return {
    x: clampFinite(position.x, 0, 1),
    y: clampFinite(position.y, 0, 1),
    unit: 'ratio',
  };
}

export function resolveEffectiveCardSize(
  cardSize: BattlefieldCardSize,
  battlefieldZoom = 1,
  visualScale = 1,
): BattlefieldCardSize {
  const scale = positiveFinite(battlefieldZoom) * positiveFinite(visualScale);

  return {
    width: Math.max(1, cardSize.width * scale),
    height: Math.max(1, cardSize.height * scale),
  };
}

export function resolveBattlefieldContentRect(element: HTMLElement): BattlefieldContentRect {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const borderLeft = cssPixels(style.borderLeftWidth);
  const borderTop = cssPixels(style.borderTopWidth);
  const paddingLeft = cssPixels(style.paddingLeft);
  const paddingRight = cssPixels(style.paddingRight);
  const paddingTop = cssPixels(style.paddingTop);
  const paddingBottom = cssPixels(style.paddingBottom);
  const innerWidth = element.clientWidth || Math.max(0, bounds.width - borderLeft - cssPixels(style.borderRightWidth));
  const innerHeight = element.clientHeight || Math.max(0, bounds.height - borderTop - cssPixels(style.borderBottomWidth));

  return {
    left: bounds.left + borderLeft + paddingLeft,
    top: bounds.top + borderTop + paddingTop,
    width: Math.max(0, innerWidth - paddingLeft - paddingRight),
    height: Math.max(0, innerHeight - paddingTop - paddingBottom),
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

/** Applies one collectively clamped logical delta and preserves group geometry. */
export function translateRatioPositionGroup(
  positions: readonly GameCardRatioPosition[],
  delta: RatioPositionDelta,
): GameCardRatioPosition[] {
  if (positions.length === 0) {
    return [];
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y));
  const appliedDelta = {
    x: clampFinite(delta.x, -minX, 1 - maxX),
    y: clampFinite(delta.y, -minY, 1 - maxY),
  };

  return positions.map((position) => ({
    x: position.x + appliedDelta.x,
    y: position.y + appliedDelta.y,
    unit: 'ratio',
  }));
}

export function sameBattlefieldPosition(left: GameCardPosition, right: GameCardPosition): boolean {
  const leftUnit = left.unit === 'ratio' ? 'ratio' : 'px';
  const rightUnit = right.unit === 'ratio' ? 'ratio' : 'px';

  return left.x === right.x && left.y === right.y && leftUnit === rightUnit;
}

function availableAxis(containerSize: number, cardSize: number): number {
  return Math.max(1, containerSize - cardSize);
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
