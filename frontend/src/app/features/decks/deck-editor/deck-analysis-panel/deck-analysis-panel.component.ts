import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { DeckManaBalancePanelComponent } from './deck-mana-balance-panel/deck-mana-balance-panel.component';
import { DeckManaCurvePanelComponent } from './deck-mana-curve-panel/deck-mana-curve-panel.component';
import { DECK_ANALYSIS_STORE } from './deck-analysis-store.token';

type AnalysisTogglePanel = 'type-breakdown' | 'utility-counts';
type AdvancedAnalysisRouteState = {
  readonly deck?: object;
  readonly routeIdentifier?: string;
};

@Component({
  selector: 'app-deck-analysis-panel',
  imports: [RuntimeTranslatePipe, RouterLink, LucideAngularModule, CzButtonDirective, DeckManaBalancePanelComponent, DeckManaCurvePanelComponent],
  templateUrl: './deck-analysis-panel.component.html',
  styleUrl: './deck-analysis-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAnalysisPanelComponent {
  readonly store = inject(DECK_ANALYSIS_STORE);
  readonly advancedAnalysisLink = input<readonly string[] | null>(null);
  readonly advancedAnalysisState = input<AdvancedAnalysisRouteState | null>(null);
  readonly advancedAnalysisAriaLabel = input('deckBuilder.advancedAnalysis.openButton');
  readonly hasAnalysisData = computed(() => this.store.analysis().mainDeckCards > 0);
  private readonly collapsedPanels = signal<ReadonlySet<AnalysisTogglePanel>>(new Set());

  isPanelCollapsed(panel: AnalysisTogglePanel): boolean {
    return this.collapsedPanels().has(panel);
  }

  togglePanel(panel: AnalysisTogglePanel): void {
    this.collapsedPanels.update((current) => {
      const next = new Set(current);
      if (next.has(panel)) {
        next.delete(panel);
      } else {
        next.add(panel);
      }

      return next;
    });
  }
}
