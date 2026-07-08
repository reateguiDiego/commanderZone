import { ChangeDetectionStrategy, Component, computed, forwardRef, input, signal } from '@angular/core';
import { Card } from '../../../core/models/card.model';
import { DeckCard } from '../../../core/models/deck.model';
import { bestCardFaceImage, bestCardImage } from '../../../shared/utils/card-image';
import { cardDisplayFace, hasAlternateCardFace } from '../../../shared/utils/card-faces';
import { DeckCardSpoilerViewComponent } from '../deck-editor/deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DECK_VIEW_STORE, DeckViewStore, DeckViewToggleFaceOptions } from '../deck-editor/deck-view-store.token';
import { CardMenuState, CardPreviewState, DeckCardColumn, DeckCardGroup } from '../models/deck-editor.models';
import { AdvancedAnalysisCardGridItem } from './deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-card-grid',
  imports: [DeckCardSpoilerViewComponent],
  template: '<app-deck-card-spoiler-view [interactive]="false" [cardClickEnabled]="false" [full]="true" />',
  providers: [
    {
      provide: DECK_VIEW_STORE,
      useExisting: forwardRef(() => AdvancedAnalysisCardGridComponent),
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisCardGridComponent implements DeckViewStore {
  readonly title = input.required<string>();
  readonly cards = input<readonly AdvancedAnalysisCardGridItem[]>([]);
  readonly hiddenCount = input(0);
  readonly defaultCollapsed = input(true);

  readonly cardMenu = signal<CardMenuState | null>(null).asReadonly();
  readonly cardPreview = signal<CardPreviewState | null>(null).asReadonly();
  readonly collapsedGroups = signal<Set<string>>(new Set());
  private readonly expandedGroups = signal<Set<string>>(new Set());
  readonly flippedFaces = signal<Record<string, boolean>>({});
  readonly cardGroups = computed<DeckCardGroup[]>(() => {
    const cards = this.cards().map((item, index) => this.deckCard(item, index));

    return [{
      id: 'advanced-analysis-cards',
      title: this.title(),
      cards,
      quantity: cards.reduce((total, entry) => total + entry.quantity, 0),
      detail: this.hiddenCount() > 0 ? `+${this.hiddenCount()}` : undefined,
    }];
  });
  readonly cardColumns = computed<DeckCardColumn[]>(() => [{
    id: 'advanced-analysis-cards',
    groups: this.cardGroups(),
  }]);

  toggleGroup(groupId: string): void {
    if (this.defaultCollapsed()) {
      const next = new Set(this.expandedGroups());
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      this.expandedGroups.set(next);
      return;
    }

    const next = new Set(this.collapsedGroups());
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.collapsedGroups.set(next);
  }

  isGroupCollapsed(groupId: string): boolean {
    return this.defaultCollapsed()
      ? !this.expandedGroups().has(groupId)
      : this.collapsedGroups().has(groupId);
  }

  deckColorIdentitySymbols(): readonly ('W' | 'U' | 'B' | 'R' | 'G')[] {
    return [];
  }

  displayCardImageUrl(card: Card): string | null {
    return bestCardFaceImage(this.displayCardFace(card)) ?? bestCardImage(card);
  }

  ensureCardImages(_cards: readonly DeckCard[]): void {}

  showCardPreview(_event: MouseEvent, _card: Card): void {}

  moveCardPreview(_event: MouseEvent): void {}

  hideCardPreview(): void {}

  hasAlternateFace(card: Card): boolean {
    return hasAlternateCardFace(card);
  }

  displayCardName(card: Card): string {
    return this.displayCardFace(card)?.name ?? card.name;
  }

  displayCardListName(card: Card): string {
    const detail = card.flavorName?.trim();

    return detail ? `${card.name} · ${detail}` : card.name;
  }

  displayCardTypeLine(card: Card): string | null {
    return this.displayCardFace(card)?.typeLine ?? card.typeLine;
  }

  displayCardManaCost(card: Card): string | null {
    return this.displayCardFace(card)?.manaCost ?? card.manaCost;
  }

  shouldShowManaCost(card: Card): boolean {
    return this.displayCardManaCost(card) !== null;
  }

  toggleCardMenu(_event: MouseEvent, _entry: DeckCard): void {}

  toggleCardFace(event: MouseEvent, card: Card, _options: DeckViewToggleFaceOptions = {}): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const next = { ...this.flippedFaces() };
    next[card.scryfallId] = !next[card.scryfallId];
    this.flippedFaces.set(next);
  }

  resetCardFace(card: Card): boolean {
    if (!this.flippedFaces()[card.scryfallId]) {
      return false;
    }

    const next = { ...this.flippedFaces() };
    delete next[card.scryfallId];
    this.flippedFaces.set(next);

    return true;
  }

  isCardInvalidForDeck(_card: Card): boolean {
    return false;
  }

  invalidCardMessage(_card: Card): string {
    return '';
  }

  private deckCard(item: AdvancedAnalysisCardGridItem, index: number): DeckCard {
    const scryfallId = item.scryfallId?.trim() || item.id;

    return {
      id: item.id,
      quantity: Math.max(1, Math.floor(item.quantity ?? 1)),
      section: 'main',
      card: {
        id: item.id,
        scryfallId,
        name: item.name,
        manaCost: null,
        typeLine: item.imageSource.cardFaces?.[0]?.typeLine ?? null,
        oracleText: null,
        colors: [],
        colorIdentity: [],
        legalities: {},
        imageUris: item.imageSource.imageUris ?? (item.imageUrl ? { normal: item.imageUrl } : {}),
        cardFaces: item.imageSource.cardFaces ? [...item.imageSource.cardFaces] : undefined,
        layout: item.layout ?? (item.imageSource.cardFaces && item.imageSource.cardFaces.length > 1 ? 'transform' : 'normal'),
        commanderLegal: true,
        set: null,
        collectorNumber: String(index + 1),
        flavorName: item.detail?.trim() || null,
      },
    };
  }

  private displayCardFace(card: Card) {
    return cardDisplayFace(card, Boolean(this.flippedFaces()[card.scryfallId]));
  }
}
