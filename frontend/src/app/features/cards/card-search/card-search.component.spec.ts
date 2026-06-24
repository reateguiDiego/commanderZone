import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronLeft, ChevronRight, CircleHelp, Image, List, LucideAngularModule, RotateCcw, Search, X } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CardSearchComponent } from './card-search.component';

describe('CardSearchComponent', () => {
  const cardsApi = {
    search: vi.fn().mockReturnValue(of({ data: [] })),
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

  beforeEach(async () => {
    cardsApi.search.mockClear();
    cardsApi.searchOptions.mockClear();

    await TestBed.configureTestingModule({
      imports: [CardSearchComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Search, CircleHelp, RotateCcw, List, Image, X, ChevronLeft, ChevronRight })),
        { provide: CardsApi, useValue: cardsApi },
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
    expect(fixture.nativeElement.querySelector('app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside app-card-advanced-search-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main .cards-view-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-aside .cards-aside-actions')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-main app-card-search-results')).not.toBeNull();
    expect(cardsApi.searchOptions).toHaveBeenCalled();
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

    expect(cardsApi.search).toHaveBeenCalledWith('sol ring', 1, 20, {});
    expect(fixture.componentInstance.hasMore()).toBe(true);
    expect(fixture.componentInstance.page()).toBe(1);
    expect(fixture.componentInstance.totalResults()).toBe(41);
    expect(fixture.componentInstance.totalPages()).toBe(3);
    expect(fixture.componentInstance.filterPills()).toEqual([{ label: 'Name', value: 'sol ring' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cards-main .cards-view-actions')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cards-filter-summary__copy strong').textContent).toContain('41 total cards');
  });
});
