import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { DeckCommanderShowcaseComponent } from '../deck-commander-showcase/deck-commander-showcase.component';

@Component({
  selector: 'app-deck-card-text-view',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent, DeckCommanderShowcaseComponent],
  templateUrl: './deck-card-text-view.component.html',
  styleUrl: './deck-card-text-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardTextViewComponent {
  readonly store = inject(DeckEditorStore);
}
