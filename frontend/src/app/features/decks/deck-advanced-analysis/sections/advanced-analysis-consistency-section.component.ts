import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import type { ConsistencyMetricRow, ConsistencyTurnGroup } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-consistency-section',
  imports: [ManaSymbolsComponent, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-consistency-section.component.html',
  styleUrl: './advanced-analysis-consistency-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisConsistencySectionComponent {
  readonly hasConsistency = input(false);
  readonly simulationRuns = input('');
  readonly openingHandRows = input<readonly ConsistencyMetricRow[]>([]);
  readonly keepRuleDescription = input('');
  readonly keepRuleRows = input<readonly ConsistencyMetricRow[]>([]);
  readonly mulliganRows = input<readonly ConsistencyMetricRow[]>([]);
  readonly byTurnGroups = input<readonly ConsistencyTurnGroup[]>([]);
  readonly colorAccessGroups = input<readonly ConsistencyTurnGroup[]>([]);
  readonly commanderCurveRows = input<readonly ConsistencyMetricRow[]>([]);
}
