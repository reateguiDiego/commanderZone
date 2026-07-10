import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronDown, ChevronRight, LucideAngularModule, RotateCw, TriangleAlert } from 'lucide-angular';
import { DeckBracketEstimate } from '../../../../core/models/deck-analysis.model';
import { Deck } from '../../../../core/models/deck.model';
import { DeviceProfileService } from '../../../../shared/services/device-profile.service';
import { DECK_ANALYSIS_STORE } from '../../../decks/deck-editor/deck-analysis-panel/deck-analysis-store.token';
import { DECK_VIEW_STORE } from '../../../decks/deck-editor/deck-view-store.token';
import { DeckViewerComponent } from './deck-viewer.component';
import { CommunityDeckViewerStore } from './community-deck-viewer.store';

describe('DeckViewerComponent', () => {
  const deckFixture: Deck = {
    id: 'deck-1',
    name: 'Readonly Deck',
    format: 'commander',
    visibility: 'public',
    folderId: null,
    commanders: [{
      id: 'card-1',
      scryfallId: 'card-1',
      name: 'Atraxa, Grand Unifier',
      manaCost: '{G}{W}{U}{B}',
      typeLine: 'Legendary Creature',
      oracleText: null,
      colors: ['G', 'W', 'U', 'B'],
      colorIdentity: ['G', 'W', 'U', 'B'],
      legalities: { commander: 'legal' },
      imageUris: {},
      layout: 'normal',
      commanderLegal: true,
      set: null,
      collectorNumber: null,
    }],
    cards: [{
      id: 'deck-card-1',
      quantity: 1,
      section: 'commander',
      card: {
        id: 'card-1',
        scryfallId: 'card-1',
        name: 'Atraxa, Grand Unifier',
        manaCost: '{G}{W}{U}{B}',
        typeLine: 'Legendary Creature',
        oracleText: null,
        colors: ['G', 'W', 'U', 'B'],
        colorIdentity: ['G', 'W', 'U', 'B'],
        legalities: { commander: 'legal' },
        imageUris: {},
        layout: 'normal',
        commanderLegal: true,
        set: null,
        collectorNumber: null,
      },
    }],
  };

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [DeckViewerComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        CommunityDeckViewerStore,
        { provide: DECK_VIEW_STORE, useExisting: CommunityDeckViewerStore },
        { provide: DECK_ANALYSIS_STORE, useExisting: CommunityDeckViewerStore },
        {
          provide: DeviceProfileService,
          useValue: {
            isDesktopLayout: signal(true),
            hasHover: signal(true),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the readonly deck viewer without edit actions', () => {
    TestBed.inject(CommunityDeckViewerStore).setDeck(deckFixture);
    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('1 cards');
    expect(element.textContent).toContain('1 sections');
    expect(element.querySelector('app-deck-card-menu')).toBeNull();
    expect(element.textContent).not.toContain('Import');
    expect(element.textContent).not.toContain('Delete');
  });

  it('renders the bracket pill before the summary counts', () => {
    TestBed.inject(CommunityDeckViewerStore).setDeck(deckFixture);
    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.componentRef.setInput('bracket', bracketFixture());
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('.deck-summary-status') as HTMLElement | null;
    const firstChild = status?.firstElementChild;
    const secondChild = firstChild?.nextElementSibling;

    expect(firstChild?.tagName.toLowerCase()).toBe('app-bracket-pill');
    expect(secondChild?.classList.contains('deck-summary-counts')).toBe(true);
  });

  it('defaults to spoiler on first session open without hover and outside desktop layout', async () => {
    TestBed.resetTestingModule();
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [DeckViewerComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        CommunityDeckViewerStore,
        { provide: DECK_VIEW_STORE, useExisting: CommunityDeckViewerStore },
        { provide: DECK_ANALYSIS_STORE, useExisting: CommunityDeckViewerStore },
        {
          provide: DeviceProfileService,
          useValue: {
            isDesktopLayout: signal(false),
            hasHover: signal(false),
          },
        },
      ],
    }).compileComponents();

    TestBed.inject(CommunityDeckViewerStore).setDeck(deckFixture);
    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.detectChanges();

    expect(fixture.componentInstance.viewMode()).toBe('spoiler');
    expect(fixture.nativeElement.querySelector('app-deck-card-spoiler-view')).not.toBeNull();
  });

  it('reuses the user session preference even on touch-first layouts', async () => {
    TestBed.resetTestingModule();
    sessionStorage.setItem('community.deckViewer.viewMode', 'text');

    await TestBed.configureTestingModule({
      imports: [DeckViewerComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert })),
        CommunityDeckViewerStore,
        { provide: DECK_VIEW_STORE, useExisting: CommunityDeckViewerStore },
        { provide: DECK_ANALYSIS_STORE, useExisting: CommunityDeckViewerStore },
        {
          provide: DeviceProfileService,
          useValue: {
            isDesktopLayout: signal(false),
            hasHover: signal(false),
          },
        },
      ],
    }).compileComponents();

    TestBed.inject(CommunityDeckViewerStore).setDeck(deckFixture);
    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.detectChanges();

    expect(fixture.componentInstance.viewMode()).toBe('text');
    expect(fixture.nativeElement.querySelector('app-deck-card-text-view')).not.toBeNull();
  });

  it('emits the selected card action for the page container to resolve', () => {
    const store = TestBed.inject(CommunityDeckViewerStore);
    store.setDeck(deckFixture);
    const deckCard = deckFixture.cards?.[0];
    if (!deckCard) {
      throw new Error('Expected deck fixture card');
    }

    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.detectChanges();

    const emitted = vi.fn();
    fixture.componentInstance.cardActionSelected.subscribe(emitted);
    store.contextMenu.set({
      card: deckCard.card,
      top: 120,
      left: 180,
    });

    fixture.componentInstance.handleContextAction('details');

    expect(emitted).toHaveBeenCalledWith({
      action: 'details',
      card: deckCard.card,
    });
    expect(store.contextMenu()).toBeNull();
  });

  it('does not emit card actions when card actions are disabled', () => {
    const store = TestBed.inject(CommunityDeckViewerStore);
    store.setDeck(deckFixture);
    const deckCard = deckFixture.cards?.[0];
    if (!deckCard) {
      throw new Error('Expected deck fixture card');
    }

    const fixture = TestBed.createComponent(DeckViewerComponent);
    fixture.componentRef.setInput('deck', deckFixture);
    fixture.componentRef.setInput('cardActionsEnabled', false);
    fixture.detectChanges();

    const emitted = vi.fn();
    fixture.componentInstance.cardActionSelected.subscribe(emitted);
    store.contextMenu.set({
      card: deckCard.card,
      top: 120,
      left: 180,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-common-card-menu')).toBeNull();

    fixture.componentInstance.handleContextAction('details');

    expect(emitted).not.toHaveBeenCalled();
    expect(store.contextMenu()).toBeNull();
  });

  it('closes the open community card context menu instead of opening another card menu', () => {
    const store = TestBed.inject(CommunityDeckViewerStore);
    store.setDeck(deckFixture);
    const deckCard = deckFixture.cards?.[0];
    if (!deckCard) {
      throw new Error('Expected deck fixture card');
    }
    const secondEntry = {
      id: 'deck-card-2',
      quantity: 1,
      section: 'main' as const,
      card: {
        ...deckCard.card,
        id: 'card-2',
        scryfallId: 'card-2',
        name: 'Sol Ring',
      },
    };

    store.contextMenu.set({
      card: deckCard.card,
      top: 120,
      left: 180,
    });

    store.toggleCardMenu(new MouseEvent('click', { bubbles: true }), secondEntry);

    expect(store.contextMenu()).toBeNull();
  });

  it('closes the open community card context menu instead of toggling card faces', () => {
    const store = TestBed.inject(CommunityDeckViewerStore);
    store.setDeck(deckFixture);
    const deckCard = deckFixture.cards?.[0];
    if (!deckCard) {
      throw new Error('Expected deck fixture card');
    }

    store.contextMenu.set({
      card: deckCard.card,
      top: 120,
      left: 180,
    });

    store.toggleCardFace(new MouseEvent('click', { bubbles: true }), deckCard.card, { updatePreview: false });

    expect(store.isFaceFlipped(deckCard.card)).toBe(false);
    expect(store.contextMenu()).toBeNull();

    store.toggleCardFace(new MouseEvent('click', { bubbles: true }), deckCard.card, { updatePreview: false });

    expect(store.isFaceFlipped(deckCard.card)).toBe(true);
  });

});

