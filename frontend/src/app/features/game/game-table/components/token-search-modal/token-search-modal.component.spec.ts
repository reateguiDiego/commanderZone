import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Plus, Search, X, LucideAngularModule } from 'lucide-angular';
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
        importProvidersFrom(LucideAngularModule.pick({ Plus, Search, X })),
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
    cardsApi.search.mockReturnValue(of({ data: [cardFixture('token-2', 'Goblin Token')], page: 1, limit: 36 }));
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
      fixture.componentInstance.tokenSelected.subscribe(selected);

      fixture.componentInstance.onQueryInput('goblin');
      vi.advanceTimersByTime(320);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenCalledWith('goblin', 1, 36, { tokenOnly: true });
      expect(fixture.nativeElement.textContent).toContain('Goblin Token');

      fixture.nativeElement.querySelector('.token-add-button')?.click();
      expect(selected).toHaveBeenCalledWith(expect.objectContaining({ scryfallId: 'token-2' }));
    } finally {
      vi.useRealTimers();
    }
  });
});

function cardFixture(scryfallId: string, name: string): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: null,
    typeLine: 'Token Creature',
    oracleText: null,
    colors: [],
    colorIdentity: ['G'],
    legalities: {},
    imageUris: { normal: `https://cards.test/${scryfallId}.jpg` },
    layout: 'token',
    commanderLegal: false,
    set: 'tst',
    collectorNumber: '1',
  };
}
