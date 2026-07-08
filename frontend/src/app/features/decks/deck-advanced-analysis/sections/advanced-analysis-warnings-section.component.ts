import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import type { AdvancedIssueItem } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-warnings-section',
  imports: [RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-warnings-section.component.html',
  styleUrl: './advanced-analysis-warnings-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisWarningsSectionComponent {
  readonly issues = input<readonly AdvancedIssueItem[]>([]);
}
