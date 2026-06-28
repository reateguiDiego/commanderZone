import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { DeckCommanderShowcaseComponent } from '../deck-commander-showcase/deck-commander-showcase.component';
import { DECK_VIEW_STORE } from '../deck-view-store.token';

@Component({
  selector: 'app-deck-card-text-view',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaSymbolsComponent, DeckCardMenuComponent, DeckCommanderShowcaseComponent],
  templateUrl: './deck-card-text-view.component.html',
  styleUrl: './deck-card-text-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardTextViewComponent {
  readonly interactive = input(true);
  readonly cardClickEnabled = input(true);
  readonly store = inject(DECK_VIEW_STORE);

  showCardPreview(event: MouseEvent, card: Card): void {
    this.store.showCardPreview(event, card);
  }

  hideCardPreview(): void {
    this.store.hideCardPreview();
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

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.store.toggleCardFace(event, card);
  }
}
