import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { type Deck, type DeckVisibility } from '../../../../../core/models/deck.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { TooltipComponent } from '../../../../../shared/ui/tooltip/tooltip.component';

@Component({
  selector: 'app-deck-list-card',
  imports: [LucideAngularModule, RuntimeTranslatePipe, ManaSymbolsComponent, TooltipComponent],
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

  visibilityIcon(visibility: DeckVisibility | undefined): 'globe' | 'lock' {
    return visibility === 'public' ? 'globe' : 'lock';
  }

  visibilityLabelKey(visibility: DeckVisibility | undefined): string {
    return visibility === 'public'
      ? 'common.visibility.visibilityChoice.public'
      : 'common.visibility.visibilityChoice.private';
  }

  visibilityPillLabelKey(visibility: DeckVisibility | undefined): string {
    return visibility === 'public'
      ? 'common.visibility.visibilityPill.public'
      : 'common.visibility.visibilityPill.private';
  }

  open(event: Event): void {
    this.openDeck.emit();
  }
}
