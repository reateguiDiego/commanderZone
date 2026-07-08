import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { AdvancedAnalysisCardGridComponent } from '../advanced-analysis-card-grid.component';
import type { AdvancedAnalysisStat, ArchetypeIdentityView, TypalIdentityView } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-summary-section',
  imports: [AdvancedAnalysisCardGridComponent, LucideAngularModule, RuntimeTranslatePipe, TooltipComponent],
  templateUrl: './advanced-analysis-summary-section.component.html',
  styleUrl: './advanced-analysis-summary-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisSummarySectionComponent {
  readonly stats = input<readonly AdvancedAnalysisStat[]>([]);
  readonly typal = input<TypalIdentityView | null>(null);
  readonly archetypes = input<readonly ArchetypeIdentityView[]>([]);
}
