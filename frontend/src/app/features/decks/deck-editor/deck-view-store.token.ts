import { InjectionToken, Signal } from '@angular/core';
import { Card } from '../../../core/models/card.model';
import { DeckCard } from '../../../core/models/deck.model';
import { CardMenuState, CardPreviewState, DeckCardColumn, DeckCardGroup } from '../models/deck-editor.models';

export interface DeckViewToggleFaceOptions {
  readonly updatePreview?: boolean;
}

export interface DeckViewStore {
  readonly cardColumns: Signal<DeckCardColumn[]>;
  readonly cardGroups: Signal<DeckCardGroup[]>;
  readonly cardMenu: Signal<CardMenuState | null>;
  readonly cardPreview: Signal<CardPreviewState | null>;
  toggleGroup(groupId: string): void;
  isGroupCollapsed(groupId: string): boolean;
  deckColorIdentitySymbols(): readonly ('W' | 'U' | 'B' | 'R' | 'G')[];
  displayCardImageUrl(card: Card): string | null;
  ensureCardImages(cards: readonly DeckCard[]): void;
  showCardPreview(event: MouseEvent, card: Card): void;
  moveCardPreview(event: MouseEvent): void;
  hideCardPreview(): void;
  hasAlternateFace(card: Card): boolean;
  displayCardName(card: Card): string;
  displayCardListName(card: Card): string;
  displayCardTypeLine(card: Card): string | null;
  displayCardManaCost(card: Card): string | null;
  shouldShowManaCost(card: Card): boolean;
  toggleCardMenu(event: MouseEvent, entry: DeckCard): void;
  toggleCardFace(event: MouseEvent, card: Card, options?: DeckViewToggleFaceOptions): void;
  resetCardFace(card: Card): boolean;
  isCardInvalidForDeck(card: Card): boolean;
  invalidCardMessage(card: Card): string;
}

export const DECK_VIEW_STORE = new InjectionToken<DeckViewStore>('DECK_VIEW_STORE');
