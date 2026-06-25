import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardSearchOptionsResponse, CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { Deck, DeckSection } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CardFaceImageComponent } from '../../../shared/components/card-face-image/card-face-image.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { ManaTextComponent } from '../../../shared/mana/mana-text/mana-text.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { TabListComponent, TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { isCommanderCandidate } from '../../../shared/utils/commander-candidate';
import { commanderColorIdentityUnion } from '../../../shared/utils/deck-commander';
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

interface CardLegalityPill {
  readonly format: string;
  readonly label: string;
  readonly status: string;
}

interface DeckSectionOption {
  readonly id: DeckSection;
  readonly labelKey: string;
}

interface AddToDeckWarning {
  readonly labelKey: string;
  readonly params: Record<string, string>;
  readonly colorSymbols?: readonly string[];
}

@Component({
  selector: 'app-card-search',
  imports: [
    CardAdvancedSearchFormComponent,
    CardFaceImageComponent,
    CardSearchHelpComponent,
    CardSearchResultsComponent,
    AppModalComponent,
    CzButtonDirective,
    FormatSelectComponent,
    LucideAngularModule,
    ManaTextComponent,
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
  private readonly decksApi = inject(DecksApi);
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
  readonly decks = signal<Deck[]>([]);
  readonly loadingDecks = signal(false);
  readonly addingToDeck = signal(false);
  readonly addToDeckErrorKey = signal<string | null>(null);
  readonly selectedDeckId = signal('');
  readonly selectedDeckSection = signal<DeckSection | ''>('');
  readonly selectedDeckQuantity = signal(1);
  readonly printingsCard = signal<Card | null>(null);
  readonly printings = signal<Card[]>([]);
  readonly loadingPrintings = signal(false);
  readonly printingsErrorKey = signal<string | null>(null);
  readonly canChooseResultView = computed(() => this.device.isDesktop() && this.device.isDesktopLayout() && this.device.hasHover());
  readonly effectiveViewMode = computed<CardSearchViewMode>(() => this.canChooseResultView() ? this.viewMode() : 'spoiler');
  readonly detailCardRulesText = computed(() => this.rulesText(this.detailsCard()));
  readonly legalFormatPills = computed(() => this.legalityPills(this.detailsCard(), true));
  readonly illegalFormatPills = computed(() => this.legalityPills(this.detailsCard(), false));
  readonly selectedDeck = computed(() => this.decks().find((deck) => deck.id === this.selectedDeckId()) ?? null);
  readonly addToDeckSectionOptions = computed(() => this.deckSectionOptions(this.addToDeckCard()));
  readonly deckSelectOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.selectDeck', disabled: true },
    ...this.decks().map((deck) => ({ id: deck.id, name: deck.name })),
  ]);
  readonly deckSectionSelectOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.selectSection', disabled: true },
    ...this.addToDeckSectionOptions().map((section) => ({ id: section.id, labelKey: section.labelKey })),
  ]);
  readonly addToDeckWarnings = computed(() => this.buildAddToDeckWarnings(this.selectedDeck(), this.addToDeckCard(), this.selectedDeckSection()));
  readonly canAddToDeck = computed(() => (
    this.addToDeckCard() !== null
    && this.selectedDeckId().trim() !== ''
    && this.selectedDeckSection() !== ''
    && this.selectedDeckQuantity() > 0
    && !this.loadingDecks()
    && !this.addingToDeck()
  ));
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
        void this.openAddToDeck(event.card);
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

  async openAddToDeck(card: Card): Promise<void> {
    this.addToDeckCard.set(card);
    this.addToDeckErrorKey.set(null);
    this.selectedDeckId.set('');
    this.selectedDeckSection.set('');
    this.selectedDeckQuantity.set(1);
    await this.loadDecksForModal();
  }

  closeAddToDeck(): void {
    this.addToDeckCard.set(null);
    this.addToDeckErrorKey.set(null);
    this.addingToDeck.set(false);
  }

  selectDeck(value: string): void {
    this.selectedDeckId.set(value);
  }

  selectDeckSection(value: string): void {
    const section = value;
    if (section === 'main' || section === 'commander' || section === 'sideboard' || section === 'maybeboard') {
      this.selectedDeckSection.set(section);
      return;
    }

    this.selectedDeckSection.set('');
  }

  selectDeckQuantity(event: Event): void {
    const target = event.target;
    const rawValue = target instanceof HTMLInputElement ? target.value : '';
    this.setDeckQuantity(rawValue);
    if (target instanceof HTMLInputElement) {
      target.value = String(this.selectedDeckQuantity());
    }
  }

  increaseDeckQuantity(): void {
    this.selectedDeckQuantity.update((quantity) => Math.min(99, quantity + 1));
  }

  decreaseDeckQuantity(): void {
    this.selectedDeckQuantity.update((quantity) => Math.max(1, quantity - 1));
  }

  async addSelectedCardToDeck(): Promise<void> {
    const card = this.addToDeckCard();
    const deckId = this.selectedDeckId();
    const section = this.selectedDeckSection();
    if (!card || !deckId || section === '' || !this.canAddToDeck()) {
      return;
    }

    this.addingToDeck.set(true);
    this.addToDeckErrorKey.set(null);
    try {
      await firstValueFrom(this.decksApi.addCard(deckId, {
        scryfallId: card.scryfallId,
        quantity: this.selectedDeckQuantity(),
        section,
      }));
      this.closeAddToDeck();
    } catch {
      this.addToDeckErrorKey.set('deckBuilder.cards.cardSearch.addToDeck.couldNotAdd');
    } finally {
      this.addingToDeck.set(false);
    }
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

  isBattleCard(card: Card): boolean {
    return this.cardTypeLine(card).startsWith('battle');
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

  private async loadDecksForModal(): Promise<void> {
    if (this.decks().length > 0 || this.loadingDecks()) {
      return;
    }

    this.loadingDecks.set(true);
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
    } catch {
      this.addToDeckErrorKey.set('deckBuilder.cards.cardSearch.addToDeck.couldNotLoadDecks');
    } finally {
      this.loadingDecks.set(false);
    }
  }

  private deckSectionOptions(card: Card | null): DeckSectionOption[] {
    const options: DeckSectionOption[] = [
      { id: 'main', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionMain' },
      { id: 'sideboard', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionSideboard' },
      { id: 'maybeboard', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionConsidering' },
    ];

    if (card && card.commanderLegal && isCommanderCandidate(card)) {
      options.splice(1, 0, { id: 'commander', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionCommander' });
    }

    return options;
  }

  private buildAddToDeckWarnings(deck: Deck | null, card: Card | null, section: DeckSection | ''): AddToDeckWarning[] {
    if (!deck || !card) {
      return [];
    }

    const warnings: AddToDeckWarning[] = [];
    const colorWarning = this.colorIdentityWarning(deck, card, section);
    if (colorWarning) {
      warnings.push(colorWarning);
    }

    const legalityWarning = this.formatLegalityWarning(deck, card);
    if (legalityWarning) {
      warnings.push(legalityWarning);
    }

    return warnings;
  }

  private colorIdentityWarning(deck: Deck, card: Card, section: DeckSection | ''): AddToDeckWarning | null {
    if (this.deckFormatKey(deck) !== 'commander' || section === 'sideboard' || section === 'commander') {
      return null;
    }

    const commanderColors = commanderColorIdentityUnion(deck);
    if (commanderColors.length === 0) {
      return null;
    }

    const allowedColors = new Set(commanderColors);
    const invalidColors = (card.colorIdentity ?? []).filter((color) => !allowedColors.has(color));
    if (invalidColors.length === 0) {
      return null;
    }

    return {
      labelKey: 'deckBuilder.cards.cardSearch.addToDeck.colorIdentityWarning',
      params: {
        card: card.name,
        deck: deck.name,
      },
      colorSymbols: invalidColors,
    };
  }

  private setDeckQuantity(value: string): void {
    const numericValue = value.replace(/\D+/g, '').slice(0, 2);
    const parsedValue = Number.parseInt(numericValue, 10);
    this.selectedDeckQuantity.set(Math.min(99, Math.max(1, Number.isFinite(parsedValue) ? parsedValue : 1)));
  }

  private formatLegalityWarning(deck: Deck, card: Card): AddToDeckWarning | null {
    const format = this.deckFormatKey(deck);
    if (!format) {
      return null;
    }

    const legality = (card.legalities?.[format] ?? '').toLowerCase();
    const legal = format === 'commander'
      ? card.commanderLegal && legality === 'legal'
      : legality === 'legal';
    if (legal) {
      return null;
    }

    return {
      labelKey: 'deckBuilder.cards.cardSearch.addToDeck.formatLegalityWarning',
      params: {
        card: card.name,
        deck: deck.name,
        format: this.formatLabel(format),
      },
    };
  }

  private deckFormatKey(deck: Deck): string {
    return (deck.format ?? '').trim().toLowerCase();
  }

  private rulesText(card: Card | null): string {
    if (!card) {
      return '';
    }

    const rootText = card.oracleText?.trim();
    if (rootText) {
      return rootText;
    }

    return (card.cardFaces ?? [])
      .map((face) => face.oracleText?.trim() ?? '')
      .filter(Boolean)
      .join('\n//\n');
  }

  private legalityPills(card: Card | null, legal: boolean): CardLegalityPill[] {
    if (!card) {
      return [];
    }

    return Object.entries(card.legalities ?? {})
      .filter(([, status]) => legal ? status === 'legal' : status !== 'legal')
      .map(([format, status]) => ({
        format,
        label: this.formatLabel(format),
        status,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  private formatLabel(format: string): string {
    return format
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  private rulingsUrl(card: Card): string {
    const set = card.set?.trim();
    const collectorNumber = card.collectorNumber?.trim();
    if (set && collectorNumber) {
      return `https://scryfall.com/card/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}?utm_source=commanderzone#rulings`;
    }

    return `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22&utm_source=commanderzone`;
  }

  private cardTypeLine(card: Card): string {
    const faceTypeLine = card.cardFaces?.[0]?.typeLine?.trim().toLowerCase();
    if (faceTypeLine) {
      return faceTypeLine;
    }

    return card.typeLine?.trim().toLowerCase() ?? '';
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
