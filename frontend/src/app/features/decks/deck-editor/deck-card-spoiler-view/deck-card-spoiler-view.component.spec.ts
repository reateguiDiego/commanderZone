import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw, TriangleAlert } from 'lucide-angular';
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
        importProvidersFrom(LucideAngularModule.pick({ RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    expect(store.ensureCardImages).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('https://img.test/card.jpg');
  });
});

function storeStub() {
  const entry: DeckCard = { id: 'deck-card-1', quantity: 1, section: 'main', card: card() };

  return {
    cardGroups: signal([{ id: 'creature', title: 'Criaturas', cards: [entry] }]),
    cardMenu: signal(null),
    ensureCardImages: vi.fn(),
    showCardPreview: vi.fn(),
    moveCardPreview: vi.fn(),
    hideCardPreview: vi.fn(),
    toggleCardMenu: vi.fn(),
    imageUrl: () => 'https://img.test/card.jpg',
    displayCardName: (value: Card) => value.name,
    hasAlternateFace: () => false,
    toggleCardFace: vi.fn(),
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
