import { importProvidersFrom } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ChevronDown, ChevronRight, Info, LucideAngularModule, RotateCw } from 'lucide-angular';
import { of, Subject, throwError } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { AdvancedAnalysisResponse } from '../../../core/models/deck-advanced-analysis.model';
import { Deck } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckAdvancedAnalysisPageComponent } from './deck-advanced-analysis-page.component';

const DECK_ID = '00000000-0000-7000-8000-000000000001';

type DecksApiMock = {
  get: ReturnType<typeof vi.fn>;
  getBySlug: ReturnType<typeof vi.fn>;
  getDeckAdvancedAnalysis: ReturnType<typeof vi.fn>;
  analysis: ReturnType<typeof vi.fn>;
};

describe('DeckAdvancedAnalysisPageComponent', () => {
  async function setup(
    routeParams: Record<string, string> = { slug: DECK_ID },
    decksApiOverrides: Partial<DecksApiMock> = {},
  ): Promise<{ fixture: ComponentFixture<DeckAdvancedAnalysisPageComponent>; decksApi: DecksApiMock }> {
    TestBed.resetTestingModule();

    const decksApi: DecksApiMock = {
      get: vi.fn().mockReturnValue(of({ deck: buildDeck() })),
      getBySlug: vi.fn().mockReturnValue(of({ deck: buildDeck() })),
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis())),
      analysis: vi.fn(),
      ...decksApiOverrides,
    };

    await TestBed.configureTestingModule({
      imports: [DeckAdvancedAnalysisPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, Info, RotateCw })),
        { provide: DecksApi, useValue: decksApi },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckAdvancedAnalysisPageComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    return { fixture, decksApi };
  }

  it('shows loading while advanced analysis is pending', async () => {
    const pendingAnalysis = new Subject<AdvancedAnalysisResponse>();
    const { fixture, decksApi } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(pendingAnalysis.asObservable()),
    });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-global-loader')).not.toBeNull();
    expect(element.querySelector('app-deck-advanced-analysis-view')).toBeNull();
    expect(element.textContent).not.toContain('Loading advanced analysis...');
    expect(decksApi.getDeckAdvancedAnalysis).toHaveBeenCalledWith(DECK_ID);

    pendingAnalysis.next(buildAdvancedAnalysis());
    pendingAnalysis.complete();
    await fixture.whenStable();
  });

  it('loads advanced analysis on enter and renders the overview summary', async () => {
    const { fixture, decksApi } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(decksApi.getDeckAdvancedAnalysis).toHaveBeenCalledWith(DECK_ID);
    expect(decksApi.analysis).not.toHaveBeenCalled();
    expect(element.querySelector('app-deck-advanced-analysis-view')).not.toBeNull();
    expect(element.querySelector('.advanced-analysis-panel')).toBeNull();
    expect(element.querySelector('.advanced-analysis-section-heading')).toBeNull();
    expect(TestBed.inject(PageHeaderStore).state()?.title).toBe('Advanced deck');
    expect(TestBed.inject(PageHeaderStore).state()?.description).toBe('Anàlisi de baralla');
    expect(element.textContent).toContain('Aristocrats');
    expect(element.textContent).toContain('Tokens');
    const archetypeTooltips = Array.from(element.querySelectorAll('.advanced-analysis-tooltip-value')) as HTMLElement[];
    expect(archetypeTooltips.map((item) => item.getAttribute('aria-label'))).toContain(
      'Detected from repeatable sacrifice outlets, sacrifice payoffs, token makers and recursion support. Score: 82/100.',
    );
    expect(archetypeTooltips.map((item) => item.getAttribute('aria-label'))).toContain(
      'Detected from token makers, payoff cards and combat finishers that convert tokens into pressure. Score: 48/100.',
    );
    expect(element.textContent).toContain('Archetype confidence');
    expect(element.querySelector('lucide-icon[name="info"]')).not.toBeNull();
    expect(element.textContent).toContain('Primary tribe');
    expect(element.textContent).toContain('Elf');
    expect(element.textContent).toContain('High');
    expect(element.textContent).not.toContain('Power band');
    expect(element.textContent).not.toContain('Power confidence');
    expect(element.textContent).toContain('Critical issues');
    expect(element.textContent).toContain('Main warnings');
  });

  it('uses tabs for advanced analysis sections on non-mobile layouts', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(element.querySelectorAll('app-tab-list button[role="tab"]')) as HTMLButtonElement[];
    const comboTab = tabs.find((tab) => tab.textContent?.includes('Combo Intelligence'));

    expect(tabs.length).toBeGreaterThan(1);
    expect(element.querySelector('app-advanced-analysis-summary-section')?.classList.contains('is-active')).toBe(true);
    expect(comboTab).toBeTruthy();

    comboTab?.click();
    fixture.detectChanges();

    expect(element.querySelector('app-advanced-analysis-summary-section')?.classList.contains('is-active')).toBe(false);
    expect(element.querySelector('app-advanced-analysis-combos-section')?.classList.contains('is-active')).toBe(true);
  });

  it('renders snapshot status and key metrics', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Permanent ramp');
    expect(element.textContent).toContain('Fast mana');
    expect(element.textContent).toContain('True tutors');
    expect(element.textContent).toContain('Board wipes');
    expect(element.textContent).toContain('Mass bounce');
    expect(element.textContent).toContain('Sac outlets');
    expect(element.textContent).toContain('Wincons');
    expect(element.textContent).toContain('Complete combos');
    expect(element.textContent).toContain('2');
    expect(element.textContent).toContain('Keepable hands');
    expect(element.textContent).toContain('72.1%');
  });

  it('renders health cards from the advanced health payload', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const healthCards = element.querySelectorAll('.advanced-analysis-health-card');

    expect(healthCards).toHaveLength(11);
    expect(element.textContent).toContain('Ramp');
    expect(element.textContent).toContain('Ramp needs review.');
    expect(element.textContent).toContain('Permanent ramp');
    expect(element.textContent).toContain('Sol Ring');
    expect(element.querySelector('img[alt="Sol Ring"]')?.getAttribute('src')).toBe('https://cards.example.test/sol-ring.jpg');
    const firstGridToggle = element.querySelector('.advanced-analysis-health-card app-advanced-analysis-card-grid .spoiler-section-toggle') as HTMLButtonElement | null;
    const firstGridBody = element.querySelector('.advanced-analysis-health-card app-advanced-analysis-card-grid .spoiler-section-body') as HTMLElement | null;
    expect(firstGridToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(firstGridBody?.classList.contains('collapsed')).toBe(true);
    firstGridToggle?.click();
    fixture.detectChanges();
    expect(firstGridToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(firstGridBody?.classList.contains('collapsed')).toBe(false);
    const solRingPreview = Array.from(element.querySelectorAll('.spoiler-card'))
      .find((preview) => preview.textContent?.includes('Sol Ring')) as HTMLElement | undefined;
    expect(solRingPreview?.querySelector('.face-toggle-button')).not.toBeNull();
    solRingPreview?.querySelector<HTMLButtonElement>('.face-toggle-button')?.click();
    fixture.detectChanges();
    expect(solRingPreview?.querySelector('img[alt="Sol Ring Back"]')?.getAttribute('src')).toBe('https://cards.example.test/sol-ring-back.jpg');
    expect(element.textContent).toContain('Tribal');
    expect(element.textContent).toContain('Tribal creatures');
    expect(element.textContent).toContain('Elf tribal identity detected.');
    expect(element.textContent).toContain('Consistency');
    expect(element.textContent).toContain('Keepable hands');
    expect(element.textContent).toContain('Wrath of God');
    expect(element.textContent).toContain('Cyclonic Rift');
    expect(element.textContent).toContain('Farewell');
  });

  it('renders power signal cards without exposing raw ids as the main label', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const signalGroup = element.querySelector('.advanced-analysis-signal-card-group');

    expect(signalGroup?.textContent).toContain('Sol Ring');
    expect(signalGroup?.textContent).toContain('Fast mana');
    expect(signalGroup?.textContent).not.toContain('oracle-sol-ring');
    expect(signalGroup?.querySelector('img[alt="Sol Ring"]')?.getAttribute('src')).toBe('https://cards.example.test/sol-ring.jpg');
  });

  it('renders tribal identity with card images without exposing raw ids as labels', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const typal = element.querySelector('.advanced-analysis-typal-identity') as HTMLElement | null;

    expect(typal).not.toBeNull();
    expect(typal?.textContent).toContain('Tribal identity');
    expect(typal?.textContent).toContain('Elf tribal');
    expect(typal?.textContent).toContain('Commander matches');
    expect(typal?.textContent).toContain('Llanowar Elves');
    expect(typal?.textContent).toContain('Elvish Archdruid');
    expect(typal?.textContent).not.toContain('oracle-llanowar');
    expect(typal?.querySelector('img[alt="Llanowar Elves"]')?.getAttribute('src')).toBe('https://cards.example.test/llanowar.jpg');
    expect(typal?.querySelector('img[alt="Elvish Archdruid"]')?.getAttribute('src')).toBe('https://cards.example.test/archdruid.jpg');
  });

  it('renders main issues ordered by severity', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const issues = Array.from(
      fixture.nativeElement.querySelectorAll('.advanced-analysis-warnings .advanced-analysis-issue-list li'),
    ) as HTMLElement[];

    expect(issues).toHaveLength(3);
    expect(issues[0]?.textContent).toContain('Critical win condition gap');
    expect(issues[1]?.textContent).toContain('Low ramp');
    expect(issues[2]?.textContent).toContain('Many one-card-away combo lines');
  });

  it('renders the Monte Carlo consistency section without implying match outcome probability', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';
    const normalizedText = text.toLowerCase();

    expect(text).toContain('Monte Carlo');
    expect(text).toContain('Simulates opening hands and card access, not match outcomes.');
    expect(text).toContain('Simulation runs');
    expect(text).toContain('100000');
    expect(text).toContain('Opening hand');
    expect(text).toContain('Keepable hands');
    expect(text).toContain('72.1%');
    expect(text).toContain('2-4 lands');
    expect(text).toContain('64.4%');
    expect(text).toContain('Keep rule');
    expect(text).toContain('Too few lands');
    expect(text).toContain('12.3%');
    expect(text).toContain('Mulligan');
    expect(text).toContain('Average mulligans needed');
    expect(text).toContain('0.42');
    expect(text).toContain('Turn 3');
    expect(text).toContain('Permanent ramp seen');
    expect(text).toContain('Turn 5');
    expect(text).toContain('Complete 2-card combo seen');
    expect(normalizedText).not.toContain('winrate');
    expect(normalizedText).not.toContain('win rate');
    expect(normalizedText).not.toContain('win probability');
    expect(normalizedText).not.toContain('chance to win');
  });

  it('renders role quality breakdown with functional role labels', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';

    expect(text).toContain('Functional roles');
    expect(text).toContain('Permanent ramp');
    expect(text).toContain('Fast mana');
    expect(text).toContain('Burst mana');
    expect(text).toContain('Rituals');
    expect(text).toContain('Mana fixing');
    expect(text).toContain('One-shot mana');
    expect(text).toContain('Some acceleration is one-shot and should not be counted as stable ramp.');
    expect(text).toContain('Premium');
    expect(text).toContain('Typed tutors');
    expect(text).toContain('Opponent tutors');
    expect(text).toContain('Mass bounce');
    expect(text).toContain('Conditional wipes');
    expect(text).toContain('One-shot sacrifice');
    expect(text).toContain('Extra combat engines');
    expect(text).toContain('Symmetrical stax risk');
    expect(element.querySelector('[aria-label="Ramp quality"]')).not.toBeNull();
  });

  it('keeps true tutors separate from ramp search and hard wipes separate from mass bounce', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = Array.from(fixture.nativeElement.querySelectorAll('.advanced-analysis-role-card')) as HTMLElement[];
    const tutors = roleCard(cards, 'Tutors');
    const wipes = roleCard(cards, 'Wipes');

    expect(tutors?.textContent).toContain('True tutors');
    expect(tutors?.textContent).toContain('Ramp search');
    expect(tutors?.textContent).toContain('Ramp search and opponent tutors are separated from true tutors.');
    expect(tutors?.textContent).not.toContain('Permanent ramp');
    expect(wipes?.textContent).toContain('Board wipes');
    expect(wipes?.textContent).toContain('Mass bounce');
    expect(wipes?.textContent).toContain('Mass bounce and conditional wipes are not the same as hard board wipes.');
    expect(wipes?.textContent).not.toContain('True tutors');
  });

  it('renders role breakdown without quality payload', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        metrics: {
          roles: {
            permanentRamp: 5,
            rampSearch: 2,
            boardWipes: 1,
          },
        },
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Functional roles');
    expect(element.textContent).toContain('Permanent ramp');
    expect(element.textContent).toContain('Ramp search');
    expect(element.textContent).not.toContain('Premium');
  });

  it('renders combo intelligence summary and complete combo lines', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';

    expect(text).toContain('Combo Intelligence');
    expect(text).toContain('Complete combos');
    expect(text).toContain('Partial, one missing');
    expect(text).toContain('Partial, two missing');
    expect(text).toContain('Win-like combos');
    expect(text).toContain('Infinite mana');
    expect(text).toContain('Lethal loops');
    expect(text).toContain('Thopter Foundry Loop');
    expect(element.querySelectorAll('.advanced-analysis-combo-list img').length).toBeGreaterThanOrEqual(3);
    expect(element.querySelector('img[alt^="Thopter Foundry"]')).not.toBeNull();
    expect(element.querySelector('img[alt^="Sword of the Meek"]')).not.toBeNull();
    expect(element.querySelector('img[alt^="Ashnods Altar"]')).not.toBeNull();
    expect(text).toContain('Win-like');
    expect(text).toContain('Infinite mana');
    expect(text).toContain('Requires commander');
    expect(text).toContain('Requires template');
  });

  it('renders partial combos and top combo completers without flooding the page', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Partial combos');
    expect(element.textContent).toContain('In deck');
    expect(element.textContent).toContain('Missing');
    expect(element.textContent).toContain('Top combo completers');
    expect(element.textContent).toContain('Demonic Consultation');
    expect(element.textContent).toContain('Tainted Pact');
    expect(element.querySelectorAll('.advanced-analysis-combo-card-link').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('.advanced-analysis-combo-list img[alt^="Demonic Consultation"]')).toHaveLength(1);
    expect(element.querySelectorAll('.advanced-analysis-completer-card img')).toHaveLength(2);
    expect(element.querySelectorAll('.advanced-analysis-combo-list li').length).toBeLessThanOrEqual(16);
  });

  it('renders combo warning for loose combo pieces without complete lines', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        combos: {
          completeCount: 0,
          partialOneMissingCount: 0,
          partialTwoMissingCount: 0,
          complete: [],
          partialOneMissing: [],
          partialTwoMissing: [],
        },
        issues: [{
          code: 'combo_pieces_without_complete_combos',
          severity: 'warning',
          title: 'Combo pieces without complete combos',
          message: 'Your deck contains many cards that appear in known combos, but no complete combo lines were detected.',
        }],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Your deck contains many cards that appear in known combos, but no complete combo lines were detected.');
  });

  it('renders combo intelligence safely when combos are missing', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        combos: null,
        topComboCompleters: [],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Combo Intelligence');
    expect(element.textContent).toContain('Combo data is not available for this analysis.');
    expect(element.textContent).toContain('No complete combo lines detected.');
    expect(element.textContent).toContain('No one-card-away combo lines detected.');
    expect(element.textContent).toContain('No combo completers identified.');
  });

  it('does not render tribal identity when typal analysis is unavailable or not detected', async () => {
    const analysis = buildAdvancedAnalysis({
      summary: {
        primaryArchetype: 'Control',
        secondaryArchetypes: [],
        archetypeConfidence: 'medium',
        mainWarnings: [],
        criticalIssues: [],
        primaryTypalType: null,
      },
      typal: {
        detected: false,
        primaryType: null,
        confidence: 'low',
        creatureCount: 0,
        supportCount: 0,
        commanderMatches: false,
        types: [],
      },
    });
    if (analysis.health && typeof analysis.health === 'object') {
      delete analysis.health['typal'];
    }

    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(analysis)),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.advanced-analysis-typal-identity')).toBeNull();
    expect(element.textContent).not.toContain('Primary tribe');
    expect(element.querySelectorAll('.advanced-analysis-health-card')).toHaveLength(10);
  });

  it('renders an empty combo state when combo payload has no lines', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        combos: {
          completeCount: 0,
          partialOneMissingCount: 0,
          partialTwoMissingCount: 0,
          winLikeCount: 0,
          infiniteManaCount: 0,
          lethalLoopCount: 0,
          complete: [],
          partialOneMissing: [],
          partialTwoMissing: [],
        },
        topComboCompleters: [],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No complete or partial combo lines detected.');
  });

  it('renders critical issues before warnings with optional evidence', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const groups = Array.from(fixture.nativeElement.querySelectorAll('.advanced-analysis-action-group')) as HTMLElement[];

    expect(groups[0]?.querySelector('h3')?.textContent).toContain('Critical issues');
    expect(groups[0]?.textContent).toContain('Critical win condition gap');
    expect(groups[0]?.textContent).toContain('Action: Add role');
    expect(groups[0]?.textContent).toContain('Evidence');
    expect(groups[1]?.querySelector('h3')?.textContent).toContain('Warnings');
    expect(groups[1]?.textContent).toContain('Low ramp');
    expect(groups[1]?.textContent).toContain('Permanent ramp');
  });

  it('renders info issues collapsed and recommendations ordered by priority', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const info = element.querySelector('.advanced-analysis-info-issues') as HTMLDetailsElement | null;
    const recommendations = Array.from(element.querySelectorAll('.advanced-analysis-recommendation-list li')) as HTMLElement[];

    expect(info).not.toBeNull();
    expect(info?.open).toBe(false);
    expect(info?.textContent).toContain('Many one-card-away combo lines');
    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]?.textContent).toContain('Add permanent ramp');
    expect(recommendations[0]?.textContent).toContain('High');
    expect(recommendations[1]?.textContent).toContain('Add hard board wipes');
    expect(recommendations[1]?.textContent).toContain('Medium');
    expect(recommendations[2]?.textContent).toContain('Review pseudo-wipes');
    expect(recommendations[2]?.textContent).toContain('Low');
    expect(recommendations.map((item) => item.textContent ?? '').join(' ')).not.toContain('Sol Ring');
  });

  it('renders a positive action state when there are no issues', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        issues: [],
        recommendations: [],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('No major structural issues detected.');
    expect(element.textContent).toContain('No functional recommendations available.');
  });

  it('resolves a deck slug before loading advanced analysis and keeps the page header back route on the slug', async () => {
    const { fixture, decksApi } = await setup({ slug: 'atraxa-control-a7f3c9d2' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(decksApi.getBySlug).toHaveBeenCalledWith('atraxa-control-a7f3c9d2');
    expect(decksApi.getDeckAdvancedAnalysis).toHaveBeenCalledWith(DECK_ID);
    expect(fixture.nativeElement.querySelector('.advanced-analysis-panel')).toBeNull();
    expect(TestBed.inject(PageHeaderStore).state()?.title).toBe('Advanced deck');
    expect(TestBed.inject(PageHeaderStore).state()?.description).toBe('Anàlisi de baralla');
    expect(fixture.componentInstance.deckDetailLink()).toEqual(['/decks', 'atraxa-control-a7f3c9d2']);
  });

  it('shows an unavailable error for 404 responses and retries the advanced request', async () => {
    const { fixture, decksApi } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })))
        .mockReturnValueOnce(of(buildAdvancedAnalysis())),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Advanced analysis is not available for this deck.');

    const retryButton = element.querySelector('button') as HTMLButtonElement;
    retryButton.click();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(decksApi.getDeckAdvancedAnalysis).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain('Aristocrats');
  });

  it('shows a permission error for 403 responses', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("You don't have permission to view this analysis.");
  });

  it('shows a generic error for 500 responses', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain("Couldn't load advanced analysis.");
    expect(element.querySelector('button')?.getAttribute('aria-label')).toBe('Retry loading advanced analysis');
  });

  it('renders the overview without breaking when optional advanced data is missing', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        snapshot: { hit: false },
        summary: null,
        health: null,
        metrics: null,
        consistency: null,
        combos: null,
        issues: [],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Ramp');
    expect(element.textContent).toContain('Unknown');
    expect(element.textContent).toContain('No main warnings found.');
    expect(element.textContent).toContain('Consistency simulation is not available for this analysis.');
    expect(element.textContent).toContain('Detailed metric signals are not available for this analysis.');
  });

  it('renders unmatched cards and card resolution metrics', async () => {
    const { fixture } = await setup({ slug: DECK_ID }, {
      getDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis({
        metrics: {
          cards: {
            totalCards: 100,
            resolvedCards: 98,
            unmatchedCards: 2,
          },
          roles: {
            permanentRamp: 8,
          },
        },
        unmatchedCards: [
          {
            deckCardId: 'deck-card-1',
            name: 'Unknown Card',
            quantity: 2,
            section: 'mainboard',
            reason: 'not_found',
          },
        ],
      }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Card resolution');
    expect(element.textContent).toContain('2 unmatched cards');
    expect(element.textContent).toContain('2x Unknown Card');
    expect(element.textContent).toContain('Mainboard');
    expect(element.textContent).toContain('Not found');
  });

  it('keeps the deck detail route available for the dashboard back action', async () => {
    const { fixture } = await setup({ slug: DECK_ID });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.deckDetailLink()).toEqual(['/decks', DECK_ID]);
  });

  it('publishes a dashboard header with a back action', async () => {
    await setup({ slug: DECK_ID });
    const header = TestBed.inject(PageHeaderStore).state();

    expect(header?.title).toBe('Advanced deck');
    expect(header?.description).toBe('Anàlisi de baralla');
    expect(header?.context).toBe('deck-advanced-analysis');
    expect(header?.actions?.[0]?.id).toBe('back-to-deck-detail');
  });
});

function buildDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: DECK_ID,
    name: 'Advanced deck',
    format: 'commander',
    folderId: null,
    slug: 'atraxa-control-a7f3c9d2',
    cards: [],
    ...overrides,
  };
}

function buildAdvancedAnalysis(overrides: Partial<AdvancedAnalysisResponse> = {}): AdvancedAnalysisResponse {
  return {
    deckId: DECK_ID,
    analyzerVersion: 'advanced-v1',
    analyzedAt: '2026-07-07T10:00:00Z',
    snapshot: {
      hit: true,
      calculatedAt: '2026-07-07T10:00:00Z',
    },
    summary: {
      primaryArchetype: 'Aristocrats',
      primaryTypalType: 'Elf',
      secondaryArchetypes: ['Tokens'],
      archetypeConfidence: 'high',
      archetypeExplanations: [
        { archetype: 'Aristocrats', reasonKey: 'aristocrats', score: 82 },
        { archetype: 'Tokens', reasonKey: 'tokens', score: 48 },
      ],
      mainWarnings: ['Low ramp'],
      criticalIssues: ['Not enough win conditions'],
    },
    typal: {
      detected: true,
      primaryType: 'Elf',
      confidence: 'medium',
      creatureCount: 14,
      supportCount: 3,
      commanderMatches: true,
      types: [
        {
          type: 'Elf',
          creatureCount: 14,
          supportCount: 3,
          commanderMatches: true,
          creatureCards: [
            { deckCardId: 'deck-card-llanowar', cardId: 'card-llanowar', oracleId: 'oracle-llanowar', name: 'Llanowar Elves', imageUrl: 'https://cards.example.test/llanowar.jpg', quantity: 1, section: 'main' },
          ],
          supportCards: [
            { deckCardId: 'deck-card-archdruid', cardId: 'card-archdruid', oracleId: 'oracle-archdruid', name: 'Elvish Archdruid', imageUrl: 'https://cards.example.test/archdruid.jpg', quantity: 1, section: 'main' },
          ],
        },
      ],
    },
    health: {
      ramp: {
        status: 'warning',
        message: 'Ramp needs review.',
        evidence: { permanentRamp: 8 },
        cards: [
          {
            deckCardId: 'deck-card-sol-ring',
            cardId: 'card-sol-ring',
            oracleId: 'oracle-sol-ring',
            name: 'Sol Ring',
            imageUrl: 'https://cards.example.test/sol-ring.jpg',
            imageUris: { normal: 'https://cards.example.test/sol-ring.jpg' },
            cardFaces: [
              { name: 'Sol Ring', manaCost: null, typeLine: 'Artifact', oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: 'https://cards.example.test/sol-ring.jpg' } },
              { name: 'Sol Ring Back', manaCost: null, typeLine: 'Artifact', oracleText: null, power: null, toughness: null, loyalty: null, colors: [], imageUris: { normal: 'https://cards.example.test/sol-ring-back.jpg' } },
            ],
            quantity: 1,
            section: 'main',
            matchedMetrics: ['permanentRamp', 'fastMana'],
          },
        ],
      },
      draw: {
        status: 'good',
        message: 'Draw looks functional.',
        evidence: { draw: 12 },
      },
      interaction: {
        status: 'warning',
        message: 'Interaction needs review.',
        evidence: { spotRemoval: 4 },
      },
      wipes: {
        status: 'good',
        message: 'Wipes look functional.',
        evidence: { boardWipes: 3 },
        cards: [
          { deckCardId: 'deck-card-wrath', cardId: 'card-wrath', oracleId: 'oracle-wrath', name: 'Wrath of God', imageUrl: 'https://cards.example.test/wrath.jpg', quantity: 1, section: 'main', matchedMetrics: ['boardWipes'] },
          { deckCardId: 'deck-card-rift', cardId: 'card-rift', oracleId: 'oracle-rift', name: 'Cyclonic Rift', imageUrl: 'https://cards.example.test/rift.jpg', quantity: 1, section: 'main', matchedMetrics: ['massBounce'] },
          { deckCardId: 'deck-card-farewell', cardId: 'card-farewell', oracleId: 'oracle-farewell', name: 'Farewell', imageUrl: 'https://cards.example.test/farewell.jpg', quantity: 1, section: 'main', matchedMetrics: ['boardWipes', 'conditionalWipes'] },
        ],
      },
      tutors: {
        status: 'unknown',
        message: 'Tutors cannot be evaluated confidently.',
        evidence: { trueTutors: 0 },
      },
      sacrifice: {
        status: 'excellent',
        message: 'Sacrifice looks strong.',
        evidence: { sacrificeOutlets: 6 },
      },
      wincons: {
        status: 'critical',
        message: 'Win conditions are likely under-supported.',
        evidence: { wincons: 1 },
      },
      typal: {
        status: 'good',
        message: 'Elf tribal identity detected.',
        evidence: {
          primaryType: 'Elf',
          creatureCount: 14,
          supportCount: 3,
          commanderMatches: true,
        },
        cards: [
          { deckCardId: 'deck-card-llanowar', cardId: 'card-llanowar', oracleId: 'oracle-llanowar', name: 'Llanowar Elves', imageUrl: 'https://cards.example.test/llanowar.jpg', quantity: 1, section: 'main' },
          { deckCardId: 'deck-card-archdruid', cardId: 'card-archdruid', oracleId: 'oracle-archdruid', name: 'Elvish Archdruid', imageUrl: 'https://cards.example.test/archdruid.jpg', quantity: 1, section: 'main' },
        ],
        value: 14,
      },
      combos: {
        status: 'excellent',
        message: 'Combo package looks strong.',
        evidence: { completeCount: 2 },
      },
      consistency: {
        status: 'warning',
        message: 'Consistency needs review.',
        evidence: { keepableHandRate: 0.72 },
      },
      stax: {
        status: 'unknown',
        message: 'Stax cannot be evaluated confidently.',
        evidence: { stax: 0 },
      },
    },
    metrics: {
      cards: {
        totalCards: 100,
        resolvedCards: 99,
        unmatchedCards: 1,
      },
      roles: {
        permanentRamp: 8,
        fastMana: 1,
        burstMana: 2,
        rituals: 1,
        manaFixing: 3,
        oneShotMana: 2,
        trueTutors: 2,
        typedTutors: 2,
        landTutors: 1,
        rampSearch: 2,
        opponentTutors: 1,
        boardWipes: 3,
        massBounce: 1,
        pseudoWipes: 1,
        conditionalWipes: 2,
        sacrificeOutlets: 6,
        oneShotSacrifice: 2,
        selfSacrifice: 4,
        sacrificePayoffs: 3,
        wincons: 1,
        combatFinishers: 2,
        infectThreats: 1,
        extraCombatEngines: 1,
        draw: 12,
        spotRemoval: 4,
        stax: 2,
        tax: 1,
        symmetricalStaxRisk: 1,
        comboPieces: 7,
      },
      roleCards: {
        permanentRamp: [
          { deckCardId: 'deck-card-sol-ring', cardId: 'card-sol-ring', oracleId: 'oracle-sol-ring', name: 'Sol Ring', imageUrl: 'https://cards.example.test/sol-ring.jpg', quantity: 1, section: 'main' },
        ],
        boardWipes: [
          { deckCardId: 'deck-card-wrath', cardId: 'card-wrath', oracleId: 'oracle-wrath', name: 'Wrath of God', imageUrl: 'https://cards.example.test/wrath.jpg', quantity: 1, section: 'main' },
          { deckCardId: 'deck-card-farewell', cardId: 'card-farewell', oracleId: 'oracle-farewell', name: 'Farewell', imageUrl: 'https://cards.example.test/farewell.jpg', quantity: 1, section: 'main' },
        ],
        massBounce: [
          { deckCardId: 'deck-card-rift', cardId: 'card-rift', oracleId: 'oracle-rift', name: 'Cyclonic Rift', imageUrl: 'https://cards.example.test/rift.jpg', quantity: 1, section: 'main' },
        ],
        conditionalWipes: [
          { deckCardId: 'deck-card-farewell', cardId: 'card-farewell', oracleId: 'oracle-farewell', name: 'Farewell', imageUrl: 'https://cards.example.test/farewell.jpg', quantity: 1, section: 'main' },
        ],
      },
      quality: {
        ramp: {
          premium: 2,
          good: 3,
          medium: 2,
          slow: 1,
          oneShot: 2,
        },
        tutor: {
          premium: 1,
          good: 1,
        },
        wipe: {
          good: 2,
          medium: 1,
        },
        wincon: {
          premium: 1,
          medium: 1,
        },
      },
    },
    power: {
      signals: {
        fastMana: 1,
        efficientTutors: 0,
      },
      signalCards: {
        fastMana: [
          { deckCardId: 'deck-card-sol-ring', cardId: 'card-sol-ring', oracleId: 'oracle-sol-ring', name: 'Sol Ring', imageUrl: 'https://cards.example.test/sol-ring.jpg', quantity: 1, section: 'main' },
        ],
      },
      evidence: [],
      notes: [],
    },
    consistency: {
      simulationRuns: 100000,
      monteCarloVersion: 'monte-carlo-v1',
      method: 'monte_carlo',
      scope: 'opening_hand_and_card_access',
      disclaimer: 'This simulates hands and card access, not match win rate.',
      keepableHandRate: 0.721,
      openingHand: {
        keepableHandRate: 0.721,
        twoToFourLandsRate: 0.644,
        zeroOrOneLandRate: 0.081,
        fivePlusLandsRate: 0.09,
        permanentRampInOpeningRate: 0.375,
        earlyInteractionInOpeningRate: 0.318,
        drawOrSelectionInOpeningRate: 0.452,
        trueTutorInOpeningRate: 0.116,
        earlyPlayInOpeningRate: 0.812,
      },
      keepRule: {
        description: 'Keepable means 2-4 lands plus an early play and development signal.',
        failedByTooFewLandsRate: 0.123,
        failedByTooManyLandsRate: 0.041,
        failedByNoEarlyPlayRate: 0.087,
        failedByTooTopHeavyRate: 0.022,
      },
      mulligan: {
        keepableAt7Rate: 0.721,
        keepableBy6Rate: 0.889,
        keepableBy5Rate: 0.954,
        averageMulligansNeeded: 0.42,
      },
      byTurn: {
        turn3: {
          permanentRampSeenRate: 0.541,
          earlyInteractionSeenRate: 0.468,
          drawOrSelectionSeenRate: 0.612,
          trueTutorSeenRate: 0.174,
          winconSeenRate: 0.221,
          comboPieceSeenRate: 0.346,
        },
        turn5: {
          permanentRampSeenRate: 0.692,
          interactionSeenRate: 0.577,
          trueTutorSeenRate: 0.241,
          winconSeenRate: 0.362,
          comboPieceSeenRate: 0.489,
          completeTwoCardComboSeenRate: 0.084,
          comboPlusProtectionSeenRate: 0.031,
        },
      },
    },
    combos: {
      completeCount: 2,
      partialOneMissingCount: 2,
      partialTwoMissingCount: 1,
      winLikeCount: 1,
      infiniteManaCount: 1,
      infiniteDamageCount: 0,
      lethalLoopCount: 1,
      commanderRequiredCount: 1,
      templateRequiredCount: 1,
      complete: [
        {
          comboVariantId: 'combo-1',
          externalId: 'Thopter Foundry Loop',
          name: 'Thopter Foundry Loop',
          cardNames: ['Thopter Foundry', 'Sword of the Meek', 'Ashnods Altar'],
          requiredOracleIds: ['oracle-thopter', 'oracle-sword', 'oracle-altar'],
          cards: [
            { oracleId: 'oracle-thopter', name: 'Thopter Foundry', imageUrl: 'https://cards.example.test/card-thopter.jpg' },
            { oracleId: 'oracle-sword', name: 'Sword of the Meek', imageUrl: 'https://cards.example.test/card-sword.jpg' },
            { oracleId: 'oracle-altar', name: 'Ashnods Altar', imageUrl: 'https://cards.example.test/card-altar.jpg' },
          ],
          features: ['infinite_mana', 'lethal_loop'],
          producesWinLike: true,
          producesInfiniteMana: true,
          lethalLoop: true,
          requiresCommander: true,
          requiresTemplate: true,
          comboSize: 3,
        },
        {
          comboVariantId: 'combo-2',
          externalId: 'Damage Loop',
          requiredOracleIds: ['oracle-a', 'oracle-b'],
          cards: [
            { oracleId: 'oracle-a', name: 'Damage Piece A', imageUrl: 'https://cards.example.test/card-a.jpg' },
            { oracleId: 'oracle-b', name: 'Damage Piece B', imageUrl: 'https://cards.example.test/card-b.jpg' },
          ],
          features: ['infinite_damage'],
          producesWinLike: true,
          producesInfiniteDamage: true,
          comboSize: 2,
        },
      ],
      partialOneMissing: [
        {
          comboVariantId: 'partial-1',
          externalId: 'Oracle Consultation',
          requiredCardNames: ['Thassa Oracle'],
          missingCardNames: ['Demonic Consultation'],
          missingOracleIds: ['oracle-consultation'],
          cards: [
            { oracleId: 'oracle-thassa', name: 'Thassa Oracle', imageUrl: 'https://cards.example.test/card-oracle.jpg' },
          ],
          missingCards: [
            { oracleId: 'oracle-consultation', name: 'Demonic Consultation', imageUrl: 'https://cards.example.test/card-consultation.jpg' },
          ],
          features: ['win_condition'],
          producesWinLike: true,
          comboSize: 2,
        },
        {
          comboVariantId: 'partial-2',
          externalId: 'Oracle Pact',
          requiredCardNames: ['Thassa Oracle'],
          missingCardNames: ['Tainted Pact'],
          missingOracleIds: ['oracle-pact'],
          cards: [
            { oracleId: 'oracle-thassa', name: 'Thassa Oracle', imageUrl: 'https://cards.example.test/card-oracle.jpg' },
          ],
          missingCards: [
            { oracleId: 'oracle-pact', name: 'Tainted Pact', imageUrl: 'https://cards.example.test/card-pact.jpg' },
          ],
          features: ['win_condition'],
          producesWinLike: true,
          comboSize: 2,
        },
      ],
      partialTwoMissing: [],
    },
    topComboCompleters: [
      { oracleId: 'oracle-consultation', name: 'Demonic Consultation', imageUrl: 'https://cards.example.test/card-consultation.jpg', completesCombos: 3 },
      { oracleId: 'oracle-pact', name: 'Tainted Pact', imageUrl: 'https://cards.example.test/card-pact.jpg', completesCombos: 2 },
    ],
    issues: [
      {
        code: 'low_wincons',
        severity: 'critical',
        title: 'Critical win condition gap',
        message: 'The deck needs more reliable ways to close games.',
        evidence: {
          wincons: 1,
          completeCombos: 2,
        },
        suggestedActionType: 'add_role',
      },
      {
        code: 'low_ramp',
        severity: 'warning',
        title: 'Low ramp',
        message: 'Add more permanent ramp.',
        evidence: {
          permanentRamp: 8,
          minRecommended: 10,
        },
        suggestedActionType: 'add_role',
      },
      {
        code: 'many_partial_combos',
        severity: 'info',
        title: 'Many one-card-away combo lines',
        message: 'Several known combo lines are missing exactly one required piece.',
        evidence: {
          partialOneMissingCount: 2,
        },
        suggestedActionType: 'review_package',
      },
    ],
    recommendations: [
      {
        code: 'review_pseudo_wipes',
        priority: 'low',
        title: 'Review pseudo-wipes',
        message: 'Check whether pseudo-wipes are doing the job of hard board wipes.',
        targetRoles: ['pseudo_wipes'],
        reasonIssueCodes: ['wipes_are_mostly_bounce_or_conditional'],
      },
      {
        code: 'add_hard_board_wipes',
        priority: 'medium',
        title: 'Add hard board wipes',
        message: 'Increase reliable reset effects instead of relying only on bounce or conditional wipes.',
        targetRoles: ['board_wipes'],
        reasonIssueCodes: ['low_hard_board_wipes'],
      },
      {
        code: 'add_permanent_ramp',
        priority: 'high',
        title: 'Add permanent ramp',
        message: 'Add stable mana development rather than one-shot acceleration.',
        targetRoles: ['permanent_ramp'],
        reasonIssueCodes: ['low_ramp'],
      },
    ],
    unmatchedCards: [],
    ...overrides,
  };
}

function roleCard(cards: HTMLElement[], title: string): HTMLElement | undefined {
  return cards.find((card) => card.querySelector('h3')?.textContent?.trim() === title);
}
