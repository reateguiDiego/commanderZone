import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { publicAssetUrl } from '../../../core/assets/app-image-url';
import { UserDisplayNameStyle } from '../../../core/models/user.model';
import { DEFAULT_PREMIUM_NAME_COLOR, displayNameStylePreset } from '../../../core/profile/display-name-style-presets';

type PlayerNameSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type PlayerNameLengthClass = 'name-length-short' | 'name-length-medium' | 'name-length-long' | 'name-length-extra-long';

function visibleCharacterCount(value: string): number {
  return Array.from(value).length;
}

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
  readonly lengthClass = computed<PlayerNameLengthClass>(() => {
    const length = visibleCharacterCount(this.label());

    if (length >= 22) {
      return 'name-length-extra-long';
    }

    if (length >= 18) {
      return 'name-length-long';
    }

    if (length >= 13) {
      return 'name-length-medium';
    }

    return 'name-length-short';
  });
  readonly classValue = computed(() => {
    const fillClass = this.fill() ? ' fill' : '';

    return `player-name-shell size-${this.size()} name-style-${this.preset().id} ${this.lengthClass()}${fillClass}`;
  });
  readonly textColor = computed(() => this.nameStyle()?.textColor ?? DEFAULT_PREMIUM_NAME_COLOR);
  readonly nameplateUrl = computed(() => {
    const assetPath = this.preset().assetPath;

    return assetPath ? publicAssetUrl(assetPath) : null;
  });
}
