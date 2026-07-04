import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { UserAvatar, UserDisplayNameStyle } from '../../../core/models/user.model';
import { AppThemeAssetsService } from '../../../core/theme/app-theme-assets.service';
import { communityUserProfilePath, shouldOpenCommunityProfileInNewTab } from '../player-profile-navigation';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../player-name/player-name.component';
import { TooltipComponent } from '../tooltip/tooltip.component';

export type PlayerInfoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface PlayerInfoSizeConfig {
  readonly avatarSize: PlayerInfoSize;
  readonly nameSize: PlayerInfoSize;
  readonly plateSize: PlayerInfoSize;
}

const SIZE_CONFIG: Record<PlayerInfoSize, PlayerInfoSizeConfig> = {
  xs: { avatarSize: 'xs', nameSize: 'xs', plateSize: 'xs' },
  sm: { avatarSize: 'sm', nameSize: 'sm', plateSize: 'xs' },
  md: { avatarSize: 'md', nameSize: 'md', plateSize: 'sm' },
  lg: { avatarSize: 'lg', nameSize: 'lg', plateSize: 'md' },
  xl: { avatarSize: 'xl', nameSize: 'xl', plateSize: 'lg' },
};

@Component({
  selector: 'app-player-info',
  imports: [RuntimeTranslatePipe, PlayerAvatarComponent, PlayerNameComponent, TooltipComponent],
  templateUrl: './player-info.component.html',
  styleUrl: './player-info.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerInfoComponent {
  private readonly auth = inject(AuthStore, { optional: true });
  private readonly router = inject(Router, { optional: true });
  readonly themeAssets = inject(AppThemeAssetsService);
  readonly displayName = input('Player');
  readonly avatar = input<UserAvatar | null | undefined>(null);
  readonly nameStyle = input<UserDisplayNameStyle | null | undefined>(null);
  readonly size = input<PlayerInfoSize>('md');
  readonly interactive = input(true);
  readonly profileUserId = input<string | null | undefined>(null);
  readonly profileUsername = input<string | null | undefined>(null);
  readonly profileCanonicalPath = input<string | null | undefined>(null);
  readonly avatarSelected = output<MouseEvent>();
  readonly nameSelected = output<MouseEvent>();

  readonly sizeConfig = computed(() => SIZE_CONFIG[this.size()]);
  readonly isCommanderZoneIdentity = computed(() => this.displayName().trim() === 'CommanderZone');
  readonly profileNavigationTooltip = computed(() => this.canNavigateToPublicProfile() ? 'View profile' : null);

  handleAvatarSelected(event: MouseEvent): void {
    if (this.navigateToPublicProfile(event)) {
      return;
    }

    this.avatarSelected.emit(event);
  }

  handleNameSelected(event: MouseEvent): void {
    if (this.navigateToPublicProfile(event)) {
      return;
    }

    this.nameSelected.emit(event);
  }

  private navigateToPublicProfile(event: MouseEvent): boolean {
    const path = this.publicProfilePath();
    const router = this.router;
    if (!path || this.isCurrentUserProfile() || !router) {
      return false;
    }

    event.stopPropagation();
    if (shouldOpenCommunityProfileInNewTab(router.url) && typeof window !== 'undefined') {
      window.open(path, '_blank', 'noopener');
    } else {
      void router.navigateByUrl(path);
    }
    return true;
  }

  private canNavigateToPublicProfile(): boolean {
    return this.publicProfilePath() !== null && !this.isCurrentUserProfile() && this.router !== null;
  }

  private isCurrentUserProfile(): boolean {
    const profileUserId = this.profileUserId()?.trim();
    return profileUserId !== '' && profileUserId === this.auth?.user()?.id;
  }

  private publicProfilePath(): string | null {
    return communityUserProfilePath(this.profileCanonicalPath(), this.profileUsername());
  }
}
