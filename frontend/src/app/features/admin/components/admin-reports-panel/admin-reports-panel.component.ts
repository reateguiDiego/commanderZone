import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import {
  FormatSelectComponent,
  FormatSelectOption,
} from '../../../../shared/components/format-select/format-select.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { ModerationUserDrawerComponent } from '../../../reports/components/moderation-user-drawer/moderation-user-drawer.component';
import { ReportEvidenceComponent } from '../../../reports/components/report-evidence/report-evidence.component';
import { ModerationSummaryStore } from '../../../reports/data-access/moderation-summary.store';
import { ReportsApi } from '../../../reports/data-access/reports.api';
import {
  AdminReport,
  AdminReportDetail,
  REPORT_CATEGORY_LABEL_KEYS,
  REPORT_SOURCE_LABEL_KEYS,
  ReportResolutionOutcome,
  ReportUserSummary,
} from '../../../reports/data-access/reports.models';
import type { AdminMessageRecipientSelection } from '../admin-users-panel/admin-users-panel.component';

const RESOLUTION_OUTCOME_OPTIONS: readonly FormatSelectOption[] = [
  { id: 'nothing', labelKey: 'reports.moderation.resolution.outcomes.nothing' },
  { id: 'strike', labelKey: 'reports.moderation.resolution.outcomes.strike' },
];

@Component({
  selector: 'app-admin-reports-panel',
  imports: [
    DatePipe,
    LucideAngularModule,
    RuntimeTranslatePipe,
    FormatSelectComponent,
    CzButtonDirective,
    TooltipComponent,
    ReportEvidenceComponent,
    ModerationUserDrawerComponent,
  ],
  templateUrl: './admin-reports-panel.component.html',
  styleUrl: './admin-reports-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportsPanelComponent {
  private readonly api = inject(ReportsApi);
  private readonly moderationSummary = inject(ModerationSummaryStore);
  private detailRequestId = 0;

  readonly reports = signal<readonly AdminReport[]>([]);
  readonly selectedReport = signal<AdminReportDetail | null>(null);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly total = signal(0);
  readonly isLoading = signal(false);
  readonly isLoadingDetail = signal(false);
  readonly isResolving = signal(false);
  readonly listError = signal<string | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly resolutionError = signal<string | null>(null);
  readonly resolutionOutcome = signal<ReportResolutionOutcome>('nothing');
  readonly strikeDescription = signal('');
  readonly moderationUserId = signal<string | null>(null);
  readonly categoryLabelKeys = REPORT_CATEGORY_LABEL_KEYS;
  readonly sourceLabelKeys = REPORT_SOURCE_LABEL_KEYS;
  readonly resolutionOutcomeOptions = RESOLUTION_OUTCOME_OPTIONS;
  readonly dateTimeFormat = 'dd/MM/yyyy HH:mm';
  readonly sendMessageRequested = output<AdminMessageRecipientSelection>();

  readonly hasPreviousPage = computed(() => this.currentPage() > 1);
  readonly hasNextPage = computed(() => this.currentPage() < this.totalPages());
  readonly canResolve = computed(
    () =>
      !this.isResolving() &&
      (this.resolutionOutcome() !== 'strike' || this.strikeDescription().trim() !== ''),
  );

  constructor() {
    void this.loadReports();
  }

  async loadReports(page = this.currentPage()): Promise<void> {
    this.isLoading.set(true);
    this.listError.set(null);

    try {
      const response = await firstValueFrom(this.api.listReports(page));
      this.reports.set(response.reports);
      this.currentPage.set(response.page);
      this.totalPages.set(response.totalPages);
      this.total.set(response.total);
    } catch (error: unknown) {
      this.listError.set(this.resolveError(error, 'reports.moderation.errors.loadQueue'));
    } finally {
      this.isLoading.set(false);
    }
  }

  async selectReport(report: AdminReport): Promise<void> {
    const requestId = ++this.detailRequestId;
    this.selectedReport.set(null);
    this.isLoadingDetail.set(true);
    this.detailError.set(null);
    this.resolutionError.set(null);
    this.resetResolutionForm();

    try {
      const response = await firstValueFrom(this.api.getReport(report.id));
      if (requestId === this.detailRequestId) {
        this.selectedReport.set(response.report);
      }
    } catch (error: unknown) {
      if (requestId === this.detailRequestId) {
        this.detailError.set(this.resolveError(error, 'reports.moderation.errors.loadReport'));
      }
    } finally {
      if (requestId === this.detailRequestId) {
        this.isLoadingDetail.set(false);
      }
    }
  }

  async resolveSelectedReport(): Promise<void> {
    const report = this.selectedReport();
    const outcome = this.resolutionOutcome();
    const strikeDescription = this.strikeDescription().trim();
    if (!report || !this.canResolve()) {
      if (outcome === 'strike' && strikeDescription === '') {
        this.resolutionError.set('reports.moderation.strikes.descriptionRequired');
      }
      return;
    }

    this.isResolving.set(true);
    this.resolutionError.set(null);
    try {
      const response = await firstValueFrom(
        this.api.resolveReport(report.id, {
          outcome,
          ...(outcome === 'strike' ? { strikeDescription } : {}),
        }),
      );

      this.selectedReport.set(response.report);
      this.reports.update((reports) => reports.filter((candidate) => candidate.id !== report.id));
      void this.moderationSummary.refresh();
      this.resetResolutionForm();
      await this.loadReports(this.currentPage());
    } catch (error: unknown) {
      this.resolutionError.set(this.resolveError(error, 'reports.moderation.errors.resolveReport'));
    } finally {
      this.isResolving.set(false);
    }
  }

  goToPreviousPage(): void {
    if (this.hasPreviousPage()) {
      void this.loadReports(this.currentPage() - 1);
    }
  }

  goToNextPage(): void {
    if (this.hasNextPage()) {
      void this.loadReports(this.currentPage() + 1);
    }
  }

  setResolutionOutcome(value: string): void {
    if (value === 'strike' || value === 'nothing') {
      this.resolutionOutcome.set(value);
      this.resolutionError.set(null);
    }
  }

  setStrikeDescription(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.strikeDescription.set(target.value);
      this.resolutionError.set(null);
    }
  }

  openModerationUser(userId: string | null): void {
    if (userId) {
      this.moderationUserId.set(userId);
    }
  }

  closeModerationUser(): void {
    this.moderationUserId.set(null);
  }

  requestMessageToReporter(report: AdminReportDetail): void {
    this.requestMessage(report.reporter);
  }

  requestMessageToReportedUser(report: AdminReportDetail): void {
    this.requestMessage(report.reportedUser);
  }

  private resetResolutionForm(): void {
    this.resolutionOutcome.set('nothing');
    this.strikeDescription.set('');
  }

  private requestMessage(user: ReportUserSummary): void {
    if (user.id) {
      this.sendMessageRequested.emit({ id: user.id, name: user.displayName });
    }
  }

  private resolveError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && this.hasErrorMessage(error.error)) {
      return error.error.error;
    }

    return fallback;
  }

  private hasErrorMessage(value: unknown): value is { readonly error: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
    );
  }
}
