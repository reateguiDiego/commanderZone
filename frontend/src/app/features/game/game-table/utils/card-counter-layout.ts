import { type GameTableResponsiveState } from './game-table-responsive-state';

export type CardCounterRelationRole = 'independent' | 'attachment' | 'stack-root' | 'stack-member';
export type CardCounterOrientation = 'vertical' | 'grid';
export type CardCounterLabelMode = 'full' | 'abbreviated' | 'accessible-only';

export interface CardCounterAvailableRect {
  readonly width: number;
  readonly height: number;
}

export interface CardCounterLayoutInput {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly counterCount: number;
  readonly responsiveState: GameTableResponsiveState;
  readonly tapped: boolean;
  readonly relationRole: CardCounterRelationRole;
  readonly availableRect: CardCounterAvailableRect;
}

export interface CardCounterLayout {
  readonly orientation: CardCounterOrientation;
  readonly rows: number;
  readonly columns: number;
  readonly badgeSize: number;
  readonly hitSize: number;
  readonly gap: number;
  readonly fontSize: number;
  readonly labelMode: CardCounterLabelMode;
  readonly overflowStrategy: 'contained-grid';
  readonly zIndex: number;
}

const STATE_DENSITY: Readonly<Record<GameTableResponsiveState, number>> = {
  normal: 1,
  compact: 0.92,
  aggressive: 0.84,
  minimal: 0.76,
};

export function resolveCardCounterLayout(input: CardCounterLayoutInput): CardCounterLayout {
  const count = Math.max(0, Math.trunc(finiteOr(input.counterCount, 0)));
  const rawWidth = Math.max(1, finiteOr(input.cardWidth, 116));
  const rawHeight = Math.max(1, finiteOr(input.cardHeight, 162));
  const cardWidth = input.tapped ? rawHeight : rawWidth;
  const cardHeight = input.tapped ? rawWidth : rawHeight;
  const availableWidth = Math.max(1, Math.min(cardWidth, finiteOr(input.availableRect.width, cardWidth)));
  const availableHeight = Math.max(1, Math.min(cardHeight, finiteOr(input.availableRect.height, cardHeight)));
  const density = STATE_DENSITY[input.responsiveState];
  const hitSize = round(clamp(availableWidth * 0.23 * density, 22, 31));
  const badgeSize = round(clamp(hitSize * 0.78, 18, 25));
  const gap = round(clamp(availableWidth * 0.022 * density, 2, 4));
  const requiredVerticalHeight = count * hitSize + Math.max(0, count - 1) * gap + 8;
  const relationNeedsGrid = input.relationRole === 'stack-member';
  const stateNeedsGrid = input.responsiveState === 'aggressive' || input.responsiveState === 'minimal';
  const orientation: CardCounterOrientation = count > 3
    && (requiredVerticalHeight > availableHeight || stateNeedsGrid || relationNeedsGrid)
    ? 'grid'
    : 'vertical';
  const rows = Math.max(1, orientation === 'vertical' ? count || 1 : Math.min(3, count || 1));
  const columns = Math.max(1, Math.ceil(Math.max(1, count) / rows));
  const labelMode: CardCounterLabelMode = orientation === 'grid'
    ? input.responsiveState === 'minimal' || availableWidth < 72
      ? 'accessible-only'
      : 'abbreviated'
    : availableWidth >= 104 && input.responsiveState === 'normal'
      ? 'full'
      : 'abbreviated';

  return {
    orientation,
    rows,
    columns,
    badgeSize,
    hitSize,
    gap,
    fontSize: round(clamp(badgeSize * 0.44, 9, 12.5)),
    labelMode,
    overflowStrategy: 'contained-grid',
    zIndex: input.relationRole === 'stack-member' ? 14 : input.relationRole === 'independent' ? 10 : 12,
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
