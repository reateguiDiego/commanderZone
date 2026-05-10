import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { appImageUrl } from '../../../core/assets/app-image-url';
import { UserAvatar } from '../../../core/models/user.model';

type PlayerAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const DEFAULT_INITIAL_BACKGROUND_COLOR = '#edcd83';
const DEFAULT_INITIAL_TEXT_COLOR = '#16120a';

@Component({
  selector: 'app-player-avatar',
  imports: [],
  templateUrl: './player-avatar.component.html',
  styleUrl: './player-avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerAvatarComponent {
  readonly displayName = input('Player');
  readonly avatar = input<UserAvatar | null | undefined>(null);
  readonly size = input<PlayerAvatarSize>('md');
  readonly premium = input(false);

  readonly imageUrl = computed(() => appImageUrl(this.avatar()?.imageUrl ?? null));
  readonly initialLetter = computed(() => {
    const configuredLetter = this.avatar()?.initial?.letter?.trim();
    if (configuredLetter) {
      return configuredLetter.slice(0, 2).toUpperCase();
    }

    return this.displayName().trim().slice(0, 1).toUpperCase() || 'P';
  });
  readonly initialBackground = computed(() => this.avatar()?.initial?.backgroundColor ?? DEFAULT_INITIAL_BACKGROUND_COLOR);
  readonly initialColor = computed(() => this.avatar()?.initial?.textColor ?? DEFAULT_INITIAL_TEXT_COLOR);
}
