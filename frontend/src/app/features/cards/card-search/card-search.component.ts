import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardSearchOptionsResponse, CardsApi } from '../../../core/api/cards.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { TabListComponent, TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { CardAdvancedSearchSubmit, CardSearchViewMode } from './card-search.models';
import { CardAdvancedSearchFormComponent } from './components/card-advanced-search-form/card-advanced-search-form.component';
import { CardSearchHelpComponent } from './components/card-search-help/card-search-help.component';
import { CardSearchResultsComponent } from './components/card-search-results/card-search-results.component';

const CARD_SEARCH_PAGE_SIZE = 20;

interface CardSearchFilterPill {
  label: string;
  value: string;
}

@Component({
  selector: 'app-card-search',
  imports: [
    CardAdvancedSearchFormComponent,
    CardSearchHelpComponent,
    CardSearchResultsComponent,
    CzButtonDirective,
    LucideAngularModule,
    RuntimeTranslatePipe,
    TabListComponent,
  ],
  templateUrl: './card-search.component.html',
  styleUrl: './card-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchComponent implements OnInit, OnDestroy {
  private readonly cardsApi = inject(CardsApi);
  private readonly pageHeader = inject(PageHeaderStore);

  readonly results = signal<Card[]>([]);
  readonly options = signal<CardSearchOptionsResponse | null>(null);
  readonly loading = signal(false);
  readonly loadingOptions = signal(false);
  readonly error = signal<string | null>(null);
  readonly searched = signal(false);
  readonly viewMode = signal<CardSearchViewMode>('list');
  readonly page = signal(1);
  readonly hasMore = signal(false);
  readonly totalResults = signal(0);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalResults() / CARD_SEARCH_PAGE_SIZE)));
  readonly filterPills = signal<CardSearchFilterPill[]>([]);
  readonly viewTabs: readonly TabListItem[] = [
    { id: 'list', label: 'deckBuilder.cards.cardSearch.view.list', icon: 'list' },
    { id: 'spoiler', label: 'deckBuilder.cards.cardSearch.view.spoiler', icon: 'image' },
  ];
  private readonly lastSearch = signal<CardAdvancedSearchSubmit | null>(null);

  ngOnInit(): void {
    this.pageHeader.set({
      title: 'deckBuilder.cards.cardSearch.header.title',
      description: 'deckBuilder.cards.cardSearch.header.description',
      context: 'rooms',
      heroRule: true,
    });
    void this.loadOptions();
  }

  ngOnDestroy(): void {
    this.pageHeader.clear();
  }

  async search(request: CardAdvancedSearchSubmit): Promise<void> {
    this.lastSearch.set(request);
    this.filterPills.set(this.buildFilterPills(request));
    await this.runSearch(request, 1);
  }

  async previousPage(): Promise<void> {
    const request = this.lastSearch();
    const previousPage = this.page() - 1;
    if (!request || previousPage < 1 || this.loading()) {
      return;
    }

    await this.runSearch(request, previousPage);
  }

  async nextPage(): Promise<void> {
    const request = this.lastSearch();
    if (!request || !this.hasMore() || this.loading()) {
      return;
    }

    await this.runSearch(request, this.page() + 1);
  }

  selectViewMode(form: CardAdvancedSearchFormComponent, value: string): void {
    if (value !== 'list' && value !== 'spoiler') {
      return;
    }

    form.selectViewMode(value);
    this.viewMode.set(value);
  }

  clear(): void {
    this.results.set([]);
    this.error.set(null);
    this.searched.set(false);
    this.viewMode.set('list');
    this.page.set(1);
    this.hasMore.set(false);
    this.totalResults.set(0);
    this.filterPills.set([]);
    this.lastSearch.set(null);
  }

  private async runSearch(request: CardAdvancedSearchSubmit, page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.searched.set(true);
    this.viewMode.set(request.viewMode);
    this.page.set(page);

    try {
      const response = await firstValueFrom(this.cardsApi.search(request.query, page, CARD_SEARCH_PAGE_SIZE, request.filters));
      this.results.set(response.data);
      this.hasMore.set(response.hasMore ?? response.data.length === CARD_SEARCH_PAGE_SIZE);
      this.totalResults.set(response.total ?? ((page - 1) * CARD_SEARCH_PAGE_SIZE) + response.data.length);
    } catch {
      this.error.set('Could not search cards.');
      this.hasMore.set(false);
      this.totalResults.set(0);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOptions(): Promise<void> {
    this.loadingOptions.set(true);
    try {
      this.options.set(await firstValueFrom(this.cardsApi.searchOptions()));
    } catch {
      this.options.set({
        types: [],
        subtypes: [],
        sets: [],
        rarities: [
          { code: 'mythic', name: 'Mythic' },
          { code: 'rare', name: 'Rare' },
          { code: 'uncommon', name: 'Uncommon' },
          { code: 'common', name: 'Common' },
        ],
        formats: [],
      });
    } finally {
      this.loadingOptions.set(false);
    }
  }

  private buildFilterPills(request: CardAdvancedSearchSubmit): CardSearchFilterPill[] {
    const filters = request.filters;
    const pills: CardSearchFilterPill[] = [];
    const options = this.options();

    this.pushPill(pills, 'Name', request.query);
    this.pushPill(pills, 'Rules', [filters.oracleTextA, filters.oracleTextB].filter(Boolean).join(filters.oracleTextMode === 'or' ? ' OR ' : ' AND '));
    this.pushPill(pills, 'Types', this.optionNames(options?.types, filters.types));
    this.pushPill(pills, 'Subtypes', this.optionNames(options?.subtypes, filters.subtypes));
    this.pushPill(pills, 'Sets', this.optionNames(options?.sets, filters.sets));
    this.pushPill(pills, 'Rarity', this.optionNames(options?.rarities, filters.rarities));
    this.pushPill(pills, 'Colors', filters.colors?.join(filters.colorMatchMode === 'exact' ? ' = ' : filters.colorMatchMode === 'all' ? ' + ' : ' / ') ?? '');
    this.pushPill(pills, 'Card kind', [
      filters.artifact ? 'Artifact' : '',
      filters.multicolor ? 'Multicolor' : '',
      filters.land ? 'Land' : '',
    ].filter(Boolean).join(', '));
    this.pushPill(pills, 'Mana value', this.rangeLabel(filters.manaValueMin, filters.manaValueMax));
    this.pushPill(pills, 'Mana cost', filters.manaCost);
    this.pushPill(pills, 'Power', this.rangeLabel(filters.powerMin, filters.powerMax));
    this.pushPill(pills, 'Toughness', this.rangeLabel(filters.toughnessMin, filters.toughnessMax));
    this.pushPill(pills, 'Formats', this.optionNames(options?.formats, filters.formats));

    return pills;
  }

  private pushPill(pills: CardSearchFilterPill[], label: string, value: string | null | undefined): void {
    const normalized = value?.trim() ?? '';
    if (normalized) {
      pills.push({ label, value: normalized });
    }
  }

  private optionNames(options: CardSearchOptionsResponse[keyof CardSearchOptionsResponse] | undefined, codes: readonly string[] | undefined): string {
    if (!codes || codes.length === 0) {
      return '';
    }

    const names = new Map((options ?? []).map((option) => [option.code, option.name]));
    return codes.map((code) => names.get(code) ?? code).join(', ');
  }

  private rangeLabel(min: number | undefined, max: number | undefined): string {
    if (min !== undefined && max !== undefined) {
      return `${min} - ${max}`;
    }

    if (min !== undefined) {
      return `>= ${min}`;
    }

    return max !== undefined ? `<= ${max}` : '';
  }
}
