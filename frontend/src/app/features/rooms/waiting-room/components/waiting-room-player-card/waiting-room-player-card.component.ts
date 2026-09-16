import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { DeckBracketLabel } from '../../../../../core/models/deck-analysis.model';
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
  readonly deckArtUrl = input<string | null>(null);
  readonly secondaryDeckArtUrl = input<string | null>(null);
  readonly deckName = input('game.opponentMiniBoard.deckPending');
  readonly deckOptions = input<readonly WaitingDeckOption[]>([]);
  readonly selectedDeck = input<WaitingDeckOption | null>(null);
  readonly selectedDeckId = input('');
  readonly deckSearch = input('');
  readonly loadingDeckPage = input(false);
  readonly hasMoreDecks = input(false);
  readonly deckBracket = input<DeckBracketLabel | null>(null);
  readonly turnPosition = input<number | null>(null);
  readonly updatingDeck = input(false);
  readonly deckLocked = input(false);
  readonly canRoll = input(false);
  readonly rolling = input(false);
  readonly canKick = input(false);
  readonly kicking = input(false);

  private readonly unavailableDeckArtUrls = signal<readonly string[]>([]);
  readonly visibleDeckArtUrls = computed<readonly string[] | null>(() => {
    const unavailableUrls = this.unavailableDeckArtUrls();
    const artUrls = [this.deckArtUrl(), this.secondaryDeckArtUrl()]
      .filter((url): url is string => !!url && !unavailableUrls.includes(url));

    return artUrls.length > 0 ? artUrls : null;
  });

  readonly deckSelectorToggled = output<void>();
  readonly deckSelectorClosed = output<void>();
  readonly selectedDeckIdChange = output<string>();
  readonly deckSearchChange = output<string>();
  readonly loadMoreDecksRequested = output<void>();
  readonly deckSelected = output<string>();
  readonly randomDeckRequested = output<void>();
  readonly rollRequested = output<void>();
  readonly kickRequested = output<RoomPlayer>();

  markDeckArtUnavailable(url: string): void {
    if (this.unavailableDeckArtUrls().includes(url)) {
      return;
    }

    this.unavailableDeckArtUrls.update((unavailableUrls) => [...unavailableUrls, url]);
  }

  rollLabel(player: RoomPlayer): string {
    const rolls = Array.isArray(player.turnRolls) && player.turnRolls.length > 0
      ? player.turnRolls
      : player.turnRoll === null ? [] : [player.turnRoll];

    return rolls.join(' - ');
  }
}
