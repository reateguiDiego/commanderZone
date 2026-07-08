import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type {
  AdvancedAnalysisStat,
  AdvancedIssueItem,
  ManaColorSourceRow,
  ManaFetchlandDetailItem,
  ManaSectionGroup,
} from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-mana-section',
  imports: [AdvancedAnalysisCardGridComponent, ManaSymbolsComponent, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-mana-section.component.html',
  styleUrl: './advanced-analysis-mana-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisManaSectionComponent {
  readonly hasMana = input(false);
  readonly overviewRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly sourceRows = input<readonly ManaColorSourceRow[]>([]);
  readonly landBaseRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly landCycleRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly landCycleAnalysisRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly fetchlandRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly fetchlandDetails = input<readonly ManaFetchlandDetailItem[]>([]);
  readonly rampRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly commanderRows = input<readonly ManaSectionGroup[]>([]);
  readonly manaIssues = input<readonly AdvancedIssueItem[]>([]);
}
