import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type { AdvancedAnalysisStat, PowerSignalCardGroup, UnmatchedCardItem } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-metrics-section',
  imports: [AdvancedAnalysisCardGridComponent, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-metrics-section.component.html',
  styleUrl: './advanced-analysis-metrics-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisMetricsSectionComponent {
  readonly keyMetrics = input<readonly AdvancedAnalysisStat[]>([]);
  readonly metricsUnavailable = input(false);
  readonly cardResolutionStats = input<readonly AdvancedAnalysisStat[]>([]);
  readonly powerSignalCardGroups = input<readonly PowerSignalCardGroup[]>([]);
  readonly hasUnmatchedCards = input(false);
  readonly unmatchedCardCount = input(0);
  readonly unmatchedCardItems = input<readonly UnmatchedCardItem[]>([]);
}
