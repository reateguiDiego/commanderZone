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

  it('emits reporter and reported users when send message actions are clicked', () => {
    const emitSpy = vi.spyOn(fixture.componentInstance.sendMessageRequested, 'emit');
    fixture.componentInstance.reports.set([report]);
    fixture.detectChanges();

    sendMessageButton(fixture, 'reported user ReportedOne').click();
    sendMessageButton(fixture, 'reporter ReporterOne').click();

    expect(emitSpy).toHaveBeenNthCalledWith(1, { id: 'reported-user-1', name: 'ReportedOne' });
    expect(emitSpy).toHaveBeenNthCalledWith(2, { id: 'reporter-user-1', name: 'ReporterOne' });
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

function sendMessageButton(fixture: ComponentFixture<AdminReportsPanelComponent>, target: string): HTMLButtonElement {
  return fixture.nativeElement.querySelector(`button[aria-label="Send message to ${target}"]`) as HTMLButtonElement;
}

function setInputValue(fixture: ComponentFixture<AdminReportsPanelComponent>, selector: string, value: string): void {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
