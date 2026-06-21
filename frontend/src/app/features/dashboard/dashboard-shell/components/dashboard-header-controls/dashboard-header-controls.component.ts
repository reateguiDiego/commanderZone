import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, input, output, signal, viewChild } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FullscreenService } from '../../../../../core/fullscreen/fullscreen.service';
import { UserAvatar, UserDisplayNameStyle } from '../../../../../core/models/user.model';
import { PlayerInfoComponent } from '../../../../../shared/ui/player-info/player-info.component';
import { FriendsDropdownComponent } from '../../../../friends/friends-dropdown/friends-dropdown.component';
import { DashboardSettingsModalComponent, SettingsLaunchTarget } from './components/dashboard-settings-modal/dashboard-settings-modal.component';
import { HeaderUserMenuComponent } from './components/header-user-menu/header-user-menu.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';

@Component({
  selector: 'app-dashboard-header-controls',
  imports: [
    RuntimeTranslatePipe,
    LucideAngularModule,
    PlayerInfoComponent,
    FriendsDropdownComponent,
    HeaderUserMenuComponent,
    DashboardSettingsModalComponent,
    CzButtonDirective,
  ],
  templateUrl: './dashboard-header-controls.component.html',
  styleUrl: './dashboard-header-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderControlsComponent {
  private readonly fullscreen = inject(FullscreenService);
  private readonly headerUserMenu = viewChild(HeaderUserMenuComponent);
  readonly device = inject(DeviceProfileService);
  readonly userLabel = input('Player');
  readonly userAvatar = input<UserAvatar | null | undefined>(null);
  readonly userNameStyle = input<UserDisplayNameStyle | null | undefined>(null);
  readonly friendsOpen = input(false);
  readonly pendingNotificationsCount = input(0);
  readonly onlineFriendsCount = input(0);
  readonly toggleFriends = output<MouseEvent>();
  readonly closeFriends = output<void>();
  readonly logout = output<void>();
  readonly settingsOpen = signal(false);
  readonly settingsLaunchTarget = signal<SettingsLaunchTarget>('general');

  toggleFriendsDropdown(event: MouseEvent): void {
    this.closeSettings();
    this.headerUserMenu()?.closeMenu();
    this.toggleFriends.emit(event);
  }

  handleUserMenuOpened(): void {
    this.closeSettings();
    this.closeFriends.emit();
  }

  openSettings(target: SettingsLaunchTarget = 'general'): void {
    this.closeFriends.emit();
    this.headerUserMenu()?.closeMenu();
    this.settingsLaunchTarget.set(target);
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
    this.settingsLaunchTarget.set('general');
  }

  logoff(): void {
    this.closeSettings();
    this.logout.emit();
  }

  async toggleFullscreen(): Promise<void> {
    await this.fullscreen.toggleFullscreen();
  }
}
