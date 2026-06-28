import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { DECK_ANALYSIS_STORE } from '../deck-analysis-store.token';

@Component({
  selector: 'app-deck-mana-curve-panel',
  imports: [RuntimeTranslatePipe, LucideAngularModule, CzButtonDirective],
  templateUrl: './deck-mana-curve-panel.component.html',
  styleUrl: './deck-mana-curve-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckManaCurvePanelComponent {
  readonly store = inject(DECK_ANALYSIS_STORE);
  readonly curveCollapsed = signal(false);

  toggleCurve(): void {
    this.curveCollapsed.update((collapsed) => !collapsed);
  }
}
