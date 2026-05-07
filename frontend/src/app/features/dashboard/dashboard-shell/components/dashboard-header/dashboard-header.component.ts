import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PageHeaderState } from '../../../../../core/ui/page-header.store';
import { DashboardHeaderContextComponent } from '../dashboard-header-context/dashboard-header-context.component';
import { DashboardHeaderControlsComponent } from '../dashboard-header-controls/dashboard-header-controls.component';

@Component({
  selector: 'app-dashboard-header',
  imports: [DashboardHeaderContextComponent, DashboardHeaderControlsComponent],
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent {
  readonly header = input<PageHeaderState | null>(null);
  readonly userLabel = input('Player');
  readonly friendsOpen = input(false);
  readonly pendingNotificationsCount = input(0);
  readonly onlineFriendsCount = input(0);
  readonly toggleFriends = output<MouseEvent>();
  readonly logout = output<void>();
}
