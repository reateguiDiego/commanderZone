import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
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
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { CommunityApi } from '../../../core/api/community.api';
import { DecksApi } from '../../../core/api/decks.api';
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

    const decksApi = {
      quickBuild: vi.fn().mockReturnValue(of({
        deck: { id: 'saved-deck', name: 'Readonly Deck', format: 'commander', folderId: null, cards: [] },
        missing: [],
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
                visibility: 'public',
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
                owner: { displayName: 'Alber' },
              },
            })),
          },
        },
        {
          provide: DecksApi,
          useValue: decksApi,
        },
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

    const fixture = TestBed.createComponent(CommunityDeckDetailPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Analysis');
    expect(text).toContain('Considering');
    expect(text).toContain('Validation');
    expect(text).not.toContain('History');
    expect(text).not.toContain('Missing');
    expect(header?.title).toBe('Readonly Deck');
    expect(header?.context).toBe('community-deck-detail');
    expect(header?.sharedBy?.displayName).toBe('Alber');
    expect(header?.stats).toBeUndefined();
    expect(header?.actions?.map((action) => action.id)).toEqual([
      'back-to-community-decks',
      'save-deck',
      'export-deck',
      'share-deck',
    ]);
    expect(fixture.nativeElement.querySelector('app-deck-card-menu')).toBeNull();

    const saveAction = header?.actions?.find((action) => action.id === 'save-deck');
    expect(saveAction).toBeDefined();
    saveAction?.execute();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Do you want to save this deck to your deck list?');
    expect(decksApi.quickBuild).not.toHaveBeenCalled();

    const confirmButton = fixture.nativeElement.querySelector('app-modal .modal-panel button.primary-button') as HTMLButtonElement;
    confirmButton.click();
    await vi.waitFor(() => expect(decksApi.quickBuild).toHaveBeenCalledOnce());
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
                owner: { displayName: 'Alber' },
              },
            })),
          },
        },
        {
          provide: DecksApi,
          useValue: {
            quickBuild: vi.fn().mockReturnValue(of({
              deck: { id: 'saved-deck', name: 'Readonly Deck', format: 'commander', folderId: null, cards: [] },
              missing: [],
            })),
          },
        },
        { provide: CardsApi, useValue: cardsApi },
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
          },
        },
        {
          provide: DeckFormatsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: DecksApi,
          useValue: {
            quickBuild: vi.fn(),
          },
        },
        {
          provide: CardsApi,
          useValue: {
            get: vi.fn(),
            printings: vi.fn(),
          },
        },
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
