export const SUPPORTED_LOCALES = [
  { code: 'es', hreflang: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'en', hreflang: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'de', hreflang: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'fr', hreflang: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'it', hreflang: 'it', label: 'Italian', nativeLabel: 'Italiano' },
  { code: 'pt', hreflang: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'ja', hreflang: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { code: 'ko', hreflang: 'ko', label: 'Korean', nativeLabel: '한국어' },
  { code: 'zh-hans', hreflang: 'zh-Hans', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { code: 'zh-hant', hreflang: 'zh-Hant', label: 'Chinese (Traditional)', nativeLabel: '繁體中文' },
  { code: 'nl', hreflang: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
  { code: 'ca', hreflang: 'ca', label: 'Catalan', nativeLabel: 'Català' },
  { code: 'ru', hreflang: 'ru', label: 'Russian', nativeLabel: 'Русский' },
] as const;

export type LocaleCode = typeof SUPPORTED_LOCALES[number]['code'];
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];
export const SUPPORTED_LOCALE_CODES = SUPPORTED_LOCALES.map((locale) => locale.code);
export const SEO_LOCALE_CODES = ['en', 'es', 'de', 'fr', 'pt', 'it'] as const satisfies readonly LocaleCode[];
export type SeoLocaleCode = typeof SEO_LOCALE_CODES[number];
export type SeoLocale = Extract<SupportedLocale, { readonly code: SeoLocaleCode }>;
export const SEO_LOCALES = SEO_LOCALE_CODES.map((code) => {
  const locale = SUPPORTED_LOCALES.find((supportedLocale): supportedLocale is SeoLocale => supportedLocale.code === code);

  if (!locale) {
    throw new Error(`Missing SEO locale config for ${code}.`);
  }

  return locale;
});
export const SEO_DEFAULT_LOCALE = SEO_LOCALES[0];

export function isSupportedLocale(locale: string | null | undefined): locale is LocaleCode {
  return typeof locale === 'string' && SUPPORTED_LOCALE_CODES.includes(locale as LocaleCode);
}

export function isSeoLocale(locale: string | null | undefined): locale is SeoLocaleCode {
  return typeof locale === 'string' && SEO_LOCALE_CODES.includes(locale as SeoLocaleCode);
}

export function getLocaleByCode(locale: string | null | undefined): SupportedLocale | undefined {
  return SUPPORTED_LOCALES.find((supportedLocale) => supportedLocale.code === locale);
}

export function getDefaultLocale(): SupportedLocale {
  return DEFAULT_LOCALE;
}

export function getLocaleHreflang(locale: LocaleCode): SupportedLocale['hreflang'] {
  return getLocaleByCode(locale)?.hreflang ?? DEFAULT_LOCALE.hreflang;
}
