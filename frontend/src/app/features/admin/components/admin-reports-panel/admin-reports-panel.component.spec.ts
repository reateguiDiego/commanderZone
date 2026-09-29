import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { LucideAngularModule, RefreshCcw, Send } from 'lucide-angular';
import { EMPTY, of } from 'rxjs';
import { FormatSelectComponent } from '../../../../shared/components/format-select/format-select.component';
import { ModerationSummaryStore } from '../../../reports/data-access/moderation-summary.store';
import { ReportsApi } from '../../../reports/data-access/reports.api';
import { AdminReportsPanelComponent } from './admin-reports-panel.component';

describe('AdminReportsPanelComponent', () => {
  let fixture: ComponentFixture<AdminReportsPanelComponent>;
  let api: {
    readonly listReports: ReturnType<typeof vi.fn>;
    readonly getReport: ReturnType<typeof vi.fn>;
    readonly resolveReport: ReturnType<typeof vi.fn>;
  };

  const report = {
    id: 'report-1',
    source: 'chat_message' as const,
    category: 'other_problem' as const,
    status: 'pending_review' as const,
    comment: 'Abusive behavior in the game chat.',
    reporter: { id: 'reporter-user-1', displayName: 'ReporterOne' },
    reportedUser: {
      id: 'reported-user-1',
      displayName: 'ReportedOne',
    },
    createdAt: '2026-09-29T10:00:00Z',
  };

  beforeEach(async () => {
    api = {
      listReports: vi
        .fn()
        .mockReturnValue(of({ reports: [report], page: 1, limit: 30, total: 1, totalPages: 1 })),
      getReport: vi.fn().mockReturnValue(
        of({
          report: {
            ...report,
            evidence: {
              reportedUserSnapshot: {
                capturedAt: '2026-09-29T10:01:00Z',
                user: {
                  displayName: 'ReportedOne',
                  publicHandle: 'reported-one',
                  avatar: { type: 'upload' as const, imageData: 'data:image/png;base64,iVBORw0KGgo=' },
                },
                folders: [{ name: 'Review folder' }],
                decks: [{ name: 'Review deck' }],
                ownedRooms: [{ name: 'Review room' }],
              },
              game: {
                capturedAt: '2026-09-29T10:01:00Z',
                chat: [{ time: '21:45', actorDisplayName: 'ReporterOne', body: 'Please stop.' }],
                gameLog: [
                  { time: '21:45:30', actorDisplayName: 'ReportedOne', action: 'Moved a card.' },
                ],
              },
            },
          },
        }),
      ),
      resolveReport: vi.fn().mockReturnValue(
        of({
          report: {
            ...report,
            resolution: {
              outcome: 'nothing',
              note: null,
              reviewedAt: '2026-09-29T10:02:00Z',
              reviewer: report.reporter,
            },
          },
          strike: null,
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AdminReportsPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RefreshCcw, Send })),
        { provide: ReportsApi, useValue: api },
        {
          provide: ModerationSummaryStore,
          useValue: { refresh: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: NgxTranslateService,
          useValue: {
            instant: vi.fn((key: string) => {
              switch (key) {
                case 'reports.categories.otherProblem':
                  return 'Otro problema';
                case 'shared.text.refresh':
                  return 'Refresh';
                case 'shared.text.reports':
                  return 'Reports';
                default:
                  return key;
              }
            }),
            onLangChange: EMPTY,
            onTranslationChange: EMPTY,
            onFallbackLangChange: EMPTY,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminReportsPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads the FIFO pending queue and its restricted detail on selection', async () => {
    expect(api.listReports).toHaveBeenCalledWith(1);
    expect(fixture.nativeElement.querySelector('#admin-reports-title')?.textContent?.trim()).toBe(
      'Reports',
    );
    const queueItem = fixture.nativeElement.querySelector(
      '.admin-report-queue__item',
    ) as HTMLButtonElement;
    expect(queueItem.textContent).toContain('Otro problema');
    expect(queueItem.textContent).not.toContain('reports.categories.other_problem');
    expect(queueItem.textContent).toContain('ReportedOne');
    expect(queueItem.classList).toContain('admin-report-queue__item--pending');
    expect(queueItem.querySelector('small')?.textContent).toMatch(/\d{2}:\d{2}/);
    expect(queueItem.querySelector('small')?.textContent).not.toMatch(/\b(?:am|pm)\b/i);

    queueItem.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.getReport).toHaveBeenCalledWith('report-1');
    expect(fixture.componentInstance.selectedReport()?.evidence?.game?.capturedAt).toBe(
      '2026-09-29T10:01:00Z',
    );
    expect(
      fixture.nativeElement.querySelector('.admin-report-detail__eyebrow')?.textContent,
    ).toContain('Otro problema');
    expect(
      fixture.nativeElement.querySelector('.admin-report-detail__reported-user')?.textContent,
    ).toContain('ReportedOne');
    expect(
      fixture.nativeElement.querySelector('.admin-report-detail__reporter')?.textContent,
    ).toContain('ReporterOne');
    const evidence = fixture.nativeElement.querySelector('app-report-evidence') as HTMLElement;
    expect(evidence).not.toBeNull();
    expect(evidence.querySelector('pre')).toBeNull();
    expect(evidence.textContent).toContain('@reported-one');
    expect(evidence.textContent).toContain('Review folder');
    expect(evidence.textContent).toContain('Review deck');
    expect(evidence.textContent).toContain('Review room');
    expect(evidence.textContent).toContain('21:45 · ReporterOne · Please stop.');
    expect(evidence.textContent).toContain('21:45:30 · ReportedOne · Moved a card.');
    expect(fixture.nativeElement.querySelector('select[name="resolutionOutcome"]')).toBeNull();

    const resolutionSelect = fixture.debugElement.query(By.directive(FormatSelectComponent));
    expect(resolutionSelect).not.toBeNull();
    (resolutionSelect.componentInstance as FormatSelectComponent).valueChange.emit('strike');
    fixture.detectChanges();

    expect(fixture.componentInstance.resolutionOutcome()).toBe('strike');
  });

  it('uses an icon-only refresh control and leaves the detail blank for an empty queue', async () => {
    const refreshButton = fixture.nativeElement.querySelector(
      '.admin-reports-refresh-button',
    ) as HTMLButtonElement;

    expect(refreshButton.classList).toContain('cz-button--icon');
    expect(refreshButton.querySelector('lucide-icon')).not.toBeNull();
    expect(refreshButton.getAttribute('aria-label')).toBe('Refresh');

    refreshButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.listReports).toHaveBeenCalledTimes(2);

    api.listReports.mockReturnValue(
      of({ reports: [], page: 1, limit: 30, total: 0, totalPages: 1 }),
    );
    await fixture.componentInstance.loadReports();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.admin-report-detail')?.textContent).not.toContain(
      'reports.moderation.detail.selectPrompt',
    );
  });

  it('reuses the user messaging flow for both report participants', async () => {
    const sendMessageRequested = vi.fn();
    fixture.componentInstance.sendMessageRequested.subscribe(sendMessageRequested);

    await fixture.componentInstance.selectReport(report);
    fixture.detectChanges();

    const messageButtons = fixture.nativeElement.querySelectorAll(
      '.admin-report-detail__reported-user button, .admin-report-detail__reporter button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(messageButtons).toHaveLength(2);

    messageButtons[1].click();
    messageButtons[0].click();

    expect(sendMessageRequested).toHaveBeenNthCalledWith(1, {
      id: 'reporter-user-1',
      name: 'ReporterOne',
    });
    expect(sendMessageRequested).toHaveBeenNthCalledWith(2, {
      id: 'reported-user-1',
      name: 'ReportedOne',
    });
  });

  it('requires a strike description and resolves through the atomic endpoint', async () => {
    await fixture.componentInstance.selectReport(report);
    fixture.componentInstance.resolutionOutcome.set('strike');
    await fixture.componentInstance.resolveSelectedReport();
    expect(api.resolveReport).not.toHaveBeenCalled();
    expect(fixture.componentInstance.resolutionError()).toBe(
      'reports.moderation.strikes.descriptionRequired',
    );

    fixture.componentInstance.strikeDescription.set('Repeated abusive messages.');
    await fixture.componentInstance.resolveSelectedReport();

    expect(api.resolveReport).toHaveBeenCalledWith('report-1', {
      outcome: 'strike',
      strikeDescription: 'Repeated abusive messages.',
    });
  });
});
