import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { DeckEditorStore } from '../../../data-access/deck-editor.store';

@Component({
  selector: 'app-deck-mana-curve-panel',
  imports: [LucideAngularModule],
  templateUrl: './deck-mana-curve-panel.component.html',
  styleUrl: './deck-mana-curve-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckManaCurvePanelComponent {
  readonly store = inject(DeckEditorStore);
}
