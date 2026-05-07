import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FriendsDropdownComponent } from '../../../../friends/friends-dropdown/friends-dropdown.component';

@Component({
  selector: 'app-dashboard-header-controls',
  imports: [LucideAngularModule, FriendsDropdownComponent],
  templateUrl: './dashboard-header-controls.component.html',
  styleUrl: './dashboard-header-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderControlsComponent {
  readonly userLabel = input('Player');
  readonly friendsOpen = input(false);
  readonly pendingNotificationsCount = input(0);
  readonly onlineFriendsCount = input(0);
  readonly toggleFriends = output<MouseEvent>();
  readonly logout = output<void>();
}
