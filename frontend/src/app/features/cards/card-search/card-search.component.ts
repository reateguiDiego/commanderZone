import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardSearchOptionsResponse, CardsApi } from '../../../core/api/cards.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { AddCardToDeckModalComponent } from '../../../shared/components/add-card-to-deck-modal/add-card-to-deck-modal.component';
import { CardDetailsModalComponent } from '../../../shared/components/card-details-modal/card-details-modal.component';
import { CardPrintingsModalComponent } from '../../../shared/components/card-printings-modal/card-printings-modal.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { CardsMainLayoutComponent } from '../../../shared/components/cards-main-layout/cards-main-layout.component';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { TabListComponent, TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { CardAdvancedSearchSubmit, CardSearchViewMode } from './card-search.models';
import { CardAdvancedSearchFormComponent } from './components/card-advanced-search-form/card-advanced-search-form.component';
import { CardSearchHelpComponent } from './components/card-search-help/card-search-help.component';
import { CardSearchResultActionEvent, CardSearchResultsComponent } from './components/card-search-results/card-search-results.component';

const CARD_SEARCH_PAGE_SIZE = 20;
const CARD_SEARCH_PAGE_CACHE_LIMIT = 12;

interface CardSearchFilterPill {
  labelKey: string;
  value?: string;
  valueKey?: string;
  manaValue?: string;
  manaSymbols?: readonly string[];
  track: string;
}

interface CardSearchPageCacheEntry {
  readonly results: readonly Card[];
  readonly hasMore: boolean;
  readonly total: number;
}

