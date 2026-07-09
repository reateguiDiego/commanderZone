import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type { AdvancedIssueItem, BoardWipeDetailItem, BoardWipeStatGroup } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-board-wipes-section',
  imports: [AdvancedAnalysisCardGridComponent, CzButtonDirective, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-board-wipes-section.component.html',
  styleUrl: './advanced-analysis-board-wipes-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisBoardWipesSectionComponent {
  readonly hasBoardWipes = input(false);
  readonly summaryRows = input<readonly BoardWipeStatGroup[]>([]);
  readonly warningIssues = input<readonly AdvancedIssueItem[]>([]);
  readonly details = input<readonly BoardWipeDetailItem[]>([]);
  readonly visibleCards = input<readonly BoardWipeDetailItem[]>([]);
  readonly hiddenCardCount = input(0);

  readonly showAllDetails = output<void>();
}
