import { GameCardInstance } from '../../../../core/models/game.model';
import { bestCardFaceImage } from '../../../../shared/utils/card-image';
import { isTheRingCard } from './gameplay-card-kind';

const UNDERCITY_INITIATIVE_FACE_NAMES = ['undercity', 'the initiative'] as const;

export function hasAlternateFace(card: GameCardInstance): boolean {
  const faces = card.cardFaces ?? [];
  const secondFaceImage = bestCardFaceImage(faces[1]);

  return faces.length > 1 && secondFaceImage !== null && secondFaceImage.trim().length > 0;
}

export function canShowAlternateFaceToggle(card: GameCardInstance): boolean {
  return hasAlternateFace(card)
    && !isUndercityInitiativeDoubleFacePair(card)
    && !isTheRingCard(card);
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

function isUndercityInitiativeDoubleFacePair(card: GameCardInstance): boolean {
  const faces = card.cardFaces ?? [];
  if (faces.length < 2) {
    return false;
  }

  const names = faces
    .map((face) => face.name?.trim().toLowerCase() ?? '')
    .filter((name) => name.length > 0);

  return UNDERCITY_INITIATIVE_FACE_NAMES.every((name) => names.includes(name));
}
