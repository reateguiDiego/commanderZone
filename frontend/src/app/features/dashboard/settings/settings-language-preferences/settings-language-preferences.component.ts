import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CardLanguageCoverage } from '../../../../core/api/cards-language.service';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { SupportedCardLanguageCode, SupportedLanguageCode } from '../../../../core/localization/language-preferences';
import { FormatSelectComponent, FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';

@Component({
  selector: 'app-settings-language-preferences',
  imports: [FormatSelectComponent],
  templateUrl: './settings-language-preferences.component.html',
  styleUrl: './settings-language-preferences.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLanguagePreferencesComponent {
  private readonly i18n = inject(AppShellI18nService);

  readonly cardLanguageOptions = input.required<readonly FormatSelectOption[]>();
  readonly appLanguageOptions = input.required<readonly FormatSelectOption[]>();
  readonly cardLanguageCoverage = input.required<readonly CardLanguageCoverage[]>();
  readonly cardLanguage = input.required<SupportedCardLanguageCode>();
  readonly appLanguage = input.required<SupportedLanguageCode>();

  readonly cardLanguageChange = output<string>();
  readonly appLanguageChange = output<string>();

  readonly cardLanguageLabel = computed(() => this.i18n.text('cardLanguage'));
  readonly appLanguageLabel = computed(() => this.i18n.text('appLanguage'));
  readonly selectedCardLanguageCoverage = computed(() =>
    this.cardLanguageCoverage().find((language) => language.code === this.cardLanguage()) ?? null,
  );
  readonly cardLanguageDisclaimer = computed(() => {
    const selectedCoverage = this.selectedCardLanguageCoverage();

    if (this.cardLanguage() === 'en' || selectedCoverage === null) {
      return null;
    }

    const languageName = this.i18n.languageName(selectedCoverage.code);

    return this.i18n.cardLanguageFallbackDisclaimer(selectedCoverage.percentageOfEnglish, languageName);
  });
}
