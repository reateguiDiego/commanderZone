import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';

@Component({
  selector: 'app-deck-commander-showcase',
  imports: [LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
  templateUrl: './deck-commander-showcase.component.html',
  styleUrl: './deck-commander-showcase.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCommanderShowcaseComponent {
  readonly entries = input<readonly DeckCard[]>([]);
  readonly store = inject(DeckEditorStore);

  constructor() {
    effect(() => {
      this.store.ensureCardImages(this.entries());
    });
  }
}
