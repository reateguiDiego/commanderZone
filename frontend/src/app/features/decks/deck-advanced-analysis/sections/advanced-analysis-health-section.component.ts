import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type { AdvancedHealthCard } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-health-section',
  imports: [AdvancedAnalysisCardGridComponent, ManaSymbolsComponent, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-health-section.component.html',
  styleUrl: './advanced-analysis-health-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisHealthSectionComponent {
  readonly cards = input<readonly AdvancedHealthCard[]>([]);
}