function bracketFixture(): DeckBracketEstimate {
  return {
    bracket: 3,
    label: 'Upgraded',
    confidence: 'medium',
    method: 'commander_brackets_beta_v1',
    floor: 1,
    ceiling: 5,
    ruleBreakers: [],
    differences: {
      themeScore: 40,
      staplesScore: 60,
      speedScore: 45,
      metagameScore: 30,
      manaEfficiencyScore: 50,
    },
    officialSignals: {
      gameChangers: { count: 1, cards: [], status: 'detected' },
      massLandDenial: { detected: false, count: 0, cards: [] },
      extraTurns: { count: 0, cards: [], chainsOrLoops: false },
      twoCardCombos: { count: 0, beforeTurnSix: false, lateGameOnly: false },
      nonLandTutors: { count: 0, cards: [], efficientCount: 0 },
    },
    reasonCodes: [],
    reasons: ['Upgraded deck signals detected.'],
    warnings: [],
    explanation: {
      short: 'Estimated as Bracket 3.',
      long: 'Estimated as Bracket 3.',
      officialCriteria: [
        { bracket: 3, label: 'Upgraded', summary: 'Upgraded decks with staples.' },
      ],
      detectedSignalsExplanation: [],
      ruleBreakersExplanation: [],
      differenceModel: {
        theme: 'Theme',
        staples: 'Staples',
        speed: 'Speed',
        metagame: 'Metagame',
        manaEfficiency: 'Mana efficiency',
      },
      reasonCodes: [],
    },
  };
}
