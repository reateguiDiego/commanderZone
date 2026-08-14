import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { DeckBracketEstimate } from '../../../../../core/models/deck-analysis.model';
import { RoomPlayer } from '../../../../../core/models/room.model';
import { PlayerInfoComponent } from '../../../../../shared/ui/player-info/player-info.component';
import { BracketLabelPillComponent } from '../../../../../shared/ui/bracket-label-pill/bracket-label-pill.component';
import { WaitingRoomDeckSelectorComponent, WaitingDeckOption } from '../waiting-room-deck-selector/waiting-room-deck-selector.component';

@Component({
  selector: 'app-waiting-room-player-card',
  imports: [RuntimeTranslatePipe, LucideAngularModule, PlayerInfoComponent, BracketLabelPillComponent, WaitingRoomDeckSelectorComponent],
  templateUrl: './waiting-room-player-card.component.html',
  styleUrl: './waiting-room-player-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomPlayerCardComponent {
  readonly player = input<RoomPlayer | null>(null);
  readonly host = input(false);
  readonly current = input(false);
  readonly ready = input(false);
  readonly selectorOpen = input(false);
  readonly hasDeckArt = input(false);
  readonly hasDualDeckArt = input(false);
  readonly deckName = input('Deck pending');
  readonly deckOptions = input<readonly WaitingDeckOption[]>([]);
  readonly selectedDeck = input<WaitingDeckOption | null>(null);
  readonly selectedDeckId = input('');
  readonly deckBracket = input<DeckBracketEstimate | null>(null);
  readonly turnPosition = input<number | null>(null);
  readonly updatingDeck = input(false);
  readonly deckLocked = input(false);
  readonly canRoll = input(false);
  readonly rolling = input(false);
  readonly canKick = input(false);
  readonly kicking = input(false);

  readonly deckSelectorToggled = output<void>();
  readonly deckSelectorClosed = output<void>();
  readonly selectedDeckIdChange = output<string>();
  readonly deckSelected = output<string>();
  readonly randomDeckRequested = output<void>();
  readonly rollRequested = output<void>();
  readonly kickRequested = output<RoomPlayer>();

  rollLabel(player: RoomPlayer): string {
    const rolls = Array.isArray(player.turnRolls) && player.turnRolls.length > 0
      ? player.turnRolls
      : player.turnRoll === null ? [] : [player.turnRoll];

    return rolls.join(' - ');
  }
}
