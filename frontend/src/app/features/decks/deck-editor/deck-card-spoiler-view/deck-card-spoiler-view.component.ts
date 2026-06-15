import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckEditorStore } from '../../data-access/deck-editor.store';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { runDeckFaceToggleAnimation } from '../deck-face-toggle-animation';

@Component({
  selector: 'app-deck-card-spoiler-view',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
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

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  ensureFrontFace(card: Card): void {
    this.store.resetCardFace(card);
  }

  resetCardFaceAfterHover(event: Event, card: Card): void {
    if (this.store.resetCardFace(card)) {
      runDeckFaceToggleAnimation(event.currentTarget, 'card-image', { animateTrigger: false });
    }
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.toggleCardFace(event, card, { updatePreview: false });
    runDeckFaceToggleAnimation(event.currentTarget, 'card-image');
  }
}
