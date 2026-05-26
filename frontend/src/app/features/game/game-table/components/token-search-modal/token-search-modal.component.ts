import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CARD_SEARCH_LIMIT, CardsApi } from '../../../../../core/api/cards.api';
import { DecksApi } from '../../../../../core/api/decks.api';
import { Card } from '../../../../../core/models/card.model';
import { DeckToken } from '../../../../../core/models/deck.model';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { filterDistinctCardsByQuery, sanitizeCardSearchQuery } from '../../../../../shared/utils/card-search';

export interface TokenSearchSelection {
  readonly card: Card;
  readonly quantity: number;
}

const MIN_TOKEN_QUANTITY = 1;
const MAX_TOKEN_QUANTITY = 20;

@Component({
  selector: 'app-token-search-modal',
  imports: [FormsModule, LucideAngularModule, AppModalComponent, PrettyScrollDirective],
  templateUrl: './token-search-modal.component.html',
  styleUrl: './token-search-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenSearchModalComponent implements OnChanges, OnDestroy {
  private readonly decksApi = inject(DecksApi);
  private readonly cardsApi = inject(CardsApi);

  readonly deckTokens = signal<DeckToken[]>([]);
  readonly searchResults = signal<Card[]>([]);
  readonly query = signal('');
  readonly loadingDeck = signal(false);
  readonly searching = signal(false);
  readonly error = signal<string | null>(null);
  readonly quantity = signal(MIN_TOKEN_QUANTITY);
  readonly showingSearchResults = computed(() => this.query().trim().length >= 2);
  readonly deckTokenCards = computed(() => {
    const seen = new Set<string>();

    return this.deckTokens()
      .map((entry) => entry.token)
      .filter((card) => {
        if (seen.has(card.scryfallId)) {
          return false;
        }

        seen.add(card.scryfallId);
        return true;
      });
  });
  readonly displayCards = computed(() => this.showingSearchResults()
    ? this.searchResults()
    : this.deckTokenCards());

  @Input() open = false;
  @Input() deckId: string | null = null;
  @Input() pending = false;

  @Output() tokenSelected = new EventEmitter<TokenSearchSelection>();
  @Output() closed = new EventEmitter<void>();

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private searchVersion = 0;
  private loadedDeckId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.resetSearch();
      return;
    }

    if (!this.open) {
      return;
    }

    if (changes['deckId'] || changes['open']) {
      void this.loadDeckTokens();
    }
  }

  ngOnDestroy(): void {
    this.clearSearchTimeout();
  }

  onQueryInput(value: string): void {
    if (this.pending) {
      return;
    }

    const query = sanitizeCardSearchQuery(value);
    this.query.set(query);
    this.clearSearchTimeout();

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      this.error.set(null);
      return;
    }

    this.searching.set(true);
    const version = ++this.searchVersion;
    this.searchTimeout = setTimeout(() => {
      void this.searchTokens(trimmed, version);
    }, 320);
  }

  selectToken(card: Card): void {
    if (this.pending) {
      return;
    }

    this.tokenSelected.emit({ card, quantity: this.quantity() });
  }

  onQuantityInput(value: string | number): void {
    this.quantity.set(this.normalizedQuantity(value));
  }

  adjustQuantity(delta: number): void {
    if (this.pending) {
      return;
    }

    this.quantity.set(this.normalizedQuantity(this.quantity() + delta));
  }

  close(): void {
    if (this.pending) {
      return;
    }

    this.closed.emit();
  }

  imageFor(card: Card): string | null {
    return card.imageUris.normal
      ?? card.imageUris.large
      ?? card.imageUris.small
      ?? card.cardFaces?.[0]?.imageUris.normal
      ?? card.cardFaces?.[0]?.imageUris.large
      ?? card.cardFaces?.[0]?.imageUris.small
      ?? null;
  }

  sourceLabel(card: Card): string | null {
    const source = this.deckTokens().find((entry) => entry.token.scryfallId === card.scryfallId)?.sourceCard.name;

    return source ? `from ${source}` : null;
  }

  private async loadDeckTokens(): Promise<void> {
    const deckId = this.deckId;
    if (!deckId) {
      this.loadedDeckId = null;
      this.deckTokens.set([]);
      return;
    }
    if (this.loadedDeckId === deckId && this.deckTokens().length > 0) {
      return;
    }

    this.loadingDeck.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.decksApi.tokens(deckId));
      if (!this.open || this.deckId !== deckId) {
        return;
      }

      this.loadedDeckId = deckId;
      this.deckTokens.set(response.data);
    } catch {
      if (this.open && this.deckId === deckId) {
        this.deckTokens.set([]);
        this.error.set('No se pudieron cargar los tokens del mazo.');
      }
    } finally {
      if (this.open && this.deckId === deckId) {
        this.loadingDeck.set(false);
      }
    }
  }

  private async searchTokens(query: string, version: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, CARD_SEARCH_LIMIT, { tokenOnly: true }));
      if (version !== this.searchVersion || query !== this.query().trim()) {
        return;
      }

      this.searchResults.set(filterDistinctCardsByQuery(response.data, query));
      this.error.set(null);
    } catch {
      if (version === this.searchVersion) {
        this.searchResults.set([]);
        this.error.set('No se pudo buscar tokens.');
      }
    } finally {
      if (version === this.searchVersion) {
        this.searching.set(false);
      }
    }
  }

  private resetSearch(): void {
    this.query.set('');
    this.searchResults.set([]);
    this.searching.set(false);
    this.error.set(null);
    this.quantity.set(MIN_TOKEN_QUANTITY);
    this.clearSearchTimeout();
  }

  private clearSearchTimeout(): void {
    if (this.searchTimeout === null) {
      return;
    }

    clearTimeout(this.searchTimeout);
    this.searchTimeout = null;
  }

  private normalizedQuantity(value: string | number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return MIN_TOKEN_QUANTITY;
    }

    return Math.max(MIN_TOKEN_QUANTITY, Math.min(MAX_TOKEN_QUANTITY, parsed));
  }
}
