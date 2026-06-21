import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AppThemeAssetsService } from '../../../../../core/theme/app-theme-assets.service';
import { UserAvatar, UserDisplayNameStyle } from '../../../../../core/models/user.model';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { DashboardHeaderControlsComponent } from '../dashboard-header-controls/dashboard-header-controls.component';

@Component({
  selector: 'app-dashboard-header',
  imports: [RuntimeTranslatePipe, RouterLink, RouterLinkActive, DashboardHeaderControlsComponent],
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent {
  readonly themeAssets = inject(AppThemeAssetsService);
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
}
