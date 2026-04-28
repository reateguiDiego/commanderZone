import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from './deck-card-menu.component';

describe('DeckCardMenuComponent', () => {
  let fixture: ComponentFixture<DeckCardMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckCardMenuComponent],
      providers: [{ provide: DeckEditorStore, useValue: storeStub() }],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckCardMenuComponent);
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
  });

  it('renders a shared quantity input between copy actions', () => {
    const text = fixture.nativeElement.textContent as string;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement | null;

    expect(text).toContain('Add copy');
    expect(text).toContain('Qty');
    expect(text).toContain('Remove copy');
    expect(input?.value).toBe('2');
  });
});

function storeStub() {
  return {
    cardMenu: signal({ entryId: 'deck-card-1', top: 10, left: 20, amount: 2 }),
    setCardMenuAmount: vi.fn(),
    addCardCopy: vi.fn(),
    removeCardCopy: vi.fn(),
    moveCardToSection: vi.fn(),
  };
}

function entry(): DeckCard {
  return {
    id: 'deck-card-1',
    quantity: 1,
    section: 'main',
    card: {
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
    },
  };
}
