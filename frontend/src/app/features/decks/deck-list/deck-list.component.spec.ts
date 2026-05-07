import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
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
  });
});
