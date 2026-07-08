import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type {
  AdvancedIssueItem,
  AdvancedAnalysisStat,
  ManaCardGroup,
  ManaColorDemandRow,
  ManaColorSourceRow,
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
  readonly sourceCardGroups = input<readonly ManaCardGroup[]>([]);
  readonly landBaseCardGroups = input<readonly ManaCardGroup[]>([]);
  readonly landCycleRows = input<readonly AdvancedAnalysisStat[]>([]);
  readonly rampCardGroups = input<readonly ManaCardGroup[]>([]);
  readonly fixingCardGroups = input<readonly ManaCardGroup[]>([]);
  readonly demandRows = input<readonly ManaColorDemandRow[]>([]);
  readonly manaIssues = input<readonly AdvancedIssueItem[]>([]);
}
