import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Search } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
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

  it('filters out non-commander cards when commanderCandidateOnly is enabled', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };
    cardsApi.search.mockReturnValue(of({
      data: [
        card('Agate Assault', 'Sorcery', null),
        card('Agate Instigator', 'Legendary Creature - Lizard Rogue', null),
        card('Agate Archmage', 'Legendary Planeswalker - Wizard', 'Agate Archmage can be your commander.'),
      ],
    }));

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.componentInstance.commanderCandidateOnly = true;
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('agate');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      const resultNames = fixture.componentInstance.results().map((result) => result.name);
      expect(resultNames).toHaveLength(2);
      expect(resultNames).toContain('Agate Instigator');
      expect(resultNames).toContain('Agate Archmage');
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters out token cards when excludeTokens is enabled', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };
    cardsApi.search.mockReturnValue(of({
      data: [
        card('Spirit Token', 'Token Creature - Spirit', null, 'token'),
        card('Sol Ring', 'Artifact', null),
      ],
    }));

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.componentInstance.excludeTokens = true;
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('so');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.results().map((result) => result.name)).toEqual(['Sol Ring']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters out emblem cards when excludeEmblems is enabled', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };
    cardsApi.search
      .mockReturnValueOnce(of({
        data: [
          card('Chandra Emblem', 'Emblem - Chandra', null, 'emblem'),
        ],
      }))
      .mockReturnValueOnce(of({
        data: [
          card('Lightning Bolt', 'Instant', null),
        ],
      }));

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.componentInstance.excludeEmblems = true;
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('cha');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.results().map((result) => result.name)).toEqual([]);

      fixture.componentInstance.onQueryInput('light');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.results().map((result) => result.name)).toEqual(['Lightning Bolt']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters out scheme cards when excludeSchemes is enabled', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };
    cardsApi.search
      .mockReturnValueOnce(of({
        data: [
          card('My Scheme', 'Scheme', null, 'scheme'),
        ],
      }))
      .mockReturnValueOnce(of({
        data: [
          card('Lightning Bolt', 'Instant', null),
        ],
      }));

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.componentInstance.excludeSchemes = true;
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('scheme');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.results().map((result) => result.name)).toEqual([]);

      fixture.componentInstance.onQueryInput('light');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.results().map((result) => result.name)).toEqual(['Lightning Bolt']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the overlay when clicking outside the component', () => {
    const fixture = TestBed.createComponent(CardAutocompleteComponent);
    fixture.componentInstance.results.set([card('Sol Ring', 'Artifact', null)]);
    fixture.detectChanges();

    expect(fixture.componentInstance.results().length).toBe(1);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.results()).toEqual([]);
  });

  it('uses a reduced backend limit for interactive autocomplete searches', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('sol');
      await vi.advanceTimersByTimeAsync(350);

      expect(cardsApi.search).toHaveBeenCalledWith('sol', 1, 40, {});
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a no-results notice after a completed empty search', async () => {
    const cardsApi = TestBed.inject(CardsApi) as unknown as { search: ReturnType<typeof vi.fn> };
    cardsApi.search.mockReturnValue(of({ data: [] }));

    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CardAutocompleteComponent);
      fixture.detectChanges();

      fixture.componentInstance.onQueryInput('sol');
      await vi.advanceTimersByTimeAsync(350);
      fixture.detectChanges();

      expect(fixture.componentInstance.searched()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('No cards found');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a no-results notice before reaching the minimum query length', () => {
    const fixture = TestBed.createComponent(CardAutocompleteComponent);
    fixture.detectChanges();

    fixture.componentInstance.onQueryInput('s');
    fixture.detectChanges();

    expect(fixture.componentInstance.searched()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('No cards found');
  });

  it('does not show a no-results notice while loading', () => {
    const fixture = TestBed.createComponent(CardAutocompleteComponent);
    fixture.componentInstance.loading.set(true);
    fixture.componentInstance.searched.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('No cards found');
    expect(fixture.nativeElement.textContent).toContain('Searching cards');
  });
});

function card(name: string, typeLine: string | null, oracleText: string | null, layout = 'normal'): Card {
  return {
    id: name,
    scryfallId: name,
    name,
    manaCost: null,
    typeLine,
    oracleText,
    colors: [],
    colorIdentity: [],
    legalities: { commander: 'legal' },
    imageUris: {},
    layout,
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
