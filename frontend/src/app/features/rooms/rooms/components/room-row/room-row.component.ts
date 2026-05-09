import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { DeckFormat } from '../../../../../core/models/deck.model';
import { Room } from '../../../../../core/models/room.model';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';

@Component({
  selector: 'app-room-row',
  imports: [RouterLink, LucideAngularModule, PlayerNameComponent],
  templateUrl: './room-row.component.html',
  styleUrl: './room-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomRowComponent {
  readonly room = input.required<Room>();
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly currentUserId = input<string | null>(null);
  readonly deletingRoomId = input<string | null>(null);
  readonly archivingRoomId = input<string | null>(null);

  readonly opened = output<Room>();
  readonly deleted = output<Room>();
  readonly archived = output<Room>();

  canDeleteRoom(room: Room): boolean {
    return this.isRoomWaiting(room) && room.owner.id === this.currentUserId();
  }

  canArchiveRoom(room: Room): boolean {
    return room.status !== 'archived' && room.owner.id === this.currentUserId() && (room.status === 'started' || !!room.gameId);
  }

  roomCapacity(room: Room): number {
    const maxPlayers = Number(room.maxPlayers);

    return Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 6 ? maxPlayers : 4;
  }

  roomPlayerCount(room: Room): number {
    return Array.isArray(room.players) ? room.players.length : 0;
  }

  isRoomStarted(room: Room): boolean {
    return room.status === 'started' || !!room.gameId;
  }

  isRoomWaiting(room: Room): boolean {
    const status = String(room.status ?? '').toLowerCase();

    return status === 'waiting' || status === 'open';
  }

  isRoomFull(room: Room): boolean {
    return this.roomPlayerCount(room) >= this.roomCapacity(room);
  }

  isRoomOpen(room: Room): boolean {
    return this.isRoomWaiting(room) && !this.isRoomStarted(room) && !this.isRoomFull(room);
  }

  formatLabel(formatId: string): string {
    return this.formats().find((format) => format.id === formatId)?.name ?? formatId;
  }
}
