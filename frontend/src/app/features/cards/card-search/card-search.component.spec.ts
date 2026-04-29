import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LucideAngularModule, Search } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { CardSearchComponent } from './card-search.component';

describe('CardSearchComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardSearchComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Search })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })) } },
      ],
    }).compileComponents();
  });

  it('renders the card search form', () => {
    const fixture = TestBed.createComponent(CardSearchComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Search');
  });
});
