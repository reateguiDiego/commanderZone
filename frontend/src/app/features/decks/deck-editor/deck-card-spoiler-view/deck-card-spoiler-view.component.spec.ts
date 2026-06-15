import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronRight, LucideAngularModule, RotateCw, TriangleAlert } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view.component';

describe('DeckCardSpoilerViewComponent', () => {
  it('loads and renders grouped card images', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    expect(store.ensureCardImages).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('https://img.test/card.jpg');
  });

  it('flips card faces without opening the card menu preview flow', async () => {
    const store = storeStub({ hasAlternateFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const cardEntry = store.cardGroups()[0]?.cards[0];

    button.click();

    expect(cardEntry).toBeDefined();
    expect(store.toggleCardFace).toHaveBeenCalledWith(expect.any(MouseEvent), cardEntry?.card, { updatePreview: false });
    expect(store.toggleCardMenu).not.toHaveBeenCalled();
  });

  it('resets double-faced cards to the front face after hover', async () => {
    const store = storeStub({ hasAlternateFace: true, resetCardFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const article = fixture.nativeElement.querySelector('.spoiler-card') as HTMLElement;
    const cardEntry = store.cardGroups()[0]?.cards[0];

    article.dispatchEvent(new Event('pointerleave'));

    expect(cardEntry).toBeDefined();
    expect(store.resetCardFace).toHaveBeenCalledWith(cardEntry?.card);
  });

  it('collapses and expands spoiler sections from the section title', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.spoiler-section-toggle') as HTMLButtonElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();

    expect(store.toggleGroup).toHaveBeenCalledWith('creature');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.spoiler-section-body')?.classList.contains('collapsed')).toBe(true);
  });
});

function storeStub(options: { hasAlternateFace?: boolean; resetCardFace?: boolean } = {}) {
  const entry: DeckCard = { id: 'deck-card-1', quantity: 1, section: 'main', card: card() };
  const collapsedGroups = signal<Set<string>>(new Set());

  return {
    cardGroups: signal([{ id: 'creature', title: 'Criaturas', quantity: 1, cards: [entry] }]),
    cardMenu: signal(null),
    toggleGroup: vi.fn((groupId: string) => {
      const next = new Set(collapsedGroups());
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      collapsedGroups.set(next);
    }),
    isGroupCollapsed: vi.fn((groupId: string) => collapsedGroups().has(groupId)),
    ensureCardImages: vi.fn(),
    deckColorIdentitySymbols: () => [],
    showCardPreview: vi.fn(),
    moveCardPreview: vi.fn(),
    hideCardPreview: vi.fn(),
    toggleCardMenu: vi.fn(),
    imageUrl: () => 'https://img.test/card.jpg',
    displayCardImageUrl: () => 'https://img.test/card.jpg',
    displayCardName: (value: Card) => value.name,
    displayCardListName: (value: Card) => value.name,
    displayCardManaCost: (value: Card) => value.manaCost,
    hasAlternateFace: () => options.hasAlternateFace ?? false,
    toggleCardFace: vi.fn(),
    resetCardFace: vi.fn().mockReturnValue(options.resetCardFace ?? false),
    isCardInvalidForDeck: () => false,
    invalidCardMessage: () => '',
    shouldShowManaCost: () => false,
    setCardMenuAmount: vi.fn(),
    addCardCopy: vi.fn(),
    removeCardCopy: vi.fn(),
    moveCardToSection: vi.fn(),
  };
}

function card(): Card {
  return {
    id: 'card-1',
    scryfallId: 'scryfall-1',
    name: 'Esper Sentinel',
    manaCost: '{W}',
    typeLine: 'Creature',
    oracleText: null,
    colors: ['W'],
    colorIdentity: ['W'],
    legalities: {},
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
