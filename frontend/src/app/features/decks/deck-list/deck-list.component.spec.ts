import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  ArrowLeft,
  FileUp,
  Folder,
  FolderPlus,
  Globe,
  Layers3,
  LayoutGrid,
  List,
  Lock,
  LucideAngularModule,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-angular';
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Card } from '../../../core/models/card.model';
import { Deck } from '../../../core/models/deck.model';
import { DeckListComponent } from './deck-list.component';

describe('DeckListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckListComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          ArrowLeft,
          FileUp,
          Folder,
          FolderPlus,
          Layers3,
          LayoutGrid,
          List,
          Pencil,
          Plus,
          Search,
          SlidersHorizontal,
          Trash2,
          TriangleAlert,
          X,
          Globe,
          Lock,
        })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })) } },
        {
          provide: DecksApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            create: vi.fn().mockReturnValue(of({ deck: savedDeck() })),
            quickBuild: vi.fn().mockReturnValue(of({ deck: savedDeck(), missing: [] })),
            importDecklist: vi.fn().mockReturnValue(of({
              deck: savedDeck(),
              missing: [],
              summary: {
                format: 'plain',
                parsedCards: 1,
                totalCards: 1,
                resolvedCards: 1,
                importedCards: 1,
                missingCards: 0,
                commanderCount: 0,
                mainCount: 1,
              },
            })),
            delete: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        {
          provide: DeckFoldersApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            names: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        { provide: DeckFormatsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the deck list page', () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.deck-page-hero h1')?.textContent.trim()).toBe('Decks');
    expect(fixture.componentInstance.store.createModalTitle()).toBe('Create deck');
  });

  it('opens the create deck flow when the route requests an import intent', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({ intent: 'import', next: '/rooms' }),
        },
      },
    });

    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.createModalOpen()).toBe(true);
    expect(fixture.componentInstance.store.createSuccessPrimaryLabel()).toBe('Continue to rooms');
  });

  it('continues to rooms after a deck flow started from a SEO CTA', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({ intent: 'import', next: '/rooms' }),
        },
      },
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();

    fixture.componentInstance.store.createSuccessDeck.set(savedDeck());
    fixture.componentInstance.store.createSuccessModalOpen.set(true);
    fixture.componentInstance.store.openCreatedDeckFromSuccess();

    expect(navigateByUrl).toHaveBeenCalledWith('/rooms');
  });

  it('turns the delete deck modal into an info message when the deck is in use', async () => {
    const decksApi = TestBed.inject(DecksApi);
    vi.spyOn(decksApi, 'delete').mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: {
        code: 'deck.in_use',
        error: 'This deck cannot be deleted because it is being used in a game.',
      },
    })));
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const deck: Deck = {
      id: 'deck-1',
      name: 'Active Deck',
      format: 'commander',
      folderId: null,
    };

    fixture.componentInstance.store.decks.set([deck]);
    fixture.componentInstance.store.deleteDeck(deck);
    await fixture.componentInstance.store.confirmDeleteDeck();

    expect(fixture.componentInstance.store.deleteModalOpen()).toBe(true);
    expect(fixture.componentInstance.store.deleteModalTitle()).toBe('Deck in use');
    expect(fixture.componentInstance.store.deleteModalMessage()).toBe('This deck cannot be deleted because it is being used in a game.');
    expect(fixture.componentInstance.store.deleteModalPrimaryLabel()).toBe('OK');
    expect(fixture.componentInstance.store.deleteModalShowsSecondary()).toBe(false);
    expect(decksApi.delete).toHaveBeenCalledWith('deck-1');
  });

  it('shows a saved deck confirmation after a successful create flow', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.newDeckName = 'Saved Deck';
    fixture.componentInstance.store.createdDecklist = '1 Sol Ring';
    fixture.componentInstance.store.openCreateModal();
    await fixture.componentInstance.store.create();

    expect(fixture.componentInstance.store.createModalOpen()).toBe(false);
    expect(fixture.componentInstance.store.createSuccessModalOpen()).toBe(true);
    expect(fixture.componentInstance.store.createSuccessMessage()).toBe(
      'This deck has been saved. It is now in your saved decks list, and you can edit it however you like. Good luck with your Commander deck!',
    );
  });

  it('sends the raw create-deck decklist and keeps both explicit selected commanders', async () => {
    const decksApi = TestBed.inject(DecksApi);
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.newDeckName = 'Partners';
    fixture.componentInstance.store.selectedCommanders.set([commanderCard(), secondCommanderCard()]);
    fixture.componentInstance.store.createdDecklist = `Commanders (2)
1 Birgi, God of Storytelling // Harnfel, Horn of Bounty
1 Krark, the Thumbless

Creatures (1)
1 Ragavan, Nimble Pilferer`;

    await fixture.componentInstance.store.create();

    expect(decksApi.importDecklist).toHaveBeenCalledWith(
      'saved-deck',
      `Commanders (2)
1 Birgi, God of Storytelling // Harnfel, Horn of Bounty
1 Krark, the Thumbless

Creatures (1)
1 Ragavan, Nimble Pilferer`,
      { commanderScryfallIds: ['card-atraxa', 'card-silas'] },
    );
  });

  it('sends a single explicit selected commander when the create-deck decklist includes it', async () => {
    const decksApi = TestBed.inject(DecksApi);
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.newDeckName = 'Single Commander';
    fixture.componentInstance.store.selectedCommanders.set([commanderCard()]);
    fixture.componentInstance.store.createdDecklist = `Deck
1 Atraxa, Praetors' Voice
99 Island`;

    await fixture.componentInstance.store.create();

    expect(decksApi.importDecklist).toHaveBeenCalledWith(
      'saved-deck',
      `Deck
1 Atraxa, Praetors' Voice
99 Island`,
      { commanderScryfallIds: ['card-atraxa'] },
    );
  });

  it('shows the saved deck confirmation when closing a completed create flow with missing cards', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.createdDeck.set(savedDeck());
    fixture.componentInstance.store.createdMissing.set(['Missing Spell']);
    fixture.componentInstance.store.createFormLocked.set(true);
    fixture.componentInstance.store.submitCreateModal();

    expect(fixture.componentInstance.store.createModalOpen()).toBe(false);
    expect(fixture.componentInstance.store.createSuccessModalOpen()).toBe(true);
  });

  it('shows the singular import disclaimer when there are zero selected commanders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const disclaimer = fixture.nativeElement.querySelector('.app-disclaimer-callout');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer.textContent).toContain(
      'If you include your commander in the import decklist, do not worry; we will remove it for you.',
    );
  });

  it('shows the plural import disclaimer when there are two selected commanders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.selectedCommanders.set([commanderCard(), secondCommanderCard()]);
    fixture.detectChanges();

    const disclaimer = fixture.nativeElement.querySelector('.app-disclaimer-callout');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer.textContent).toContain(
      'If you include your commanders in the import decklist, do not worry; we will remove them for you.',
    );
  });

  it('allows creating a commander deck without a local commander section when the decklist is present', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.newDeckName = 'Inference Deck';
    fixture.componentInstance.store.createdDecklist = `1 Muldrotha, the Gravetide
99 Island`;

    expect(fixture.componentInstance.store.isCreatePrimaryDisabled()).toBe(false);
  });

  it('loads raw decklist files into the create flow', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

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

    fixture.componentInstance.store.loadCreatedDeckFile({ target: input } as unknown as Event);

    expect(fixture.componentInstance.store.createdDecklist).toBe('About\nName Imported\n1 Arcane Signet');
    expect(input.value).toBe('');
  });

  it('accepts .dec files in the create-flow import input', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="file"]');

    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toContain('.dec');
  });

  it('shows the commander preview when hovering the commander card body in the create modal', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(DeckListComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      fixture.componentInstance.store.formats.set([
        { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
      ]);
      fixture.componentInstance.store.newDeckFormatId = 'commander';
      fixture.componentInstance.store.openCreateModal();
      fixture.componentInstance.store.selectedCommanders.set([commanderCard()]);
      fixture.detectChanges();

      const hoverTarget = fixture.nativeElement.querySelector('.commander-preview-body') as HTMLElement | null;
      expect(hoverTarget).not.toBeNull();

      hoverTarget!.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: true,
        clientX: 160,
        clientY: 220,
      }));
      vi.advanceTimersByTime(300);

      expect(fixture.componentInstance.commanderHoverPreview()?.imageUrl).toBe('https://cards.test/atraxa.jpg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the commander preview anchored to the card image center instead of the mouse position', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(DeckListComponent);
      const component = fixture.componentInstance;
      const anchor = document.createElement('span');
      anchor.className = 'commander-preview-image';
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        x: 100,
        y: 140,
        width: 88,
        height: 124,
        top: 140,
        right: 188,
        bottom: 264,
        left: 100,
        toJSON: () => ({}),
      });

      component.scheduleCommanderPreview({
        currentTarget: anchor,
        clientX: 110,
        clientY: 150,
      } as unknown as MouseEvent, 'https://cards.test/atraxa.jpg');
      vi.advanceTimersByTime(300);
      const initialPreview = component.commanderHoverPreview();

      component.moveCommanderPreview({
        currentTarget: anchor,
        clientX: 1000,
        clientY: 20,
      } as unknown as MouseEvent);
      const movedPreview = component.commanderHoverPreview();

      expect(initialPreview).not.toBeNull();
      expect(movedPreview).not.toBeNull();
      expect(movedPreview?.x).toBe(initialPreview?.x);
      expect(movedPreview?.y).toBe(initialPreview?.y);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a tooltip when commander search is disabled because two commanders are already selected', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.selectedCommanders.set([commanderCard(), secondCommanderCard()]);
    fixture.detectChanges();

    const shell = fixture.nativeElement.querySelector('.commander-autocomplete-shell') as HTMLElement | null;
    expect(shell).not.toBeNull();
    expect(shell?.title).toBe("You already have 2 commanders. You can't add more.");
    expect(shell?.classList.contains('commander-autocomplete-shell-disabled')).toBe(true);
  });

  it('renders both diagonal commander art panes for decks with two commanders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.decks.set([
      savedDeck({
        commanders: [commanderCard(), secondCommanderCard()],
      }),
    ]);
    fixture.componentInstance.store.loading.set(false);
    fixture.detectChanges();

    const deckRow = fixture.nativeElement.querySelector('.deck-list-row.has-dual-commander-art') as HTMLElement | null;
    const panes = fixture.nativeElement.querySelectorAll('.deck-dual-commander-art-pane');

    expect(deckRow).not.toBeNull();
    expect(deckRow?.style.getPropertyValue('--deck-commander-art')).toContain('atraxa-art.jpg');
    expect(deckRow?.style.getPropertyValue('--deck-secondary-commander-art')).toContain('silas-art.jpg');
    expect(panes.length).toBe(2);
  });

  it('hides the commander preview when clicking outside the commander card', () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    const component = fixture.componentInstance;
    component.commanderHoverPreview.set({ imageUrl: 'https://cards.test/atraxa.jpg', x: 100, y: 100 });

    const outsideTarget = document.createElement('button');
    component.onDocumentPointerDown({ target: outsideTarget } as unknown as PointerEvent);

    expect(component.commanderHoverPreview()).toBeNull();
  });

  it('hides the commander preview when removing a commander', () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    const component = fixture.componentInstance;
    component.store.selectedCommanders.set([commanderCard()]);
    component.commanderHoverPreview.set({ imageUrl: 'https://cards.test/atraxa.jpg', x: 100, y: 100 });

    component.removeCommander('card-atraxa');

    expect(component.commanderHoverPreview()).toBeNull();
    expect(component.store.selectedCommanders()).toEqual([]);
  });

  it('replaces the create form with a single import warning when cards are missing', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.createdImportMessage.set('89 parsed cards, 99 imported, 1 missing.');
    fixture.componentInstance.store.createdMissing.set(['Unholy Annex/Ritual Chamber']);
    fixture.componentInstance.store.createFormLocked.set(true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(fixture.componentInstance.store.createModalTitle()).toBe('Warning');
    expect(text).toContain('89 parsed cards, 99 imported, 1 missing.');
    expect(text).toContain('Missing cards');
    expect(text).toContain('Unholy Annex/Ritual Chamber');
    expect(text).toContain('Accept');
    expect(text).not.toContain('Deck name');
    expect(text).not.toContain('Format');
    expect(text).not.toContain('Visibility');
    expect(text).not.toContain('Commander');
    expect(text).not.toContain('Import decklist');
    expect(fixture.nativeElement.querySelectorAll('.create-import-result')).toHaveLength(1);
  });
});

function savedDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'saved-deck',
    name: 'Saved Deck',
    format: 'commander',
    folderId: null,
    commanders: [],
    ...overrides,
  };
}

function commanderCard(): Card {
  return {
    id: 'card-atraxa',
    scryfallId: 'card-atraxa',
    name: "Atraxa, Praetors' Voice",
    manaCost: '{1}{G}{W}{U}{B}',
    typeLine: 'Legendary Creature',
    oracleText: 'Flying, vigilance, deathtouch, lifelink',
    colors: ['G', 'W', 'U', 'B'],
    colorIdentity: ['G', 'W', 'U', 'B'],
    legalities: { commander: 'legal' },
    imageUris: { normal: 'https://cards.test/atraxa.jpg', art_crop: 'https://cards.test/atraxa-art.jpg' },
    layout: 'normal',
    commanderLegal: true,
    set: 'cmm',
    collectorNumber: '1',
  };
}

function secondCommanderCard(): Card {
  return {
    id: 'card-silas',
    scryfallId: 'card-silas',
    name: 'Silas Renn, Seeker Adept',
    manaCost: '{1}{U}{B}',
    typeLine: 'Legendary Creature',
    oracleText: 'Deathtouch',
    colors: ['U', 'B'],
    colorIdentity: ['U', 'B'],
    legalities: { commander: 'legal' },
    imageUris: { normal: 'https://cards.test/silas.jpg', art_crop: 'https://cards.test/silas-art.jpg' },
    layout: 'normal',
    commanderLegal: true,
    set: 'c16',
    collectorNumber: '1',
  };
}
