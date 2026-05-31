import { CardFace } from '../../../../core/models/card.model';
import { GameCardInstance } from '../../../../core/models/game.model';

export function hasAlternateFaceContent(card: GameCardInstance, activeFaceIndex = activeCardFaceIndex(card)): boolean {
  const nextFaceIndex = nextCardFaceIndex(card, activeFaceIndex);

  return nextFaceIndex !== null && cardFaceHasContent(card.cardFaces?.[nextFaceIndex]);
}

export function nextCardFaceIndex(card: GameCardInstance, activeFaceIndex = activeCardFaceIndex(card)): number | null {
  const faceCount = card.cardFaces?.length ?? 0;
  if (faceCount < 2) {
    return null;
  }

  return (Math.max(0, Math.min(faceCount - 1, activeFaceIndex)) + 1) % faceCount;
}

export function activeCardFaceIndex(card: GameCardInstance): number {
  return Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;
}

function cardFaceHasContent(face: CardFace | null | undefined): boolean {
  if (!face) {
    return false;
  }

  return Boolean(
    face.name?.trim()
    || face.typeLine?.trim()
    || face.oracleText?.trim()
    || face.manaCost?.trim()
    || face.power?.trim()
    || face.toughness?.trim()
    || face.loyalty?.trim()
    || Object.values(face.imageUris ?? {}).some((value) => value?.trim()),
  );
}
