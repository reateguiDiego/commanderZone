import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CardLanguageCoverage } from '../../../../core/api/cards-language.service';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { SupportedCardLanguageCode, SupportedLanguageCode } from '../../../../core/localization/language-preferences';
import { FormatSelectComponent, FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-settings-language-preferences',
  imports: [FormatSelectComponent, RuntimeTranslatePipe, CzButtonDirective],
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
  readonly passwordChangeDisabled = input(false);
  readonly passwordChangeInProgress = input(false);
  readonly passwordChangeSent = input(false);
  readonly passwordChangeError = input(false);

  readonly cardLanguageChange = output<string>();
  readonly appLanguageChange = output<string>();
  readonly themeChangeRequested = output<void>();
  readonly premiumRequested = output<void>();
  readonly passwordChangeRequested = output<void>();

  readonly cardLanguageLabel = computed(() => this.i18n.text('cardLanguage'));
  readonly appLanguageLabel = computed(() => this.i18n.text('appLanguage'));
  readonly passwordChangeLabelKey = computed(() => {
    if (this.passwordChangeInProgress()) {
      return 'settings.dashboardSettingsModal.sendingPasswordEmail';
    }

    return this.passwordChangeSent()
      ? 'settings.dashboardSettingsModal.passwordResetEmailSentShort'
      : 'settings.dashboardSettingsModal.changePassword';
  });
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
