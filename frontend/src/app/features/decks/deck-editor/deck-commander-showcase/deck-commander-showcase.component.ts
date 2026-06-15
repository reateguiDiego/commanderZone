import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { Card } from '../../../../core/models/card.model';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { runDeckFaceToggleAnimation } from '../deck-face-toggle-animation';

@Component({
  selector: 'app-deck-commander-showcase',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
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

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  ensureFrontFace(card: Card): void {
    this.store.resetCardFace(card);
  }

  resetCardFaceAfterHover(card: Card): void {
    this.store.resetCardFace(card);
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.toggleCardFace(event, card, { updatePreview: false });
    runDeckFaceToggleAnimation(event.currentTarget, 'card-image');
  }
}
