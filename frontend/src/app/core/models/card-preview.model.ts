import type { CardFace, CardImageUris } from './card.model';
import type { ManaColor } from '../../shared/mana/mana-symbol.service';

export interface CardPreviewItem {
  id: string;
  scryfallId: string;
  name: string;
  cropImage: string | null;
  imageUris?: CardImageUris | null;
  cardFaces?: readonly CardFace[] | null;
  colors?: readonly ManaColor[];
  cardType?: string | null;
  cardTypeIcon?: string | null;
  timesPlayed?: number;
  label?: string;
  rank?: number;
}
