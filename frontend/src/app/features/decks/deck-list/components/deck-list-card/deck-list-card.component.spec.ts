import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Copy, Globe, Heart, Lock, LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { DeckListCardComponent } from './deck-list-card.component';

describe('DeckListCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckListCardComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Copy, Globe, Heart, Lock, TriangleAlert })),
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

  it('renders owner metrics when requested', () => {
    const fixture = TestBed.createComponent(DeckListCardComponent);
    fixture.componentRef.setInput('deck', {
      id: 'deck-1',
      name: 'Public Deck',
      format: 'commander',
      visibility: 'public',
      folderId: null,
      likes: 17,
      copies: 4,
      cards: [],
    });
    fixture.componentRef.setInput('metricsMode', 'owner');
    fixture.detectChanges();

    const metrics = (fixture.nativeElement as HTMLElement).querySelector('.deck-card-metrics');

    expect(metrics).not.toBeNull();
    expect(metrics?.classList).toContain('owner-metrics');
    expect(metrics?.querySelector('.deck-card-metric-likes')?.getAttribute('aria-label')).toBe('Likes: 17');
    expect(metrics?.querySelector('.deck-card-metric-copies')?.getAttribute('aria-label')).toBe('Copies: 4');
  });
});
