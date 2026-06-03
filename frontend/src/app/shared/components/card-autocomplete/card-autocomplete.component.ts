import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi, CardSearchFilters } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { PrettyScrollDirective } from '../../ui/pretty-scroll/pretty-scroll.directive';
import { isCommanderCandidate } from '../../utils/commander-candidate';
import { filterDistinctCardsByQuery, sanitizeCardSearchQuery } from '../../utils/card-search';
import { isEmblemCard, isSchemeCard, isTokenCard } from '../../utils/token-card';

const AUTOCOMPLETE_SEARCH_LIMIT = 40;

export interface CardAutocompleteSelection {
  card: Card;
  quantity: number;
}

@Component({
  selector: 'app-card-autocomplete',
  imports: [FormsModule, LucideAngularModule, ManaSymbolsComponent, PrettyScrollDirective],
  templateUrl: './card-autocomplete.component.html',
  styleUrl: './card-autocomplete.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardAutocompleteComponent implements OnDestroy {
  private readonly cardsApi = inject(CardsApi);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly results = signal<Card[]>([]);
  readonly loading = signal(false);
  readonly quantities = signal<Record<string, number>>({});

  @Input() placeholder = 'Search cards';
  @Input() actionLabel = 'Select';
  @Input() minQueryLength = 2;
  @Input() clearOnSelect = false;
  @Input() showQuantity = false;
  @Input() filters: CardSearchFilters = {};
  @Input() commanderCandidateOnly = false;
  @Input() excludeTokens = false;
  @Input() excludeEmblems = false;
  @Input() excludeSchemes = false;
  @Input() query = '';
  @Input() disabled = false;

  @Output() queryChange = new EventEmitter<string>();
  @Output() cardSelected = new EventEmitter<CardAutocompleteSelection>();

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private searchVersion = 0;
  private lastQuery = '';
  private lastSignature = '';

  ngOnDestroy(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (this.hostElement.nativeElement.contains(target)) {
      return;
    }

    this.closeOverlay();
  }

  onQueryInput(value: string): void {
    if (this.disabled) {
      return;
    }

    const sanitized = sanitizeCardSearchQuery(value);
    this.query = sanitized;
    this.queryChange.emit(sanitized);

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    const query = sanitized.trim();
    if (query.length < this.minQueryLength) {
      this.resetResults();
      return;
    }

    this.loading.set(true);
    const version = ++this.searchVersion;
    this.searchTimeout = setTimeout(() => {
      void this.search(query, version);
    }, 320);
  }

  quantityFor(cardId: string): number {
    return this.quantities()[cardId] ?? 1;
  }

  setQuantity(cardId: string, value: unknown): void {
    this.quantities.set({
      ...this.quantities(),
      [cardId]: this.normalizeQuantity(value),
    });
  }

  selectCard(card: Card): void {
    if (this.disabled) {
      return;
    }

    const quantity = this.showQuantity ? this.quantityFor(card.scryfallId) : 1;
    this.cardSelected.emit({ card, quantity });
    this.results.set([]);
    this.lastQuery = '';
    this.lastSignature = '';
    this.quantities.set({});

    if (this.clearOnSelect) {
      this.query = '';
      this.queryChange.emit('');
      return;
    }

    this.query = card.name;
    this.queryChange.emit(card.name);
  }

  private async search(query: string, version: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, AUTOCOMPLETE_SEARCH_LIMIT, this.filters));
      if (version !== this.searchVersion || query !== this.query.trim()) {
        return;
      }

      const distinctCards = filterDistinctCardsByQuery(response.data, query);
      const filteredCards = distinctCards.filter((card) => {
        if (this.excludeTokens && isTokenCard(card)) {
          return false;
        }

        if (this.excludeEmblems && isEmblemCard(card)) {
          return false;
        }

        if (this.excludeSchemes && isSchemeCard(card)) {
          return false;
        }

        if (this.commanderCandidateOnly && !isCommanderCandidate(card)) {
          return false;
        }

        return true;
      });
      const signature = filteredCards.map((card) => card.scryfallId).join('|');
      if (signature === this.lastSignature && query === this.lastQuery) {
        return;
      }

      this.lastQuery = query;
      this.lastSignature = signature;
      this.results.set(filteredCards);
    } catch {
      if (version === this.searchVersion) {
        this.results.set([]);
      }
    } finally {
      if (version === this.searchVersion) {
        this.loading.set(false);
      }
    }
  }

  private normalizeQuantity(value: unknown): number {
    const numeric = Number.parseInt(String(value ?? 1), 10);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  }

  private resetResults(): void {
    this.results.set([]);
    this.loading.set(false);
    this.lastQuery = '';
    this.lastSignature = '';
    this.quantities.set({});
  }

  private closeOverlay(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    this.searchVersion += 1;
    this.loading.set(false);
    this.results.set([]);
  }
}
