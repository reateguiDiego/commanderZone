import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import type { FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type {
  AdvancedAnalysisStat,
  ManaCardGroup,
  ManaColorDemandRow,
  ManaColorSourceRow,
  ManaFunctionalCardGroup,
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
  readonly sourceColorFilterOptions = input<readonly FormatSelectOption[]>([]);
  readonly sourceColorFilterValue = input('all');
  readonly baseAndAccelerationCardGroups = input<readonly ManaFunctionalCardGroup[]>([]);
  readonly demandRows = input<readonly ManaColorDemandRow[]>([]);

  readonly sourceColorFilterChange = output<string>();
}
