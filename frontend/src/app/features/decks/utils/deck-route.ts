import { Deck } from '../../../core/models/deck.model';

export function deckEditorIdentifier(deck: Pick<Deck, 'id' | 'slug'>): string {
  return deck.slug?.trim() || deck.id;
}
