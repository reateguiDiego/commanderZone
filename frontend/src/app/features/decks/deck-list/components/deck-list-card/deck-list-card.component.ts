import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { type Deck, type DeckVisibility } from '../../../../../core/models/deck.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-deck-list-card',
  imports: [LucideAngularModule, RuntimeTranslatePipe, ManaSymbolsComponent, CzButtonDirective],
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

  visibilityIcon(visibility: DeckVisibility | undefined): 'globe' | 'lock' {
    return visibility === 'public' ? 'globe' : 'lock';
  }

  visibilityLabelKey(visibility: DeckVisibility | undefined): string {
    return visibility === 'public'
      ? 'common.visibility.visibilityChoice.public'
      : 'common.visibility.visibilityChoice.private';
  }

  open(event: Event): void {
    if (this.isDeckActionEvent(event)) {
      event.stopPropagation();
      return;
    }

    this.openDeck.emit();
  }

  handleDeckActionPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  handleDeckActionMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  edit(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.blurActionTarget(event);
    this.editDeck.emit();
  }

  delete(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.blurActionTarget(event);
    this.deleteDeck.emit();
  }

  private blurActionTarget(event: Event): void {
    const target = event.currentTarget;

    if (target instanceof HTMLElement) {
      target.blur();
    }
  }

  private isDeckActionEvent(event: Event): boolean {
    const target = event.target;

    return target instanceof HTMLElement && target.closest('.deck-row-actions') !== null;
  }
}
