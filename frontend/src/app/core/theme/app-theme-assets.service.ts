import { Injectable, computed, inject } from '@angular/core';
import { AppThemeService } from './app-theme.service';

const CZ_LOGO = '/assets/icons/CZ/CZ_logo.webp';
const CZ_LOGO_BLACK = '/assets/icons/CZ/CZ_logo_black.webp';
const CZ_ZONE_HEADER_LOGO = '/assets/icons/CZ/CZ_logo_zone_header.webp';
const CZ_ZONE_HEADER_LOGO_BLACK = '/assets/icons/CZ/CZ_logo_zone_header_black.webp';
const CZ_CARDS_ICON = '/assets/icons/CZ/CZ_cards_icon.webp';
const CZ_CARDS_ICON_BLACK = '/assets/icons/CZ/CZ_cards_icon_black.webp';

@Injectable({ providedIn: 'root' })
export class AppThemeAssetsService {
  private readonly appTheme = inject(AppThemeService);
  private readonly usesBlackCzAssets = computed(() => this.appTheme.themeId() === 'candy-summoners');

  readonly czLogoUrl = computed(() => (this.usesBlackCzAssets() ? CZ_LOGO_BLACK : CZ_LOGO));
  readonly czZoneHeaderLogoUrl = computed(() =>
    this.usesBlackCzAssets() ? CZ_ZONE_HEADER_LOGO_BLACK : CZ_ZONE_HEADER_LOGO,
  );
  readonly czCardsIconUrl = computed(() => (this.usesBlackCzAssets() ? CZ_CARDS_ICON_BLACK : CZ_CARDS_ICON));
}
