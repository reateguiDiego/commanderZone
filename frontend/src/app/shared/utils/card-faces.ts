import { Card, CardFace } from '../../core/models/card.model';
import { bestCardFaceImage, bestCardImage } from './card-image';

export function hasAlternateCardFace(card: Card | null | undefined): boolean {
  const faces = card?.cardFaces ?? [];
  const secondFaceImage = bestCardFaceImage(faces[1]);

  return faces.length > 1 && secondFaceImage !== null && secondFaceImage.trim().length > 0;
}

export function cardDisplayFace(card: Card | null | undefined, flipped: boolean): CardFace | null {
  const faces = card?.cardFaces ?? [];
  if (faces.length < 2) {
    return null;
  }

  return faces[flipped ? 1 : 0] ?? null;
}

export function cardFaceImage(card: Card | null | undefined, flipped: boolean): string | null {
  if (!card) {
    return null;
  }

  if (!flipped) {
    return bestCardImage(card) ?? bestCardFaceImage(card.cardFaces?.[0]);
  }

  return bestCardFaceImage(card.cardFaces?.[1]);
}

export function readableCardFaceImage(card: Card | null | undefined, flipped: boolean): string | null {
  if (!card) {
    return null;
  }

  if (!flipped) {
    return readableImageUri(card.imageUris) ?? bestCardImage(card) ?? bestCardFaceImage(card.cardFaces?.[0]);
  }

  return readableImageUri(card.cardFaces?.[1]?.imageUris) ?? bestCardFaceImage(card.cardFaces?.[1]);
}

function readableImageUri(imageUris: Card['imageUris'] | null | undefined): string | null {
  if (!imageUris) {
    return null;
  }

  return imageUris.large ?? imageUris.png ?? imageUris.normal ?? imageUris.small ?? null;
}
