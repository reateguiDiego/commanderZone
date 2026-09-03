import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CircleHelp, Copy, Heart, Info, LucideAngularModule, X } from 'lucide-angular';
import { RUNTIME_TRANSLATION_FALLBACKS } from '../../../../../core/localization/runtime-translation-fallbacks';
import { DashboardPageContextComponent } from './dashboard-page-context.component';

describe('DashboardPageContextComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPageContextComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ CircleHelp, Copy, Heart, Info, X })),
      ],
    }).compileComponents();
  });

  it('keeps title actions without tooltip hidden when no tooltip text is provided', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Cards',
      titleActions: [
        {
          id: 'help',
          label: 'Help',
          icon: 'circle-help',
          iconOnly: true,
          variant: 'secondary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.page-header-title-actions .cz-tooltip') as HTMLElement;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.page-header-title-actions .cz-tooltip__bubble')).toBeNull();
  });

  it('shows a title action tooltip on click when configured in click mode', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Cards',
      titleActions: [
        {
          id: 'disclaimer',
          label: 'Card language',
          icon: 'info',
          iconOnly: true,
          tooltip: '73% of cards are available in Spanish.',
          tooltipTriggerMode: 'click',
          variant: 'secondary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.page-header-title-actions button[data-action-id=\"disclaimer\"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const bubble = fixture.nativeElement.querySelector('.page-header-title-actions .cz-tooltip__bubble') as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('73% of cards are available in Spanish.');
  });

  it('renders the community deck detail actions stack instead of stats', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Readonly Deck',
      context: 'community-deck-detail',
      sharedBy: {
        displayName: 'Alber',
      },
      actions: [
        {
          id: 'save-deck',
          label: 'Save deck',
          variant: 'primary',
          execute: () => undefined,
        },
      ],
      stats: [
        {
          id: 'commander',
          label: 'Commander',
          value: 'Atraxa, Grand Unifier',
        },
      ],
      actionFeedback: {
        message: 'Saved',
        tone: 'success',
      },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.page-header-stats')).toBeNull();
    expect(fixture.nativeElement.querySelector('.page-header-title-meta-label')?.textContent).toContain('Shared by');
    expect(fixture.nativeElement.querySelector('app-player-info')?.textContent).toContain('Alber');
    const actionsStack = fixture.nativeElement.querySelector('.page-header-actions-stack') as HTMLElement | null;
    expect(actionsStack).not.toBeNull();
    expect(actionsStack?.querySelector('.page-header-shared-by app-player-info')?.textContent).toContain('Alber');
    expect(fixture.nativeElement.querySelector('.page-header-action-feedback')?.textContent).toContain('Saved');
  });

  it('renders translated labels for action counters when configured', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Readonly Deck',
      context: 'community-deck-detail',
      actions: [
        {
          id: 'like-deck',
          label: 'Like deck',
          counter: 12,
          counterLabel: 'community.deckCard.likes',
          variant: 'secondary',
          execute: () => undefined,
        },
        {
          id: 'save-deck',
          label: 'Save deck',
          counter: 4,
          counterLabel: 'community.deckCard.copies',
          variant: 'primary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const counters = Array.from(fixture.nativeElement.querySelectorAll('.page-header-action-counter'))
      .map((element) => (element as HTMLElement).textContent?.trim());
    expect(counters).toEqual(['Likes: 12', 'Copies: 4']);
  });

  it('renders own deck ownership text without player info', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Own Deck',
      context: 'community-deck-detail',
      sharedBy: {
        displayName: 'Alber',
      },
      sharedByLabel: 'This deck is yours.',
      sharedByOwnDeck: true,
      actions: [
        {
          id: 'save-deck',
          label: 'Save deck',
          variant: 'primary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const sharedBy = fixture.nativeElement.querySelector('.page-header-shared-by') as HTMLElement | null;
    expect(sharedBy?.textContent).toContain('This deck is yours.');
    expect(sharedBy?.querySelector('app-player-info')).toBeNull();
  });

  it('renders deck editor actions on the back button row', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Deck editor',
      context: 'deck-editor',
      actions: [
        {
          id: 'back-to-decks',
          label: 'Back',
          isBack: true,
          variant: 'secondary',
          execute: () => undefined,
        },
        {
          id: 'save-deck',
          label: 'Save deck',
          variant: 'primary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const navigationRow = fixture.nativeElement.querySelector('.page-header-navigation-row') as HTMLElement | null;
    const actionsRow = navigationRow?.querySelector('.page-header-detail-row.has-actions') as HTMLElement | null;
    const backButton = navigationRow?.querySelector('.page-header-title-back-button') as HTMLElement | null;

    expect(navigationRow).not.toBeNull();
    expect(backButton).not.toBeNull();
    expect(actionsRow?.querySelector('.page-header-actions-stack')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.page-header-actions-stack').length).toBe(1);
  });

  it('does not render the commander bracket pill when bracket is missing', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Deck editor',
      context: 'deck-editor',
      bracket: null,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-bracket-pill')).toBeNull();
    expect(fixture.nativeElement.querySelector('.page-header-title-main h1')?.textContent).toContain('Deck editor');
  });

  it('opens and closes the commander bracket explanation modal', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Community deck',
      context: 'community-deck-detail',
      bracket: buildBracketEstimate(),
    });
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector('app-bracket-pill .bracket-pill') as HTMLButtonElement;
    pill.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.modal-panel') as HTMLElement | null;
    const text = modal?.textContent ?? '';

    expect(modal).not.toBeNull();
    expect(text).toContain('Commander Bracket Estimate');
    expect(text).toContain(`Bracket 3 ${String.fromCharCode(8212)} Upgraded`);
    expect(text).toContain('Official Commander Bracket gates set a minimum bracket of 3.');
    expect(text).toContain('Game Changers');
    expect(text).toContain('Mass Land Denial');
    expect(text).toContain('Difference between Bracket 2 and 3.');
    expect(text).not.toContain('Mana efficiency: key gate for Bracket 5');
    expect(text).not.toContain('Important factor for Bracket 5.');

    const closeButton = fixture.nativeElement.querySelector('.modal-close-button') as HTMLButtonElement;
    closeButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-panel')).toBeNull();
  });

  it('keeps the commander bracket translation keys available in runtime fallbacks', () => {
    const requiredKeys = [
      'bracket.pill.label',
      'bracket.tooltip.current',
      'bracket.explanation.button',
      'bracket.explanation.title',
      'bracket.explanation.currentBracket',
      'bracket.explanation.detectedSignals',
      'bracket.explanation.officialSignals',
      'bracket.explanation.differenceModel',
      'bracket.explanation.theme',
      'bracket.explanation.staples',
      'bracket.explanation.speed',
      'bracket.explanation.metagame',
      'bracket.explanation.manaEfficiency',
      'bracket.explanation.warning',
      'shared.text.high',
      'shared.text.medium',
      'shared.text.low',
    ];

    expect(requiredKeys.every((key) => RUNTIME_TRANSLATION_FALLBACKS[key])).toBe(true);
  });

  it('renders deck editor owner metrics inside the actions row', () => {
    const fixture = TestBed.createComponent(DashboardPageContextComponent);
    fixture.componentRef.setInput('header', {
      title: 'Deck editor',
      context: 'deck-editor',
      deckMetrics: {
        likes: 8,
        copies: 3,
      },
      actions: [
        {
          id: 'back-to-decks',
          label: 'Back',
          isBack: true,
          variant: 'secondary',
          execute: () => undefined,
        },
        {
          id: 'export-deck',
          label: 'Export deck',
          variant: 'secondary',
          execute: () => undefined,
        },
      ],
    });
    fixture.detectChanges();

    const metrics = fixture.nativeElement.querySelector('.page-header-navigation-row .page-header-detail-row.has-actions .deck-card-metrics.owner-metrics') as HTMLElement | null;
    expect(metrics).not.toBeNull();
    expect(metrics?.textContent).toContain('8');
    expect(metrics?.textContent).toContain('3');
  });
});

