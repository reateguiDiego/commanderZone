import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi, CardSearchFilters } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { filterDistinctCardsByQuery, sanitizeCardSearchQuery } from '../../utils/card-search';

export interface CardAutocompleteSelection {
  card: Card;
  quantity: number;
}

@Component({
  selector: 'app-card-autocomplete',
  imports: [FormsModule, LucideAngularModule, ManaSymbolsComponent],
  templateUrl: './card-autocomplete.component.html',
  styleUrl: './card-autocomplete.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardAutocompleteComponent implements OnDestroy {
  private readonly cardsApi = inject(CardsApi);

  readonly results = signal<Card[]>([]);
  readonly loading = signal(false);
  readonly quantities = signal<Record<string, number>>({});

  @Input() placeholder = 'Search cards';
  @Input() actionLabel = 'Select';
  @Input() minQueryLength = 2;
  @Input() clearOnSelect = false;
  @Input() showQuantity = false;
  @Input() filters: CardSearchFilters = {};
  @Input() query = '';

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

  onQueryInput(value: string): void {
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
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 24, this.filters));
      if (version !== this.searchVersion || query !== this.query.trim()) {
        return;
      }

      const distinctCards = filterDistinctCardsByQuery(response.data, query);
      const signature = distinctCards.map((card) => card.scryfallId).join('|');
      if (signature === this.lastSignature && query === this.lastQuery) {
        return;
      }

      this.lastQuery = query;
      this.lastSignature = signature;
      this.results.set(distinctCards);
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
}
