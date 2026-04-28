import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Card } from '../../../core/models/card.model';
import { Deck, DeckCard, DeckSection } from '../../../core/models/deck.model';
import { DeckEditorComponent } from './deck-editor.component';

describe('DeckEditorComponent', () => {
  async function setup(routeParams: Record<string, string> = {}, deck?: Deck) {
    const decksApi = {
      get: vi.fn().mockReturnValue(of({ deck })),
      tokens: vi.fn().mockReturnValue(of({ data: [], unresolved: [] })),
      validateCommander: vi.fn().mockReturnValue(of({ valid: true, errors: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [DeckEditorComponent],
      providers: [
        provideRouter([]),
        { provide: CardsApi, useValue: { search: vi.fn().mockReturnValue(of({ data: [] })), image: vi.fn() } },
        { provide: DecksApi, useValue: decksApi },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();
  }

  it('shows a missing deck id error without a route id', async () => {
    await setup();
    const fixture = TestBed.createComponent(DeckEditorComponent);

    expect(fixture.componentInstance.store.error()).toBe('Missing deck id.');
  });

  it('keeps sideboard cards grouped after lands', async () => {
    await setup({ id: 'deck-1' }, {
      id: 'deck-1',
      name: 'Test deck',
      format: 'commander',
      folderId: null,
      cards: [
        deckCard('main-land', 'main', card('Command Tower', 'Land')),
        deckCard('side-land', 'sideboard', card('Wastes', 'Basic Land')),
      ],
    });
    const fixture = TestBed.createComponent(DeckEditorComponent);

    await fixture.componentInstance.store.load();

    const groups = fixture.componentInstance.store.cardGroups();
    expect(groups.map((group) => group.id)).toEqual(['commander', 'land', 'sideboard']);
    expect(groups.find((group) => group.id === 'sideboard')?.cards[0].card.name).toBe('Wastes');
  });

  it('shows deck title warning only for backend validation errors', async () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Test deck',
      format: 'commander',
      folderId: null,
      cards: [deckCard('main-card', 'main', card('Black Lotus', 'Artifact'))],
    };
    await setup({ id: 'deck-1' }, deck);
    const fixture = TestBed.createComponent(DeckEditorComponent);

    fixture.componentInstance.store.validation.set({
      valid: false,
      errors: ['Black Lotus is banned in Commander.'],
      issues: [{ severity: 'warning', title: 'Review', detail: 'Only warning.', cards: ['Black Lotus'] }],
    });

    expect(fixture.componentInstance.store.hasDeckIssues()).toBe(true);
    expect(fixture.componentInstance.store.deckIssueTooltip()).toContain('Black Lotus is banned in Commander.');

    fixture.componentInstance.store.validation.set({
      valid: true,
      errors: [],
      issues: [{ severity: 'warning', title: 'Review', detail: 'Only warning.', cards: ['Black Lotus'] }],
    });

    expect(fixture.componentInstance.store.hasDeckIssues()).toBe(false);
  });
});

function deckCard(id: string, section: DeckSection, card: Card): DeckCard {
  return { id, section, card, quantity: 1 };
}

function card(name: string, typeLine: string): Card {
  return {
    id: `${name}-id`,
    scryfallId: `${name}-scryfall-id`,
    name,
    manaCost: null,
    typeLine,
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
