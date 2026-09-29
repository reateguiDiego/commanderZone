import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import {
  FormatSelectComponent,
  type FormatSelectOption,
} from '../../../../shared/components/format-select/format-select.component';
import { AppThemeAssetsService } from '../../../../core/theme/app-theme-assets.service';
import { REPORT_CATEGORY_LABEL_KEYS, ReportCategory } from '../../data-access/reports.models';
import { ReportStore } from '../../data-access/report.store';

const REPORT_COMMENT_MAX_LENGTH = 400;

type ReportCategoryOption = FormatSelectOption & { readonly id: ReportCategory };

const REPORT_CATEGORY_OPTIONS: readonly ReportCategoryOption[] = [
  { id: 'harassment', labelKey: REPORT_CATEGORY_LABEL_KEYS.harassment },
  {
    id: 'discrimination_or_unwanted_sexual_content',
    labelKey: REPORT_CATEGORY_LABEL_KEYS.discrimination_or_unwanted_sexual_content,
  },
  { id: 'threats_or_safety', labelKey: REPORT_CATEGORY_LABEL_KEYS.threats_or_safety },
  { id: 'personal_data_exposure', labelKey: REPORT_CATEGORY_LABEL_KEYS.personal_data_exposure },
  {
    id: 'spam_advertising_scam_phishing',
    labelKey: REPORT_CATEGORY_LABEL_KEYS.spam_advertising_scam_phishing,
  },
  { id: 'impersonation', labelKey: REPORT_CATEGORY_LABEL_KEYS.impersonation },
  { id: 'public_offensive_content', labelKey: REPORT_CATEGORY_LABEL_KEYS.public_offensive_content },
  {
    id: 'intentional_game_disruption',
    labelKey: REPORT_CATEGORY_LABEL_KEYS.intentional_game_disruption,
  },
  {
    id: 'serious_gameplay_deception',
    labelKey: REPORT_CATEGORY_LABEL_KEYS.serious_gameplay_deception,
  },
  { id: 'other_problem', labelKey: REPORT_CATEGORY_LABEL_KEYS.other_problem },
];

@Component({
  selector: 'app-report-modal',
  imports: [AppModalComponent, FormatSelectComponent, RuntimeTranslatePipe],
  templateUrl: './report-modal.component.html',
  styleUrl: './report-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportModalComponent {
  readonly reports = inject(ReportStore);
  readonly themeAssets = inject(AppThemeAssetsService);
  readonly categories = REPORT_CATEGORY_OPTIONS;
  readonly commentMaxLength = REPORT_COMMENT_MAX_LENGTH;
  readonly category = signal<ReportCategory>('harassment');
  readonly comment = signal('');
  readonly commentLength = computed(() => this.comment().length);

  constructor() {
    effect(() => {
      const draft = this.reports.activeDraft();
      if (draft) {
        this.category.set('harassment');
        this.comment.set('');
      }
    });
  }

  updateCategory(value: string): void {
    if (this.isReportCategory(value)) {
      this.category.set(value);
    }
  }

  updateComment(value: string): void {
    this.comment.set(value.slice(0, this.commentMaxLength));
  }

  updateCommentFromEvent(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.updateComment(target.value);
    }
  }

  private isReportCategory(value: string): value is ReportCategory {
    return this.categories.some((option) => option.id === value);
  }

  submitOrClose(): void {
    if (this.reports.submissionSucceeded()) {
      this.reports.close();
      return;
    }

    void this.reports.submit(this.category(), this.comment());
  }
}
