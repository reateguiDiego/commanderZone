import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FullscreenService } from '../../../../../core/fullscreen/fullscreen.service';
import { UserAvatar, UserDisplayNameStyle } from '../../../../../core/models/user.model';
import { PlayerAvatarComponent } from '../../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { FriendsDropdownComponent } from '../../../../friends/friends-dropdown/friends-dropdown.component';
import { DashboardSettingsModalComponent } from './components/dashboard-settings-modal/dashboard-settings-modal.component';
import { HeaderUserMenuComponent } from './components/header-user-menu/header-user-menu.component';

@Component({
  selector: 'app-dashboard-header-controls',
  imports: [
    LucideAngularModule,
    PlayerAvatarComponent,
    PlayerNameComponent,
    FriendsDropdownComponent,
    HeaderUserMenuComponent,
    DashboardSettingsModalComponent,
  ],
  templateUrl: './dashboard-header-controls.component.html',
  styleUrl: './dashboard-header-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderControlsComponent {
  private readonly fullscreen = inject(FullscreenService);
  readonly userLabel = input('Player');
  readonly userAvatar = input<UserAvatar | null | undefined>(null);
  readonly userNameStyle = input<UserDisplayNameStyle | null | undefined>(null);
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

  async toggleFullscreen(): Promise<void> {
    await this.fullscreen.toggleFullscreen();
  }
}
