import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { type Deck, type DeckVisibility } from '../../../../../core/models/deck.model';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-deck-list-card',
  imports: [LucideAngularModule, ManaSymbolsComponent, CzButtonDirective],
  templateUrl: './deck-list-card.component.html',
  styleUrl: './deck-list-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListCardComponent {
  readonly deck = input.required<Deck>();
  readonly commanderBackground = input<string | null>(null);
  readonly secondaryCommanderBackground = input<string | null>(null);
  readonly colorIdentity = input<readonly string[] | null>(null);
  readonly hasCommanderArt = input(false);
  readonly hasDualCommanderArt = input(false);
  readonly hasIssues = input(false);
  readonly issueTooltip = input('');

  readonly openDeck = output<void>();
  readonly editDeck = output<void>();
  readonly deleteDeck = output<void>();
  readonly deckDragStart = output<DragEvent>();
  readonly deckDragEnd = output<void>();
  readonly deckPointerDown = output<PointerEvent>();
  readonly deckPointerMove = output<PointerEvent>();
  readonly deckPointerUp = output<PointerEvent>();
  readonly deckPointerCancel = output<PointerEvent>();

  visibilityIcon(visibility: DeckVisibility | undefined): 'globe' | 'lock' {
    return visibility === 'public' ? 'globe' : 'lock';
  }

  edit(event: MouseEvent): void {
    event.stopPropagation();
    this.editDeck.emit();
  }

  delete(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteDeck.emit();
  }
}
