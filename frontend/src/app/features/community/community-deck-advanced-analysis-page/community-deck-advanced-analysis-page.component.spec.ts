import { importProvidersFrom } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ChevronDown, ChevronRight, Info, LucideAngularModule, RotateCw } from 'lucide-angular';
import { of, Subject, throwError } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { CommunityDeckDetail } from '../../../core/models/community.model';
import { AdvancedAnalysisResponse } from '../../../core/models/deck-advanced-analysis.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CommunityDeckAdvancedAnalysisPageComponent } from './community-deck-advanced-analysis-page.component';

const DECK_ID = '00000000-0000-7000-8000-000000000001';
const COMMUNITY_SLUG = 'atraxa-control-a7f3c9d2';

type CommunityApiMock = {
  deck: ReturnType<typeof vi.fn>;
  getCommunityDeckAdvancedAnalysis: ReturnType<typeof vi.fn>;
};

describe('CommunityDeckAdvancedAnalysisPageComponent', () => {
  async function setup(
    routeParams: Record<string, string> = { slug: COMMUNITY_SLUG },
    communityApiOverrides: Partial<CommunityApiMock> = {},
  ): Promise<{ fixture: ComponentFixture<CommunityDeckAdvancedAnalysisPageComponent>; communityApi: CommunityApiMock }> {
    TestBed.resetTestingModule();

    const communityApi: CommunityApiMock = {
      deck: vi.fn().mockReturnValue(of({ deck: buildCommunityDeck() })),
      getCommunityDeckAdvancedAnalysis: vi.fn().mockReturnValue(of(buildAdvancedAnalysis())),
      ...communityApiOverrides,
    };

    await TestBed.configureTestingModule({
      imports: [CommunityDeckAdvancedAnalysisPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, Info, RotateCw })),
        { provide: CommunityApi, useValue: communityApi },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDeckAdvancedAnalysisPageComponent);
    fixture.detectChanges();

    return { fixture, communityApi };
  }

  it('uses the community advanced analysis endpoint and renders the shared advanced analysis view', async () => {
    const { fixture, communityApi } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(communityApi.getCommunityDeckAdvancedAnalysis).toHaveBeenCalledWith(COMMUNITY_SLUG);
    expect(communityApi.deck).toHaveBeenCalledWith(COMMUNITY_SLUG);
    expect(element.querySelector('app-deck-advanced-analysis-view')).not.toBeNull();
    expect(element.querySelector('.advanced-analysis-panel')).toBeNull();
    expect(TestBed.inject(PageHeaderStore).state()?.title).toBe('Public Advanced deck');
    expect(TestBed.inject(PageHeaderStore).state()?.description).toBe('Anàlisi de baralla');
    expect(element.textContent).toContain('Aristocrats');
  });

  it('shows loading while community advanced analysis is pending', async () => {
    const pendingAnalysis = new Subject<AdvancedAnalysisResponse>();
    const { fixture } = await setup({ slug: COMMUNITY_SLUG }, {
      getCommunityDeckAdvancedAnalysis: vi.fn().mockReturnValue(pendingAnalysis.asObservable()),
    });

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-global-loader')).not.toBeNull();
    expect(element.querySelector('app-deck-advanced-analysis-view')).toBeNull();
    expect(element.textContent).not.toContain('Loading advanced analysis...');

    pendingAnalysis.next(buildAdvancedAnalysis());
    pendingAnalysis.complete();
    await fixture.whenStable();
  });

  it('shows an unavailable error for community 404 responses and retries the public request', async () => {
    const { fixture, communityApi } = await setup({ slug: COMMUNITY_SLUG }, {
      getCommunityDeckAdvancedAnalysis: vi.fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })))
        .mockReturnValueOnce(of(buildAdvancedAnalysis())),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Advanced analysis is not available for this deck.');

    const retryButton = element.querySelector('button[aria-label="Retry loading advanced analysis"]') as HTMLButtonElement;
    retryButton.click();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(communityApi.getCommunityDeckAdvancedAnalysis).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain('Aristocrats');
  });

  it('shows a permission error for community 403 responses', async () => {
    const { fixture } = await setup({ slug: COMMUNITY_SLUG }, {
      getCommunityDeckAdvancedAnalysis: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 }))),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("You don't have permission to view this analysis.");
  });

  it('keeps the community deck detail route available and publishes a community header action', async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();

    expect(fixture.componentInstance.deckDetailLink()).toEqual(['/community/decks', COMMUNITY_SLUG]);
    expect(header?.title).toBe('Public Advanced deck');
    expect(header?.description).toBe('Anàlisi de baralla');
    expect(header?.context).toBe('community-deck-advanced-analysis');
    expect(header?.actions?.[0]?.id).toBe('back-to-community-deck-detail');
  });
});

function buildCommunityDeck(overrides: Partial<CommunityDeckDetail> = {}): CommunityDeckDetail {
  return {
    id: DECK_ID,
    publicSlug: COMMUNITY_SLUG,
    canonicalPath: `/community/decks/${COMMUNITY_SLUG}`,
    name: 'Public Advanced deck',
    format: 'commander',
    valid: true,
    cropImage: null,
    commanderName: null,
    colorIdentity: [],
    updatedAt: '2026-07-07T10:00:00Z',
    likes: 0,
    copies: 0,
    creatorUserId: 'user-1',
    visibility: 'public',
    folderId: null,
    commanders: [],
    cards: [],
    sections: {
      commander: [],
      main: [],
      sideboard: [],
      maybeboard: [],
    },
    owner: {
      id: 'user-1',
      displayName: 'Owner',
    },
    likedByViewer: false,
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
      secondaryArchetypes: ['Tokens'],
      archetypeConfidence: 'high',
      mainWarnings: [],
      criticalIssues: [],
    },
    health: null,
    metrics: null,
    consistency: null,
    combos: null,
    issues: [],
    recommendations: [],
    unmatchedCards: [],
    ...overrides,
  };
}
