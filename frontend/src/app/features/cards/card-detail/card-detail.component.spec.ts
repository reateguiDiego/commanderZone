import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { CardsApi } from '../../../core/api/cards.api';
import { CardDetailComponent } from './card-detail.component';

describe('CardDetailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardDetailComponent],
      providers: [
        provideRouter([]),
        { provide: CardsApi, useValue: { get: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
  });

  it('shows a missing id error without a route id', () => {
    const fixture = TestBed.createComponent(CardDetailComponent);

    expect(fixture.componentInstance.error()).toBe('Missing card id.');
  });
});
