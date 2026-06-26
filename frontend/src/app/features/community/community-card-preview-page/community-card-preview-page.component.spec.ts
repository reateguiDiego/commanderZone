import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Image as ImageIcon, List, LucideAngularModule } from 'lucide-angular';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { CommunityApi } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { CommunityCardPreviewPageComponent } from './community-card-preview-page.component';

describe('CommunityCardPreviewPageComponent', () => {
  it('calls the top commanders service, renders the preview data and reuses the cache', async () => {
    const cardsApi = {
      get: vi.fn(),
      printings: vi.fn(),
    };
    const api = {
      topCommanders: vi.fn().mockReturnValue(of({
        items: [
          { id: 'card-1', scryfallId: 'scryfall-1', name: 'Atraxa, Grand Unifier', cropImage: 'https://cards.test/atraxa.jpg', colors: ['W', 'U', 'B', 'G'], cardType: 'Legendary Creature - Phyrexian Angel', cardTypeIcon: 'creature', timesPlayed: 1800, rank: 1 },
          { id: 'card-2', scryfallId: 'scryfall-2', name: 'The Ur-Dragon', cropImage: 'https://cards.test/ur-dragon.jpg', colors: ['W', 'U', 'B', 'R', 'G'], cardType: 'Legendary Creature - Dragon Avatar', cardTypeIcon: 'creature', timesPlayed: 2900, rank: 2 },
        ],
        total: 2,
        isPreview: true,
        message: 'preview',
      })),
      topCards: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityCardPreviewPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ List, Image: ImageIcon })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        { provide: DeviceProfileService, useValue: { hasHover: signal(true), isMobileLayout: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'commanders' } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityCardPreviewPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.topCommanders).toHaveBeenCalledTimes(1);
    expect(api.topCommanders).toHaveBeenCalledWith({ type: '', colors: '', lang: 'es' });
    expect(fixture.nativeElement.textContent).toContain('Atraxa, Grand Unifier');
    expect(fixture.nativeElement.textContent).toContain('2900');
    expect(fixture.nativeElement.textContent).toContain('Legendary Creature - Dragon Avatar');
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.card-preview-result strong') as NodeListOf<HTMLElement>).map((node) => node.textContent?.trim()),
    ).toEqual(['The Ur-Dragon', 'Atraxa, Grand Unifier']);

    const secondFixture = TestBed.createComponent(CommunityCardPreviewPageComponent);
    secondFixture.detectChanges();
    await vi.waitFor(() => expect(secondFixture.componentInstance.loading()).toBe(false));

    expect(api.topCommanders).toHaveBeenCalledTimes(1);
  });

  it('calls the top cards service and renders the preview data', async () => {
    const cardsApi = {
      get: vi.fn(),
      printings: vi.fn(),
    };
    const api = {
      topCommanders: vi.fn(),
      topCards: vi.fn().mockReturnValue(of({
        items: [
          { id: 'card-2', scryfallId: 'scryfall-2', name: 'Cyclonic Rift', cropImage: 'https://cards.test/rift.jpg', colors: ['U'], cardType: 'Instant', cardTypeIcon: 'instant', timesPlayed: 2400, rank: 1 },
          { id: 'card-3', scryfallId: 'scryfall-3', name: 'Sol Ring', cropImage: 'https://cards.test/sol-ring.jpg', colors: [], cardType: 'Artifact', cardTypeIcon: 'artifact', timesPlayed: 3000, rank: 2 },
        ],
        total: 2,
        isPreview: true,
        message: 'preview',
      })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityCardPreviewPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ List, Image: ImageIcon })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        { provide: DeviceProfileService, useValue: { hasHover: signal(true), isMobileLayout: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'cards' } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityCardPreviewPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.topCards).toHaveBeenCalledTimes(1);
    expect(api.topCards).toHaveBeenCalledWith({ type: '', colors: '', lang: 'es' });
    expect(fixture.nativeElement.textContent).toContain('Cyclonic Rift');
    expect(fixture.nativeElement.textContent).toContain('3000');
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.card-preview-result strong') as NodeListOf<HTMLElement>).map((node) => node.textContent?.trim()),
    ).toEqual(['Sol Ring', 'Cyclonic Rift']);
  });

  it('reuses the cards modals for details and printings actions', async () => {
    const cardsApi = {
      get: vi.fn().mockReturnValue(of({
        card: {
          id: 'card-1',
          scryfallId: 'scryfall-1',
          name: 'Sol Ring',
          manaCost: '{1}',
          typeLine: 'Artifact',
          oracleText: '{T}: Add {C}.',
          colors: [],
          colorIdentity: [],
          legalities: { commander: 'legal' },
          imageUris: {},
          layout: 'normal',
          commanderLegal: true,
          set: 'lea',
          collectorNumber: '233',
        },
      })),
      printings: vi.fn().mockReturnValue(of({
        data: [{
          id: 'card-1',
          scryfallId: 'scryfall-1',
          name: 'Sol Ring',
          manaCost: '{1}',
          typeLine: 'Artifact',
          oracleText: '{T}: Add {C}.',
          colors: [],
          colorIdentity: [],
          legalities: { commander: 'legal' },
          imageUris: {},
          layout: 'normal',
          commanderLegal: true,
          set: 'lea',
          setName: 'Limited Edition Alpha',
          collectorNumber: '233',
        }],
      })),
    };
    const api = {
      topCommanders: vi.fn().mockReturnValue(of({
        items: [
          { id: 'card-1', scryfallId: 'scryfall-1', name: 'Sol Ring', cropImage: 'https://cards.test/sol-ring.jpg', colors: [], cardType: 'Artifact', cardTypeIcon: 'artifact', timesPlayed: 3000, rank: 1 },
        ],
        total: 1,
        isPreview: true,
        message: 'preview',
      })),
      topCards: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityCardPreviewPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ List, Image: ImageIcon })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        { provide: DeviceProfileService, useValue: { hasHover: signal(true), isMobileLayout: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'commanders' } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityCardPreviewPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    await fixture.componentInstance.handlePreviewAction({
      action: 'details',
      item: {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Sol Ring',
        cropImage: 'https://cards.test/sol-ring.jpg',
      },
    });

    expect(cardsApi.get).toHaveBeenCalledWith('scryfall-1');
    expect(fixture.componentInstance.detailsDialog()?.card?.name).toBe('Sol Ring');

    await fixture.componentInstance.handlePreviewAction({
      action: 'printings',
      item: {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Sol Ring',
        cropImage: 'https://cards.test/sol-ring.jpg',
      },
    });

    expect(cardsApi.printings).toHaveBeenCalledWith('scryfall-1');
    expect(fixture.componentInstance.printingsDialog()?.printings.length).toBe(1);
  });

  it('forces spoiler view and hides the view toggle on mobile layouts without hover', async () => {
    const cardsApi = {
      get: vi.fn(),
      printings: vi.fn(),
    };
    const api = {
      topCommanders: vi.fn().mockReturnValue(of({
        items: [
          { id: 'card-1', scryfallId: 'scryfall-1', name: 'Atraxa, Grand Unifier', cropImage: 'https://cards.test/atraxa.jpg', colors: ['W', 'U', 'B', 'G'], cardType: 'Legendary Creature - Phyrexian Angel', cardTypeIcon: 'creature', timesPlayed: 1800, rank: 1 },
        ],
        total: 1,
        isPreview: true,
        message: 'preview',
      })),
      topCards: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityCardPreviewPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ List, Image: ImageIcon })),
        { provide: CardsApi, useValue: cardsApi },
        { provide: CommunityApi, useValue: api },
        { provide: DeckFormatsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        { provide: DeviceProfileService, useValue: { hasHover: signal(false), isMobileLayout: signal(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'commanders' } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityCardPreviewPageComponent);
    fixture.componentInstance.viewMode.set('list');
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(fixture.componentInstance.spoilerOnlyView()).toBe(true);
    expect(fixture.componentInstance.effectiveViewMode()).toBe('spoiler');
    expect(fixture.nativeElement.querySelector('app-tab-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('.card-preview-results--spoiler')).not.toBeNull();
  });
});
