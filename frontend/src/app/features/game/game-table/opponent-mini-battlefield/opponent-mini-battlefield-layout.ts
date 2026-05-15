import { GameCardInstance } from '../../../../core/models/game.model';
import { DEFAULT_BATTLEFIELD_SIZE, renderedBattlefieldPosition } from '../battlefield-position';

export interface MiniBattlefieldSize {
  width: number;
  height: number;
}

export interface MiniBattlefieldCardLayout {
  instanceId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MiniBattlefieldLayoutOptions {
  boardSize?: MiniBattlefieldSize;
  getPosition?: (card: GameCardInstance) => { x: number; y: number } | null;
}

const CARD_WIDTH = 100;
const CARD_HEIGHT = 140;
const DEFAULT_BATTLEFIELD_WIDTH = 900;
const DEFAULT_BATTLEFIELD_HEIGHT = 520;
const FALLBACK_GAP_X = 122;
const FALLBACK_GAP_Y = 156;
const VIEWPORT_PADDING = 8;
const MAX_CARD_HEIGHT = 96;
const EDGE_USAGE_THRESHOLD = 0.78;

interface LogicalCardPlacement {
  card: GameCardInstance;
  x: number;
  y: number;
  hasBoardPosition: boolean;
}

interface LogicalBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LayoutFrame {
  bounds: LogicalBounds;
  preserveBoardSpace: boolean;
}

export function layoutOpponentMiniBattlefield(
  cards: readonly GameCardInstance[],
  viewport: MiniBattlefieldSize,
  options: MiniBattlefieldLayoutOptions = {},
): MiniBattlefieldCardLayout[] {
  if (cards.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return [];
  }

  const placements = cards.map((card, index) => logicalCardPlacement(card, index, cards.length, options));
  const frame = layoutFrame(placements, options.boardSize);
  const bounds = frame.bounds;
  const contentWidth = Math.max(1, bounds.right - bounds.left);
  const contentHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, viewport.width - VIEWPORT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - VIEWPORT_PADDING * 2);
  const fitScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  const maxScale = Math.min(1, MAX_CARD_HEIGHT / CARD_HEIGHT, availableHeight / CARD_HEIGHT);
  const cardScale = Math.max(0.01, Math.min(fitScale, maxScale));
  const cardWidth = CARD_WIDTH * cardScale;
  const cardHeight = CARD_HEIGHT * cardScale;

  if (!frame.preserveBoardSpace) {
    const scaledWidth = contentWidth * cardScale;
    const scaledHeight = contentHeight * cardScale;
    const offsetX = (viewport.width - scaledWidth) / 2 - bounds.left * cardScale;
    const offsetY = (viewport.height - scaledHeight) / 2 - bounds.top * cardScale;

    return placements.map(({ card, x, y }) => ({
      instanceId: card.instanceId,
      left: roundPixel(x * cardScale + offsetX),
      top: roundPixel(y * cardScale + offsetY),
      width: roundPixel(cardWidth),
      height: roundPixel(cardHeight),
    }));
  }

  const xScale = positionScale(availableWidth, contentWidth, cardWidth, CARD_WIDTH);
  const yScale = positionScale(availableHeight, contentHeight, cardHeight, CARD_HEIGHT);
  const minLeft = VIEWPORT_PADDING;
  const minTop = VIEWPORT_PADDING;
  const maxLeft = VIEWPORT_PADDING + Math.max(0, availableWidth - cardWidth);
  const maxTop = VIEWPORT_PADDING + Math.max(0, availableHeight - cardHeight);

  return placements.map(({ card, x, y }) => ({
    instanceId: card.instanceId,
    left: roundPixel(clamp(minLeft + (x - bounds.left) * xScale, minLeft, maxLeft)),
    top: roundPixel(clamp(minTop + (y - bounds.top) * yScale, minTop, maxTop)),
    width: roundPixel(cardWidth),
    height: roundPixel(cardHeight),
  }));
}

