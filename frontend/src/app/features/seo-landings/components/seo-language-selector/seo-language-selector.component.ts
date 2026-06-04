import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SeoLocaleCode } from '../../../../core/localization/locale-config';
import { LandingLocaleLink } from '../../models/seo-landing-content.model';

const FLAG_ASSET_BY_LOCALE = {
  es: '/assets/icons/flags/spain.png',
  en: '/assets/icons/flags/uk.png',
  de: '/assets/icons/flags/germany.png',
  fr: '/assets/icons/flags/france.png',
  it: '/assets/icons/flags/italy.png',
  pt: '/assets/icons/flags/portugal.png',
} as const satisfies Record<SeoLocaleCode, string>;

@Component({
  selector: 'app-seo-language-selector',
  templateUrl: './seo-language-selector.component.html',
  styleUrl: './seo-language-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLanguageSelectorComponent {
  readonly currentLocale = input.required<SeoLocaleCode>();
  readonly links = input.required<readonly LandingLocaleLink[]>();
  readonly currentLink = computed(() => this.links().find((link) => this.isCurrentLocale(link.locale)) ?? this.links()[0]);

  isCurrentLocale(locale: SeoLocaleCode): boolean {
    return locale === this.currentLocale();
  }

  flagAsset(locale: SeoLocaleCode): string {
    return FLAG_ASSET_BY_LOCALE[locale];
  }
}
