import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FriendsDropdownComponent } from '../../../../friends/friends-dropdown/friends-dropdown.component';
import { DashboardSettingsModalComponent } from './components/dashboard-settings-modal/dashboard-settings-modal.component';
import { HeaderUserMenuComponent } from './components/header-user-menu/header-user-menu.component';

@Component({
  selector: 'app-dashboard-header-controls',
  imports: [
    LucideAngularModule,
    FriendsDropdownComponent,
    HeaderUserMenuComponent,
    DashboardSettingsModalComponent,
  ],
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
  readonly settingsOpen = signal(false);

  openSettings(): void {
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  logoff(): void {
    this.closeSettings();
    this.logout.emit();
  }
}
