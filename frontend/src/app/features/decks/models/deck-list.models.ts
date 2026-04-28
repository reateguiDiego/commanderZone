import { Deck } from '../../../core/models/deck.model';

export interface DeckFolderSection {
  id: string | null;
  name: string;
  decks: Deck[];
  isUnfiled: boolean;
}
