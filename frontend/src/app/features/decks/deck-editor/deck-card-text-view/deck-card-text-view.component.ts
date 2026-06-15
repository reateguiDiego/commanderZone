import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { DeckCommanderShowcaseComponent } from '../deck-commander-showcase/deck-commander-showcase.component';
import { runDeckFaceToggleAnimation } from '../deck-face-toggle-animation';

@Component({
  selector: 'app-deck-card-text-view',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent, DeckCommanderShowcaseComponent],
  templateUrl: './deck-card-text-view.component.html',
  styleUrl: './deck-card-text-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardTextViewComponent {
  readonly store = inject(DeckEditorStore);

  showCardPreview(event: MouseEvent, card: Card): void {
    this.store.resetCardFace(card);
    this.store.showCardPreview(event, card);
  }

  hideCardPreview(card: Card): void {
    this.store.hideCardPreview();
    this.store.resetCardFace(card);
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.toggleCardFace(event, card);
    runDeckFaceToggleAnimation(event.currentTarget, 'text-preview');
  }
}
