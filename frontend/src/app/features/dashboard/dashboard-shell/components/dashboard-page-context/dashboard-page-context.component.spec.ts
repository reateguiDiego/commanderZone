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
});
