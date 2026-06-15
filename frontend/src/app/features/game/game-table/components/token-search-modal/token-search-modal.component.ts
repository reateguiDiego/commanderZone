import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
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
import { GameXQuantityStepperComponent } from '../game-x-quantity-stepper/game-x-quantity-stepper.component';

export type GameplayCardSearchKind = 'token' | 'emblem' | 'dungeon';

export type GameplayCardSearchSelection =
  | { readonly kind: 'token'; readonly card: Card; readonly quantity: number }
  | { readonly kind: 'emblem' | 'dungeon'; readonly card: Card };

const MIN_TOKEN_QUANTITY = 1;
const MAX_TOKEN_QUANTITY = 20;
const SEARCH_DEBOUNCE_MS = 320;

@Component({
  selector: 'app-token-search-modal',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, AppModalComponent, PrettyScrollDirective, GameXQuantityStepperComponent],
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
  readonly showingDeckTokens = computed(() => this.kind === 'token' && !this.showingSearchResults());
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
    : this.kind === 'token'
      ? this.deckTokenCards()
      : this.searchResults());

  @Input() open = false;
  @Input() kind: GameplayCardSearchKind = 'token';
  @Input() deckId: string | null = null;
  @Input() pending = false;

  @Output() cardSelected = new EventEmitter<GameplayCardSearchSelection>();
  @Output() closed = new EventEmitter<void>();

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private searchVersion = 0;
  private loadedDeckId: string | null = null;
  private readonly gameplayCatalog: Record<'emblem' | 'dungeon', Card[]> = {
    emblem: [],
    dungeon: [],
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.resetSearch();
      return;
    }

    if (!this.open) {
      return;
    }

    if (changes['kind']) {
      this.resetSearch();
    }

    if (this.kind === 'token' && (changes['deckId'] || changes['open'] || changes['kind'])) {
      void this.loadDeckTokens();
      return;
    }

    if (this.kind !== 'token' && (changes['open'] || changes['kind'])) {
      void this.loadGameplayCatalog(this.kind);
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
    const version = ++this.searchVersion;
    if (trimmed.length < 2) {
      if (this.kind === 'token') {
        this.searchResults.set([]);
        this.searching.set(false);
        this.error.set(null);
        return;
      }

      const kind = this.kind;
      this.error.set(null);
      if (trimmed.length === 1) {
        this.searchResults.set(this.gameplayCatalog[kind]);
        this.searching.set(false);
        return;
      }

      this.searching.set(true);
      this.searchTimeout = setTimeout(() => {
        void this.searchGameplayCards('', version, kind, false);
      }, SEARCH_DEBOUNCE_MS);
      return;
    }

    this.searching.set(true);
    this.error.set(null);
    this.searchTimeout = setTimeout(() => {
      if (this.kind === 'token') {
        void this.searchTokens(trimmed, version);
        return;
      }

      void this.searchGameplayCards(trimmed, version, this.kind, true);
    }, SEARCH_DEBOUNCE_MS);
  }

  selectCard(card: Card): void {
    if (this.pending) {
      return;
    }

    if (this.kind === 'token') {
      this.cardSelected.emit({ kind: 'token', card, quantity: this.quantity() });
      return;
    }

    this.cardSelected.emit({ kind: this.kind, card });
  }

  onQuantityInput(value: string | number): void {
    this.quantity.set(this.normalizedQuantity(value));
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
    if (this.kind !== 'token') {
      return null;
    }

    const source = this.deckTokens().find((entry) => entry.token.scryfallId === card.scryfallId)?.sourceCard.name;

    return source ? `from ${source}` : null;
  }

  modalTitle(): string {
    return this.kind === 'token'
      ? 'Create token'
      : this.kind === 'emblem'
        ? 'Add emblem'
        : 'Add dungeon';
  }

  searchPlaceholder(): string {
    return this.kind === 'token'
      ? 'Search tokens'
      : this.kind === 'emblem'
        ? 'Search emblems'
        : 'Search dungeons';
  }

  resultsLabel(): string {
    const count = this.displayCards().length;
    if (this.kind === 'token') {
      return this.showingDeckTokens()
        ? `${this.deckTokenCards().length} deck tokens`
        : `${count} token results`;
    }

    return `${count} ${this.kind} results`;
  }

  emptyStateLabel(): string {
    if (this.kind === 'token') {
      return this.showingSearchResults() ? 'No tokens found.' : 'This deck has no detected tokens.';
    }

    return this.kind === 'emblem' ? 'No emblems found.' : 'No dungeons found.';
  }

  addButtonLabel(card: Card): string {
    return this.kind === 'token'
      ? `Create ${this.quantity()} ${card.name}`
      : `Add ${card.name}`;
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

  private loadGameplayCatalog(kind: 'emblem' | 'dungeon'): void {
    this.searching.set(true);
    void this.searchGameplayCards('', ++this.searchVersion, kind, false);
  }

  private async searchGameplayCards(
    query: string,
    version: number,
    kind: 'emblem' | 'dungeon',
    fallbackToCatalog: boolean,
  ): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, CARD_SEARCH_LIMIT, { gameplayKind: kind }));
      if (this.isStaleGameplaySearch(version, query, kind)) {
        return;
      }

      let results = filterDistinctCardsByQuery(response.data, query);
      if (fallbackToCatalog && results.length === 0) {
        const fallbackResponse = await firstValueFrom(this.cardsApi.search('', 1, CARD_SEARCH_LIMIT, { gameplayKind: kind }));
        if (this.isStaleGameplaySearch(version, query, kind)) {
          return;
        }

        results = filterDistinctCardsByQuery(fallbackResponse.data, '');
        this.gameplayCatalog[kind] = results;
      }

      if (query === '') {
        this.gameplayCatalog[kind] = results;
      }
      this.searchResults.set(results);
      this.error.set(null);
    } catch {
      if (version === this.searchVersion) {
        this.searchResults.set([]);
        this.error.set(`Could not load ${kind}s.`);
      }
    } finally {
      if (version === this.searchVersion) {
        this.searching.set(false);
      }
    }
  }

  private isStaleGameplaySearch(version: number, query: string, kind: 'emblem' | 'dungeon'): boolean {
    const currentQuery = this.query().trim();
    const queryMatches = query === ''
      ? currentQuery.length === 0
      : query === currentQuery;

    return version !== this.searchVersion || !queryMatches || this.kind !== kind;
  }

  private resetSearch(): void {
    this.searchVersion++;
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
