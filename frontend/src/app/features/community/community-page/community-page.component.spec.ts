import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronRight, Globe, LucideAngularModule, Sparkles, Trophy } from 'lucide-angular';
import { of } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { CommunityPageComponent } from './community-page.component';

describe('CommunityPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommunityPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronRight, Globe, Sparkles, Trophy })),
        {
          provide: CommunityApi,
          useValue: {
            home: vi.fn().mockReturnValue(of({
              commanders: [
                { id: 'commander-1', scryfallId: 'commander-scryfall-1', name: 'Atraxa, Grand Unifier', cropImage: 'https://cards.test/atraxa.jpg', colors: ['W', 'U', 'B', 'G'], cardType: 'Legendary Creature - Phyrexian Angel', cardTypeIcon: 'creature', timesPlayed: 1800 },
                { id: 'commander-2', scryfallId: 'commander-scryfall-2', name: 'The Ur-Dragon', cropImage: 'https://cards.test/ur-dragon.jpg', colors: ['W', 'U', 'B', 'R', 'G'], cardType: 'Legendary Creature - Dragon Avatar', cardTypeIcon: 'creature', timesPlayed: 2900 },
                { id: 'commander-3', scryfallId: 'commander-scryfall-3', name: 'Edgar Markov', cropImage: 'https://cards.test/edgar.jpg', colors: ['W', 'B', 'R'], cardType: 'Legendary Creature - Vampire Knight', cardTypeIcon: 'creature', timesPlayed: 2400 },
                { id: 'commander-4', scryfallId: 'commander-scryfall-4', name: 'Should Not Render', cropImage: 'https://cards.test/extra.jpg', colors: ['G'], cardType: 'Legendary Creature - Elf', cardTypeIcon: 'creature', timesPlayed: 900 },
              ],
              cards: [
                { id: 'card-1', scryfallId: 'card-scryfall-1', name: 'Sol Ring', cropImage: 'https://cards.test/sol-ring.jpg', cardType: 'Artifact', cardTypeIcon: 'artifact', timesPlayed: 3000 },
                { id: 'card-2', scryfallId: 'card-scryfall-2', name: 'Swords to Plowshares', cropImage: 'https://cards.test/stp.jpg', cardType: 'Instant', cardTypeIcon: 'instant', timesPlayed: 2100 },
                { id: 'card-3', scryfallId: 'card-scryfall-3', name: 'Cyclonic Rift', cropImage: 'https://cards.test/rift.jpg', cardType: 'Instant', cardTypeIcon: 'instant', timesPlayed: 2600 },
                { id: 'card-4', scryfallId: 'card-scryfall-4', name: 'Should Not Render', cropImage: 'https://cards.test/extra-card.jpg', cardType: 'Artifact', cardTypeIcon: 'artifact', timesPlayed: 1200 },
              ],
              decks: Array.from({ length: 7 }, (_, index) => ({
                id: `deck-${index + 1}`,
                name: `Deck ${index + 1}`,
                format: 'commander',
                valid: true,
                cropImage: 'https://cards.test/deck.jpg',
                commanderName: 'Atraxa, Grand Unifier',
                colorIdentity: ['W', 'U', 'B', 'G'],
                updatedAt: '2026-06-26T00:00:00Z',
              })),
            })),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        { provide: DeviceProfileService, useValue: { isMobileLayout: signal(false) } },
      ],
    }).compileComponents();
  });

  it('renders the Community home sections', async () => {
    const fixture = TestBed.createComponent(CommunityPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a.top-commanders-link'));

    expect(element.textContent).toContain('Decks de la comunidad');
    expect(element.textContent).toContain('Descubre decks');
    expect(element.textContent).toContain('Los comandantes mas jugados');
    expect(element.textContent).toContain('Las cartas mas jugados');
    expect(element.textContent).toContain('Basado en partidas jugadas por la comunidad');
    expect(element.textContent).toContain('Buscar decks');
    expect(element.textContent).toContain('3000');
    expect(element.textContent).toContain('Legendary Creature');
    expect(element.querySelectorAll('.commander-card')).toHaveLength(6);
    expect(element.querySelectorAll('app-deck-list-card')).toHaveLength(6);
    expect(element.textContent).not.toContain('Should Not Render');
    expect(
      Array.from(element.querySelectorAll('.commander-card h3')).map((node) => node.textContent?.trim()),
    ).toEqual([
      'The Ur-Dragon',
      'Edgar Markov',
      'Atraxa, Grand Unifier',
      'Sol Ring',
      'Cyclonic Rift',
      'Swords to Plowshares',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/community/top-commanders',
      '/community/top-cards',
    ]);
  });
});
