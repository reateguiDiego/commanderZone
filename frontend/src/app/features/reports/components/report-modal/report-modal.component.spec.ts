import { importProvidersFrom, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Flag, LucideAngularModule, X } from 'lucide-angular';
import { FormatSelectComponent } from '../../../../shared/components/format-select/format-select.component';
import { AppThemeService } from '../../../../core/theme/app-theme.service';
import { ReportDraft } from '../../data-access/reports.models';
import { ReportStore } from '../../data-access/report.store';
import { ReportModalComponent } from './report-modal.component';

describe('ReportModalComponent', () => {
  let fixture: ComponentFixture<ReportModalComponent>;
  let reports: ReturnType<typeof createReportStoreMock>;

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    reports = createReportStoreMock();

    await TestBed.configureTestingModule({
      imports: [ReportModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Flag, X })),
        { provide: ReportStore, useValue: reports },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportModalComponent);
    fixture.detectChanges();
  });

  it('uses the shared select for categories and updates the selected category', () => {
    const select = fixture.debugElement.query(By.directive(FormatSelectComponent));

    expect(select).not.toBeNull();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(
      (
        fixture.nativeElement.querySelector(
          'app-format-select input[name="reportCategory"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('harassment');

    (select.componentInstance as FormatSelectComponent).valueChange.emit('other_problem');
    fixture.detectChanges();

    expect(fixture.componentInstance.category()).toBe('other_problem');
  });

  it('does not expose the untranslated title key as a native hover tooltip', () => {
    const modal = fixture.nativeElement.querySelector('app-modal') as HTMLElement;

    expect(modal.getAttribute('title')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-title-row h2')?.textContent?.trim()).toBe(
      'Report',
    );
    expect(fixture.nativeElement.querySelector('.modal-title-icon')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-header-image')).toBeNull();
  });

  it('limits the reporter comment to 400 characters and exposes the counter', () => {
    const textarea = fixture.nativeElement.querySelector(
      'textarea[name="reportComment"]',
    ) as HTMLTextAreaElement;

    textarea.value = 'x'.repeat(420);
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(textarea.maxLength).toBe(400);
    expect(fixture.componentInstance.comment()).toHaveLength(400);
    expect(fixture.nativeElement.querySelector('#report-comment-count')?.textContent?.trim()).toBe(
      '400/400',
    );
    expect(fixture.nativeElement.querySelector('.report-modal-character-count')).not.toBeNull();
  });

  it('shows the report confirmation on two lines', () => {
    reports.setSubmissionSucceeded(true);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.report-modal-feedback--success')?.textContent,
    ).toContain('Your report was submitted.\nThank you for helping keep CommanderZone welcoming.');
  });

  it('replaces the report title with the theme-aware Command Zone logo after submission', () => {
    reports.setSubmissionSucceeded(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-title-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-title-icon')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-header-image')?.getAttribute('src')).toBe(
      '/assets/icons/CZ/CZ_logo_zone_header.webp',
    );

    TestBed.inject(AppThemeService).selectTheme('candy-summoners');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-header-image')?.getAttribute('src')).toBe(
      '/assets/icons/CZ/CZ_logo_zone_header_black.webp',
    );
  });

  it('submits the bounded comment from the larger report modal', () => {
    fixture.componentInstance.updateComment('x'.repeat(401));
    fixture.componentInstance.submitOrClose();

    expect(reports.submit).toHaveBeenCalledWith('harassment', 'x'.repeat(400));
    expect(fixture.nativeElement.querySelector('.modal-panel')?.classList).not.toContain(
      'modal-panel-compact',
    );
  });
});

function createReportStoreMock() {
  const activeDraft = signal<ReportDraft | null>({
    source: 'profile',
    reportedUserId: 'reported-user',
    targetDisplayName: 'Reported player',
  });
  const isSubmitting = signal(false);
  const submissionSucceeded = signal(false);
  const submissionError = signal<string | null>(null);

  return {
    activeDraft: activeDraft.asReadonly(),
    isSubmitting: isSubmitting.asReadonly(),
    submissionSucceeded: submissionSucceeded.asReadonly(),
    setSubmissionSucceeded: (value: boolean) => submissionSucceeded.set(value),
    submissionError: submissionError.asReadonly(),
    close: vi.fn(),
    submit: vi.fn(),
  };
}
