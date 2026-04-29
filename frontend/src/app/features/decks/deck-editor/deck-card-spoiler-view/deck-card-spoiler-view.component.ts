import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';

@Component({
  selector: 'app-deck-card-spoiler-view',
  imports: [LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
  templateUrl: './deck-card-spoiler-view.component.html',
  styleUrl: './deck-card-spoiler-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardSpoilerViewComponent {
  readonly store = inject(DeckEditorStore);

  constructor() {
    this.store.hideCardPreview();

    effect(() => {
      for (const group of this.store.cardGroups()) {
        this.store.ensureCardImages(group.cards);
      }
    });
  }
}
