import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { ReportEvidence } from '../../data-access/reports.models';

@Component({
  selector: 'app-report-evidence',
  imports: [DatePipe, PrettyScrollDirective, RuntimeTranslatePipe],
  templateUrl: './report-evidence.component.html',
  styleUrl: './report-evidence.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportEvidenceComponent {
  readonly evidence = input.required<ReportEvidence>();
  readonly dateTimeFormat = input.required<string>();

  readonly hasCapturedEvidence = computed(() => {
    const evidence = this.evidence();
    return evidence.reportedUserSnapshot !== null || evidence.game !== null;
  });
}
