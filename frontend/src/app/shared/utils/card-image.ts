import { Card, CardFace, CardImageUris } from '../../core/models/card.model';

export function bestCardImage(card: Card | null | undefined): string | null {
  return bestImageUri(card?.imageUris);
}

export function bestCardFaceImage(face: CardFace | null | undefined): string | null {
  return bestImageUri(face?.imageUris);
}

function bestImageUri(imageUris: CardImageUris | null | undefined): string | null {
  if (!imageUris) {
    return null;
  }

  return imageUris.normal ?? imageUris.large ?? imageUris.small ?? imageUris.png ?? null;
}
