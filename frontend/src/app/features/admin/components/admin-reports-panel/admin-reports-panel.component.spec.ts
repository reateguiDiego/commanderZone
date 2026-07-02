import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Send } from 'lucide-angular';
import { of } from 'rxjs';
import { AdminReportsApi } from '../../data-access/admin-reports.api';
import { AdminReportsPanelComponent } from './admin-reports-panel.component';

describe('AdminReportsPanelComponent', () => {
  let fixture: ComponentFixture<AdminReportsPanelComponent>;
  let reportsApi: { readonly listReports: ReturnType<typeof vi.fn> };

  const report = {
    id: 'report-1',
    reporter: {
      id: 'reporter-user-1',
      displayName: 'ReporterOne',
      email: 'reporter@example.test',
    },
    reportedUser: {
      id: 'reported-user-1',
      displayName: 'ReportedOne',
      email: 'reported@example.test',
    },
    reason: 'Abusive behavior in a room.',
    createdAt: '2026-07-01T18:00:00+00:00',
  };

  beforeEach(async () => {
    reportsApi = {
      listReports: vi.fn().mockReturnValue(of({ reports: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AdminReportsPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Send })),
        { provide: AdminReportsApi, useValue: reportsApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminReportsPanelComponent);
    fixture.detectChanges();
  });

  it('renders the reports table columns', () => {
    const textContent = fixture.nativeElement.textContent;

    expect(textContent).toContain('Reports');
    expect(textContent).toContain('Reporter');
    expect(textContent).toContain('Reporter mail');
    expect(textContent).toContain('Reported user');
    expect(textContent).toContain('Reported mail');
    expect(textContent).toContain('Reason');
    expect(textContent).toContain('Actions');
  });

  it('renders the empty state until reports are connected to data', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No user reports yet.');
  });

  it('emits the reported user when send message is clicked', () => {
    const emitSpy = vi.spyOn(fixture.componentInstance.sendMessageRequested, 'emit');
    fixture.componentInstance.reports.set([report]);
    fixture.detectChanges();

    const sendButton = fixture.nativeElement.querySelector('button[aria-label="Send message to reported user ReportedOne"]') as HTMLButtonElement;
    sendButton.click();

    expect(emitSpy).toHaveBeenCalledWith({
      id: 'reported-user-1',
      name: 'ReportedOne',
    });
  });

  it('emits the reporter when reporter send message is clicked', () => {
    const emitSpy = vi.spyOn(fixture.componentInstance.sendMessageRequested, 'emit');
    fixture.componentInstance.reports.set([report]);
    fixture.detectChanges();

    const sendButton = fixture.nativeElement.querySelector('button[aria-label="Send message to reporter ReporterOne"]') as HTMLButtonElement;
    sendButton.click();

    expect(emitSpy).toHaveBeenCalledWith({
      id: 'reporter-user-1',
      name: 'ReporterOne',
    });
  });

  it('loads reports from the admin reports api', async () => {
    reportsApi.listReports.mockReturnValue(of({ reports: [report] }));

    await fixture.componentInstance.loadReports();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('ReporterOne');
    expect(fixture.nativeElement.textContent).toContain('reported@example.test');
    expect(fixture.nativeElement.textContent).toContain('Abusive behavior in a room.');
  });

  it('filters reports by reporter and reported user', () => {
    fixture.componentInstance.reports.set([
      report,
      {
        id: 'report-2',
        reporter: {
          id: 'reporter-user-2',
          displayName: 'SecondReporter',
          email: 'second-reporter@example.test',
        },
        reportedUser: {
          id: 'reported-user-2',
          displayName: 'AnotherReported',
          email: 'another-reported@example.test',
        },
        reason: 'Spam messages.',
        createdAt: '2026-07-01T18:01:00+00:00',
      },
    ]);
    fixture.detectChanges();

    setInputValue(fixture, 'input[name="reporterSearch"]', 'ReporterOne');
    expect(fixture.nativeElement.textContent).toContain('ReportedOne');
    expect(fixture.nativeElement.textContent).not.toContain('AnotherReported');

    setInputValue(fixture, 'input[name="reportedUserSearch"]', 'missing-user');
    expect(fixture.nativeElement.textContent).toContain('No reports match the current filters.');
  });
});

function setInputValue(fixture: ComponentFixture<AdminReportsPanelComponent>, selector: string, value: string): void {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
