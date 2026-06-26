import { CardPreviewItem } from './card-preview.model';
import { Card } from './card.model';
import { Deck, DeckCard, DeckVisibility } from './deck.model';

export interface CommunityDeckSummary {
  id: string;
  name: string;
  format: 'commander' | string;
  valid: boolean;
  cropImage: string | null;
  secondaryCropImage?: string | null;
  commanderName: string | null;
  colorIdentity: string[];
  updatedAt: string;
}

export interface CommunityDeckOwner {
  displayName: string;
}

export interface CommunityDeckSections {
  commander: DeckCard[];
  main: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
}

export interface CommunityDeckDetail extends CommunityDeckSummary {
  visibility: DeckVisibility;
  backgroundName?: string;
  sleevesName?: string;
  folderId: string | null;
  commanders: Card[];
  cards: DeckCard[];
  sections: CommunityDeckSections;
  owner: CommunityDeckOwner;
}

export interface CommunityHome {
  commanders: CardPreviewItem[];
  cards: CardPreviewItem[];
  decks: CommunityDeckSummary[];
}

export interface CommunityPreviewCards {
  items: CardPreviewItem[];
  total: number;
  isPreview: true;
  message: string;
}

export function toDeckCardListItem(summary: CommunityDeckSummary): Deck {
  return {
    id: summary.id,
    name: summary.name,
    format: summary.format,
    valid: summary.valid,
    visibility: 'public',
    folderId: null,
    cards: [],
  };
}
