import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SeoLocaleCode } from '../../../../core/localization/locale-config';
import { getPublicChromeCopy } from '../../../../core/localization/public-chrome-copy';
import { LandingLocaleLink } from '../../models/seo-landing-content.model';

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
  readonly copy = computed(() => getPublicChromeCopy(this.currentLocale()).languageSelector);

  isCurrentLocale(locale: SeoLocaleCode): boolean {
    return locale === this.currentLocale();
  }

  localeBadge(locale: SeoLocaleCode): string {
    return locale.toUpperCase();
  }
}
