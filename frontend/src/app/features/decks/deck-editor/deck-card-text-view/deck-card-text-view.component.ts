import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';

@Component({
  selector: 'app-deck-card-text-view',
  imports: [LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
  templateUrl: './deck-card-text-view.component.html',
  styleUrl: './deck-card-text-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardTextViewComponent {
  readonly store = inject(DeckEditorStore);
}
