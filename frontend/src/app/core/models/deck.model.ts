import { Card } from './card.model';

export type DeckSection = 'main' | 'commander';

export interface DeckCard {
  id: string;
  quantity: number;
  section: DeckSection;
  card: Card;
}

export interface Deck {
  id: string;
  name: string;
  format: 'commander' | string;
  folderId: string | null;
  cards?: DeckCard[];
}

export interface DeckFolder {
  id: string;
  name: string;
}

export interface CommanderValidation {
  valid: boolean;
  errors: string[];
}
