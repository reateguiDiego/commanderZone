import { Card } from '../../core/models/card.model';

export function bestCardImage(card: Card | null | undefined): string | null {
  if (!card?.imageUris) {
    return null;
  }

  return card.imageUris.normal ?? card.imageUris.large ?? card.imageUris.small ?? card.imageUris.png ?? null;
}

