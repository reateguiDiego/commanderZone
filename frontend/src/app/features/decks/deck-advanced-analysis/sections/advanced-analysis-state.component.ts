import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-advanced-analysis-state',
  imports: [CzButtonDirective, RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-state.component.html',
  styleUrl: './advanced-analysis-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisStateComponent {
  readonly variant = input<'error' | 'empty'>('empty');
  readonly message = input<string | null>(null);
  readonly retry = output<void>();
}
