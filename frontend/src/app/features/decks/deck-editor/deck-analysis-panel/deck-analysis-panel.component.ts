import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DeckManaBalancePanelComponent } from './deck-mana-balance-panel/deck-mana-balance-panel.component';
import { DeckManaCurvePanelComponent } from './deck-mana-curve-panel/deck-mana-curve-panel.component';
import { DECK_ANALYSIS_STORE } from './deck-analysis-store.token';

@Component({
  selector: 'app-deck-analysis-panel',
  imports: [RuntimeTranslatePipe, DeckManaBalancePanelComponent, DeckManaCurvePanelComponent],
  templateUrl: './deck-analysis-panel.component.html',
  styleUrl: './deck-analysis-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAnalysisPanelComponent {
  readonly store = inject(DECK_ANALYSIS_STORE);
}
