import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom, signal } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Heart,
  History,
  Layers3,
  LucideAngularModule,
  RotateCw,
  SearchX,
  ShieldCheck,
  Shuffle,
  TriangleAlert,
  X,
} from 'lucide-angular';
import { Subject, of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommunityApi } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CommunityDeckDetailPageComponent } from './community-deck-detail-page.component';

describe('CommunityDeckDetailPageComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a readonly community deck detail without edit actions', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const communityApi = {
      copyDeck: vi.fn().mockReturnValue(of({
        deck: { id: 'saved-deck', name: 'Readonly Deck', format: 'commander', folderId: null, cards: [] },
        source: { id: 'deck-1', copies: 1 },
      })),
      likeDeck: vi.fn().mockReturnValue(of({ deck: { id: 'deck-1', likes: 1, likedByViewer: true } })),
      deck: vi.fn().mockReturnValue(of({
        deck: {
          id: 'deck-1',
          name: 'Readonly Deck',
          format: 'commander',
          valid: true,
          cropImage: null,
          commanderName: 'Atraxa, Grand Unifier',
          colorIdentity: ['W', 'U', 'B', 'G'],
          updatedAt: '2026-06-26T00:00:00Z',
          likes: 0,
          copies: 0,
          creatorUserId: 'user-1',
          likedByViewer: false,
          visibility: 'public',
          publicSlug: 'readonly-deck-a7f3c9d2',
          folderId: null,
          commanders: [{
            id: 'card-1',
            scryfallId: 'card-1',
            name: 'Atraxa, Grand Unifier',
            manaCost: '{G}{W}{U}{B}',
            typeLine: 'Legendary Creature',
            oracleText: null,
            colors: ['G', 'W', 'U', 'B'],
            colorIdentity: ['G', 'W', 'U', 'B'],
            legalities: { commander: 'legal' },
            imageUris: {},
            layout: 'normal',
            commanderLegal: true,
            set: null,
            collectorNumber: null,
          }],
          cards: [{
            id: 'deck-card-1',
            quantity: 1,
            section: 'commander',
            card: {
              id: 'card-1',
              scryfallId: 'card-1',
              name: 'Atraxa, Grand Unifier',
              manaCost: '{G}{W}{U}{B}',
              typeLine: 'Legendary Creature',
              oracleText: null,
              colors: ['G', 'W', 'U', 'B'],
              colorIdentity: ['G', 'W', 'U', 'B'],
              legalities: { commander: 'legal' },
              imageUris: {},
              layout: 'normal',
              commanderLegal: true,
              set: null,
              collectorNumber: null,
            },
          }],
          sections: {
            commander: [],
            main: [],
            sideboard: [],
            maybeboard: [],
          },
          owner: {
            id: 'owner-1',
            displayName: 'Alber',
            displayNameStyle: { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' },
          },
        },
      })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        {
          provide: CommunityApi,
          useValue: communityApi,
        },
        { provide: AuthStore, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn().mockReturnValue(of({
              card: {
                id: 'card-1',
                scryfallId: 'card-1',
                name: 'Atraxa, Grand Unifier',
                manaCost: '{G}{W}{U}{B}',
                typeLine: 'Legendary Creature',
                oracleText: 'Flying, vigilance, deathtouch, lifelink',
                colors: ['G', 'W', 'U', 'B'],
                colorIdentity: ['G', 'W', 'U', 'B'],
                legalities: { commander: 'legal' },
                imageUris: {},
                layout: 'normal',
                commanderLegal: true,
                set: 'one',
                collectorNumber: '196',
              },
            })),
            printings: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'deck-1' }) } },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Analysis');
    expect(text).toContain('Advanced Analysis');
    expect(text).toContain('Deep deck health, combos, consistency and power signals.');
    expect(text).toContain('Considering');
    expect(text).toContain('Validation');
    expect(text).not.toContain('History');
    expect(text).not.toContain('Missing');
    expect(header?.title).toBe('Readonly Deck');
    expect(header?.context).toBe('community-deck-detail');
    expect(header?.sharedBy?.displayName).toBe('Alber');
    expect(header?.sharedBy?.nameStyle).toEqual({ type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    expect(header?.stats).toBeUndefined();
    expect(header?.actions?.map((action) => action.id)).toEqual([
      'back-to-community-decks',
      'like-deck',
      'save-deck',
      'export-deck',
      'share-deck',
    ]);
    const likeAction = header?.actions?.find((action) => action.id === 'like-deck');
    expect(likeAction?.tone).toBe('danger');
    expect(likeAction?.counter).toBe(0);
    expect(likeAction?.counterLabel).toBe('community.deckCard.likes');
    expect(likeAction?.variant).toBe('secondary');
    const saveHeaderAction = header?.actions?.find((action) => action.id === 'save-deck');
    expect(saveHeaderAction?.counter).toBe(0);
    expect(saveHeaderAction?.counterLabel).toBe('community.deckCard.copies');
    const advancedAnalysisLink = fixture.nativeElement.querySelector(
      'a[aria-label="Open advanced analysis for this community deck"]',
    ) as HTMLAnchorElement | null;
    expect(advancedAnalysisLink?.getAttribute('href')).toBe('/community/decks/readonly-deck-a7f3c9d2/analysis');
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    advancedAnalysisLink?.click();
    expect(router.serializeUrl(navigateByUrlSpy.mock.calls[0]?.[0] as Parameters<Router['serializeUrl']>[0]))
      .toBe('/community/decks/readonly-deck-a7f3c9d2/analysis');
    expect(fixture.nativeElement.querySelector('app-deck-card-menu')).toBeNull();

    const saveAction = header?.actions?.find((action) => action.id === 'save-deck');
    expect(saveAction).toBeDefined();
    saveAction?.execute();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Do you want to save this deck to your deck list?');
    expect(communityApi.copyDeck).not.toHaveBeenCalled();

    const confirmButton = fixture.nativeElement.querySelector('app-modal .modal-panel button.primary-button') as HTMLButtonElement;
    confirmButton.click();
    await vi.waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(['/auth/register']));
    expect(communityApi.copyDeck).not.toHaveBeenCalled();
  });

  it('opens the shared details modal for community deck card actions', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const cardsApi = {
      get: vi.fn().mockReturnValue(of({
        card: {
          id: 'card-1',
          scryfallId: 'card-1',
          name: 'Atraxa, Grand Unifier',
          manaCost: '{G}{W}{U}{B}',
          typeLine: 'Legendary Creature',
          oracleText: 'Flying, vigilance, deathtouch, lifelink',
          colors: ['G', 'W', 'U', 'B'],
          colorIdentity: ['G', 'W', 'U', 'B'],
          legalities: { commander: 'legal' },
          imageUris: {},
          layout: 'normal',
          commanderLegal: true,
          set: 'one',
          collectorNumber: '196',
        },
      })),
      printings: vi.fn().mockReturnValue(of({ data: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        {
          provide: CommunityApi,
          useValue: {
            deck: vi.fn().mockReturnValue(of({
              deck: {
                id: 'deck-1',
                name: 'Readonly Deck',
                format: 'commander',
                valid: true,
                cropImage: null,
                commanderName: 'Atraxa, Grand Unifier',
                colorIdentity: ['W', 'U', 'B', 'G'],
                updatedAt: '2026-06-26T00:00:00Z',
                likes: 0,
                copies: 0,
                creatorUserId: 'user-1',
                likedByViewer: false,
                visibility: 'public',
                folderId: null,
                commanders: [],
                cards: [{
                  id: 'deck-card-1',
                  quantity: 1,
                  section: 'commander',
                  card: {
                    id: 'card-1',
                    scryfallId: 'card-1',
                    name: 'Atraxa, Grand Unifier',
                    manaCost: '{G}{W}{U}{B}',
                    typeLine: 'Legendary Creature',
                    oracleText: null,
                    colors: ['G', 'W', 'U', 'B'],
                    colorIdentity: ['G', 'W', 'U', 'B'],
                    legalities: { commander: 'legal' },
                    imageUris: {},
                    layout: 'normal',
                    commanderLegal: true,
                    set: 'one',
                    collectorNumber: '196',
                  },
                }],
                sections: {
                  commander: [],
                  main: [],
                  sideboard: [],
                  maybeboard: [],
                },
                owner: { id: 'owner-1', displayName: 'Alber' },
              },
            })),
            copyDeck: vi.fn(),
            likeDeck: vi.fn(),
          },
        },
        { provide: CardsApi, useValue: cardsApi },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'deck-1' }) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    await fixture.componentInstance.handleCardAction({
      action: 'details',
      card: {
        id: 'card-1',
        scryfallId: 'card-1',
        name: 'Atraxa, Grand Unifier',
        manaCost: '{G}{W}{U}{B}',
        typeLine: 'Legendary Creature',
        oracleText: null,
        colors: ['G', 'W', 'U', 'B'],
        colorIdentity: ['G', 'W', 'U', 'B'],
        legalities: { commander: 'legal' },
        imageUris: {},
        layout: 'normal',
        commanderLegal: true,
        set: 'one',
        collectorNumber: '196',
      },
    });
    fixture.detectChanges();

    expect(cardsApi.get).toHaveBeenCalledWith('card-1');
    expect(fixture.componentInstance.detailsDialog()?.card?.name).toBe('Atraxa, Grand Unifier');
    expect(fixture.nativeElement.querySelector('app-card-details-modal')).not.toBeNull();
  });

  it('likes and copies the community deck through CommunityApi actions', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const communityApi = {
      deck: vi.fn().mockReturnValue(of({
        deck: {
          id: 'deck-1',
          name: 'Readonly Deck',
          format: 'commander',
          valid: true,
          cropImage: null,
          commanderName: null,
          colorIdentity: [],
          updatedAt: '2026-06-26T00:00:00Z',
          likes: 0,
          copies: 0,
          creatorUserId: 'owner-1',
          likedByViewer: false,
          visibility: 'public',
          folderId: null,
          commanders: [],
          cards: [],
          sections: {
            commander: [],
            main: [],
            sideboard: [],
            maybeboard: [],
          },
          owner: { id: 'owner-1', displayName: 'Alber' },
        },
      })),
      likeDeck: vi.fn()
        .mockReturnValueOnce(of({ deck: { id: 'deck-1', likes: 7, likedByViewer: true } }))
        .mockReturnValueOnce(of({ deck: { id: 'deck-1', likes: 6, likedByViewer: false } })),
      copyDeck: vi.fn().mockReturnValue(of({
        deck: { id: 'saved-deck', slug: 'saved-slug', name: 'Readonly Deck', format: 'commander', folderId: null, cards: [] },
        source: { id: 'deck-1', copies: 3 },
      })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        { provide: CommunityApi, useValue: communityApi },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn(),
            printings: vi.fn(),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'deck-1' }) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    const header = TestBed.inject(PageHeaderStore).state();
    header?.actions?.find((action) => action.id === 'like-deck')?.execute();
    await vi.waitFor(() => expect(communityApi.likeDeck).toHaveBeenCalledWith('deck-1'));
    expect(fixture.componentInstance.deck()?.likes).toBe(7);
    expect(fixture.componentInstance.deck()?.likedByViewer).toBe(true);
    await vi.waitFor(() => expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.counter).toBe(7));
    expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.disabled).toBe(false);
    expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.variant).toBe('primary');

    TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.execute();
    await vi.waitFor(() => expect(communityApi.likeDeck).toHaveBeenCalledTimes(2));
    expect(fixture.componentInstance.deck()?.likes).toBe(6);
    expect(fixture.componentInstance.deck()?.likedByViewer).toBe(false);
    await vi.waitFor(() => expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.counter).toBe(6));
    expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.variant).toBe('secondary');

    await fixture.componentInstance.saveDeck();
    await vi.waitFor(() => expect(communityApi.copyDeck).toHaveBeenCalledWith('deck-1'));
    expect(fixture.componentInstance.deck()?.copies).toBe(3);
    await vi.waitFor(() => expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'save-deck')?.counter).toBe(3));
    expect(fixture.componentInstance.savedDeckIdentifier()).toBe('saved-slug');
    expect(fixture.componentInstance.saveSuccessModalOpen()).toBe(true);
  });

  it('disables like and save when the viewer owns the community deck', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const communityApi = {
      deck: vi.fn().mockReturnValue(of({
        deck: {
          id: 'deck-1',
          name: 'Own Public Deck',
          format: 'commander',
          valid: true,
          cropImage: null,
          commanderName: null,
          colorIdentity: [],
          updatedAt: '2026-06-26T00:00:00Z',
          likes: 5,
          copies: 2,
          creatorUserId: 'current-user',
          likedByViewer: false,
          visibility: 'public',
          folderId: null,
          commanders: [],
          cards: [],
          sections: {
            commander: [],
            main: [],
            sideboard: [],
            maybeboard: [],
          },
          owner: { id: 'current-user', displayName: 'Alber' },
        },
      })),
      likeDeck: vi.fn(),
      copyDeck: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        { provide: CommunityApi, useValue: communityApi },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn(),
            printings: vi.fn(),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'deck-1' }) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    const header = TestBed.inject(PageHeaderStore).state();
    const likeAction = header?.actions?.find((action) => action.id === 'like-deck');
    const saveAction = header?.actions?.find((action) => action.id === 'save-deck');
    expect(likeAction?.disabled).toBe(true);
    expect(saveAction?.disabled).toBe(true);
    expect(header?.sharedByLabel).toBe('This deck is yours.');
    expect(header?.sharedByOwnDeck).toBe(true);

    likeAction?.execute();
    saveAction?.execute();

    expect(communityApi.likeDeck).not.toHaveBeenCalled();
    expect(communityApi.copyDeck).not.toHaveBeenCalled();
    expect(fixture.componentInstance.saveConfirmationModalOpen()).toBe(false);
  });

  it('optimistically removes an existing like while the unlike request is pending', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const likeResponse = new Subject<{ deck: { id: string; likes: number; likedByViewer: boolean } }>();
    const communityApi = {
      deck: vi.fn().mockReturnValue(of({
        deck: {
          id: 'deck-1',
          name: 'Liked Deck',
          format: 'commander',
          valid: true,
          cropImage: null,
          commanderName: null,
          colorIdentity: [],
          updatedAt: '2026-06-26T00:00:00Z',
          likes: 4,
          copies: 0,
          creatorUserId: 'owner-1',
          likedByViewer: true,
          visibility: 'public',
          folderId: null,
          commanders: [],
          cards: [],
          sections: {
            commander: [],
            main: [],
            sideboard: [],
            maybeboard: [],
          },
          owner: { id: 'owner-1', displayName: 'Alber' },
        },
      })),
      likeDeck: vi.fn().mockReturnValue(likeResponse.asObservable()),
      copyDeck: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        { provide: CommunityApi, useValue: communityApi },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn(),
            printings: vi.fn(),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'deck-1' }) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.variant).toBe('primary');

    TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.execute();

    await vi.waitFor(() => expect(communityApi.likeDeck).toHaveBeenCalledWith('deck-1'));
    expect(fixture.componentInstance.deck()?.likedByViewer).toBe(false);
    expect(fixture.componentInstance.deck()?.likes).toBe(3);
    await vi.waitFor(() => expect(TestBed.inject(PageHeaderStore).state()?.actions?.find((action) => action.id === 'like-deck')?.variant).toBe('secondary'));

    likeResponse.next({ deck: { id: 'deck-1', likes: 3, likedByViewer: false } });
    likeResponse.complete();
    await vi.waitFor(() => expect(fixture.componentInstance.liking()).toBe(false));
  });

  it('navigates to the not found page when the community deck is missing', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    await TestBed.configureTestingModule({
      imports: [CommunityDeckDetailPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          ChevronDown,
          ChevronRight,
          Heart,
          History,
          Layers3,
          RotateCw,
          SearchX,
          ShieldCheck,
          Shuffle,
          TriangleAlert,
          X,
        })),
        {
          provide: CommunityApi,
          useValue: {
            deck: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
            copyDeck: vi.fn(),
            likeDeck: vi.fn(),
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn(),
            printings: vi.fn(),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'missing-deck' }) } },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/404', { replaceUrl: true }));

    expect(navigateSpy).toHaveBeenCalledWith('/404', { replaceUrl: true });
  });
});
