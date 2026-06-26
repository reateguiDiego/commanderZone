import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronRight, LucideAngularModule, RotateCw, TriangleAlert } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { DeckCard } from '../../../../core/models/deck.model';
import { DECK_VIEW_STORE } from '../deck-view-store.token';
import { DeckCardTextViewComponent } from './deck-card-text-view.component';

describe('DeckCardTextViewComponent', () => {
  async function setup(store = storeStub()) {
    await TestBed.configureTestingModule({
      imports: [DeckCardTextViewComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    return TestBed.createComponent(DeckCardTextViewComponent);
  }

  it('renders grouped card rows', async () => {
    const fixture = await setup();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Tierras');
    expect(fixture.nativeElement.textContent).toContain('Command Tower');
  });

  it('flips card faces from text rows without opening the card menu', async () => {
    const store = storeStub({ hasAlternateFace: true });
    const fixture = await setup(store);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const cardEntry = store.cardColumns()[0]?.groups[0]?.cards[0];

    button.click();

    expect(cardEntry).toBeDefined();
    expect(store.toggleCardFace).toHaveBeenCalledWith(expect.any(MouseEvent), cardEntry?.card);
    expect(store.toggleCardMenu).not.toHaveBeenCalled();
  });

  it('suppresses contextmenu interactions from the text-row face toggle', async () => {
    const store = storeStub({ hasAlternateFace: true });
    const fixture = await setup(store);
    const parentContextMenuSpy = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenuSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(parentContextMenuSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(store.toggleCardMenu).not.toHaveBeenCalled();
  });

  it('hides the preview without resetting double-faced cards after hover', async () => {
    const store = storeStub({ hasAlternateFace: true });
    const fixture = await setup(store);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.deck-card-row') as HTMLElement;
    const cardEntry = store.cardColumns()[0]?.groups[0]?.cards[0];

    row.dispatchEvent(new Event('pointerleave'));

    expect(cardEntry).toBeDefined();
    expect(store.hideCardPreview).toHaveBeenCalledOnce();
    expect(store.resetCardFace).not.toHaveBeenCalled();
  });
});

function storeStub(options: { hasAlternateFace?: boolean } = {}) {
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
    displayCardListName: (value: Card) => value.name,
    displayCardManaCost: (value: Card) => value.manaCost,
    hasAlternateFace: () => options.hasAlternateFace ?? false,
    toggleCardFace: vi.fn(),
    resetCardFace: vi.fn(),
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
