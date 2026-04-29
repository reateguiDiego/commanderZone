import { Card } from '../../../core/models/card.model';
import { DeckCard, DeckSection } from '../../../core/models/deck.model';

export type DeckEditorTab = 'analysis' | 'considering' | 'validation' | 'missing' | 'history';
export type DeckEditorViewMode = 'text' | 'spoiler';

export interface MissingCardItem {
  name: string;
  quantity: number;
  section: DeckSection;
  watched: boolean;
}

export interface MissingSearchResult {
  name: string;
  cards: Card[];
}

export interface ImportStats {
  parsedCards: number;
  importedCards: number;
  missingCards: number;
}

export interface DeckCardGroup {
  id: string;
  title: string;
  cards: DeckCard[];
}

export interface DeckCardColumn {
  id: string;
  groups: DeckCardGroup[];
}

export interface CardPreviewState {
  card: Card;
  imageUrl: string | null;
  top: number;
  left: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

export interface HoverListState {
  title: string;
  items: string[];
  top: number;
  left: number;
}

export interface CardMenuState {
  entryId: string;
  top: number;
  left: number;
  amount: number;
}
