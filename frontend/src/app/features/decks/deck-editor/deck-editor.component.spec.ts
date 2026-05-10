import { importProvidersFrom } from '@angular/core';
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
import { Card } from '../../../core/models/card.model';
import { Deck, DeckCard, DeckSection } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckEditorComponent } from './deck-editor.component';

describe('DeckEditorComponent', () => {
  async function setup(routeParams: Record<string, string> = {}, deck?: Deck) {
    const decksApi = {
      get: vi.fn().mockReturnValue(of({ deck })),
      tokens: vi.fn().mockReturnValue(of({ data: [], unresolved: [] })),
      validateCommander: vi.fn().mockReturnValue(of(validCommanderValidation())),
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
