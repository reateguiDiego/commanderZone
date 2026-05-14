import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { DeckFormat } from '../../../../../core/models/deck.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, CurrentRoomTurn } from '../../../../../core/models/room.model';

@Component({
  selector: 'app-room-current-banner',
  imports: [RouterLink, LucideAngularModule],
  templateUrl: './room-current-banner.component.html',
  styleUrl: './room-current-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomCurrentBannerComponent {
  readonly room = input.required<CurrentRoomSummary>();
  readonly currentPlayer = input<CurrentRoomPlayerSummary | null>(null);
  readonly turn = input<CurrentRoomTurn | null>(null);
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly leavingRoomId = input<string | null>(null);

  readonly leaveRequested = output<string>();

  readonly playerDeckName = computed(() => this.currentPlayer()?.deckName ?? 'No deck selected');
  readonly deckImageUrl = computed(() => this.currentPlayer()?.deckImageUrl ?? null);
  readonly formatName = computed(() => this.formatLabel(this.room().format));
  readonly playerCountLabel = computed(() => `${this.room().playerCount} / ${this.roomCapacity(this.room())}`);
  readonly primaryActionRoute = computed(() => {
    const room = this.room();

    return room.gameId ? ['/games', room.gameId] : ['/rooms', room.id, 'waiting'];
  });
  readonly primaryActionLabel = computed(() => this.room().gameId ? 'Open' : 'Join room');
  readonly primaryActionIcon = computed(() => this.room().gameId ? 'play' : 'door-open');
  readonly turnLabel = computed(() => {
    const number = this.turn()?.number;

    return typeof number === 'number' ? `Turn ${number}` : 'Turn pending';
  });

  formatLabel(formatId: string): string {
    return this.formats().find((format) => format.id === formatId)?.name ?? formatId;
  }

  roomCapacity(room: CurrentRoomSummary): number {
    const maxPlayers = Number(room.maxPlayers);

    return Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 6 ? maxPlayers : 4;
  }
}
