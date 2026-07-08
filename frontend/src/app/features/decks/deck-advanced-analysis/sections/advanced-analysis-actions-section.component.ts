import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import type { ActionIssueItem, RecommendationItem } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-actions-section',
  imports: [RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-actions-section.component.html',
  styleUrl: './advanced-analysis-actions-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisActionsSectionComponent {
  readonly hasActionIssues = input(false);
  readonly criticalIssues = input<readonly ActionIssueItem[]>([]);
  readonly warningIssues = input<readonly ActionIssueItem[]>([]);
  readonly infoIssues = input<readonly ActionIssueItem[]>([]);
  readonly recommendations = input<readonly RecommendationItem[]>([]);
}
