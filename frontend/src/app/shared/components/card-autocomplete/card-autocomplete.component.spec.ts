import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Search } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { CardAutocompleteComponent } from './card-autocomplete.component';

describe('CardAutocompleteComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardAutocompleteComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Search })),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })) } },
      ],
    }).compileComponents();
  });

  it('renders the configured placeholder', () => {
    const fixture = TestBed.createComponent(CardAutocompleteComponent);
    fixture.componentInstance.placeholder = 'Find a card';
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input')?.getAttribute('placeholder')).toBe('Find a card');
  });
});
