import type { CardFace } from '../../../../core/models/card.model';
import { GameCardInstance } from '../../../../core/models/game.model';

export type VentureCardKind = 'venture' | 'initiative';

type VentureCardText = Pick<GameCardInstance, 'oracleText' | 'cardFaces'> | null | undefined;

export function ventureCardKind(card: VentureCardText): VentureCardKind | null {
  const texts = cardTexts(card);

  if (texts.some(hasInitiativeText)) {
    return 'initiative';
  }

  return texts.some(hasVentureText) ? 'venture' : null;
}

function cardTexts(card: VentureCardText): string[] {
  if (!card) {
    return [];
  }

  return [
    card.oracleText,
    ...(card.cardFaces ?? []).map((face: CardFace) => face.oracleText),
  ]
    .filter((text): text is string => typeof text === 'string')
    .map((text) => normalizedOracleText(text))
    .filter((text) => text.length > 0);
}

function normalizedOracleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasInitiativeText(text: string): boolean {
  return /\b(?:take|takes) the initiative\b/.test(text);
}

function hasVentureText(text: string): boolean {
  return /\bventure into the dungeon\b/.test(text);
}
