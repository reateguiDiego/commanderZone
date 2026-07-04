import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CircleHelp, Copy, Heart, Info, LucideAngularModule } from 'lucide-angular';
import { DashboardPageContextComponent } from './dashboard-page-context.component';

describe('DashboardPageContextComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPageContextComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ CircleHelp, Copy, Heart, Info })),
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
