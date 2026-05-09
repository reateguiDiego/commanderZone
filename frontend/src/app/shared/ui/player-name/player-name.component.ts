import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { publicAssetUrl } from '../../../core/assets/app-image-url';
import { UserDisplayNameStyle } from '../../../core/models/user.model';
import { DEFAULT_PREMIUM_NAME_COLOR, displayNameStylePreset } from '../../../core/profile/display-name-style-presets';

type PlayerNameSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-player-name',
  imports: [],
  templateUrl: './player-name.component.html',
  styleUrl: './player-name.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerNameComponent {
  readonly displayName = input('Player');
  readonly nameStyle = input<UserDisplayNameStyle | null | undefined>(undefined);
  readonly size = input<PlayerNameSize>('md');
  readonly fill = input(false);

  readonly preset = computed(() => displayNameStylePreset(this.nameStyle()));
  readonly label = computed(() => this.displayName().trim() || 'Player');
  readonly premium = computed(() => this.preset().tier === 'premium');
  readonly hasNameplate = computed(() => Boolean(this.preset().assetPath));
  readonly classValue = computed(() => `player-name-shell size-${this.size()} name-style-${this.preset().id}${this.fill() ? ' fill' : ''}`);
  readonly textColor = computed(() => this.nameStyle()?.textColor ?? DEFAULT_PREMIUM_NAME_COLOR);
  readonly nameplateUrl = computed(() => {
    const assetPath = this.preset().assetPath;

    return assetPath ? publicAssetUrl(assetPath) : null;
  });
}
