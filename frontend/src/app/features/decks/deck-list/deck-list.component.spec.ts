import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ArrowLeft,
  Folder,
  FolderPlus,
  LucideAngularModule,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
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
          RefreshCcw,
          Search,
          Trash2,
        })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: DecksApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
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

    expect(fixture.nativeElement.textContent).toContain('Decks');
  });
});
