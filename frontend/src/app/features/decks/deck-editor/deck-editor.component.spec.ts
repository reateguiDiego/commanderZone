import { HttpErrorResponse } from '@angular/common/http';
import { computed, importProvidersFrom, signal } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
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
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { AppShellI18nService } from '../../../core/localization/app-shell-i18n.service';
import { SupportedLanguageCode } from '../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { Card, CardFace } from '../../../core/models/card.model';
import { Deck, DeckCard, DeckSection } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckEditorComponent } from './deck-editor.component';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';

type DecksApiMock = {
  get: ReturnType<typeof vi.fn>;
  importDecklist: ReturnType<typeof vi.fn>;
  tokens: ReturnType<typeof vi.fn>;
  validateCommander: ReturnType<typeof vi.fn>;
  updateCard: ReturnType<typeof vi.fn>;
  selectPrinting: ReturnType<typeof vi.fn>;
};

describe('DeckEditorComponent', () => {
  async function setup(
    routeParams: Record<string, string> = {},
    deck?: Deck,
    languageConfig: { cardLanguage?: SupportedLanguageCode; appLanguage?: SupportedLanguageCode } = {},
    decksApiOverrides: Partial<DecksApiMock> = {},
  ) {
    const cardLanguage = signal<SupportedLanguageCode>(languageConfig.cardLanguage ?? 'en');
    const appLanguage = signal<SupportedLanguageCode>(languageConfig.appLanguage ?? 'en');
    const decksApi: DecksApiMock = {
      get: vi.fn().mockReturnValue(of({ deck })),
      importDecklist: vi.fn().mockReturnValue(of({ deck: deck ?? buildDeckWithSingleCard(), missing: [], summary: { parsedCards: 1, importedCards: 1 } })),
      tokens: vi.fn().mockReturnValue(of({ data: [], unresolved: [] })),
      validateCommander: vi.fn().mockReturnValue(of(validCommanderValidation())),
      updateCard: vi.fn(),
      selectPrinting: vi.fn(),
      ...decksApiOverrides,
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

    return { decksApi, router: TestBed.inject(Router) };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a missing deck id error without a route id', async () => {
    await setup();
    const fixture = TestBed.createComponent(DeckEditorComponent);

    expect(fixture.componentInstance.store.error()).toBe('Missing deck id.');
  });

  it('navigates to the not found page when the deck API returns 404', async () => {
    const { router } = await setup(
      { id: 'missing-deck' },
      undefined,
      {},
      {
        get: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
      },
    );
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    expect(navigateSpy).toHaveBeenCalledWith('/404', { replaceUrl: true });
  });

  it('does not request deck tokens during the initial deck load', async () => {
    const { decksApi } = await setup({ id: 'deck-1' }, buildDeckWithSingleCard());
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    expect(decksApi.tokens).not.toHaveBeenCalled();
  });

  it('sends the raw decklist text to the backend import endpoint', async () => {
    const deck = buildDeckWithSingleCard();
    const importedDeck = {
      ...deck,
      cards: [
        deckCard('commander-card', 'commander', card('Muldrotha, the Gravetide', 'Legendary Creature')),
        deckCard('main-card', 'main', card('Arcane Signet', 'Artifact')),
      ],
    };
    const { decksApi } = await setup({ id: 'deck-1' }, deck, {}, {
      importDecklist: vi.fn().mockReturnValue(of({
        deck: importedDeck,
        missing: [],
        summary: {
          parsedCards: 2,
          importedCards: 2,
          totalCards: 2,
          resolvedCards: 2,
          missingCards: 0,
          commanderCount: 1,
          mainCount: 1,
          format: 'moxfield',
        },
      })),
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    fixture.componentInstance.store.decklist = `Commanders (1)
1 Muldrotha, the Gravetide

Deck
1 Arcane Signet`;

    await fixture.componentInstance.store.importDeck('deck-1');

    expect(decksApi.importDecklist).toHaveBeenCalledWith('deck-1', `Commanders (1)
1 Muldrotha, the Gravetide

Deck
1 Arcane Signet`);
  });

  it('refreshes deck tokens only after playable card changes', async () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Token refresh deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('main-card', 'main', card('Sol Ring', 'Artifact'), 1),
        deckCard('side-card', 'sideboard', card('Swan Song', 'Instant'), 1),
      ],
    };
    const sideboardUpdatedDeck: Deck = {
      ...deck,
      cards: [
        deckCard('main-card', 'main', card('Sol Ring', 'Artifact'), 1),
        deckCard('side-card', 'sideboard', card('Swan Song', 'Instant'), 2),
      ],
    };
    const mainUpdatedDeck: Deck = {
      ...deck,
      cards: [
        deckCard('main-card', 'main', card('Sol Ring', 'Artifact'), 2),
        deckCard('side-card', 'sideboard', card('Swan Song', 'Instant'), 2),
      ],
    };
    const { decksApi } = await setup({ id: 'deck-1' }, deck);
    decksApi.updateCard
      .mockReturnValueOnce(of({ deck: sideboardUpdatedDeck }))
      .mockReturnValueOnce(of({ deck: mainUpdatedDeck }));
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    decksApi.tokens.mockClear();

    const sideboardEntry = fixture.componentInstance.store.deck()?.cards?.find((entry) => entry.id === 'side-card');
    await fixture.componentInstance.store.addCardCopy(new MouseEvent('click'), sideboardEntry!);
    expect(decksApi.tokens).not.toHaveBeenCalled();

    const mainEntry = fixture.componentInstance.store.deck()?.cards?.find((entry) => entry.id === 'main-card');
    await fixture.componentInstance.store.addCardCopy(new MouseEvent('click'), mainEntry!);
    expect(decksApi.tokens).toHaveBeenCalledWith('deck-1');
  });

  it('loads raw decklist files into the editor import modal', async () => {
    await setup({ id: 'deck-1' }, buildDeckWithSingleCard());
    const fixture = TestBed.createComponent(DeckEditorComponent);

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsText(): void {
        this.result = 'About\nName Imported\n1 Arcane Signet';
        this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
      }
    }

    vi.stubGlobal('FileReader', MockFileReader);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['deck'], 'deck.dec', { type: 'text/plain' })],
    });

    fixture.componentInstance.store.loadDeckFile({ target: input } as unknown as Event);

    expect(fixture.componentInstance.store.decklist).toBe('About\nName Imported\n1 Arcane Signet');
    expect(input.value).toBe('');
  });

  it('accepts .dec files in the editor import input', async () => {
    await setup({ id: 'deck-1' }, buildDeckWithSingleCard());
    const fixture = TestBed.createComponent(DeckEditorComponent);
    await fixture.componentInstance.store.load();
    fixture.componentInstance.store.importModalOpen.set(true);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="file"]');

    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toContain('.dec');
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

  it('sorts sideboard cards by the same type order as deck sections', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Sorted sideboard deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('side-land', 'sideboard', card('Temple Garden', 'Land')),
        deckCard('side-unknown', 'sideboard', card('Mystery Booster Card', 'Conspiracy')),
        deckCard('side-artifact', 'sideboard', card('Sol Ring', 'Artifact')),
        deckCard('side-creature', 'sideboard', card('Birds of Paradise', 'Creature')),
        deckCard('side-enchantment', 'sideboard', card('Rhystic Study', 'Enchantment')),
        deckCard('side-instant', 'sideboard', card('Swan Song', 'Instant')),
        deckCard('side-planeswalker', 'sideboard', card('Jace, the Mind Sculptor', 'Planeswalker')),
        deckCard('side-battle', 'sideboard', card('Invasion of Zendikar', 'Battle')),
        deckCard('side-sorcery', 'sideboard', card('Cultivate', 'Sorcery')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const sideboardCards = fixture.componentInstance.store.cardGroups()
      .find((group) => group.id === 'sideboard')
      ?.cards
      .map((entry) => entry.card.name);
    const sideboardListCards = fixture.componentInstance.store.sideboardCards().map((entry) => entry.card.name);

    expect(sideboardCards).toEqual([
      'Jace, the Mind Sculptor',
      'Birds of Paradise',
      'Swan Song',
      'Cultivate',
      'Rhystic Study',
      'Sol Ring',
      'Invasion of Zendikar',
      'Temple Garden',
      'Mystery Booster Card',
    ]);
    expect(sideboardListCards).toEqual(sideboardCards);
  });

  it('sorts cards inside a section by name, subtype, and primary type', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Sorted creature deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('same-zombie', 'main', card('Shared Name', 'Creature — Zombie')),
        deckCard('same-creature-angel', 'main', card('Shared Name', 'Creature — Angel')),
        deckCard('alpha-wizard', 'main', card('Alpha Name', 'Creature — Wizard')),
        deckCard('same-artifact-angel', 'main', card('Shared Name', 'Artifact Creature — Angel')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const creatureCards = fixture.componentInstance.store.cardGroups()
      .find((group) => group.id === 'creature')
      ?.cards
      .map((entry) => entry.id);

    expect(creatureCards).toEqual([
      'alpha-wizard',
      'same-artifact-angel',
      'same-creature-angel',
      'same-zombie',
    ]);
  });

  it('counts only commander and main cards in the deck summary', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Summary deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('commander-card', 'commander', card('Talrand, Sky Summoner', 'Legendary Creature'), 1),
        deckCard('main-card', 'main', card('Persistent Petitioners', 'Creature'), 99),
        deckCard('side-card', 'sideboard', card('Swan Song', 'Instant'), 10),
        deckCard('maybe-card', 'maybeboard', card('Cyclonic Rift', 'Instant'), 5),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    fixture.detectChanges();

    const summaryText = (fixture.nativeElement.querySelector('.deck-summary-counts') as HTMLElement).textContent ?? '';

    expect(fixture.componentInstance.store.playableCardCount()).toBe(100);
    expect(fixture.componentInstance.store.playableSectionCount()).toBe(2);
    expect(summaryText).toContain('100 cards');
    expect(summaryText).toContain('2 sections');
  });

  it('uses a styled dropdown for the deck editor view mode', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'View mode deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', card('Sol Ring', 'Artifact'))],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.view-mode-select select')).toBeNull();

    const trigger = fixture.nativeElement.querySelector('.view-mode-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('.view-mode-option'),
    ) as HTMLButtonElement[];
    const spoilerOption = options.find((option) => option.textContent?.includes('Spoiler'));

    expect(options.length).toBe(2);
    expect(spoilerOption).toBeDefined();

    spoilerOption?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.viewMode()).toBe('spoiler');
    expect(fixture.nativeElement.querySelector('.view-mode-menu')).toBeNull();
  });

  it('detects alternate faces from second face image data instead of split names', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Faces deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('split-name-card', 'main', card('Wear // Tear', 'Instant')),
        deckCard('faced-card', 'main', {
          ...card('Birgi, God of Storytelling // Harnfel, Horn of Bounty', 'Legendary Creature // Legendary Artifact'),
          cardFaces: [
            cardFace('Birgi, God of Storytelling'),
            cardFace('Harnfel, Horn of Bounty'),
          ],
        }),
        deckCard('empty-faced-card', 'main', {
          ...card('Front // Empty Back', 'Creature // Creature'),
          cardFaces: [
            cardFace('Front'),
            cardFace('Empty Back', null),
          ],
        }),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const deckCards = fixture.componentInstance.store.deck()?.cards ?? [];

    expect(deckCards).toHaveLength(3);
    expect(fixture.componentInstance.store.hasAlternateFace(deckCards[0]!.card)).toBe(false);
    expect(fixture.componentInstance.store.hasAlternateFace(deckCards[1]!.card)).toBe(true);
    expect(fixture.componentInstance.store.hasAlternateFace(deckCards[2]!.card)).toBe(false);
  });

  it('shows only the front type line for cards with split type lines', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Type line deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('main-mdfc', 'main', {
          ...card('Bala Ged Recovery // Bala Ged Sanctuary', 'Sorcery // Land', 'modal_dfc'),
          cardFaces: [
            cardFace('Bala Ged Recovery'),
            cardFace('Bala Ged Sanctuary'),
          ],
        }),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const deckCards = fixture.componentInstance.store.deck()?.cards ?? [];
    const deckCardEntry = deckCards[0];

    expect(deckCardEntry).toBeDefined();
    expect(fixture.componentInstance.store.displayCardTypeLine(deckCardEntry!.card)).toBe('Sorcery');
    fixture.componentInstance.store.toggleCardFace(new MouseEvent('click'), deckCardEntry!.card, { updatePreview: false });
    expect(fixture.componentInstance.store.displayCardTypeLine(deckCardEntry!.card)).toBe('Sorcery');
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
        code: 'deck.warning',
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
        code: 'deck.warning',
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

  it('shows only preferred-language print versions when they exist', async () => {
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

    expect(store.visiblePrintVersionOptions().map((card) => card.scryfallId)).toEqual(['sol-ring-es-1', 'sol-ring-es-2']);
    expect(groups.map((group) => group.title)).toEqual(['Espanol']);
    expect(groups[0]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-es-1', 'sol-ring-es-2']);
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-pt-1');
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-en-1');
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-ph-1');
  });

  it('shows only English print versions when preferred language is English', async () => {
    const deck = buildDeckWithSingleCard();
    await setup({ id: 'deck-1' }, deck, { cardLanguage: 'en', appLanguage: 'en' });
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const { store } = fixture.componentInstance;

    await store.load();
    store.printVersionEntry.set(deck.cards?.[0] ?? null);
    store.printVersionModalOpen.set(true);
    store.printVersionOptions.set([
      printCard('sol-ring-en-1', 'en', 'one', '1'),
      printCard('sol-ring-ph-1', 'ph', 'two', '2'),
      printCard('sol-ring-fr-1', 'fr', 'three', '3'),
      printCard('sol-ring-en-2', 'en', 'four', '4'),
    ]);

    const groups = store.printVersionGroups();

    expect(store.visiblePrintVersionOptions().map((card) => card.scryfallId)).toEqual(['sol-ring-en-1', 'sol-ring-en-2']);
    expect(groups.map((group) => group.title)).toEqual(['English']);
    expect(groups[0]?.cards.map((card) => card.scryfallId)).toEqual(['sol-ring-en-1', 'sol-ring-en-2']);
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-fr-1');
    expect(groups.flatMap((group) => group.cards.map((card) => card.scryfallId))).not.toContain('sol-ring-ph-1');

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.print-version-name')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-panel')?.classList.contains('modal-panel-wide')).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.print-version-card small').length).toBe(2);
  });

  it('does not revalidate when selecting an equivalent print version', async () => {
    const deck = buildDeckWithSingleCard();
    const nextPrint = {
      ...card('Sol Ring', 'Artifact'),
      id: 'sol-ring-alt-id',
      scryfallId: 'sol-ring-alt-scryfall-id',
      set: 'alt',
      collectorNumber: '2',
    };
    const updatedDeck: Deck = {
      ...deck,
      cards: [deckCard('main-card', 'main', nextPrint)],
    };
    const { decksApi } = await setup({ id: 'deck-1' }, deck);
    decksApi.selectPrinting.mockReturnValue(of({ deck: updatedDeck }));
    const fixture = TestBed.createComponent(DeckEditorComponent);
    fixture.detectChanges();
    await fixture.componentInstance.store.load();
    await fixture.whenStable();

    decksApi.validateCommander.mockClear();
    fixture.componentInstance.store.printVersionEntry.set(deck.cards?.[0] ?? null);

    await fixture.componentInstance.store.selectPrintVersion(nextPrint);

    expect(decksApi.selectPrinting).toHaveBeenCalledWith('deck-1', 'main-card', 'sol-ring-alt-scryfall-id');
    expect(decksApi.validateCommander).not.toHaveBeenCalled();
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

  it('does not render selectable print-version cards when the effective language has one version', async () => {
    const deck = buildDeckWithSingleCard();
    await setup({ id: 'deck-1' }, deck, { cardLanguage: 'es', appLanguage: 'es' });
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const { store } = fixture.componentInstance;

    await store.load();
    store.printVersionEntry.set(deck.cards?.[0] ?? null);
    store.printVersionModalOpen.set(true);
    store.printVersionOptions.set([
      printCard('sol-ring-es-1', 'es', 'one', '1'),
      printCard('sol-ring-en-1', 'en', 'two', '2'),
      printCard('sol-ring-en-2', 'en', 'three', '3'),
    ]);
    fixture.detectChanges();

    expect(store.visiblePrintVersionOptions().map((card) => card.scryfallId)).toEqual(['sol-ring-es-1']);
    expect(fixture.nativeElement.querySelector('.print-version-intro')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-title-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.print-version-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.print-version-modal .ok-notice')).not.toBeNull();
  });

  it('uses a reduced limit when searching missing cards in the deck editor', async () => {
    await setup({ id: 'deck-1' }, buildDeckWithSingleCard());
    const fixture = TestBed.createComponent(DeckEditorComponent);
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };

    fixture.componentInstance.store.missingSearchQuery = 'Sol Ring';
    await fixture.componentInstance.store.searchMissingQuery();

    expect(cardsApi.search).toHaveBeenCalledWith('Sol Ring', 1, 60);
  });

  it('passes commander color identity to the deckbuilder autocomplete search filters', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Talrand',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('commander-card', 'commander', card('Talrand, Sky Summoner', 'Legendary Creature', 'normal', ['U'])),
        deckCard('main-card', 'main', card('Sol Ring', 'Artifact')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    fixture.detectChanges();

    const autocomplete = fixture.debugElement.query(By.directive(CardAutocompleteComponent)).componentInstance as CardAutocompleteComponent;

    expect(autocomplete.filters).toEqual({ colorIdentity: ['U'] });
  });

  it('leaves deckbuilder autocomplete search unfiltered when there is no commander color identity', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'No commander yet',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', card('Sol Ring', 'Artifact'))],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();
    fixture.detectChanges();

    const autocomplete = fixture.debugElement.query(By.directive(CardAutocompleteComponent)).componentInstance as CardAutocompleteComponent;

    expect(autocomplete.filters).toEqual({});
  });
});

function deckCard(id: string, section: DeckSection, card: Card, quantity = 1): DeckCard {
  return { id, section, card, quantity };
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

function card(name: string, typeLine: string, layout = 'normal', colorIdentity: Array<'W' | 'U' | 'B' | 'R' | 'G'> = []): Card {
  return {
    id: `${name}-id`,
    scryfallId: `${name}-scryfall-id`,
    name,
    manaCost: null,
    typeLine,
    oracleText: null,
    colors: [],
    colorIdentity,
    legalities: {},
    imageUris: {},
    layout,
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}

function cardFace(name: string, imageUri: string | null = `/cards/${name}.jpg`): CardFace {
  return {
    name,
    manaCost: null,
    typeLine: null,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: imageUri ? { normal: imageUri } : {},
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
      nl: 'Dutch',
      ca: 'Catalan',
    };
}
