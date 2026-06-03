import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../../data-access/deck-editor.store';

@Component({
  selector: 'app-deck-mana-balance-panel',
  imports: [RuntimeTranslatePipe, ManaSymbolsComponent],
  templateUrl: './deck-mana-balance-panel.component.html',
  styleUrl: './deck-mana-balance-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckManaBalancePanelComponent {
  readonly store = inject(DeckEditorStore);
}
