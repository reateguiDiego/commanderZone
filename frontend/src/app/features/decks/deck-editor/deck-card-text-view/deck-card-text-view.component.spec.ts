import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronRight, LucideAngularModule, RotateCw, TriangleAlert } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardTextViewComponent } from './deck-card-text-view.component';

describe('DeckCardTextViewComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckCardTextViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DeckEditorStore, useValue: storeStub() },
      ],
    }).compileComponents();
  });

  it('renders grouped card rows', () => {
    const fixture = TestBed.createComponent(DeckCardTextViewComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Tierras');
    expect(fixture.nativeElement.textContent).toContain('Command Tower');
  });
});

function storeStub() {
  const entry: DeckCard = { id: 'deck-card-1', quantity: 1, section: 'main', card: card() };

  return {
    cardColumns: signal([{ id: 'land-sideboard', groups: [{ id: 'land', title: 'Tierras', cards: [entry] }] }]),
    cardMenu: signal(null),
    isGroupCollapsed: () => false,
    toggleGroup: vi.fn(),
    showCardPreview: vi.fn(),
    moveCardPreview: vi.fn(),
    hideCardPreview: vi.fn(),
    toggleCardMenu: vi.fn(),
    displayCardName: (value: Card) => value.name,
    hasAlternateFace: () => false,
    toggleCardFace: vi.fn(),
    isCardInvalidForDeck: () => false,
    invalidCardMessage: () => '',
    displayCardTypeLine: (value: Card) => value.typeLine,
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
    name: 'Command Tower',
    manaCost: null,
    typeLine: 'Land',
    oracleText: null,
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
