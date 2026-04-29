import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { FriendListRow } from '../data-access/friends.store';
import { FriendsStore } from '../data-access/friends.store';

@Component({
  selector: 'app-friends-dropdown',
  imports: [FormsModule, LucideAngularModule],
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
      case 'pending':
        void this.store.cancelRequest(row.id);
        return;
      case 'friend':
        void this.store.removeFriend(row.id);
        return;
    }
  }

  declineIncoming(row: FriendListRow): void {
    if (row.kind !== 'incoming') {
      return;
    }

    void this.store.declineRequest(row.id);
  }
}
