import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BarChart3, ChevronDown, History, Layers3, LucideAngularModule, SearchX, ShieldCheck, Shuffle } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { CommunityDeckDetail } from '../../../../core/models/community.model';
import { DeckCard, DeckSection } from '../../../../core/models/deck.model';
import { DECK_ANALYSIS_STORE } from '../../../decks/deck-editor/deck-analysis-panel/deck-analysis-store.token';
import { DECK_VIEW_STORE } from '../../../decks/deck-editor/deck-view-store.token';
import { CommunityDeckInspectorComponent } from './community-deck-inspector.component';
import { CommunityDeckViewerStore } from '../deck-viewer/community-deck-viewer.store';

describe('CommunityDeckInspectorComponent', () => {
  it('shows hover card lists for analysis metrics', async () => {
    await TestBed.configureTestingModule({
      imports: [CommunityDeckInspectorComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ BarChart3, ChevronDown, History, Layers3, SearchX, ShieldCheck, Shuffle })),
        CommunityDeckViewerStore,
        { provide: DECK_VIEW_STORE, useExisting: CommunityDeckViewerStore },
        { provide: DECK_ANALYSIS_STORE, useExisting: CommunityDeckViewerStore },
      ],
    }).compileComponents();

    TestBed.inject(CommunityDeckViewerStore).setDeck(buildDeckDetail());
    const fixture = TestBed.createComponent(CommunityDeckInspectorComponent);
    fixture.componentRef.setInput('deck', buildDeckDetail());
    fixture.detectChanges();

    const hoverRow = fixture.nativeElement.querySelector('.hoverable-analysis-row') as HTMLElement | null;

    expect(hoverRow).not.toBeNull();

    hoverRow?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 80, clientY: 120 }));
    fixture.detectChanges();

    const hoverList = fixture.nativeElement.querySelector('.analysis-hover-list') as HTMLElement | null;
    expect(hoverList).not.toBeNull();
    expect(hoverList?.textContent).toContain('Esper Sentinel');
  });
});

function buildDeckDetail(): CommunityDeckDetail {
  const commander = card('Atraxa, Praetors\' Voice', 'Legendary Creature', '{1}{G}{W}{U}{B}', ['G', 'W', 'U', 'B']);
  const creature = card('Esper Sentinel', 'Artifact Creature', '{W}', ['W']);
  const instant = card('Swords to Plowshares', 'Instant', '{W}', ['W']);

  return {
    id: 'community-deck-1',
    name: 'Community Deck',
    format: 'commander',
    valid: true,
    cropImage: null,
    secondaryCropImage: null,
    commanderName: commander.name,
    colorIdentity: ['G', 'W', 'U', 'B'],
    updatedAt: '2026-06-26T12:00:00Z',
    visibility: 'public',
    folderId: null,
    commanders: [commander],
    cards: [
      deckCard('commander-card', 'commander', commander),
      deckCard('creature-card', 'main', creature),
      deckCard('instant-card', 'main', instant),
    ],
    sections: {
      commander: [deckCard('commander-card', 'commander', commander)],
      main: [deckCard('creature-card', 'main', creature), deckCard('instant-card', 'main', instant)],
      sideboard: [],
      maybeboard: [],
    },
    owner: {
      displayName: 'Tester',
    },
  };
}

function deckCard(id: string, section: DeckSection, card: Card, quantity = 1): DeckCard {
  return { id, section, card, quantity };
}

function card(
  name: string,
  typeLine: string,
  manaCost: string | null,
  colorIdentity: Array<'W' | 'U' | 'B' | 'R' | 'G'>,
): Card {
  return {
    id: `${name}-id`,
    scryfallId: `${name}-scryfall-id`,
    name,
    manaCost,
    typeLine,
    oracleText: null,
    colors: colorIdentity,
    colorIdentity,
    legalities: {},
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}
