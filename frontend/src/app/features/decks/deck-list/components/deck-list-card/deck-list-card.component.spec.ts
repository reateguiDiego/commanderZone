import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Globe, Lock, LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { DeckListCardComponent } from './deck-list-card.component';

describe('DeckListCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckListCardComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Globe, Lock, TriangleAlert })),
      ],
    }).compileComponents();
  });

  it('renders deck visuals without owner edit actions', () => {
    const fixture = TestBed.createComponent(DeckListCardComponent);
    fixture.componentRef.setInput('deck', {
      id: 'deck-1',
      name: 'Public Deck',
      format: 'commander',
      visibility: 'public',
      folderId: null,
      cards: [],
    });
    fixture.componentRef.setInput('colorIdentity', ['G', 'U']);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Public Deck');
    expect(element.querySelector('.visibility-pill')?.textContent?.trim()).toBe('Public');
    expect(element.querySelector('.deck-row-actions')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });

  it('renders a crawlable deck link when a deck href is provided', () => {
    const fixture = TestBed.createComponent(DeckListCardComponent);
    fixture.componentRef.setInput('deck', {
      id: 'deck-1',
      name: 'Public Deck',
      format: 'commander',
      visibility: 'public',
      folderId: null,
      cards: [],
    });
    fixture.componentRef.setInput('deckHref', '/community/decks/public-deck-deck0001/');
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a.deck-list-row');

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/community/decks/public-deck-deck0001/');
    expect((fixture.nativeElement as HTMLElement).querySelector('article.deck-list-row')).toBeNull();
  });
});
