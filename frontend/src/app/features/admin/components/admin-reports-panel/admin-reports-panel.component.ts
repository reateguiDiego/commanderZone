import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { AdminReportsApi } from '../../data-access/admin-reports.api';
import { AdminReport } from '../../data-access/admin-reports.models';
import type { AdminMessageRecipientSelection } from '../admin-users-panel/admin-users-panel.component';

@Component({
  selector: 'app-admin-reports-panel',
  imports: [CzButtonDirective, LucideAngularModule, TooltipComponent],
  templateUrl: './admin-reports-panel.component.html',
  styleUrl: './admin-reports-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportsPanelComponent {
  private readonly api = inject(AdminReportsApi);

  readonly sendMessageRequested = output<AdminMessageRecipientSelection>();
  readonly reports = signal<readonly AdminReport[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly reporterQuery = signal('');
  readonly reportedUserQuery = signal('');
  readonly filteredReports = computed(() => {
    const reporterQuery = this.normalizeQuery(this.reporterQuery());
    const reportedUserQuery = this.normalizeQuery(this.reportedUserQuery());

    return this.reports().filter((report) => (
      this.matchesUserQuery(report.reporter, reporterQuery)
      && this.matchesUserQuery(report.reportedUser, reportedUserQuery)
    ));
  });

  constructor() {
    void this.loadReports();
  }

  async loadReports(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(this.api.listReports());
      this.reports.set(response.reports);
    } catch (error: unknown) {
      this.errorMessage.set(this.resolveError(error, 'Could not load reports.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  requestSendMessage(report: AdminReport): void {
    this.sendMessageRequested.emit({
      id: report.reportedUser.id,
      name: report.reportedUser.displayName,
    });
  }

  requestSendMessageToReporter(report: AdminReport): void {
    this.sendMessageRequested.emit({
      id: report.reporter.id,
      name: report.reporter.displayName,
    });
  }

  updateReporterQuery(event: Event): void {
    this.reporterQuery.set(this.inputValue(event));
  }

  updateReportedUserQuery(event: Event): void {
    this.reportedUserQuery.set(this.inputValue(event));
  }

  private matchesUserQuery(user: { readonly displayName: string; readonly email: string }, query: string): boolean {
    if (query === '') {
      return true;
    }

    return this.normalizeQuery(user.displayName).includes(query) || this.normalizeQuery(user.email).includes(query);
  }

  private normalizeQuery(value: string): string {
    return value.trim().toLowerCase();
  }

  private inputValue(event: Event): string {
    const target = event.target;

    return target instanceof HTMLInputElement ? target.value : '';
  }

  private resolveError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return fallback;
  }
}
