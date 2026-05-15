import { GameCardPosition, GameCardRatioPosition } from '../../../core/models/game.model';

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

  return {
    x: Math.round(clampRatio(position.x) * availableAxis(battlefieldSize.width, cardSize.width)),
    y: Math.round(clampRatio(position.y) * availableAxis(battlefieldSize.height, cardSize.height)),
  };
}

export function ratioBattlefieldPosition(
  position: BattlefieldPixelPosition,
  battlefieldSize: BattlefieldSize = DEFAULT_BATTLEFIELD_SIZE,
  cardSize: BattlefieldCardSize = DEFAULT_BATTLEFIELD_CARD_SIZE,
): GameCardRatioPosition {
  return {
    x: roundRatio(position.x / availableAxis(battlefieldSize.width, cardSize.width)),
    y: roundRatio(position.y / availableAxis(battlefieldSize.height, cardSize.height)),
    unit: 'ratio',
  };
}

export function sameBattlefieldPosition(left: GameCardPosition, right: GameCardPosition): boolean {
  return left.x === right.x && left.y === right.y && (left.unit ?? 'pixel') === (right.unit ?? 'pixel');
}

function availableAxis(containerSize: number, cardSize: number): number {
  return Math.max(1, Math.round(containerSize - cardSize));
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function roundRatio(value: number): number {
  return Math.round(clampRatio(value) * 1_000_000) / 1_000_000;
}
