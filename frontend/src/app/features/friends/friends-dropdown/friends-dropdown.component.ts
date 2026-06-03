import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerAvatarComponent } from '../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../shared/ui/player-name/player-name.component';
import { FriendListRow } from '../data-access/friends.store';
import { FriendsStore } from '../data-access/friends.store';

@Component({
  selector: 'app-friends-dropdown',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, PrettyScrollDirective, PlayerAvatarComponent, PlayerNameComponent],
  templateUrl: './friends-dropdown.component.html',
  styleUrl: './friends-dropdown.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendsDropdownComponent {
  readonly store = inject(FriendsStore);

  runPrimaryAction(row: FriendListRow): void {
    switch (row.kind) {
      case 'incoming':
        void this.store.acceptRequest(row.id);
        return;
      case 'room-invite':
        void this.store.acceptRoomInvite(row.id);
        return;
      case 'pending':
        void this.store.cancelRequest(row.id);
        return;
      case 'friend':
        void this.store.removeFriend(row.id);
        return;
    }
  }

  declineIncoming(row: FriendListRow): void {
    if (row.kind === 'incoming') {
      void this.store.declineRequest(row.id);
    }

    if (row.kind === 'room-invite') {
      void this.store.declineRoomInvite(row.id);
    }
  }
}
