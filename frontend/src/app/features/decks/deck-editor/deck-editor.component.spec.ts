import { computed, importProvidersFrom, signal } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import {
  BarChart3,
  BookmarkPlus,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  FileDown,
  FileUp,
  History,
  Layers3,
  LucideAngularModule,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  SearchX,
  ShieldCheck,
  Shuffle,
  Trash,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { AppShellI18nService } from '../../../core/localization/app-shell-i18n.service';
import { SupportedLanguageCode } from '../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { Card } from '../../../core/models/card.model';
import { Deck, DeckCard, DeckSection } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckEditorComponent } from './deck-editor.component';

describe('DeckEditorComponent', () => {
  async function setup(
    routeParams: Record<string, string> = {},
    deck?: Deck,
    languageConfig: { cardLanguage?: SupportedLanguageCode; appLanguage?: SupportedLanguageCode } = {},
  ) {
    const cardLanguage = signal<SupportedLanguageCode>(languageConfig.cardLanguage ?? 'en');
    const appLanguage = signal<SupportedLanguageCode>(languageConfig.appLanguage ?? 'en');
    const decksApi = {
      get: vi.fn().mockReturnValue(of({ deck })),
      tokens: vi.fn().mockReturnValue(of({ data: [], unresolved: [] })),
      validateCommander: vi.fn().mockReturnValue(of(validCommanderValidation())),
    };
    const languagePreferencesMock = {
      cardLanguage,
      appLanguage,
    };
    const i18nMock = {
      locale: computed(() => appLanguage() === 'es' ? 'es' : 'en'),
      languageName: (code: SupportedLanguageCode) => languageNamesForLocale(appLanguage() === 'es' ? 'es' : 'en')[code],
    };

    await TestBed.configureTestingModule({
      imports: [DeckEditorComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          BarChart3,
          BookmarkPlus,
          Camera,
          CheckCircle2,
          ChevronDown,
          ChevronRight,
          Copy,
          EyeOff,
          FileDown,
          FileUp,
          History,
          Layers3,
          Minus,
          Plus,
          RotateCcw,
          RotateCw,
          Save,
          Search,
          SearchX,
          ShieldCheck,
          Shuffle,
          Trash,
          TriangleAlert,
          Upload,
          X,
        })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })), image: vi.fn() } },
        { provide: DecksApi, useValue: decksApi },
        { provide: LanguagePreferencesService, useValue: languagePreferencesMock },
        { provide: AppShellI18nService, useValue: i18nMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();
  }

  it('shows a missing deck id error without a route id', async () => {
    await setup();
    const fixture = TestBed.createComponent(DeckEditorComponent);

    expect(fixture.componentInstance.store.error()).toBe('Missing deck id.');
  });

  it('keeps sideboard cards grouped after lands', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Test deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('main-land', 'main', card('Command Tower', 'Land')),
        deckCard('side-land', 'sideboard', card('Wastes', 'Basic Land')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const groups = fixture.componentInstance.store.cardGroups();
    expect(groups.map((group) => group.id)).toEqual(['commander', 'land', 'sideboard']);
    expect(groups.find((group) => group.id === 'sideboard')?.cards[0].card.name).toBe('Wastes');
  });

  it('shows land quantity including modal double-faced lands assigned to other groups', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Test deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('main-mdfc', 'main', card('Bala Ged Recovery // Bala Ged Sanctuary', 'Sorcery // Land', 'modal_dfc')),
        deckCard('main-land', 'main', card('Command Tower', 'Land')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const landGroup = fixture.componentInstance.store.cardGroups().find((group) => group.id === 'land');
    expect(landGroup?.quantity).toBe(1);
    expect(landGroup?.detail).toBe('2 including MDFC');
  });

  it('balances card groups across text columns by estimated height', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Balanced deck',
      format: 'commander',
      folderId: null,
      cards: [
        ...manyDeckCards('creature', 21, 'Creature'),
        ...manyDeckCards('instant', 14, 'Instant'),
        ...manyDeckCards('sorcery', 14, 'Sorcery'),
        ...manyDeckCards('enchantment', 7, 'Enchantment'),
        ...manyDeckCards('artifact', 9, 'Artifact'),
        ...manyDeckCards('land', 36, 'Land'),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const groups = fixture.componentInstance.store.cardGroups();
    const columns = fixture.componentInstance.store.cardColumns();
    const columnWeights = columns
      .map((column) => column.groups.reduce((total, group) => total + estimatedGroupWeight(group.id, group.quantity), 0));
    const flattenedColumnGroupIds = columns.flatMap((column) => column.groups.map((group) => group.id));

    expect(columnWeights).toHaveLength(2);
    expect(Math.abs(columnWeights[0] - columnWeights[1])).toBeLessThanOrEqual(8);
    expect(flattenedColumnGroupIds).toEqual(groups.map((group) => group.id));
  });

  it('shows deck title warning only for backend validation errors', async () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Test deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', card('Black Lotus', 'Artifact'))],
    };
    await setup({ id: 'deck-1' }, deck);
    const fixture = TestBed.createComponent(DeckEditorComponent);

    fixture.componentInstance.store.validation.set({
      valid: false,
      format: 'commander',
      counts: { total: 100, commander: 1, main: 99, sideboard: 0, maybeboard: 0 },
      commander: { mode: 'single', names: ['Atraxa'], colorIdentity: ['W', 'U', 'B', 'G'] },
      errors: [{
        code: 'card.commander_banned',
        title: 'Banned card',
        detail: 'Black Lotus is banned in Commander.',
        cards: ['Black Lotus'],
      }],
      warnings: [{
        code: 'card.layout_review',
        title: 'Review',
        detail: 'Only warning.',
        cards: ['Black Lotus'],
      }],
    });

    expect(fixture.componentInstance.store.hasDeckIssues()).toBe(true);
    expect(fixture.componentInstance.store.deckIssueTooltip()).toContain('Banned card');

    fixture.componentInstance.store.validation.set({
      ...validCommanderValidation(),
      warnings: [{
        code: 'card.layout_review',
        title: 'Review',
        detail: 'Only warning.',
        cards: ['Black Lotus'],
      }],
    });

    expect(fixture.componentInstance.store.hasDeckIssues()).toBe(false);
  });

  it('closes transient deck editor overlays together', async () => {
    const testCard = card('Black Lotus', 'Artifact');
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Overlay deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', testCard)],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    fixture.componentInstance.store.cardMenu.set({
      entryId: 'main-card',
      top: 10,
      left: 10,
      amount: 1,
      showImagePreview: true,
    });
    fixture.componentInstance.store.cardPreview.set({
      card: testCard,
      imageUrl: null,
      top: 20,
      left: 20,
    });
    fixture.componentInstance.store.hoverList.set({
      title: 'Hover',
      items: ['Black Lotus'],
      top: 30,
      left: 30,
    });

    fixture.componentInstance.store.closeTransientOverlays();

    expect(fixture.componentInstance.store.cardMenu()).toBeNull();
    expect(fixture.componentInstance.store.cardPreview()).toBeNull();
    expect(fixture.componentInstance.store.hoverList()).toBeNull();
  });

  it('closes transient overlays when a zoom shortcut is used', async () => {
    const testCard = card('Black Lotus', 'Artifact');
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Zoom deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', testCard)],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    fixture.componentInstance.store.cardMenu.set({
      entryId: 'main-card',
      top: 10,
      left: 10,
      amount: 1,
      showImagePreview: true,
    });
    fixture.componentInstance.store.cardPreview.set({
      card: testCard,
      imageUrl: null,
      top: 20,
      left: 20,
    });

    fixture.componentInstance.handleDocumentKeydown(new KeyboardEvent('keydown', {
      code: 'NumpadAdd',
      ctrlKey: true,
    }));

    expect(fixture.componentInstance.store.cardMenu()).toBeNull();
    expect(fixture.componentInstance.store.cardPreview()).toBeNull();
  });

  it('closes transient overlays on desktop scroll', async () => {
    const testCard = card('Black Lotus', 'Artifact');
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Scroll deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', testCard)],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    fixture.componentInstance.store.cardMenu.set({
      entryId: 'main-card',
      top: 10,
      left: 10,
      amount: 1,
      showImagePreview: true,
    });
    fixture.componentInstance.store.cardPreview.set({
      card: testCard,
      imageUrl: null,
      top: 20,
      left: 20,
    });

    fixture.componentInstance.handleWindowScroll();

    expect(fixture.componentInstance.store.cardMenu()).toBeNull();
    expect(fixture.componentInstance.store.cardPreview()).toBeNull();
  });

  it('publishes the deck title and warning to the page header', async () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Header deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', card('Black Lotus', 'Artifact'))],
    };
    await setup({ id: 'deck-1' }, deck);
    const fixture = TestBed.createComponent(DeckEditorComponent);
    fixture.detectChanges();
    await fixture.componentInstance.store.load();

    fixture.componentInstance.store.validation.set({
      valid: false,
      format: 'commander',
      counts: { total: 100, commander: 1, main: 99, sideboard: 0, maybeboard: 0 },
      commander: { mode: 'single', names: ['Atraxa'], colorIdentity: ['W', 'U', 'B', 'G'] },
      errors: [{
        code: 'card.commander_banned',
        title: 'Banned card',
        detail: 'Black Lotus is banned in Commander.',
        cards: ['Black Lotus'],
      }],
      warnings: [],
    });
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();
    expect(header?.title).toBe('Header deck');
    expect(header?.actions?.[0]?.id).toBe('back-to-decks');
    expect(header?.titleWarning?.tone).toBe('danger');
    expect(header?.titleWarning?.tooltip).toContain('Banned card');
  });

  it('groups print versions by preferred language, alternatives, and English for Spanish card preference', async () => {
    const deck = buildDeckWithSingleCard();
    await setup({ id: 'deck-1' }, deck, { cardLanguage: 'es', appLanguage: 'es' });
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const { store } = fixture.componentInstance;

    store.printVersionEntry.set(deck.cards?.[0] ?? null);
    store.printVersionModalOpen.set(true);
    store.printVersionOptions.set([
      printCard('sol-ring-es-1', 'es', 'one', '1'),
      printCard('sol-ring-ph-1', 'ph', 'four', '4'),
      printCard('sol-ring-en-1', 'en', 'two', '2'),
      printCard('sol-ring-es-2', 'es', 'five', '5'),
      printCard('sol-ring-pt-1', 'pt', 'three', '3'),
      printCard('sol-ring-en-2', 'en', 'six', '6'),
    ]);

    const groups = store.printVersionGroups();

    expect(groups.map((group) => group.title)).toEqual(['Espanol', 'Alternativos', 'Ingles']);
    expect(groups[0]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-es-1', 'sol-ring-es-2']);
    expect(groups[1]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-ph-1']);
    expect(groups[2]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-en-1', 'sol-ring-en-2']);
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-pt-1');
  });

  it('groups print versions as English then alternatives when preferred language is English', async () => {
    const deck = buildDeckWithSingleCard();
    await setup({ id: 'deck-1' }, deck, { cardLanguage: 'en', appLanguage: 'en' });
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const { store } = fixture.componentInstance;

    store.printVersionEntry.set(deck.cards?.[0] ?? null);
    store.printVersionModalOpen.set(true);
    store.printVersionOptions.set([
      printCard('sol-ring-en-1', 'en', 'one', '1'),
      printCard('sol-ring-ph-1', 'ph', 'two', '2'),
      printCard('sol-ring-fr-1', 'fr', 'three', '3'),
      printCard('sol-ring-en-2', 'en', 'four', '4'),
    ]);

    const groups = store.printVersionGroups();

    expect(groups.map((group) => group.title)).toEqual(['English', 'Alternatives']);
    expect(groups[0]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-en-1', 'sol-ring-en-2']);
    expect(groups[1]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-ph-1']);
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-fr-1');
  });

  it('returns only non-empty print version sections', async () => {
    const deck = buildDeckWithSingleCard();
    await setup({ id: 'deck-1' }, deck, { cardLanguage: 'es', appLanguage: 'es' });
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const { store } = fixture.componentInstance;

    store.printVersionEntry.set(deck.cards?.[0] ?? null);
    store.printVersionModalOpen.set(true);
    store.printVersionOptions.set([
      printCard('sol-ring-en-1', 'en', 'one', '1'),
      printCard('sol-ring-en-2', 'en', 'two', '2'),
    ]);

    expect(store.printVersionGroups().map((group) => group.title)).toEqual(['Ingles']);
  });

  it('uses a reduced limit when searching missing cards in the deck editor', async () => {
    await setup({ id: 'deck-1' }, buildDeckWithSingleCard());
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };

    fixture.componentInstance.store.missingSearchQuery = 'Sol Ring';
    await fixture.componentInstance.store.searchMissingQuery();

    expect(cardsApi.search).toHaveBeenCalledWith('Sol Ring', 1, 60);
  });
});

function deckCard(id: string, section: DeckSection, card: Card): DeckCard {
  return { id, section, card, quantity: 1 };
}

function manyDeckCards(prefix: string, count: number, typeLine: string): DeckCard[] {
  return Array.from({ length: count }, (_, index) => {
    const name = `${prefix} ${index + 1}`;

    return deckCard(`${prefix}-${index + 1}`, 'main', card(name, typeLine));
  });
}

function estimatedGroupWeight(id: string, quantity: number): number {
  return id === 'commander' ? 10 : 2 + quantity;
}

function buildDeckWithSingleCard(): Deck {
  return {
    id: 'deck-1',
    name: 'Print deck',
    format: 'commander',
    folderId: null,
    cards: [deckCard('main-card', 'main', card('Sol Ring', 'Artifact'))],
  };
}

function validCommanderValidation() {
  return {
    valid: true,
    format: 'commander' as const,
    counts: { total: 100, commander: 1, main: 99, sideboard: 0, maybeboard: 0 },
    commander: { mode: 'single' as const, names: ['Atraxa'], colorIdentity: ['W', 'U', 'B', 'G'] },
    errors: [],
    warnings: [],
  };
}

function card(name: string, typeLine: string, layout = 'normal'): Card {
  return {
    id: `${name}-id`,
    scryfallId: `${name}-scryfall-id`,
    name,
    manaCost: null,
    typeLine,
    oracleText: null,
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: {},
    layout,
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}

function printCard(scryfallId: string, lang: string, setCode: string, collectorNumber: string): Card {
  return {
    ...card('Sol Ring', 'Artifact'),
    id: scryfallId,
    scryfallId,
    lang,
    set: setCode,
    collectorNumber,
  };
}

function languageNamesForLocale(locale: 'en' | 'es'): Record<SupportedLanguageCode, string> {
  return locale === 'es'
    ? {
      en: 'Ingles',
      fr: 'Frances',
      de: 'Aleman',
      it: 'Italiano',
      es: 'Espanol',
      ja: 'Japones',
      zhs: 'Chino (S)',
      pt: 'Portugues',
      ru: 'Ruso',
      ko: 'Coreano',
      zht: 'Chino (T)',
      nl: 'Holandes',
      ca: 'Catalan',
    }
    : {
      en: 'English',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      es: 'Spanish',
      ja: 'Japanese',
      zhs: 'Chinese (Simplified)',
      pt: 'Portuguese',
      ru: 'Russian',
      ko: 'Korean',
      zht: 'Chinese (Traditional)',
      nl: 'Dutch',
      ca: 'Catalan',
    };
}
