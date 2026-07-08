import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CardFaceImageComponent } from '../../../../shared/components/card-face-image/card-face-image.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import type { AdvancedAnalysisStat, ComboCompleterItem, ComboDisplayItem } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-combos-section',
  imports: [CardFaceImageComponent, CzButtonDirective, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-combos-section.component.html',
  styleUrl: './advanced-analysis-combos-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisCombosSectionComponent {
  readonly comboPiecesWarning = input<string | null>(null);
  readonly comboEmptyMessage = input<string | null>(null);
  readonly summaryStats = input<readonly AdvancedAnalysisStat[]>([]);
  readonly completeCombos = input<readonly ComboDisplayItem[]>([]);
  readonly partialCombos = input<readonly ComboDisplayItem[]>([]);
  readonly topCompleters = input<readonly ComboCompleterItem[]>([]);
  readonly hiddenCompleteCount = input(0);
  readonly hiddenPartialCount = input(0);
  readonly hiddenCompleterCount = input(0);

  readonly showAllComplete = output<void>();
  readonly showAllPartial = output<void>();
  readonly showAllCompleters = output<void>();
}
