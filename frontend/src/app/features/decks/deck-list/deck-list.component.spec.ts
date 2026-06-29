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
  LoaderCircle,
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
import { Deck, DeckFolder } from '../../../core/models/deck.model';
import { DeckListComponent } from './deck-list.component';
import { SLEEVE_OPTIONS } from './components/create-sleeve-spoiler/create-sleeve-spoiler.component';

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
          LoaderCircle,
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
            update: vi.fn().mockReturnValue(of({ deck: savedDeck() })),
            delete: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        {
          provide: DeckFoldersApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            create: vi.fn().mockReturnValue(of({ folder: savedFolder() })),
            rename: vi.fn().mockReturnValue(of({ folder: savedFolder() })),
            delete: vi.fn().mockReturnValue(of(undefined)),
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

  it('sorts root folders and unfiled decks together by name', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-charlie', name: 'Charlie Folder' }),
    ]);
    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-delta', name: 'Delta Deck', folderId: null }),
      savedDeck({ id: 'deck-alpha', name: 'Alpha Deck', folderId: null }),
    ]);
    fixture.componentInstance.store.loading.set(false);
    fixture.detectChanges();

    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.deck-card-topline strong') as NodeListOf<HTMLElement>,
    ).map((element) => element.textContent?.trim());

    expect(names).toEqual(['Alpha Deck', 'Charlie Folder', 'Delta Deck']);
  });

  it('derives folder select options from loaded folders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-1', name: 'Folder One' }),
    ]);

    expect(fixture.componentInstance.folderOptions()).toEqual([
      { id: '', labelKey: 'deckBuilder.deckList.noFolder' },
      { id: 'folder-1', name: 'Folder One' },
    ]);
  });

  it('renders visibility pills with text labels and tooltips', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-alpha', name: 'Alpha Folder', visibility: 'public' }),
    ]);
    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-beta', name: 'Beta Deck', folderId: null, visibility: 'private' }),
    ]);
    fixture.componentInstance.store.loading.set(false);
    fixture.detectChanges();

    const pills = Array.from(
      fixture.nativeElement.querySelectorAll('.visibility-pill') as NodeListOf<HTMLElement>,
    );
    const tooltipTriggers = Array.from(
      fixture.nativeElement.querySelectorAll('app-tooltip .cz-tooltip') as NodeListOf<HTMLElement>,
    );
    tooltipTriggers.forEach((trigger) => {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    fixture.detectChanges();

    expect(pills).toHaveLength(2);
    const tooltipTexts = Array.from(
      fixture.nativeElement.querySelectorAll('app-tooltip .cz-tooltip__bubble') as NodeListOf<HTMLElement>,
    )
      .map((bubble) => bubble.textContent?.trim())
      .filter((value): value is string => !!value);

    expect(pills.map((pill) => pill.textContent?.trim())).toEqual(['PUBLIC', 'PRIVATE']);
    expect(pills.map((pill) => pill.getAttribute('aria-label'))).toEqual(['Public', 'Private']);
    expect(tooltipTexts).toContain('Public');
    expect(tooltipTexts).toContain('Private');
  });

  it('saves the selected edit folder with the deck update payload', async () => {
    const decksApi = TestBed.inject(DecksApi);
    const updateDeck = vi.spyOn(decksApi, 'update').mockReturnValue(of({
      deck: savedDeck({
        id: 'deck-1',
        name: 'Renamed Deck',
        visibility: 'public',
        folderId: null,
      }),
    }));
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const deck = savedDeck({ id: 'deck-1', name: 'Original Deck', folderId: 'folder-1' });

    fixture.componentInstance.store.decks.set([deck]);
    fixture.componentInstance.store.openDeckEditModal(deck);
    fixture.componentInstance.store.editDeckName = 'Renamed Deck';
    fixture.componentInstance.store.editDeckVisibility = 'public';
    fixture.componentInstance.store.editDeckFolderId = '';
    await fixture.componentInstance.store.saveDeckEdit();

    expect(updateDeck).toHaveBeenCalledWith('deck-1', {
      name: 'Renamed Deck',
      visibility: 'public',
      folderId: null,
    });
  });

  it('disables edit deck save until the form has valid changes', async () => {
    const decksApi = TestBed.inject(DecksApi);
    const updateDeck = vi.spyOn(decksApi, 'update');
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const deck = savedDeck({ id: 'deck-1', name: 'Original Deck', visibility: 'private', folderId: null });

    fixture.componentInstance.store.openDeckEditModal(deck);
    fixture.detectChanges();

    let saveButton = fixture.nativeElement.querySelector('.modal-panel footer button:last-child') as HTMLButtonElement | null;
    expect(fixture.componentInstance.store.canSaveDeckEdit()).toBe(false);
    expect(saveButton?.disabled).toBe(true);

    await fixture.componentInstance.store.saveDeckEdit();
    expect(updateDeck).not.toHaveBeenCalled();

    fixture.componentInstance.store.editDeckVisibility = 'public';
    fixture.detectChanges();

    saveButton = fixture.nativeElement.querySelector('.modal-panel footer button:last-child') as HTMLButtonElement | null;
    expect(fixture.componentInstance.store.canSaveDeckEdit()).toBe(true);
    expect(saveButton?.disabled).toBe(false);
  });

  it('does not save an edited deck name over the length limit', async () => {
    const decksApi = TestBed.inject(DecksApi);
    const updateDeck = vi.spyOn(decksApi, 'update');
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const deck = savedDeck({ id: 'deck-1', name: 'Original Deck' });

    fixture.componentInstance.store.openDeckEditModal(deck);
    fixture.componentInstance.store.editDeckName = 'x'.repeat(fixture.componentInstance.store.maxDeckNameLength + 1);
    await fixture.componentInstance.store.saveDeckEdit();

    expect(fixture.componentInstance.store.isEditDeckNameTooLong()).toBe(true);
    expect(updateDeck).not.toHaveBeenCalled();
  });

  it('does not create or rename folders over the length limit', async () => {
    const deckFoldersApi = TestBed.inject(DeckFoldersApi);
    const createFolder = vi.spyOn(deckFoldersApi, 'create');
    const renameFolder = vi.spyOn(deckFoldersApi, 'rename');
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const tooLongName = 'x'.repeat(fixture.componentInstance.store.maxFolderNameLength + 1);

    fixture.componentInstance.store.newFolderName = tooLongName;
    await fixture.componentInstance.store.createFolder();
    fixture.componentInstance.store.openRenameFolderModal(savedFolder({ id: 'folder-1', name: 'Folder One' }));
    fixture.componentInstance.store.renameFolderName = tooLongName;
    await fixture.componentInstance.store.renameFolder();

    expect(fixture.componentInstance.store.isNewFolderNameTooLong()).toBe(true);
    expect(fixture.componentInstance.store.isRenameFolderNameTooLong()).toBe(true);
    expect(createFolder).not.toHaveBeenCalled();
    expect(renameFolder).not.toHaveBeenCalled();
  });

  it('disables rename folder save until the form has valid changes', async () => {
    const deckFoldersApi = TestBed.inject(DeckFoldersApi);
    const renameFolder = vi.spyOn(deckFoldersApi, 'rename');
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openRenameFolderModal(savedFolder({
      id: 'folder-1',
      name: 'Folder One',
      visibility: 'private',
    }));
    fixture.detectChanges();

    let saveButton = fixture.nativeElement.querySelector('.modal-panel footer button:last-child') as HTMLButtonElement | null;
    expect(fixture.componentInstance.store.canSaveFolderRename()).toBe(false);
    expect(saveButton?.disabled).toBe(true);

    await fixture.componentInstance.store.renameFolder();
    expect(renameFolder).not.toHaveBeenCalled();

    fixture.componentInstance.store.renameFolderName = 'Folder Two';
    fixture.detectChanges();

    saveButton = fixture.nativeElement.querySelector('.modal-panel footer button:last-child') as HTMLButtonElement | null;
    expect(fixture.componentInstance.store.canSaveFolderRename()).toBe(true);
    expect(saveButton?.disabled).toBe(false);
  });

  it('renders the edit deck folder select from loaded folders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const deck = savedDeck({ id: 'deck-1', name: 'Original Deck', folderId: 'folder-1' });

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-1', name: 'Folder One' }),
    ]);
    fixture.componentInstance.store.openDeckEditModal(deck);
    fixture.detectChanges();

    const folderInput = fixture.nativeElement.querySelector('input[name="editDeckFolder"]') as HTMLInputElement | null;

    expect(folderInput).not.toBeNull();
    expect(folderInput?.value).toBe('folder-1');
    expect(fixture.nativeElement.textContent).toContain('Folder One');
  });

  it('hides the edit deck folder select when there are no folders', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([]);
    fixture.componentInstance.store.openDeckEditModal(savedDeck({ id: 'deck-1', name: 'Original Deck' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="editDeckFolder"]')).toBeNull();
  });

  it('uses the target name as the delete deck modal title', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.deleteDeck(savedDeck({ id: 'deck-1', name: 'Deck To Delete' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.store.deleteModalTitle()).toBe('Delete Deck To Delete?');
    expect(fixture.nativeElement.querySelector('.modal-panel-narrow')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-title-row h2')?.textContent.trim()).toBe('Delete Deck To Delete?');
  });

  it('does not open the deck article when clicking a deck action', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-1', name: 'Deck One', folderId: null }),
    ]);
    fixture.componentInstance.store.loading.set(false);
    fixture.detectChanges();

    const editButton = fixture.nativeElement.querySelector('.deck-owner-card .deck-row-actions button') as HTMLButtonElement | null;
    const pointerDownAllowed = editButton?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    const mouseDownAllowed = editButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    editButton?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    editButton?.focus();
    editButton?.click();

    expect(pointerDownAllowed).toBe(true);
    expect(mouseDownAllowed).toBe(false);
    expect(document.activeElement).not.toBe(editButton);
    expect(fixture.componentInstance.store.deckEditModalOpen()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not enter a folder when clicking a folder action', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-1', name: 'Folder One' }),
    ]);
    fixture.componentInstance.store.loading.set(false);
    fixture.detectChanges();

    const renameButton = fixture.nativeElement.querySelector('.folder-list-row .deck-row-actions button') as HTMLButtonElement | null;
    const pointerDownAllowed = renameButton?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    const mouseDownAllowed = renameButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    renameButton?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    renameButton?.focus();
    renameButton?.click();

    expect(pointerDownAllowed).toBe(true);
    expect(mouseDownAllowed).toBe(false);
    expect(document.activeElement).not.toBe(renameButton);
    expect(fixture.componentInstance.store.folderRenameModalOpen()).toBe(true);
    expect(fixture.componentInstance.store.currentFolderId()).toBeNull();
  });

  it('hides create folder inside a folder and defaults new decks to that folder', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-1', name: 'Folder One' }),
    ]);
    fixture.componentInstance.store.currentFolderId.set('folder-1');
    fixture.detectChanges();

    const actionsText = (fixture.nativeElement.querySelector('.deck-primary-actions') as HTMLElement).textContent ?? '';
    fixture.componentInstance.store.openCreateModal();

    expect(actionsText).toContain('Crear mazo');
    expect(actionsText).not.toContain('Crear carpeta');
    expect(fixture.componentInstance.store.newDeckFolderId).toBe('folder-1');
  });

  it('builds mana color percentages from all deck color symbols', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-1', commanders: [commanderCard()] }),
    ]);
    expect(fixture.componentInstance.store.manaColorStats()).toEqual([]);

    fixture.componentInstance.store.folders.set([
      savedFolder({ id: 'folder-1', name: 'Folder One' }),
      savedFolder({ id: 'folder-2', name: 'Folder Two' }),
    ]);
    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-1', commanders: [commanderCard()] }),
      savedDeck({ id: 'deck-2', commanders: [] }),
    ]);
    expect(fixture.componentInstance.store.manaColorStats()).toEqual([]);

    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-1', commanders: [commanderCard()] }),
      savedDeck({ id: 'deck-2', commanders: [secondCommanderCard()] }),
    ]);

    expect(fixture.componentInstance.store.manaColorStats()).toEqual([
      { color: 'W', percentage: 17 },
      { color: 'U', percentage: 33 },
      { color: 'B', percentage: 33 },
      { color: 'R', percentage: 0 },
      { color: 'G', percentage: 17 },
      { color: 'C', percentage: 0 },
    ]);
  });

  it('filters decks by deck name and not commander name', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.decks.set([
      savedDeck({ id: 'deck-1', name: 'Zurgito', commanders: [commanderCard()] }),
      savedDeck({ id: 'deck-2', name: 'dede', commanders: [secondCommanderCard()] }),
    ]);
    fixture.componentInstance.store.setSearchQuery('ie');

    expect(fixture.componentInstance.store.visibleUnfiledDecks()).toEqual([]);
  });

  it('limits the deck search query to 20 characters', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.setSearchQuery('x'.repeat(fixture.componentInstance.store.maxDeckSearchLength + 1));

    expect(fixture.componentInstance.store.searchQuery()).toHaveLength(fixture.componentInstance.store.maxDeckSearchLength);
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
    expect(fixture.componentInstance.store.createSuccessPrimaryLabel()).toBe('deckBuilder.deckList.continueToRooms');
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
    expect(fixture.componentInstance.store.createSuccessMessage()).toBe('deckBuilder.deckList.createSuccessMessage');
  });

  it('reloads the deck list when returning from the saved deck confirmation', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const reloadAll = vi.spyOn(fixture.componentInstance.store, 'reloadAll').mockResolvedValue(undefined);

    fixture.componentInstance.store.createSuccessDeck.set(savedDeck());
    fixture.componentInstance.store.createSuccessModalOpen.set(true);

    await fixture.componentInstance.store.returnToDeckListFromSuccess();

    expect(fixture.componentInstance.store.createSuccessModalOpen()).toBe(false);
    expect(fixture.componentInstance.store.createSuccessDeck()).toBeNull();
    expect(reloadAll).toHaveBeenCalledOnce();
  });

  it('hides commander and import fields when creating an empty deck', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.setNewDeckCreateEmpty(true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Create empty deck');
    expect(fixture.nativeElement.querySelector('label[for="commanderSearch"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-card-autocomplete')).toBeNull();
    expect(fixture.nativeElement.querySelector('textarea[name="createdDecklist"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer-callout')).toBeNull();
  });

  it('renders the create deck name counter as a compact right-aligned field hint', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.detectChanges();

    const hint = fixture.nativeElement.querySelector('.create-deck-name-count-hint') as HTMLElement | null;
    expect(hint?.textContent?.trim()).toBe('0/20');
    expect(hint?.textContent).not.toContain('Maximum 20 characters');
    expect(hint?.textContent).not.toContain('characters');

    const nameInput = fixture.nativeElement.querySelector('input[name="name"]') as HTMLInputElement;
    nameInput.value = 'Atraxa';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const updatedHint = fixture.nativeElement.querySelector('.create-deck-name-count-hint') as HTMLElement | null;
    expect(updatedHint?.textContent?.trim()).toBe('6/20');
  });

  it('renders the cosmetics action below the create deck visibility control', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const visibilityChoice = fixture.nativeElement.querySelector('app-visibility-choice') as HTMLElement | null;
    const cosmeticsRow = fixture.nativeElement.querySelector('.create-cosmetics-row') as HTMLElement | null;
    const playmatImage = cosmeticsRow?.querySelector('.create-cosmetics-preview-image--playmat') as HTMLImageElement | null;
    const sleeveImage = cosmeticsRow?.querySelector('.create-cosmetics-preview-image--sleeve') as HTMLImageElement | null;
    const previewButtons = Array.from(
      cosmeticsRow?.querySelectorAll('.create-cosmetics-preview') ?? [],
    ) as HTMLButtonElement[];

    expect(visibilityChoice).not.toBeNull();
    expect(cosmeticsRow).not.toBeNull();
    expect(visibilityChoice?.compareDocumentPosition(cosmeticsRow!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(previewButtons).toHaveLength(2);
    expect(previewButtons[0].getAttribute('aria-label')).toBe('Edit Playmat');
    expect(previewButtons[1].getAttribute('aria-label')).toBe('Edit Sleeve');
    expect(previewButtons[0].querySelector('.create-cosmetics-edit-icon')).not.toBeNull();
    expect(previewButtons[1].querySelector('.create-cosmetics-edit-icon')).not.toBeNull();
    expect(cosmeticsRow?.textContent).toContain('Playmat');
    expect(cosmeticsRow?.textContent).toContain('Sleeve');
    expect(playmatImage?.getAttribute('src')).toBe('/assets/images/play-mat/G_1.png');
    expect(sleeveImage?.getAttribute('src')).toBe('/assets/images/sleeves/facedown_card.jpg');
    expect(playmatImage?.getAttribute('alt')).toBe('Playmat');
    expect(sleeveImage?.getAttribute('alt')).toBe('Sleeve');

    expect(fixture.nativeElement.querySelector('app-create-sleeve-spoiler')).toBeNull();
  });

  it('replaces the create form with the sleeve selector and saves the selected sleeve locally', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const panelsBefore = fixture.nativeElement.querySelectorAll('.modal-panel').length;
    const previewButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-cosmetics-preview') as NodeListOf<HTMLButtonElement>,
    );

    previewButtons[1].click();
    fixture.detectChanges();

    const spoiler = fixture.nativeElement.querySelector('app-create-sleeve-spoiler') as HTMLElement | null;
    const sleeveButtons = spoiler?.querySelectorAll('.create-sleeve-option') as NodeListOf<HTMLButtonElement>;
    const nextSleeve = SLEEVE_OPTIONS.find((sleeve) => sleeve.path !== '/assets/images/sleeves/facedown_card.jpg');

    expect(spoiler).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.create-deck-form')).toBeNull();
    expect(sleeveButtons.length).toBe(SLEEVE_OPTIONS.length);
    expect(fixture.nativeElement.querySelectorAll('.modal-panel').length).toBe(panelsBefore);
    expect(nextSleeve).toBeDefined();

    Array.from(sleeveButtons)
      .find((button) => button.querySelector('img')?.getAttribute('src') === nextSleeve?.path)
      ?.click();
    fixture.detectChanges();

    const selectedButton = Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-option') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.querySelector('img')?.getAttribute('src') === nextSleeve?.path);
    const actionButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-spoiler-actions button') as NodeListOf<HTMLButtonElement>,
    );

    expect(selectedButton?.classList.contains('is-selected')).toBe(true);
    expect(fixture.nativeElement.querySelector('.modal-back-button app-back-button, app-back-button.modal-back-button')).not.toBeNull();
    expect(actionButtons.map((button) => button.textContent?.trim())).toEqual(['Save']);

    actionButtons[0].click();
    fixture.detectChanges();

    const savedSleevePreview = fixture.nativeElement.querySelector('.create-cosmetics-preview-image--sleeve') as HTMLImageElement | null;
    expect(fixture.nativeElement.querySelector('app-create-sleeve-spoiler')).toBeNull();
    expect(fixture.nativeElement.querySelector('.create-deck-form')).not.toBeNull();
    expect(savedSleevePreview?.getAttribute('src')).toBe(nextSleeve?.path);
  });

  it('returns from the sleeve selector without applying draft changes when using Back', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const previewButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-cosmetics-preview') as NodeListOf<HTMLButtonElement>,
    );
    const nextSleeve = SLEEVE_OPTIONS.find((sleeve) => sleeve.path !== '/assets/images/sleeves/facedown_card.jpg');

    previewButtons[1].click();
    fixture.detectChanges();

    Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-option') as NodeListOf<HTMLButtonElement>,
    )
      .find((button) => button.querySelector('img')?.getAttribute('src') === nextSleeve?.path)
      ?.click();
    fixture.detectChanges();

    const backButton = fixture.nativeElement.querySelector('.modal-back-button button') as HTMLButtonElement | null;

    backButton?.click();
    fixture.detectChanges();

    const sleevePreview = fixture.nativeElement.querySelector('.create-cosmetics-preview-image--sleeve') as HTMLImageElement | null;
    expect(fixture.nativeElement.querySelector('app-create-sleeve-spoiler')).toBeNull();
    expect(sleevePreview?.getAttribute('src')).toBe('/assets/images/sleeves/facedown_card.jpg');
  });

  it('does not open the sleeve selector from the playmat action', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const previewButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-cosmetics-preview') as NodeListOf<HTMLButtonElement>,
    );

    previewButtons[0].click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-create-sleeve-spoiler')).toBeNull();
    expect(fixture.nativeElement.querySelector('.create-deck-form')).not.toBeNull();
  });

  it('uses the shared create-modal label style for deck name, commander and import decklist', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.formats.set([
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
    ]);
    fixture.componentInstance.store.newDeckFormatId = 'commander';
    fixture.componentInstance.store.openCreateModal();
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.deck-modal-form .field-label') as NodeListOf<HTMLElement>,
    ).map((label) => label.textContent?.trim().replace(/\s+/g, ' '));

    expect(labels).toContain('Deck name *');
    expect(labels).toContain('Commander');
    expect(labels).toContain('Import decklist *');
  });

  it('does not render the cosmetics action when the create flow is locked', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.createFormLocked.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.create-cosmetics-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-create-sleeve-spoiler')).toBeNull();
  });

  it('creates an empty deck without importing and navigates directly to it', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const decksApi = TestBed.inject(DecksApi);
    const importDecklist = vi.spyOn(decksApi, 'importDecklist');
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.openCreateModal();
    fixture.componentInstance.store.newDeckName = 'Empty Deck';
    fixture.componentInstance.store.setNewDeckCreateEmpty(true);
    await fixture.componentInstance.store.create();

    expect(importDecklist).not.toHaveBeenCalled();
    expect(fixture.componentInstance.store.createModalOpen()).toBe(false);
    expect(fixture.componentInstance.store.createSuccessModalOpen()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/decks', 'saved-deck']);
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
    expect(fixture.componentInstance.store.createdDeckFileLoading()).toBe(false);
    expect(input.value).toBe('');
  });

  it('shows loading while a decklist file is being read', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    interface PendingFileReader {
      result: string | ArrayBuffer | null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null;
      readAsText(): void;
    }

    const pendingReaders: PendingFileReader[] = [];
    class MockPendingFileReader implements PendingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      constructor() {
        pendingReaders.push(this);
      }

      readAsText(): void {
        this.result = '1 Arcane Signet';
      }
    }

    vi.stubGlobal('FileReader', MockPendingFileReader);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['deck'], 'deck.dec', { type: 'text/plain' })],
    });

    fixture.componentInstance.store.loadCreatedDeckFile({ target: input } as unknown as Event);

    expect(fixture.componentInstance.store.createdDeckFileLoading()).toBe(true);

    const reader = pendingReaders[0];
    expect(reader).toBeDefined();
    reader?.onload?.call(reader as unknown as FileReader, {} as ProgressEvent<FileReader>);

    expect(fixture.componentInstance.store.createdDeckFileLoading()).toBe(false);
    expect(fixture.componentInstance.store.createdDecklist).toBe('1 Arcane Signet');
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

  it('does not render a tooltip when commander search is disabled because two commanders are already selected', async () => {
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
    const tooltip = fixture.nativeElement.querySelector('.commander-autocomplete-shell')?.closest('app-tooltip') as HTMLElement | null;
    expect(shell).not.toBeNull();
    expect(tooltip).toBeNull();
    expect(fixture.nativeElement.querySelector('.commander-count-hint')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain("You already have 2 commanders. You can't add more.");
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

  it('hides the commander preview when submitting the create modal', () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    const component = fixture.componentInstance;
    vi.spyOn(component.store, 'submitCreateModal').mockImplementation(() => undefined);
    component.commanderHoverPreview.set({ imageUrl: 'https://cards.test/atraxa.jpg', x: 100, y: 100 });

    component.submitCreateModal();

    expect(component.commanderHoverPreview()).toBeNull();
    expect(component.store.submitCreateModal).toHaveBeenCalledOnce();
  });

  it('hides the commander preview when cancelling the create flow', async () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    const component = fixture.componentInstance;
    vi.spyOn(component.store, 'cancelCreateFlow').mockResolvedValue(undefined);
    component.commanderHoverPreview.set({ imageUrl: 'https://cards.test/atraxa.jpg', x: 100, y: 100 });

    await component.cancelCreateFlow();

    expect(component.commanderHoverPreview()).toBeNull();
    expect(component.store.cancelCreateFlow).toHaveBeenCalledOnce();
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

function savedFolder(overrides: Partial<DeckFolder> = {}): DeckFolder {
  return {
    id: 'saved-folder',
    name: 'Saved Folder',
    visibility: 'private',
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
