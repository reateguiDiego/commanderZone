import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronLeft, ChevronRight, CircleHelp, Image, List, LucideAngularModule, RotateCcw, RotateCw, Search, SlidersHorizontal, X } from 'lucide-angular';
import { of, Subject } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Card } from '../../../core/models/card.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { CardSearchComponent } from './card-search.component';

describe('CardSearchComponent', () => {
  let isDesktop: ReturnType<typeof signal<boolean>>;
  let isDesktopLayout: ReturnType<typeof signal<boolean>>;
  let hasHover: ReturnType<typeof signal<boolean>>;

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
  const decksApi = {
    list: vi.fn().mockReturnValue(of({ data: [] })),
    addCard: vi.fn().mockReturnValue(of({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] } })),
  };

  beforeEach(async () => {
    isDesktop = signal(true);
    isDesktopLayout = signal(true);
    hasHover = signal(true);
    cardsApi.search.mockClear();
    cardsApi.printings.mockClear();
    cardsApi.searchOptions.mockClear();
    decksApi.list.mockClear();
    decksApi.addCard.mockClear();

    await TestBed.configureTestingModule({
      imports: [CardSearchComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Search, CircleHelp, RotateCcw, RotateCw, List, Image, X, ChevronLeft, ChevronRight, SlidersHorizontal })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: DecksApi, useValue: decksApi },
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
    expect(TestBed.inject(PageHeaderStore).state()?.titleActions?.[0]?.id).toBe('card-search-help');
    expect(fixture.nativeElement.querySelector('app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside app-card-search-help')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main .cards-view-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside .cards-aside-actions')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main app-card-search-results')).not.toBeNull();
    expect(cardsApi.searchOptions).toHaveBeenCalled();
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

    await fixture.componentInstance.openAddToDeck(cardFixture('red-card', 'Lightning Bolt', {
      colorIdentity: ['R'],
      commanderLegal: false,
      legalities: { commander: 'not_legal' },
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedDeckId()).toBe('');
    expect(fixture.componentInstance.selectedDeckSection()).toBe('');
    expect(fixture.nativeElement.querySelector('.add-to-deck-modal__card')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('app-format-select').length).toBeGreaterThanOrEqual(2);

    fixture.componentInstance.selectDeck('deck-1');
    fixture.componentInstance.selectDeckSection('main');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lightning Bolt has color identity outside Atraxa Deck');
    expect(fixture.nativeElement.textContent).toContain('Lightning Bolt is not legal in Commander');
    expect(fixture.nativeElement.querySelector('.add-to-deck-modal__warnings app-mana-symbols')).not.toBeNull();
  });

  it('keeps add-to-deck quantity between one and ninety-nine', () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    const input = document.createElement('input');

    input.value = '123';
    fixture.componentInstance.selectDeckQuantity({ target: input } as unknown as Event);
    expect(fixture.componentInstance.selectedDeckQuantity()).toBe(12);

    input.value = '0';
    fixture.componentInstance.selectDeckQuantity({ target: input } as unknown as Event);
    expect(fixture.componentInstance.selectedDeckQuantity()).toBe(1);

    fixture.componentInstance.decreaseDeckQuantity();
    expect(fixture.componentInstance.selectedDeckQuantity()).toBe(1);

    input.value = '99';
    fixture.componentInstance.selectDeckQuantity({ target: input } as unknown as Event);
    fixture.componentInstance.increaseDeckQuantity();
    expect(fixture.componentInstance.selectedDeckQuantity()).toBe(99);
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