@Component({
  selector: 'app-card-search',
  imports: [
    AddCardToDeckModalComponent,
    CardAdvancedSearchFormComponent,
    CardDetailsModalComponent,
    CardPrintingsModalComponent,
    CardSearchHelpComponent,
    CardSearchResultsComponent,
    CardsMainLayoutComponent,
    CzButtonDirective,
    FormatSelectComponent,
    LucideAngularModule,
    ManaSymbolsComponent,
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
  private readonly device = inject(DeviceProfileService);

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
  readonly formattedTotalResults = computed(() => this.formatCount(this.totalResults()));
  readonly filterPills = signal<CardSearchFilterPill[]>([]);
  readonly searchHelpOpen = signal(false);
  readonly filtersExpanded = signal(true);
  readonly detailsCard = signal<Card | null>(null);
  readonly addToDeckCard = signal<Card | null>(null);
  readonly printingsCard = signal<Card | null>(null);
  readonly printings = signal<Card[]>([]);
  readonly loadingPrintings = signal(false);
  readonly printingsErrorKey = signal<string | null>(null);
  readonly canChooseResultView = computed(() => this.device.isDesktop() && this.device.isDesktopLayout() && this.device.hasHover());
  readonly effectiveViewMode = computed<CardSearchViewMode>(() => this.canChooseResultView() ? this.viewMode() : 'spoiler');
  readonly viewTabs: readonly TabListItem[] = [
    { id: 'list', label: 'deckBuilder.cards.cardSearch.view.list', icon: 'list' },
    { id: 'spoiler', label: 'deckBuilder.cards.cardSearch.view.spoiler', icon: 'image' },
  ];
  readonly sortOptions: readonly FormatSelectOption[] = [
    { id: 'name_asc', labelKey: 'deckBuilder.cards.cardSearch.sort.nameAsc' },
    { id: 'name_desc', labelKey: 'deckBuilder.cards.cardSearch.sort.nameDesc' },
    { id: 'mana_value_desc', labelKey: 'deckBuilder.cards.cardSearch.sort.manaValueDesc' },
    { id: 'mana_value_asc', labelKey: 'deckBuilder.cards.cardSearch.sort.manaValueAsc' },
  ];
  private readonly lastSearch = signal<CardAdvancedSearchSubmit | null>(null);
  private readonly pageCache = new Map<string, CardSearchPageCacheEntry>();

  ngOnInit(): void {
    this.pageHeader.set({
      title: 'deckBuilder.cards.cardSearch.header.title',
      description: 'deckBuilder.cards.cardSearch.header.description',
      context: 'rooms',
      heroRule: true,
      titleActions: [
        {
          id: 'card-search-help',
          label: 'deckBuilder.cards.cardSearch.help.title',
          icon: 'circle-help',
          iconOnly: true,
          tooltip: 'deckBuilder.cards.cardSearch.help.title',
          variant: 'secondary',
          execute: () => this.searchHelpOpen.update((open) => !open),
        },
      ],
    });
    void this.loadOptions();
  }

  ngOnDestroy(): void {
    this.pageHeader.clear();
  }

  async search(request: CardAdvancedSearchSubmit): Promise<void> {
    this.filtersExpanded.set(false);
    const nextRequest = {
      ...request,
      viewMode: this.effectiveViewMode(),
    };
    this.lastSearch.set(nextRequest);
    this.filterPills.set(this.buildFilterPills(nextRequest));
    this.pageCache.clear();
    await this.runSearch(nextRequest, 1);
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
    if (!this.canChooseResultView()) {
      return;
    }

    if (value !== 'list' && value !== 'spoiler') {
      return;
    }

    form.selectViewMode(value);
    this.viewMode.set(value);
    const currentSearch = this.lastSearch();
    if (currentSearch) {
      this.lastSearch.set({
        ...currentSearch,
        viewMode: value,
      });
    }
  }

  async selectSort(form: CardAdvancedSearchFormComponent, value: string): Promise<void> {
    form.selectSort(value);
    if (form.hasSearchCriteria()) {
      form.submit();
    }
  }

  handleResultAction(event: CardSearchResultActionEvent): void {
    switch (event.action) {
      case 'details':
        this.openDetails(event.card);
        return;
      case 'addToDeck':
        this.openAddToDeck(event.card);
        return;
      case 'rulings':
        this.openRulings(event.card);
        return;
      case 'printings':
        void this.openPrintings(event.card);
        return;
    }
  }

  openDetails(card: Card): void {
    this.detailsCard.set(card);
  }

  closeDetails(): void {
    this.detailsCard.set(null);
  }

  openAddToDeck(card: Card): void {
    this.addToDeckCard.set(card);
  }

  closeAddToDeck(): void {
    this.addToDeckCard.set(null);
  }

  openRulings(card: Card): void {
    window.open(this.rulingsUrl(card), '_blank', 'noopener,noreferrer');
  }

  async openPrintings(card: Card): Promise<void> {
    this.printingsCard.set(card);
    this.printings.set([]);
    this.printingsErrorKey.set(null);
    this.loadingPrintings.set(true);
    try {
      const response = await firstValueFrom(this.cardsApi.printings(card.scryfallId));
      this.printings.set(response.data);
    } catch {
      this.printingsErrorKey.set('deckBuilder.cards.cardSearch.printings.couldNotLoad');
    } finally {
      this.loadingPrintings.set(false);
    }
  }

  closePrintings(): void {
    this.printingsCard.set(null);
    this.printings.set([]);
    this.printingsErrorKey.set(null);
    this.loadingPrintings.set(false);
  }

  clear(): void {
    this.filtersExpanded.set(true);
    this.results.set([]);
    this.error.set(null);
    this.searched.set(false);
    this.viewMode.set(this.defaultViewMode());
    this.page.set(1);
    this.hasMore.set(false);
    this.totalResults.set(0);
    this.filterPills.set([]);
    this.lastSearch.set(null);
    this.pageCache.clear();
  }

  expandFilters(): void {
    this.filtersExpanded.set(true);
  }

  collapseFilters(): void {
    this.filtersExpanded.set(false);
  }

  private async runSearch(request: CardAdvancedSearchSubmit, page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.searched.set(true);
    this.viewMode.set(this.canChooseResultView() ? request.viewMode : 'spoiler');
    this.page.set(page);
    this.results.set([]);
    this.hasMore.set(false);

    const cacheKey = this.pageCacheKey(request, page);
    const cachedPage = this.pageCache.get(cacheKey);
    if (cachedPage) {
      await Promise.resolve();
      this.results.set([...cachedPage.results]);
      this.hasMore.set(cachedPage.hasMore);
      this.totalResults.set(cachedPage.total);
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(this.cardsApi.search(request.query, page, CARD_SEARCH_PAGE_SIZE, request.filters));
      this.results.set(response.data);
      this.hasMore.set(response.hasMore ?? response.data.length === CARD_SEARCH_PAGE_SIZE);
      this.totalResults.set(response.total ?? ((page - 1) * CARD_SEARCH_PAGE_SIZE) + response.data.length);
      this.rememberPage(cacheKey, {
        results: response.data,
        hasMore: response.hasMore ?? response.data.length === CARD_SEARCH_PAGE_SIZE,
        total: response.total ?? ((page - 1) * CARD_SEARCH_PAGE_SIZE) + response.data.length,
      });
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

  private rulingsUrl(card: Card): string {
    const set = card.set?.trim();
    const collectorNumber = card.collectorNumber?.trim();
    if (set && collectorNumber) {
      return `https://scryfall.com/card/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}?utm_source=commanderzone#rulings`;
    }

    return `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22&utm_source=commanderzone`;
  }

  private buildFilterPills(request: CardAdvancedSearchSubmit): CardSearchFilterPill[] {
    const filters = request.filters;
    const pills: CardSearchFilterPill[] = [];
    const options = this.options();

    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.name', request.query);
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.rules', [filters.oracleTextA, filters.oracleTextB].filter(Boolean).join(filters.oracleTextMode === 'or' ? ' OR ' : ' AND '));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.types', this.optionNames(options?.types, filters.types));
    this.pushPillKey(pills, 'deckBuilder.cards.cardSearch.summary.filters.types', filters.basic ? 'deckBuilder.cards.cardSearch.form.basic' : null);
    this.pushPillKey(pills, 'deckBuilder.cards.cardSearch.summary.filters.types', filters.legendary ? 'deckBuilder.cards.cardSearch.form.legendary' : null);
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.subtypes', this.optionNames(options?.subtypes, filters.subtypes));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.sets', this.optionNames(options?.sets, filters.sets));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.rarity', this.optionNames(options?.rarities, filters.rarities));
    this.pushManaSymbolsPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.colors', filters.colors);
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.cardKind', [
      filters.artifact ? 'Artifact' : '',
      filters.multicolor ? 'Multicolor' : '',
      filters.land ? 'Land' : '',
    ].filter(Boolean).join(', '));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.manaValue', this.rangeLabel(filters.manaValueMin, filters.manaValueMax));
    this.pushManaValuePill(pills, 'deckBuilder.cards.cardSearch.summary.filters.manaCost', filters.manaCost);
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.power', this.rangeLabel(filters.powerMin, filters.powerMax));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.toughness', this.rangeLabel(filters.toughnessMin, filters.toughnessMax));
    this.pushPill(pills, 'deckBuilder.cards.cardSearch.summary.filters.formats', this.optionNames(options?.formats, filters.formats));

    return pills;
  }

  private pushPill(pills: CardSearchFilterPill[], labelKey: string, value: string | null | undefined): void {
    const normalized = value?.trim() ?? '';
    if (normalized) {
      pills.push({ labelKey, value: normalized, track: `${labelKey}:${normalized}` });
    }
  }

  private pageCacheKey(request: CardAdvancedSearchSubmit, page: number): string {
    return JSON.stringify({
      query: request.query,
      filters: request.filters,
      page,
    });
  }

  private rememberPage(cacheKey: string, entry: CardSearchPageCacheEntry): void {
    this.pageCache.set(cacheKey, entry);
    if (this.pageCache.size <= CARD_SEARCH_PAGE_CACHE_LIMIT) {
      return;
    }

    const firstKey = this.pageCache.keys().next().value;
    if (typeof firstKey === 'string') {
      this.pageCache.delete(firstKey);
    }
  }

  private pushManaValuePill(pills: CardSearchFilterPill[], labelKey: string, value: string | null | undefined): void {
    const normalized = value?.trim() ?? '';
    if (normalized) {
      pills.push({ labelKey, value: normalized, manaValue: normalized, track: `${labelKey}:${normalized}` });
    }
  }

  private pushPillKey(pills: CardSearchFilterPill[], labelKey: string, valueKey: string | null | undefined): void {
    if (valueKey) {
      pills.push({ labelKey, valueKey, track: `${labelKey}:${valueKey}` });
    }
  }

  private pushManaSymbolsPill(pills: CardSearchFilterPill[], labelKey: string, value: readonly string[] | undefined): void {
    if (value && value.length > 0) {
      pills.push({ labelKey, manaSymbols: [...value], track: `${labelKey}:${value.join(',')}` });
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

  private defaultViewMode(): CardSearchViewMode {
    return this.canChooseResultView() ? 'list' : 'spoiler';
  }

  private formatCount(value: number): string {
    return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
}
