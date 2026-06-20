import { Injectable, effect, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LocaleCode, SUPPORTED_LOCALES } from './locale-config';
import { LANGUAGE_OPTIONS, SupportedLanguageCode } from './language-preferences';
import { LanguagePreferencesService } from './language-preferences.service';
import { TranslationService } from './translation.service';

export interface HybridLanguageOption {
  readonly code: SupportedLanguageCode;
  readonly locale: LocaleCode;
  readonly label: string;
  readonly flagAsset: string;
}

const RUNTIME_LANGUAGE_BY_LOCALE = {
  es: 'es',
  en: 'en',
  de: 'de',
  fr: 'fr',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  'zh-hans': 'zhs',
  nl: 'nl',
  ca: 'ca',
  ru: 'ru',
} as const satisfies Record<LocaleCode, SupportedLanguageCode>;

const LOCALE_BY_RUNTIME_LANGUAGE = Object.fromEntries(
  Object.entries(RUNTIME_LANGUAGE_BY_LOCALE).map(([locale, language]) => [language, locale]),
) as Record<SupportedLanguageCode, LocaleCode>;

export const HYBRID_LANGUAGE_OPTIONS: readonly HybridLanguageOption[] = SUPPORTED_LOCALES.map((locale) => {
  const code = RUNTIME_LANGUAGE_BY_LOCALE[locale.code];
  const languageOption = getLanguageOption(code);

  return {
    code,
    locale: locale.code,
    label: locale.nativeLabel,
    flagAsset: languageOption.flagAsset,
  };
});

export function toRuntimeLocale(languageCode: SupportedLanguageCode): LocaleCode {
  return LOCALE_BY_RUNTIME_LANGUAGE[languageCode];
}

export function toRuntimeLanguageCode(locale: LocaleCode): SupportedLanguageCode {
  return RUNTIME_LANGUAGE_BY_LOCALE[locale];
}

@Injectable({ providedIn: 'root' })
export class RuntimeLanguageSelectorService {
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly translation = inject(TranslationService);
  private lastAppliedLocale: LocaleCode | undefined;

  readonly selectedLanguage = this.languagePreferences.appLanguage;
  readonly languageOptions = HYBRID_LANGUAGE_OPTIONS;

  constructor() {
    effect(() => this.applyRuntimeLocale(this.selectedLanguage()));
  }

  async selectLanguage(languageCode: SupportedLanguageCode): Promise<void> {
    if (languageCode === this.selectedLanguage()) {
      return;
    }

    await this.languagePreferences.updatePreferences({
      cardLanguage: languageCode,
      appLanguage: languageCode,
    });
    this.applyRuntimeLocale(languageCode);
  }

  applyLanguage(languageCode: SupportedLanguageCode): void {
    this.applyRuntimeLocale(languageCode);
  }

  private applyRuntimeLocale(languageCode: SupportedLanguageCode): void {
    const locale = toRuntimeLocale(languageCode);

    if (locale === this.lastAppliedLocale) {
      return;
    }

    this.lastAppliedLocale = locale;
    void firstValueFrom(this.translation.useLocale(locale)).catch(() => undefined);
  }
}

function getLanguageOption(code: SupportedLanguageCode): (typeof LANGUAGE_OPTIONS)[number] {
  const languageOption = LANGUAGE_OPTIONS.find((option) => option.code === code);

  if (!languageOption) {
    throw new Error(`Missing runtime language option for ${code}.`);
  }

  return languageOption;
}
