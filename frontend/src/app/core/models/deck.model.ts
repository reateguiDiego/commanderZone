import { Card } from './card.model';

export type DeckSection = 'main' | 'commander' | 'sideboard' | 'maybeboard';
export type DeckVisibility = 'private' | 'public';
export type DeckFolderVisibility = DeckVisibility;

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
  visibility?: DeckVisibility;
  folderId: string | null;
  cards?: DeckCard[];
}

export interface DeckSections {
  commander: DeckCard[];
  main: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
  tokens: DeckToken[];
}

export interface DeckSectionCounts {
  commander: number;
  main: number;
  sideboard: number;
  maybeboard: number;
  tokens: number;
  playableTotal: number;
}

export interface DeckSectionsResponse {
  deckId: string;
  sections: DeckSections;
  counts: DeckSectionCounts;
}

export interface DeckTokenSource {
  scryfallId: string;
  name: string;
  section: DeckSection;
}

export interface DeckToken {
  sourceCard: DeckTokenSource;
  token: Card;
  resolved: true;
}

export interface UnresolvedDeckToken {
  sourceCard: DeckTokenSource;
  token: {
    scryfallId: string;
    name: string;
    uri: string | null;
  };
  resolved: false;
}

export interface DeckTokensResponse {
  deckId: string;
  data: DeckToken[];
  unresolved: UnresolvedDeckToken[];
}

export interface DeckFolder {
  id: string;
  name: string;
  visibility?: DeckFolderVisibility;
}

export interface DeckFormat {
  id: string;
  name: string;
  minCards: number;
  maxCards: number;
  hasCommander: boolean;
}

export interface CommanderValidationEntry {
  code: string;
  title: string;
  detail: string;
  cards: string[];
}

export interface CommanderValidationCounts {
  total: number;
  commander: number;
  main: number;
  sideboard: number;
  maybeboard: number;
}

export interface CommanderValidationCommander {
  mode: 'single' | 'pair' | 'invalid';
  names: string[];
  colorIdentity: string[];
}

export interface CommanderValidation {
  valid: boolean;
  format: 'commander' | string;
  counts: CommanderValidationCounts;
  commander: CommanderValidationCommander;
  errors: CommanderValidationEntry[];
  warnings: CommanderValidationEntry[];
}