function buildBracketEstimate() {
  return {
    bracket: 3,
    label: 'Upgraded',
    confidence: 'medium',
    method: 'commander_brackets_beta_v1',
    floor: 3,
    ceiling: 4,
    ruleBreakers: [],
    differences: {
      themeScore: 15,
      staplesScore: 52,
      speedScore: 41,
      metagameScore: 18,
      manaEfficiencyScore: 54,
    },
    officialSignals: {
      gameChangers: { count: 2, status: 'allowed_in_bracket_3', cards: [] },
      massLandDenial: { detected: false, count: 0, cards: [] },
      extraTurns: { count: 1, chainsOrLoops: false, cards: [] },
      twoCardCombos: { count: 0, beforeTurnSix: false, lateGameOnly: false },
      nonLandTutors: { count: 3, efficientCount: 1, cards: [] },
    },
    reasonCodes: [],
    reasons: [
      'Official Commander Bracket gates set a minimum bracket of 3.',
      'It does not move higher because speed is below optimized.',
    ],
    warnings: [],
    explanation: {
      short: 'Estimated as Bracket 3 because the deck has upgraded staples.',
      long: 'Long explanation.',
      officialCriteria: [],
      detectedSignalsExplanation: [],
      ruleBreakersExplanation: [],
      differenceModel: {
        theme: 'Difference between Bracket 1 and 2.',
        staples: 'Difference between Bracket 2 and 3.',
        speed: 'Difference between Bracket 3 and 4.',
        metagame: 'Difference between Bracket 4 and 5.',
        manaEfficiency: 'Important factor for Bracket 5.',
      },
      reasonCodes: [],
    },
  } as const;
}
