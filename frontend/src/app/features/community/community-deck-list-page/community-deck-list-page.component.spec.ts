import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ChevronDown, ChevronLeft, ChevronRight, Globe, LucideAngularModule, Search } from 'lucide-angular';
import { of } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { CommunityDeckListPageComponent } from './community-deck-list-page.component';

describe('CommunityDeckListPageComponent', () => {
  it('loads the public deck list and can open a community deck', async () => {
    const firstPage = {
        decks: [
          {
            id: 'deck-1',
            publicSlug: 'atraxa-grand-unifier-atraxa-tokens-d3ck0001',
            canonicalPath: '/community/decks/atraxa-grand-unifier-atraxa-tokens-d3ck0001/',
            name: 'Atraxa Tokens',
            format: 'commander',
            valid: true,
            cropImage: 'https://cards.test/atraxa.jpg',
            commanderName: 'Atraxa, Grand Unifier',
            colorIdentity: ['W', 'U', 'B', 'G'],
            updatedAt: '2026-06-26T00:00:00Z',
          },
        ],
        page: 1,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasMore: true,
      };
    const secondPage = {
      decks: [
        {
          id: 'deck-2',
          publicSlug: 'tymna-thrasios-partner-value-commander-d3ck0002',
          canonicalPath: '/community/decks/tymna-thrasios-partner-value-commander-d3ck0002/',
          name: 'Partner Value',
          format: 'commander',
          valid: true,
          cropImage: 'https://cards.test/tymna.jpg',
          commanderName: 'Tymna the Weaver / Thrasios, Triton Hero',
          colorIdentity: ['W', 'U', 'B', 'G'],
          updatedAt: '2026-06-27T00:00:00Z',
        },
      ],
      page: 2,
      limit: 20,
      total: 21,
      totalPages: 2,
      hasMore: false,
    };
    const api = {
      decks: vi.fn((filters: { page?: number }) => of(filters.page === 2 ? secondPage : firstPage)),
    };
    const deckFormatsApi = {
      list: vi.fn().mockReturnValue(of({ data: [{ id: 'commander', name: 'Commander' }] })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckListPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronLeft, ChevronRight, Globe, Search })),
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: deckFormatsApi },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityDeckListPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.decks).toHaveBeenCalledWith({ page: 1 });
    expect(deckFormatsApi.list).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Search decks');
    expect(fixture.nativeElement.textContent).toContain('Atraxa Tokens');
    expect(fixture.componentInstance.totalPages()).toBe(2);
    expect(fixture.componentInstance.hasMore()).toBe(true);

    await fixture.componentInstance.nextPage();
    fixture.detectChanges();
    expect(api.decks).toHaveBeenCalledWith({ page: 2 });
    expect(fixture.nativeElement.textContent).toContain('Partner Value');

    fixture.componentInstance.openDeck({
      id: 'deck-1',
      publicSlug: 'atraxa-grand-unifier-atraxa-tokens-d3ck0001',
      canonicalPath: '/community/decks/atraxa-grand-unifier-atraxa-tokens-d3ck0001/',
      name: 'Atraxa Tokens',
      format: 'commander',
      valid: true,
      cropImage: 'https://cards.test/atraxa.jpg',
      commanderName: 'Atraxa, Grand Unifier',
      colorIdentity: ['W', 'U', 'B', 'G'],
      updatedAt: '2026-06-26T00:00:00Z',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/community/decks/atraxa-grand-unifier-atraxa-tokens-d3ck0001');
  });
});
