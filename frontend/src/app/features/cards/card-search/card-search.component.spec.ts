import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ChevronLeft, ChevronRight, CircleHelp, Image, Info, List, LucideAngularModule, RotateCcw, RotateCw, Search, SlidersHorizontal, X } from 'lucide-angular';
import { of, Subject } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { CardsLanguageService } from '../../../core/api/cards-language.service';
import { DecksApi } from '../../../core/api/decks.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { Card } from '../../../core/models/card.model';
import { AddCardToDeckModalComponent } from '../../../shared/components/add-card-to-deck-modal/add-card-to-deck-modal.component';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { CardSearchComponent } from './card-search.component';

describe('CardSearchComponent', () => {
  let isDesktop: ReturnType<typeof signal<boolean>>;
  let isDesktopLayout: ReturnType<typeof signal<boolean>>;
  let hasHover: ReturnType<typeof signal<boolean>>;
  let cardLanguage: ReturnType<typeof signal<'en' | 'es'>>;
  let appLanguage: ReturnType<typeof signal<'en' | 'es'>>;

  const cardsApi = {
    search: vi.fn().mockReturnValue(of({ data: [] })),
    printings: vi.fn().mockReturnValue(of({ data: [] })),
    searchOptions: vi.fn().mockReturnValue(of({
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
    })),
  };
  const cardsLanguageService = {
    list: vi.fn().mockReturnValue(of({
      selectedCardLanguage: 'es',
      data: [
        { code: 'en', label: 'English', distinctCardNames: 100, percentageOfEnglish: 100 },
        { code: 'es', label: 'Spanish', distinctCardNames: 73, percentageOfEnglish: 73 },
      ],
    })),
  };
  const decksApi = {
    list: vi.fn().mockReturnValue(of({ data: [] })),
    addCard: vi.fn().mockReturnValue(of({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] } })),
  };

  beforeEach(async () => {
    isDesktop = signal(true);
    isDesktopLayout = signal(true);
    hasHover = signal(true);
    cardLanguage = signal('es');
    appLanguage = signal('en');
    cardsApi.search.mockClear();
    cardsApi.printings.mockClear();
    cardsApi.searchOptions.mockClear();
    cardsLanguageService.list.mockClear();
    decksApi.list.mockClear();
    decksApi.addCard.mockClear();

    await TestBed.configureTestingModule({
      imports: [CardSearchComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Search, CircleHelp, Info, RotateCcw, RotateCw, List, Image, X, ChevronLeft, ChevronRight, SlidersHorizontal })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: CardsLanguageService, useValue: cardsLanguageService },
        { provide: DecksApi, useValue: decksApi },
        {
          provide: LanguagePreferencesService,
          useValue: {
            cardLanguage,
            appLanguage,
          },
        },
        {
          provide: DeviceProfileService,
          useValue: {
            isDesktop,
            isDesktopLayout,
            hasHover,
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the advanced card search form', async () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('WIP: cards-page');
    expect(TestBed.inject(PageHeaderStore).state()?.title).toBe('Cards');
    expect(TestBed.inject(PageHeaderStore).state()?.heroRule).toBe(true);
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[0]?.id).toBe('card-search-language-disclaimer');
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[0]?.tooltipTriggerMode).toBe('click');
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[0]?.tooltipPlacement).toBe('bottom');
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[1]?.id).toBe('card-search-help');
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[1]?.tooltip).toBeUndefined();
    expect(fixture.nativeElement.querySelector('app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside app-card-search-help')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main .cards-view-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside .cards-aside-actions')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main app-card-search-results')).not.toBeNull();
    expect(cardsApi.searchOptions).toHaveBeenCalled();
    expect(cardsLanguageService.list).toHaveBeenCalled();
  });

  it('adds a clickable title action disclaimer when the selected card language is not English', async () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const titleActions = TestBed.inject(PageHeaderStore).state()?.titleActions ?? [];
    expect(titleActions).toHaveLength(2);
    expect(titleActions[0]?.tooltip).toContain('73% of cards are available in Spanish');
  });

  it('omits the title action disclaimer when the selected card language is English', async () => {
    cardLanguage.set('en');
    cardsLanguageService.list.mockReturnValueOnce(of({
      selectedCardLanguage: 'en',
      data: [{ code: 'en', label: 'English', distinctCardNames: 100, percentageOfEnglish: 100 }],
    }));

    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.map((action) => action.id)).toEqual(['card-search-help']);
  });

  it('opens the search guide from the page header action', async () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    TestBed.inject(PageHeaderStore).state()?.titleActions?.[0]?.execute();
    fixture.detectChanges();

    expect(fixture.componentInstance.searchHelpOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('.search-help--floating .search-help__body')).not.toBeNull();
  });

  it('searches cards with a twenty card page size and tracks pagination', async () => {
    cardsApi.search.mockReturnValue(of({
      data: [{
        id: 'card-1',
        scryfallId: 'card-1',
        name: 'Sol Ring',
        manaCost: '{1}',
        typeLine: 'Artifact',
        oracleText: '',
        colors: [],
        colorIdentity: [],
        legalities: {},
        imageUris: {},
        cardFaces: [],
        hasRulings: false,
        allParts: [],
        manaValue: 1,
        producedMana: [],
        prices: {},
        layout: 'normal',
        commanderLegal: true,
      }],
      page: 1,
      limit: 20,
      hasMore: true,
      total: 1241,
    }));
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.search({
      query: 'sol ring',
      filters: {},
      viewMode: 'list',
    });

    expect(cardsApi.search).toHaveBeenCalledWith('sol ring', 1, 20, {});
    expect(fixture.componentInstance.filtersExpanded()).toBe(false);
    expect(fixture.componentInstance.hasMore()).toBe(true);
    expect(fixture.componentInstance.page()).toBe(1);
    expect(fixture.componentInstance.totalResults()).toBe(1241);
    expect(fixture.componentInstance.totalPages()).toBe(63);
    expect(fixture.componentInstance.filterPills()).toEqual([{
      labelKey: 'deckBuilder.cards.cardSearch.summary.filters.name',
      value: 'sol ring',
      track: 'deckBuilder.cards.cardSearch.summary.filters.name:sol ring',
    }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cards-main .cards-view-actions')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-filter-summary__copy strong').textContent).toContain('1.241 cards found');
  });

  it('expands advanced filters when the collapsed title is clicked', async () => {
    cardsApi.search.mockReturnValue(of({
      data: [cardFixture('card-1', 'Sol Ring')],
      page: 1,
      limit: 20,
      hasMore: false,
      total: 1,
    }));
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.search({
      query: 'sol ring',
      filters: {},
      viewMode: 'list',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.filtersExpanded()).toBe(false);

    const toggle = fixture.nativeElement.querySelector('.cards-filter-toggle--summary') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filtersExpanded()).toBe(true);
    expect(fixture.nativeElement.querySelector('.cards-filter-toggle--summary')).toBeNull();
  });

  it('keeps a standalone filter reopen button when filters are closed before searching', async () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.collapseFilters();
    fixture.detectChanges();

    const reopenButton = fixture.nativeElement.querySelector('.cards-filter-toggle--standalone.cards-filter-toggle--empty') as HTMLButtonElement | null;
    expect(reopenButton).not.toBeNull();

    reopenButton?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filtersExpanded()).toBe(true);
  });

  it('forces spoiler view and hides view tabs outside desktop hover layout', async () => {
    isDesktop.set(true);
    isDesktopLayout.set(false);
    hasHover.set(true);
    cardsApi.search.mockReturnValue(of({
      data: [cardFixture('card-1', 'Sol Ring')],
      page: 1,
      limit: 20,
      hasMore: false,
      total: 1,
    }));
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.search({
      query: 'sol ring',
      filters: {},
      viewMode: 'list',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.effectiveViewMode()).toBe('spoiler');
    expect(fixture.nativeElement.querySelector('.cards-view-actions app-tab-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('.card-results--spoiler')).not.toBeNull();
  });

  it('keeps the selected result view across pagination and new searches until cleared', async () => {
    cardsApi.search.mockReturnValue(of({
      data: [cardFixture('card-1', 'Sol Ring')],
      page: 1,
      limit: 20,
      hasMore: true,
      total: 41,
    }));
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.search({
      query: 'sol ring',
      filters: {},
      viewMode: 'list',
    });
    fixture.componentInstance.selectViewMode({ selectViewMode: vi.fn() } as never, 'spoiler');

    await fixture.componentInstance.nextPage();

    expect(fixture.componentInstance.viewMode()).toBe('spoiler');

    await fixture.componentInstance.search({
      query: 'arcane',
      filters: {},
      viewMode: 'list',
    });

    expect(fixture.componentInstance.viewMode()).toBe('spoiler');

    fixture.componentInstance.clear();

    expect(fixture.componentInstance.viewMode()).toBe('list');
    expect(fixture.componentInstance.filtersExpanded()).toBe(true);
  });

  it('clears previous results immediately when a new search starts', async () => {
    const pendingSearch = new Subject<{
      data: ReturnType<typeof cardFixture>[];
      page: number;
      limit: number;
      hasMore: boolean;
      total: number;
    }>();
    cardsApi.search.mockReturnValue(pendingSearch.asObservable());
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.results.set([cardFixture('old-card', 'Old Result')]);

    const searchPromise = fixture.componentInstance.search({
      query: 'new query',
      filters: {},
      viewMode: 'list',
    });

    expect(fixture.componentInstance.results()).toEqual([]);
    expect(fixture.componentInstance.loading()).toBe(true);

    pendingSearch.next({
      data: [cardFixture('new-card', 'New Result')],
      page: 1,
      limit: 20,
      hasMore: false,
      total: 1,
    });
    pendingSearch.complete();
    await searchPromise;

    expect(fixture.componentInstance.results().map((card) => card.name)).toEqual(['New Result']);
  });

  it('shows add-to-deck warnings for commander color identity and format legality', async () => {
    decksApi.list.mockReturnValue(of({
      data: [{
        id: 'deck-1',
        name: 'Atraxa Deck',
        format: 'commander',
        folderId: null,
        commanders: [cardFixture('commander-1', 'Atraxa', { colorIdentity: ['W', 'U', 'B', 'G'] })],
        cards: [],
      }],
    }));
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.openAddToDeck(cardFixture('red-card', 'Lightning Bolt', {
      colorIdentity: ['R'],
      commanderLegal: false,
      legalities: { commander: 'not_legal' },
    }));
    await fixture.whenStable();
    fixture.detectChanges();

    const modal = fixture.debugElement.query(By.directive(AddCardToDeckModalComponent)).componentInstance as AddCardToDeckModalComponent;
    expect(modal.selectedDeckId()).toBe('');
    expect(modal.selectedDeckSection()).toBe('');
    expect(fixture.nativeElement.querySelectorAll('app-format-select').length).toBeGreaterThanOrEqual(2);

    modal.selectDeck('deck-1');
    modal.selectDeckSection('main');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lightning Bolt has color identity outside Atraxa Deck');
    expect(fixture.nativeElement.textContent).toContain('Lightning Bolt is not legal in Commander');
    expect(fixture.nativeElement.querySelector('.add-to-deck-modal__warnings app-mana-symbols')).not.toBeNull();
  });

  it('keeps add-to-deck quantity between one and ninety-nine', () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.componentInstance.openAddToDeck(cardFixture('test-card', 'Test Card'));
    fixture.detectChanges();
    const modal = fixture.debugElement.query(By.directive(AddCardToDeckModalComponent)).componentInstance as AddCardToDeckModalComponent;
    const input = document.createElement('input');

    input.value = '123';
    modal.selectDeckQuantity({ target: input } as unknown as Event);
    expect(modal.selectedDeckQuantity()).toBe(12);

    input.value = '0';
    modal.selectDeckQuantity({ target: input } as unknown as Event);
    expect(modal.selectedDeckQuantity()).toBe(1);

    modal.decreaseDeckQuantity();
    expect(modal.selectedDeckQuantity()).toBe(1);

    input.value = '99';
    modal.selectDeckQuantity({ target: input } as unknown as Event);
    modal.increaseDeckQuantity();
    expect(modal.selectedDeckQuantity()).toBe(99);
  });
});

function cardFixture(scryfallId: string, name: string, overrides: Partial<Card> = {}): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: '',
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: {},
    cardFaces: [],
    hasRulings: false,
    allParts: [],
    manaValue: 1,
    producedMana: [],
    prices: {},
    layout: 'normal',
    commanderLegal: true,
    set: 'tst',
    collectorNumber: '1',
    ...overrides,
  };
}
