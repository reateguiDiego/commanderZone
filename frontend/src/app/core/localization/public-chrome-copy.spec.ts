import { SEO_LOCALE_CODES } from './locale-config';
import { getPublicChromeCopy } from './public-chrome-copy';

describe('public chrome copy', () => {
  it('localizes public chrome labels for every SEO locale', () => {
    expect(getPublicChromeCopy('en').languageSelector.label).toBe('Language');
    expect(getPublicChromeCopy('es').languageSelector.label).toBe('Idioma');
    expect(getPublicChromeCopy('de').languageSelector.label).toBe('Sprache');
    expect(getPublicChromeCopy('fr').languageSelector.label).toBe('Langue');
    expect(getPublicChromeCopy('pt').languageSelector.label).toBe('Idioma');
    expect(getPublicChromeCopy('it').languageSelector.label).toBe('Lingua');

    for (const locale of SEO_LOCALE_CODES) {
      const copy = getPublicChromeCopy(locale);
      expect(copy.footer.links.map((link) => link.href).every((href) => href.startsWith('/'))).toBe(true);
      expect(copy.footer.links).toHaveLength(7);
    }
  });

  it('does not expose fixed English cookie chrome in non-English locales', () => {
    const forbiddenEnglish = [
      /\bCookie preferences\b/,
      /\bReject\b/,
      /\bAccept\b/,
      /\bprivacy policy\b/,
    ];

    for (const locale of ['es', 'de', 'fr', 'pt', 'it'] as const) {
      const copy = getPublicChromeCopy(locale);
      const visibleChrome = [
        copy.languageSelector.label,
        copy.cookieBanner.title,
        copy.cookieBanner.copyStart,
        copy.cookieBanner.privacyPolicyLabel,
        copy.cookieBanner.cookiePolicyLabel,
        copy.cookieBanner.reject,
        copy.cookieBanner.accept,
        copy.disclaimer.heading,
        copy.disclaimer.text,
        ...copy.footer.links.map((link) => link.label),
      ].join(' ');

      for (const forbiddenPattern of forbiddenEnglish) {
        expect(visibleChrome).not.toMatch(forbiddenPattern);
      }
    }
  });
});
