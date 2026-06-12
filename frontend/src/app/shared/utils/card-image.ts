import { Card, CardFace, CardImageUris } from '../../core/models/card.model';

type CardFaceImageSource = CardFace & {
  image_uris?: CardImageUris | null;
};

export function bestCardImage(card: Card | null | undefined): string | null {
  return bestImageUri(card?.imageUris) ?? bestCardFaceImage(card?.cardFaces?.[0]);
}

export function bestCardArtImage(card: Card | null | undefined): string | null {
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

  return imageUris.normal ?? imageUris.large ?? imageUris.small ?? imageUris.png ?? null;
}

function bestArtImageUri(imageUris: CardImageUris | null | undefined): string | null {
  if (!imageUris) {
    return null;
  }

  return imageUris.art_crop ?? imageUris.border_crop ?? imageUris.large ?? imageUris.normal ?? null;
}
