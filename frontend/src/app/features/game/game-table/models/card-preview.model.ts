import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface CardPreviewSourceRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export const CARD_PREVIEW_HOVER_DELAY_MS = 100;

export interface CardPreviewEvent {
  readonly card: GameCardInstance;
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly sourceRect: CardPreviewSourceRect | null;
}

export function previewRectFromElement(element: Element | null): CardPreviewSourceRect | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}
