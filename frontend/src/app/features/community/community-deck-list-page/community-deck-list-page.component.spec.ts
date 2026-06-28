import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ChevronDown, Globe, LucideAngularModule, Search } from 'lucide-angular';
import { of } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { CommunityDeckListPageComponent } from './community-deck-list-page.component';

describe('CommunityDeckListPageComponent', () => {
  it('loads the public deck list and can open a community deck', async () => {
    const api = {
      decks: vi.fn().mockReturnValue(of({
        decks: [
          {
            id: 'deck-1',
            name: 'Atraxa Tokens',
            format: 'commander',
            valid: true,
            cropImage: 'https://cards.test/atraxa.jpg',
            commanderName: 'Atraxa, Grand Unifier',
            colorIdentity: ['W', 'U', 'B', 'G'],
            updatedAt: '2026-06-26T00:00:00Z',
          },
        ],
      })),
    };
    const deckFormatsApi = {
      list: vi.fn().mockReturnValue(of({ data: [{ id: 'commander', name: 'Commander' }] })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckListPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, Globe, Search })),
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: deckFormatsApi },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityDeckListPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.decks).toHaveBeenCalledWith({});
    expect(deckFormatsApi.list).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Buscar decks');
    expect(fixture.nativeElement.textContent).toContain('Atraxa Tokens');

    fixture.componentInstance.openDeck('deck-1');
    expect(navigateSpy).toHaveBeenCalledWith(['/community/decks', 'deck-1']);
  });
});
