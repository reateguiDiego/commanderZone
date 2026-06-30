import {
  getDefaultLocale,
  getLocaleByCode,
  getLocaleHreflang,
  isSupportedLocale,
  LocaleCode,
  SEO_DEFAULT_LOCALE,
  SEO_LOCALE_CODES,
  SEO_LOCALES,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
} from './locale-config';

describe('locale config', () => {
  const expectedLocaleCodes = [
    'es',
    'en',
    'de',
    'fr',
    'it',
    'pt',
    'ja',
    'zh-hans',
    'nl',
    'ca',
    'ru',
  ] as const satisfies readonly LocaleCode[];
  const nonSeoLocaleCodes = ['ja', 'zh-hans', 'nl', 'ca', 'ru'] as const;

  it('defines the supported locales in the approved order', () => {
    expect(SUPPORTED_LOCALE_CODES).toEqual(expectedLocaleCodes);
  });

  it('defines the SEO-indexable locales separately from runtime locales', () => {
    expect(SEO_LOCALE_CODES).toEqual(['en', 'es', 'de', 'fr', 'pt', 'it']);
    expect(SEO_LOCALES.map((locale) => locale.code)).toEqual([...SEO_LOCALE_CODES]);
    expect(SEO_DEFAULT_LOCALE.code).toBe('en');

    for (const locale of nonSeoLocaleCodes) {
      expect(SEO_LOCALE_CODES).not.toContain(locale);
      expect(SEO_LOCALES.map((seoLocale) => seoLocale.code)).not.toContain(locale);
    }
  });

  it('stores code, hreflang, label, and native label for every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(locale.code).toBeTruthy();
      expect(locale.hreflang).toBeTruthy();
      expect(locale.label).toBeTruthy();
      expect(locale.nativeLabel).toBeTruthy();
      expect(locale.nativeLabel).not.toMatch(/Ã|Â|Ð|Ñ|æ|ç®|ä¸/);
    }
  });

  it('does not contain duplicated locale codes or hreflang values', () => {
    const localeCodes = SUPPORTED_LOCALES.map((locale) => locale.code);
    const hreflangValues = SUPPORTED_LOCALES.map((locale) => locale.hreflang);

    expect(new Set(localeCodes).size).toBe(localeCodes.length);
    expect(new Set(hreflangValues).size).toBe(hreflangValues.length);
  });

  it('identifies supported locale codes', () => {
    expect(isSupportedLocale('es')).toBe(true);
    expect(isSupportedLocale('zh-hans')).toBe(true);
  });

  it('rejects unsupported or empty locale codes', () => {
    expect(isSupportedLocale('zhs')).toBe(false);
    expect(isSupportedLocale('zh')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('returns locales by code', () => {
    expect(getLocaleByCode('en')).toEqual({
      code: 'en',
      hreflang: 'en',
      label: 'English',
      nativeLabel: 'English',
    });
    expect(getLocaleByCode('zh-hans')?.hreflang).toBe('zh-Hans');
    expect(getLocaleByCode('unknown')).toBeUndefined();
  });

  it('returns the default locale', () => {
    expect(getDefaultLocale()).toEqual({
      code: 'es',
      hreflang: 'es',
      label: 'Spanish',
      nativeLabel: 'Español',
    });
  });

  it('returns hreflang values for supported locale codes', () => {
    expect(getLocaleHreflang('es')).toBe('es');
    expect(getLocaleHreflang('zh-hans')).toBe('zh-Hans');
  });
});
