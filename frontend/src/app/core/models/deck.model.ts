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
  cards?: DeckCard[];
}

export interface CommanderValidation {
  valid: boolean;
  errors: string[];
}

