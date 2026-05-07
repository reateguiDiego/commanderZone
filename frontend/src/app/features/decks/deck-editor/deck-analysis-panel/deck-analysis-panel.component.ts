import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckManaBalancePanelComponent } from './deck-mana-balance-panel/deck-mana-balance-panel.component';
import { DeckManaCurvePanelComponent } from './deck-mana-curve-panel/deck-mana-curve-panel.component';

@Component({
  selector: 'app-deck-analysis-panel',
  imports: [DeckManaBalancePanelComponent, DeckManaCurvePanelComponent],
  templateUrl: './deck-analysis-panel.component.html',
  styleUrl: './deck-analysis-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAnalysisPanelComponent {
  readonly store = inject(DeckEditorStore);
}
