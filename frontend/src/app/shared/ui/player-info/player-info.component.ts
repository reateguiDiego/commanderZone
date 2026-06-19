import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { UserAvatar, UserDisplayNameStyle } from '../../../core/models/user.model';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../player-name/player-name.component';

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
  imports: [PlayerAvatarComponent, PlayerNameComponent],
  templateUrl: './player-info.component.html',
  styleUrl: './player-info.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerInfoComponent {
  readonly displayName = input('Player');
  readonly avatar = input<UserAvatar | null | undefined>(null);
  readonly nameStyle = input<UserDisplayNameStyle | null | undefined>(null);
  readonly size = input<PlayerInfoSize>('md');
  readonly avatarSelected = output<MouseEvent>();
  readonly nameSelected = output<MouseEvent>();

  readonly sizeConfig = computed(() => SIZE_CONFIG[this.size()]);
}
