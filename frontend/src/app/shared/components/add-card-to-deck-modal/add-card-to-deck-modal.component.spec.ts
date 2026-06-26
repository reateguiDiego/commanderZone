import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, X } from 'lucide-angular';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Card } from '../../../core/models/card.model';
import { Deck } from '../../../core/models/deck.model';
import { AddCardToDeckModalComponent } from './add-card-to-deck-modal.component';

describe('AddCardToDeckModalComponent', () => {
  let fixture: ComponentFixture<AddCardToDeckModalComponent>;
  let component: AddCardToDeckModalComponent;
  let decksApi: { list: ReturnType<typeof vi.fn>; addCard: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    decksApi = {
      list: vi.fn().mockReturnValue(of({ data: [deckFixture()] })),
      addCard: vi.fn().mockReturnValue(of({ deck: deckFixture() })),
    };

    await TestBed.configureTestingModule({
      imports: [AddCardToDeckModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ X })),
        { provide: CardsApi, useValue: { get: vi.fn() } },
        { provide: DecksApi, useValue: decksApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddCardToDeckModalComponent);
    component = fixture.componentInstance;
  });

  it('builds the selected deck preview from commander art and color identity', () => {
    const deck = deckFixture();
    component.decks.set([deck]);
    component.selectedDeckId.set(deck.id);

    expect(component.selectedDeckPreview()).toEqual({
      name: 'Counters United',
      commanderNames: ['Atraxa, Grand Unifier', 'Ikra Shidiqi, the Usurper'],
      colorIdentity: ['W', 'U', 'B', 'G'],
      primaryArt: 'https://cards.test/atraxa-art.jpg',
      secondaryArt: 'https://cards.test/ikra-art.jpg',
    });
  });

  it('renders the selected deck preview article inside the modal', async () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('card', cardFixture());
    fixture.detectChanges();
    await fixture.whenStable();

    component.selectDeck('deck-1');
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.add-to-deck-modal__deck-preview') as HTMLElement | null;
    const name = fixture.nativeElement.querySelector('.add-to-deck-modal__deck-preview-name') as HTMLElement | null;
    const commanders = fixture.nativeElement.querySelector('.add-to-deck-modal__deck-preview-commanders') as HTMLElement | null;

    expect(preview).not.toBeNull();
    expect(preview?.classList.contains('add-to-deck-modal__deck-preview--dual-art')).toBe(true);
    expect(name?.textContent).toContain('Counters United');
    expect(commanders?.textContent).toContain('Atraxa, Grand Unifier / Ikra Shidiqi, the Usurper');
    expect(fixture.nativeElement.textContent).toContain('Add card');
  });
});

function deckFixture(): Deck {
  return {
    id: 'deck-1',
    name: 'Counters United',
    format: 'commander',
    folderId: null,
    commanders: [
      cardFixture('commander-1', 'Atraxa, Grand Unifier', ['W', 'U', 'B', 'G'], 'https://cards.test/atraxa-art.jpg'),
      cardFixture('commander-2', 'Ikra Shidiqi, the Usurper', ['B', 'G'], 'https://cards.test/ikra-art.jpg'),
    ],
    cards: [],
  };
}

function cardFixture(
  scryfallId = 'card-1',
  name = 'Sol Ring',
  colorIdentity: string[] = [],
  artCrop = 'https://cards.test/sol-ring-art.jpg',
): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: null,
    typeLine: 'Artifact',
    oracleText: null,
    colors: colorIdentity,
    colorIdentity,
    legalities: { commander: 'legal' },
    imageUris: {
      art_crop: artCrop,
      normal: artCrop,
    },
    layout: 'normal',
    commanderLegal: true,
    set: 'cmm',
    collectorNumber: '1',
  };
}
