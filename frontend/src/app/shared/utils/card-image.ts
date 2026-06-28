import { Card, CardFace, CardImageUris } from '../../core/models/card.model';

type CardFaceImageSource = CardFace & {
  image_uris?: CardImageUris | null;
};

type CardImageSource = {
  imageUris?: CardImageUris | null;
  cardFaces?: CardFace[] | null;
};

export function bestCardImage<T extends CardImageSource>(card: T | null | undefined): string | null {
  return bestImageUri(card?.imageUris) ?? bestCardFaceImage(card?.cardFaces?.[0]);
}

export function bestCardArtImage<T extends CardImageSource>(card: T | null | undefined): string | null {
  return bestArtImageUri(card?.imageUris) ?? bestCardFaceArtImage(card?.cardFaces?.[0]) ?? bestCardImage(card);
}

export function bestCardFaceImage(face: CardFaceImageSource | null | undefined): string | null {
  return bestImageUri(face?.imageUris) ?? bestImageUri(face?.image_uris);
}

function bestCardFaceArtImage(face: CardFaceImageSource | null | undefined): string | null {
  return bestArtImageUri(face?.imageUris) ?? bestArtImageUri(face?.image_uris);
}

function bestImageUri(imageUris: CardImageUris | null | undefined): string | null {
  if (!imageUris) {
    return null;
  }

  return firstImageUri(imageUris.normal, imageUris.large, imageUris.small, imageUris.png);
}

function bestArtImageUri(imageUris: CardImageUris | null | undefined): string | null {
  if (!imageUris) {
    return null;
  }

  return firstImageUri(imageUris.art_crop, imageUris.border_crop, imageUris.large, imageUris.normal);
}

function firstImageUri(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}
