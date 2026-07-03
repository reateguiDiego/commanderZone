import { CardPreviewItem } from './card-preview.model';
import { Card } from './card.model';
import { Deck, DeckCard, DeckVisibility } from './deck.model';
import { UserAvatar, UserDisplayNameStyle } from './user.model';

export interface CommunityDeckSummary {
  id: string;
  publicSlug?: string | null;
  canonicalPath?: string | null;
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
  handle?: string | null;
  canonicalPath?: string | null;
  avatar?: UserAvatar | null;
  displayNameStyle?: UserDisplayNameStyle | null;
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
  isPreview: boolean;
  message: string;
}

export interface CommunityIndexableEntry {
  canonicalPath: string;
  updatedAt: string;
}

export interface CommunityIndexableDeck extends CommunityIndexableEntry {
  id: string;
  slug: string;
}

export interface CommunityIndexableProfile extends CommunityIndexableEntry {
  handle: string;
}

export interface CommunityIndexableCard extends CommunityIndexableEntry {
  slug: string;
}

export interface CommunityIndexable {
  decks: CommunityIndexableDeck[];
  profiles: CommunityIndexableProfile[];
  commanders: CommunityIndexableCard[];
  cards: CommunityIndexableCard[];
}

export interface CommunityProfile {
  handle: string;
  canonicalPath: string;
  displayName: string;
  avatar: UserAvatar | null;
  decks: CommunityDeckSummary[];
}

export interface CommunityDiscoveryDetail {
  item: CardPreviewItem;
  decks: CommunityDeckSummary[];
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
