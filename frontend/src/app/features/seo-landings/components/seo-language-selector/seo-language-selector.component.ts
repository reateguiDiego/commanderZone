import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LocaleCode } from '../../../../core/localization/locale-config';
import { LandingLocaleLink } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-seo-language-selector',
  templateUrl: './seo-language-selector.component.html',
  styleUrl: './seo-language-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLanguageSelectorComponent {
  readonly currentLocale = input.required<LocaleCode>();
  readonly links = input.required<readonly LandingLocaleLink[]>();

  isCurrentLocale(locale: LocaleCode): boolean {
    return locale === this.currentLocale();
  }
}