function logicalCardPlacement(
  card: GameCardInstance,
  index: number,
  total: number,
  options: MiniBattlefieldLayoutOptions,
): LogicalCardPlacement {
  const position = card.position?.unit === 'ratio'
    ? defaultPosition(card, options.boardSize)
    : options.getPosition?.(card) ?? defaultPosition(card, options.boardSize);
  if (position) {
    return { card, x: position.x, y: position.y, hasBoardPosition: true };
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(total * 1.35)));

  return {
    card,
    x: (index % columns) * FALLBACK_GAP_X,
    y: Math.floor(index / columns) * FALLBACK_GAP_Y,
    hasBoardPosition: false,
  };
}

function defaultPosition(card: GameCardInstance, boardSize: MiniBattlefieldSize | undefined): { x: number; y: number } | null {
  return renderedBattlefieldPosition(
    card.position,
    boardSize ?? DEFAULT_BATTLEFIELD_SIZE,
    { width: CARD_WIDTH, height: CARD_HEIGHT },
  );
}

function layoutFrame(placements: LogicalCardPlacement[], boardSize: MiniBattlefieldSize | undefined): LayoutFrame {
  const bounds = mergeBounds(placements.map(visualBounds));
  const shouldPreserveBoardSpace = placements.some((placement) => placement.hasBoardPosition);
  if (!shouldPreserveBoardSpace) {
    return { bounds, preserveBoardSpace: false };
  }

  const boardWidth = positiveSize(boardSize?.width, DEFAULT_BATTLEFIELD_WIDTH);
  const boardHeight = positiveSize(boardSize?.height, DEFAULT_BATTLEFIELD_HEIGHT);
  const right = effectiveBoardEdge(bounds.right, boardWidth);
  const bottom = effectiveBoardEdge(bounds.bottom, boardHeight);

  return {
    preserveBoardSpace: true,
    bounds: {
      left: Math.min(0, bounds.left),
      top: Math.min(0, bounds.top),
      right: Math.max(CARD_WIDTH, right),
      bottom: Math.max(CARD_HEIGHT, bottom),
    },
  };
}

function effectiveBoardEdge(occupiedEdge: number, measuredEdge: number): number {
  if (occupiedEdge <= 0 || occupiedEdge >= measuredEdge) {
    return Math.max(measuredEdge, occupiedEdge);
  }

  return occupiedEdge / measuredEdge >= EDGE_USAGE_THRESHOLD ? occupiedEdge : measuredEdge;
}

function visualBounds({ card, x, y }: LogicalCardPlacement): LogicalBounds {
  if (!card.tapped) {
    return { left: x, top: y, right: x + CARD_WIDTH, bottom: y + CARD_HEIGHT };
  }

  const centerX = x + CARD_WIDTH / 2;
  const centerY = y + CARD_HEIGHT / 2;
  const tappedWidth = CARD_HEIGHT;
  const tappedHeight = CARD_WIDTH;

  return {
    left: centerX - tappedWidth / 2,
    top: centerY - tappedHeight / 2,
    right: centerX + tappedWidth / 2,
    bottom: centerY + tappedHeight / 2,
  };
}

function mergeBounds(bounds: LogicalBounds[]): LogicalBounds {
  return bounds.reduce<LogicalBounds>(
    (current, next) => ({
      left: Math.min(current.left, next.left),
      top: Math.min(current.top, next.top),
      right: Math.max(current.right, next.right),
      bottom: Math.max(current.bottom, next.bottom),
    }),
    { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
  );
}

function roundPixel(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveSize(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

function positionScale(availableSize: number, contentSize: number, renderedCardSize: number, logicalCardSize: number): number {
  const sourceRange = Math.max(1, contentSize - logicalCardSize);
  const targetRange = Math.max(0, availableSize - renderedCardSize);

  return targetRange / sourceRange;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
