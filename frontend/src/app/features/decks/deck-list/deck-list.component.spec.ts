import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  ArrowLeft,
  Folder,
  FolderPlus,
  Globe,
  Lock,
  LucideAngularModule,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-angular';
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Deck } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckListComponent } from './deck-list.component';

describe('DeckListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckListComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({
          ArrowLeft,
          Folder,
          FolderPlus,
          Pencil,
          Plus,
          Search,
          Trash2,
          TriangleAlert,
          Globe,
          Lock,
        })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })) } },
        {
          provide: DecksApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
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
            validateCommander: vi.fn().mockReturnValue(of({
              valid: true,
              format: 'commander',
              counts: { total: 100, commander: 1, main: 99, sideboard: 0, maybeboard: 0 },
              commander: { mode: 'single', names: [], colorIdentity: [] },
              errors: [],
              warnings: [],
            })),
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

  it('renders the deck list page', () => {
    const fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();

    expect(TestBed.inject(PageHeaderStore).state()?.title).toBe('Decks');
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

  it('explains that imported commander entries are removed automatically', async () => {
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

function savedDeck(): Deck {
  return {
    id: 'saved-deck',
    name: 'Saved Deck',
    format: 'commander',
    folderId: null,
  };
}
