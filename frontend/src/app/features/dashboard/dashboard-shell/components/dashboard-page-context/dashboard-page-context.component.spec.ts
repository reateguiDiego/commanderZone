import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CircleHelp, Info, LucideAngularModule } from 'lucide-angular';
import { DashboardPageContextComponent } from './dashboard-page-context.component';

describe('DashboardPageContextComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPageContextComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ CircleHelp, Info })),
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
    expect(fixture.nativeElement.querySelector('.page-header-actions-stack')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.page-header-action-feedback')?.textContent).toContain('Saved');
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
});
