import { CardFace, CardImageUris } from '../../core/models/card.model';
import { bestCardFaceImage, bestCardFaceThumbnailImage, bestCardImage, bestCardThumbnailImage } from './card-image';

export type CardFaceImageResolution = 'small' | 'normal';

export interface CardFaceImageSource {
  readonly name: string;
  readonly imageUris?: CardImageUris | null;
  readonly cardFaces?: readonly CardFace[] | null;
}

export function hasAlternateCardFace(card: CardFaceImageSource | null | undefined): boolean {
  const faces = card?.cardFaces ?? [];
  const secondFaceImage = bestCardFaceImage(faces[1]);

  return faces.length > 1 && secondFaceImage !== null && secondFaceImage.trim().length > 0;
}

export function cardDisplayFace(card: CardFaceImageSource | null | undefined, flipped: boolean): CardFace | null {
  const faces = card?.cardFaces ?? [];
  if (faces.length < 2) {
    return null;
  }

  return faces[flipped ? 1 : 0] ?? null;
}

export function cardFaceImage(
  card: CardFaceImageSource | null | undefined,
  flipped: boolean,
  resolution: CardFaceImageResolution = 'normal',
): string | null {
  if (!card) {
    return null;
  }

  const imageForFace = resolution === 'small' ? bestCardFaceThumbnailImage : bestCardFaceImage;

  if (!flipped) {
    return (resolution === 'small' ? bestCardThumbnailImage(card) : bestCardImage(card)) ?? imageForFace(card.cardFaces?.[0]);
  }

  return imageForFace(card.cardFaces?.[1]);
}
