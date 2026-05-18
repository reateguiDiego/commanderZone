import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RoomPlayer } from '../../../../../core/models/room.model';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { PlayerAvatarComponent } from '../../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { WaitingRoomDeckSelectorComponent, WaitingDeckOption } from '../waiting-room-deck-selector/waiting-room-deck-selector.component';

@Component({
  selector: 'app-waiting-room-player-card',
  imports: [LucideAngularModule, ManaSymbolsComponent, PlayerAvatarComponent, PlayerNameComponent, WaitingRoomDeckSelectorComponent],
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
  readonly deckName = input('Deck pending');
  readonly deckColorIdentity = input<readonly string[]>([]);
  readonly deckOptions = input<readonly WaitingDeckOption[]>([]);
  readonly selectedDeck = input<WaitingDeckOption | null>(null);
  readonly selectedDeckId = input('');
  readonly updatingDeck = input(false);
  readonly deckLocked = input(false);
  readonly canKick = input(false);
  readonly kicking = input(false);

  readonly deckSelectorToggled = output<void>();
  readonly deckSelectorClosed = output<void>();
  readonly selectedDeckIdChange = output<string>();
  readonly deckSelected = output<string>();
  readonly randomDeckRequested = output<void>();
  readonly kickRequested = output<RoomPlayer>();

  rollLabel(player: RoomPlayer): string {
    const rolls = Array.isArray(player.turnRolls) && player.turnRolls.length > 0
      ? player.turnRolls
      : player.turnRoll === null ? [] : [player.turnRoll];

    return rolls.join(' - ');
  }
}
