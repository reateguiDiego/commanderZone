import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { runDeckFaceToggleAnimation } from '../deck-face-toggle-animation';
import { DECK_VIEW_STORE } from '../deck-view-store.token';

@Component({
  selector: 'app-deck-card-spoiler-view',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent],
  templateUrl: './deck-card-spoiler-view.component.html',
  styleUrl: './deck-card-spoiler-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardSpoilerViewComponent {
  readonly interactive = input(true);
  readonly cardClickEnabled = input(true);
  readonly store = inject(DECK_VIEW_STORE);

  constructor() {
    this.store.hideCardPreview();

    effect(() => {
      for (const group of this.store.cardGroups()) {
        this.store.ensureCardImages(group.cards);
      }
    });
  }

  stopFaceTogglePointer(event: Event): void {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  stopFaceToggleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  isBattleVisibleFace(card: Card): boolean {
    return (this.store.displayCardTypeLine(card) ?? '').trim().toLowerCase().startsWith('battle');
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.store.toggleCardFace(event, card, { updatePreview: false });
    runDeckFaceToggleAnimation(event.currentTarget, 'card-image');
  }
}
