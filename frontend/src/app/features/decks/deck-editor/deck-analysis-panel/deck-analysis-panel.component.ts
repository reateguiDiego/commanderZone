import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { DeckManaBalancePanelComponent } from './deck-mana-balance-panel/deck-mana-balance-panel.component';
import { DeckManaCurvePanelComponent } from './deck-mana-curve-panel/deck-mana-curve-panel.component';
import { DECK_ANALYSIS_STORE } from './deck-analysis-store.token';

type AnalysisTogglePanel = 'type-breakdown' | 'utility-counts';

@Component({
  selector: 'app-deck-analysis-panel',
  imports: [RuntimeTranslatePipe, LucideAngularModule, DeckManaBalancePanelComponent, DeckManaCurvePanelComponent],
  templateUrl: './deck-analysis-panel.component.html',
  styleUrl: './deck-analysis-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAnalysisPanelComponent {
  readonly store = inject(DECK_ANALYSIS_STORE);
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
