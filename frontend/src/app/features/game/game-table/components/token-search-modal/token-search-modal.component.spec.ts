import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronUp, Plus, Search, X, LucideAngularModule } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../../../core/api/cards.api';
import { DecksApi } from '../../../../../core/api/decks.api';
import { Card } from '../../../../../core/models/card.model';
import { TokenSearchModalComponent } from './token-search-modal.component';

describe('TokenSearchModalComponent', () => {
  let fixture: ComponentFixture<TokenSearchModalComponent>;
  let decksApi: { tokens: ReturnType<typeof vi.fn> };
  let cardsApi: { search: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    decksApi = { tokens: vi.fn() };
    cardsApi = { search: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [TokenSearchModalComponent],
      providers: [
        { provide: DecksApi, useValue: decksApi },
        { provide: CardsApi, useValue: cardsApi },
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronUp, Plus, Search, X })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TokenSearchModalComponent);
    decksApi.tokens.mockReturnValue(of({
      deckId: 'deck-1',
      data: [{
        sourceCard: { scryfallId: 'source-1', name: 'Avenger of Zendikar', section: 'main' },
        token: cardFixture('token-1', 'Plant Token'),
        resolved: true,
      }],
      unresolved: [],
    }));
    cardsApi.search.mockReturnValue(of({ data: [cardFixture('token-2', 'Goblin Token')], page: 1, limit: 500 }));
  });

  it('shows detected deck tokens by default', async () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('deckId', 'deck-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(decksApi.tokens).toHaveBeenCalledWith('deck-1');
    expect(fixture.nativeElement.textContent).toContain('Plant Token');
    expect(fixture.nativeElement.textContent).toContain('from Avenger of Zendikar');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('https://cards.test/token-1.jpg');
  });

  it('searches only tokens and emits the selected token', async () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('deckId', 'deck-1');
    fixture.detectChanges();
    await fixture.whenStable();

    vi.useFakeTimers();
    try {
      const selected = vi.fn();
      fixture.componentInstance.cardSelected.subscribe(selected);

      fixture.componentInstance.onQueryInput('goblin');
      expect(cardsApi.search).not.toHaveBeenCalled();
      vi.advanceTimersByTime(320);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenCalledWith('goblin', 1, 500, { tokenOnly: true });
      expect(fixture.nativeElement.textContent).toContain('Goblin Token');

      fixture.componentInstance.onQuantityInput('3');
      fixture.detectChanges();
      fixture.nativeElement.querySelector('.token-add-button')?.click();
      expect(selected).toHaveBeenCalledWith({
        kind: 'token',
        card: expect.objectContaining({ scryfallId: 'token-2' }),
        quantity: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps token quantity to the supported range', () => {
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.onQuantityInput('99');
    expect(fixture.componentInstance.quantity()).toBe(20);

    fixture.componentInstance.onQuantityInput('0');
    expect(fixture.componentInstance.quantity()).toBe(1);
  });

  it('searches emblems by gameplayKind and emits selected emblem without quantity controls', async () => {
    const selected = vi.fn();
    cardsApi.search.mockReturnValue(of({ data: [cardFixture('emblem-1', 'Chandra Emblem', 'Emblem', 'emblem')], page: 1, limit: 500 }));
    fixture.componentInstance.cardSelected.subscribe(selected);

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('kind', 'emblem');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(decksApi.tokens).not.toHaveBeenCalled();
    expect(cardsApi.search).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      fixture.componentInstance.onQueryInput('ch');
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();
    } finally {
      vi.useRealTimers();
    }

    expect(cardsApi.search).toHaveBeenCalledWith('ch', 1, 500, { gameplayKind: 'emblem' });
    expect(fixture.nativeElement.textContent).toContain('Chandra Emblem');
    expect(fixture.nativeElement.querySelector('app-game-x-quantity-stepper')).toBeNull();

    fixture.nativeElement.querySelector('.token-add-button')?.click();

    expect(selected).toHaveBeenCalledWith({
      kind: 'emblem',
      card: expect.objectContaining({ scryfallId: 'emblem-1' }),
    });
  });

  it('searches dungeons by gameplayKind after debounce without quantity controls', async () => {
    vi.useFakeTimers();
    try {
      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('kind', 'dungeon');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(cardsApi.search).not.toHaveBeenCalled();
      cardsApi.search.mockReturnValueOnce(of({ data: [cardFixture('dungeon-1', 'Undercity', 'Dungeon', 'dungeon')], page: 1, limit: 500 }));

      fixture.componentInstance.onQueryInput('under');
      expect(cardsApi.search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenNthCalledWith(1, 'under', 1, 500, { gameplayKind: 'dungeon' });
      expect(fixture.nativeElement.textContent).toContain('Undercity');
      expect(fixture.nativeElement.querySelector('app-game-x-quantity-stepper')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not search emblem or dungeon cards until the query has more than one character', async () => {
    vi.useFakeTimers();
    try {
      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('kind', 'dungeon');
      fixture.detectChanges();
      await fixture.whenStable();
      cardsApi.search.mockReturnValue(of({ data: [cardFixture('dungeon-search', 'Dungeon of the Mad Mage', 'Dungeon', 'dungeon')], page: 1, limit: 500 }));

      fixture.componentInstance.onQueryInput('u');
      expect(cardsApi.search).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(320);
      expect(cardsApi.search).not.toHaveBeenCalled();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No dungeons found.');

      fixture.componentInstance.onQueryInput('du');
      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenCalledOnce();
      expect(cardsApi.search).toHaveBeenCalledWith('du', 1, 500, { gameplayKind: 'dungeon' });
      expect(fixture.nativeElement.textContent).toContain('Dungeon of the Mad Mage');

      cardsApi.search.mockClear();
      fixture.componentInstance.onQueryInput('');
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();

      expect(cardsApi.search).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('No dungeons found.');
    } finally {
      vi.useRealTimers();
    }
  });
});

function cardFixture(scryfallId: string, name: string, typeLine = 'Token Creature', layout = 'token'): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: null,
    typeLine,
    oracleText: null,
    colors: [],
    colorIdentity: ['G'],
    legalities: {},
    imageUris: { normal: `https://cards.test/${scryfallId}.jpg` },
    layout,
    commanderLegal: false,
    set: 'tst',
    collectorNumber: '1',
  };
}
