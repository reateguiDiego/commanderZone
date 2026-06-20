import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckFormat } from '../../../../../core/models/deck.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, CurrentRoomTurn, CurrentRoomViewerRole, Room } from '../../../../../core/models/room.model';
import { FormatSelectComponent, type FormatSelectOption } from '../../../../../shared/components/format-select/format-select.component';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { RoomCurrentBannerComponent } from '../room-current-banner/room-current-banner.component';
import { RoomRowComponent } from '../room-row/room-row.component';

@Component({
  selector: 'app-room-browser',
  imports: [RuntimeTranslatePipe, FormsModule, PrettyScrollDirective, FormatSelectComponent, RoomCurrentBannerComponent, RoomRowComponent],
  templateUrl: './room-browser.component.html',
  styleUrl: './room-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomBrowserComponent {
  readonly rooms = input<readonly Room[]>([]);
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly currentUserId = input<string | null>(null);
  readonly currentRoomId = input<string | null>(null);
  readonly currentRoom = input<CurrentRoomSummary | null>(null);
  readonly currentRoomPlayer = input<CurrentRoomPlayerSummary | null>(null);
  readonly currentRoomTurn = input<CurrentRoomTurn | null>(null);
  readonly currentRoomViewerRole = input<CurrentRoomViewerRole | null>(null);
  readonly deletingRoomId = input<string | null>(null);
  readonly leavingRoomId = input<string | null>(null);

  readonly listedRoomOpened = output<Room>();
  readonly leaveRequested = output<Room>();
  readonly currentRoomLeaveRequested = output<string>();
  readonly deleteRequested = output<Room>();

  readonly roomNameFilter = signal('');
  readonly roomOwnerFilter = signal('');
  readonly visibilityFilter = signal<'all' | 'public' | 'private'>('all');
  readonly statusFilter = signal<'all' | 'open' | 'full' | 'started'>('all');
  readonly formatFilter = signal('all');
  readonly visibilityFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', labelKey: 'rooms.roomBrowser.publicAndPrivate' },
    { id: 'public', labelKey: 'rooms.roomBrowser.publicOnly' },
    { id: 'private', labelKey: 'rooms.roomBrowser.privateOnly' },
  ];
  readonly statusFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', labelKey: 'rooms.roomBrowser.publicAndPrivate' },
    { id: 'open', labelKey: 'rooms.roomBrowser.open' },
    { id: 'full', labelKey: 'rooms.roomBrowser.full' },
    { id: 'started', labelKey: 'rooms.roomBrowser.started' },
  ];

  readonly filteredRooms = computed(() => {
    const nameFilter = this.normalizeFilter(this.roomNameFilter());
    const ownerFilter = this.normalizeFilter(this.roomOwnerFilter());
    const visibilityFilter = this.visibilityFilter();
    const statusFilter = this.statusFilter();
    const formatFilter = this.formatFilter();

    return [...this.rooms()]
      .filter((room) => {
        if (this.currentRoom()?.id === room.id) {
          return false;
        }

        const matchesName = !nameFilter || this.normalizeFilter(room.name).includes(nameFilter);
        const matchesOwner = !ownerFilter || this.normalizeFilter(room.owner.displayName).includes(ownerFilter);
        const matchesVisibility = visibilityFilter === 'all' || room.visibility === visibilityFilter;
        const matchesStatus = statusFilter === 'all' || this.statusKey(room) === statusFilter;
        const matchesFormat = formatFilter === 'all' || room.format === formatFilter;

        return matchesName && matchesOwner && matchesVisibility && matchesStatus && matchesFormat;
      })
      .sort((left, right) => this.roomSortRank(left) - this.roomSortRank(right) || left.name.localeCompare(right.name));
  });

  setVisibilityFilter(value: string): void {
    if (value === 'public' || value === 'private' || value === 'all') {
      this.visibilityFilter.set(value);
    }
  }

  setStatusFilter(value: string): void {
    if (value === 'open' || value === 'full' || value === 'started' || value === 'all') {
      this.statusFilter.set(value);
    }
  }

  private statusKey(room: Room): 'open' | 'full' | 'started' {
    if (room.status === 'started' || room.gameId) {
      return 'started';
    }

    return this.roomPlayerCount(room) >= this.roomCapacity(room) ? 'full' : 'open';
  }

  private normalizeFilter(value: string): string {
    return value.trim().toLowerCase();
  }

  private roomSortRank(room: Room): number {
    const visibilityRank = room.visibility === 'public' ? 0 : 100;
    const statusRank = { open: 0, full: 10, started: 20 }[this.statusKey(room)];

    return visibilityRank + statusRank;
  }

  private roomCapacity(room: Room): number {
    const maxPlayers = Number(room.maxPlayers);

    return Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 6 ? maxPlayers : 4;
  }

  private roomPlayerCount(room: Room): number {
    return Array.isArray(room.players) ? room.players.length : 0;
  }

}
