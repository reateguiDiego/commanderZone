import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
﻿import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { DeckFormat } from '../../../../../core/models/deck.model';
import { Room } from '../../../../../core/models/room.model';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-room-row',
  imports: [RuntimeTranslatePipe, RouterLink, LucideAngularModule, PlayerNameComponent, CzButtonDirective],
  templateUrl: './room-row.component.html',
  styleUrl: './room-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomRowComponent {
  readonly lockedRoomTooltip = 'You are already in a room. Leave it before joining another one.';

  readonly room = input.required<Room>();
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly currentUserId = input<string | null>(null);
  readonly currentRoomId = input<string | null>(null);
  readonly actionsLocked = input(false);
  readonly deletingRoomId = input<string | null>(null);
  readonly leavingRoomId = input<string | null>(null);

  readonly opened = output<Room>();
  readonly left = output<Room>();
  readonly deleted = output<Room>();

  canDeleteRoom(room: Room): boolean {
    return !this.actionsLocked() && this.isRoomWaiting(room) && room.owner.id === this.currentUserId();
  }

  canLeaveRoom(room: Room): boolean {
    return this.isCurrentRoom(room);
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

  canJoinRoom(room: Room): boolean {
    return !this.actionsLocked() && room.visibility === 'public' && !room.gameId;
  }

  isCurrentUserInRoom(room: Room): boolean {
    return this.isCurrentRoom(room);
  }

  isCurrentRoom(room: Room): boolean {
    return this.currentRoomId() === room.id;
  }

  formatLabel(formatId: string): string {
    return this.formats().find((format) => format.id === formatId)?.name ?? formatId;
  }
}
