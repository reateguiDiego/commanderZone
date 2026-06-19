import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { publicAssetUrl } from '../../../core/assets/app-image-url';
import { UserDisplayNameStyle } from '../../../core/models/user.model';
import { DEFAULT_PREMIUM_NAME_COLOR, displayNameStylePreset } from '../../../core/profile/display-name-style-presets';

type PlayerNameSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type PlayerNamePlateSize = 'micro' | PlayerNameSize;
type PlayerNameAlign = 'center' | 'left';
type PlayerNameLengthClass =
  | 'name-length-tiny'
  | 'name-length-short'
  | 'name-length-medium'
  | 'name-length-long'
  | 'name-length-extra-long'
  | 'name-length-ultra';

interface PlayerNamePlateMetrics {
  readonly width: string;
  readonly height: string;
  readonly labelWidth: string;
  readonly padding: string;
}

const PLATE_METRICS: Record<PlayerNamePlateSize, PlayerNamePlateMetrics> = {
  micro: {
    width: '8.6rem',
    height: '2.15rem',
    labelWidth: 'calc(100% - 2.65rem)',
    padding: '0.28rem 1.15rem',
  },
  xs: {
    width: '10.4rem',
    height: '2.6rem',
    labelWidth: 'calc(100% - 3rem)',
    padding: '0.32rem 1.3rem',
  },
  sm: {
    width: '12rem',
    height: '3rem',
    labelWidth: 'calc(100% - 3.25rem)',
    padding: '0.38rem 1.45rem',
  },
  md: {
    width: '14.5rem',
    height: '3.64rem',
    labelWidth: 'calc(100% - 3.8rem)',
    padding: '0.45rem 1.8rem',
  },
  lg: {
    width: '17.2rem',
    height: '4.3rem',
    labelWidth: 'calc(100% - 4.45rem)',
    padding: '0.5rem 2rem',
  },
  xl: {
    width: '20rem',
    height: '5rem',
    labelWidth: 'calc(100% - 5.2rem)',
    padding: '0.6rem 2.35rem',
  },
};

function visibleCharacterCount(value: string): number {
  return Array.from(value).length;
}

function lengthClass(length: number): PlayerNameLengthClass {
  if (length >= 23) {
    return 'name-length-ultra';
  }

  if (length >= 19) {
    return 'name-length-extra-long';
  }

  if (length >= 15) {
    return 'name-length-long';
  }

  if (length >= 11) {
    return 'name-length-medium';
  }

  if (length >= 7) {
    return 'name-length-short';
  }

  return 'name-length-tiny';
}

function fontSizeForLength(length: number): string {
  if (length >= 23) {
    return '0.44rem';
  }

  if (length >= 19) {
    return '0.5rem';
  }

  if (length >= 15) {
    return '0.58rem';
  }

  if (length >= 11) {
    return '0.68rem';
  }

  if (length >= 7) {
    return '0.82rem';
  }

  return '0.92rem';
}

function plainFontSizeForLength(length: number): string {
  if (length >= 23) {
    return '0.72rem';
  }

  if (length >= 19) {
    return '0.82rem';
  }

  if (length >= 15) {
    return '0.96rem';
  }

  if (length >= 11) {
    return '1.12rem';
  }

  if (length >= 7) {
    return '1.28rem';
  }

  return '1.56rem';
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
  /**
   * `size` remains as the plain text size. Nameplate image dimensions are
   * controlled by `plateSize` or the explicit plate inputs below.
   */
  readonly size = input<PlayerNameSize>('md');
  readonly plateSize = input<PlayerNamePlateSize | null>(null);
  readonly plateWidth = input<string | null>(null);
  readonly plateHeight = input<string | null>(null);
  readonly plateLabelWidth = input<string | null>(null);
  readonly platePadding = input<string | null>(null);
  readonly fill = input(false);
  readonly align = input<PlayerNameAlign>('center');

  readonly preset = computed(() => displayNameStylePreset(this.nameStyle()));
  readonly label = computed(() => this.displayName().trim() || 'Player');
  readonly labelLength = computed(() => visibleCharacterCount(this.label()));
  readonly premium = computed(() => this.preset().tier === 'premium');
  readonly hasNameplate = computed(() => Boolean(this.preset().assetPath));
  readonly resolvedPlateSize = computed<PlayerNamePlateSize>(() => this.plateSize() ?? this.size());
  readonly plateMetrics = computed(() => PLATE_METRICS[this.resolvedPlateSize()]);
  readonly lengthClass = computed<PlayerNameLengthClass>(() => lengthClass(this.labelLength()));
  readonly nameplateFontSize = computed(() => fontSizeForLength(this.labelLength()));
  readonly plainFontSize = computed(() => plainFontSizeForLength(this.labelLength()));
  readonly plateWidthValue = computed(() => this.plateWidth()?.trim() || this.plateMetrics().width);
  readonly plateHeightValue = computed(() => this.plateHeight()?.trim() || this.plateMetrics().height);
  readonly plateLabelWidthValue = computed(() => this.plateLabelWidth()?.trim() || this.plateMetrics().labelWidth);
  readonly platePaddingValue = computed(() => this.platePadding()?.trim() || this.plateMetrics().padding);
  readonly classValue = computed(() => {
    const fillClass = this.fill() ? ' fill' : '';
    const alignClass = ` align-${this.align()}`;

    return `player-name-shell size-${this.size()} plate-size-${this.resolvedPlateSize()} name-style-${this.preset().id} ${this.lengthClass()}${fillClass}${alignClass}`;
  });
  readonly textColor = computed(() => this.nameStyle()?.textColor ?? DEFAULT_PREMIUM_NAME_COLOR);
  readonly nameplateUrl = computed(() => {
    const assetPath = this.preset().assetPath;

    return assetPath ? publicAssetUrl(assetPath) : null;
  });
}
