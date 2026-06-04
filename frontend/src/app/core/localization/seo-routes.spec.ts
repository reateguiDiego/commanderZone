import { SEO_LOCALE_CODES, SeoLocaleCode } from './locale-config';
import { PAGE_TRANSLATION_STRATEGIES } from './page-translation-strategy';
import {
  findSeoRouteByPath,
  getLocalizedRouteAlternates,
  getSeoPath,
  SEO_ROUTE_KEYS,
  SEO_ROUTES,
  SeoRouteKey,
} from './seo-routes';

describe('SEO routes', () => {
  const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'] as const;
  const approvedSeoRoutes = [
    'home',
    'playCommanderOnline',
    'playMagicOnlineWithFriends',
    'createCommanderRoom',
    'importCommanderDeck',
    'commanderDeckBuilder',
    'tableAssistant',
    'waysToPlayCommanderOnline',
    'howToPlayCommanderOnline',
    'faq',
  ] as const satisfies readonly SeoRouteKey[];
  const expectedCanonicalPaths = {
    home: {
      es: '/es/',
      en: '/',
      de: '/de/',
      fr: '/fr/',
      pt: '/pt/',
      it: '/it/',
    },
    playCommanderOnline: {
      es: '/es/jugar-commander-online/',
      en: '/en/play-commander-online/',
      de: '/de/commander-online-spielen/',
      fr: '/fr/jouer-commander-en-ligne/',
      pt: '/pt/jogar-commander-online/',
      it: '/it/giocare-commander-online/',
    },
    playMagicOnlineWithFriends: {
      es: '/es/jugar-magic-online-amigos/',
      en: '/en/play-magic-online-with-friends/',
      de: '/de/magic-online-mit-freunden-spielen/',
      fr: '/fr/jouer-magic-en-ligne-amis/',
      pt: '/pt/jogar-magic-online-amigos/',
      it: '/it/giocare-magic-online-amici/',
    },
    createCommanderRoom: {
      es: '/es/crear-sala-commander/',
      en: '/en/create-commander-room/',
      de: '/de/commander-raum-erstellen/',
      fr: '/fr/creer-salle-commander/',
      pt: '/pt/criar-sala-commander/',
      it: '/it/creare-stanza-commander/',
    },
    importCommanderDeck: {
      es: '/es/importar-mazo-commander-mtg/',
      en: '/en/import-mtg-commander-deck/',
      de: '/de/mtg-commander-deck-importieren/',
      fr: '/fr/importer-deck-commander-mtg/',
      pt: '/pt/importar-deck-commander-mtg/',
      it: '/it/importare-mazzo-commander-mtg/',
    },
    commanderDeckBuilder: {
      es: '/es/deck-builder-commander-mtg/',
      en: '/en/mtg-commander-deck-builder/',
      de: '/de/mtg-commander-deck-builder/',
      fr: '/fr/deck-builder-commander-mtg/',
      pt: '/pt/deck-builder-commander-mtg/',
      it: '/it/deck-builder-commander-mtg/',
    },
    tableAssistant: {
      es: '/es/asistente-mesa-commander/',
      en: '/en/commander-table-assistant/',
      de: '/de/commander-tischassistent/',
      fr: '/fr/assistant-table-commander/',
      pt: '/pt/assistente-mesa-commander/',
      it: '/it/assistente-tavolo-commander/',
    },
    waysToPlayCommanderOnline: {
      es: '/es/formas-jugar-commander-online/',
      en: '/en/ways-to-play-commander-online/',
      de: '/de/commander-online-spielen-moeglichkeiten/',
      fr: '/fr/facons-jouer-commander-en-ligne/',
      pt: '/pt/formas-jogar-commander-online/',
      it: '/it/modi-giocare-commander-online/',
    },
    howToPlayCommanderOnline: {
      es: '/es/como-jugar-commander-online/',
      en: '/en/how-to-play-commander-online/',
      de: '/de/commander-online-spielen-anleitung/',
      fr: '/fr/comment-jouer-commander-en-ligne/',
      pt: '/pt/como-jogar-commander-online/',
      it: '/it/come-giocare-commander-online/',
    },
    faq: {
      es: '/es/faq/',
      en: '/en/faq/',
      de: '/de/faq/',
      fr: '/fr/faq/',
      pt: '/pt/faq/',
      it: '/it/faq/',
    },
  } as const satisfies Record<SeoRouteKey, Record<SeoLocaleCode, string>>;

  it('defines only the approved SEO landing routes', () => {
    expect(SEO_ROUTE_KEYS).toEqual(approvedSeoRoutes);
  });

  it('keeps every SEO route classified as seo-static', () => {
    for (const routeKey of SEO_ROUTE_KEYS) {
      expect(PAGE_TRANSLATION_STRATEGIES[routeKey]).toBe('seo-static');
    }
  });

  it('defines SEO slugs only for the primary SEO locales', () => {
    for (const routeKey of SEO_ROUTE_KEYS) {
      expect(Object.keys(SEO_ROUTES[routeKey].slugs).sort()).toEqual([...SEO_LOCALE_CODES].sort());
    }
  });

  it('does not duplicate slugs within the same SEO-indexable locale', () => {
    for (const locale of SEO_LOCALE_CODES) {
      const slugs = SEO_ROUTE_KEYS.map((routeKey) => SEO_ROUTES[routeKey].slugs[locale]);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('builds normalized localized SEO paths', () => {
    expect(getSeoPath('home', 'en')).toBe('/');
    expect(getSeoPath('home', 'es')).toBe('/es/');
    expect(getSeoPath('playCommanderOnline', 'en')).toBe('/en/play-commander-online/');
    expect(getSeoPath('commanderDeckBuilder', 'es')).toBe('/es/deck-builder-commander-mtg/');
    expect(getSeoPath('tableAssistant', 'es')).toBe('/es/asistente-mesa-commander/');
  });

  it('uses the final canonical slug matrix for every SEO landing and locale', () => {
    for (const routeKey of SEO_ROUTE_KEYS) {
      for (const locale of SEO_LOCALE_CODES) {
        expect(getSeoPath(routeKey, locale)).toBe(expectedCanonicalPaths[routeKey][locale]);
      }
    }
  });

  it('uses localized SEO terms for the table assistant route without reusing the internal app path', () => {
    expect(SEO_ROUTES.tableAssistant.slugs.es).toBe('asistente-mesa-commander');
    expect(SEO_ROUTES.tableAssistant.slugs.en).toBe('commander-table-assistant');
    expect(getSeoPath('tableAssistant', 'es')).not.toBe('/table-assistant/');
    expect(getSeoPath('tableAssistant', 'en')).not.toBe('/table-assistant/');
  });

  it('returns alternates only for SEO-indexable locales', () => {
    const alternates = getLocalizedRouteAlternates('playMagicOnlineWithFriends');

    expect(Object.keys(alternates).sort()).toEqual([...SEO_LOCALE_CODES].sort());
    expect(alternates.es).toBe('/es/jugar-magic-online-amigos/');
    expect(alternates.en).toBe('/en/play-magic-online-with-friends/');
    expect(alternates.fr).toBe('/fr/jouer-magic-en-ligne-amis/');

    for (const locale of nonSeoLocaleCodes) {
      expect(locale in alternates).toBe(false);
    }
  });

  it('uses the root URL as the English home alternate', () => {
    const alternates = getLocalizedRouteAlternates('home');

    expect(alternates.en).toBe('/');
    expect(alternates.es).toBe('/es/');
    expect(alternates.it).toBe('/it/');
  });

  it('finds SEO routes by localized path', () => {
    expect(findSeoRouteByPath('/')).toEqual({
      routeKey: 'home',
      locale: 'en',
      path: '/',
    });

    expect(findSeoRouteByPath('/es/jugar-commander-online/')).toEqual({
      routeKey: 'playCommanderOnline',
      locale: 'es',
      path: '/es/jugar-commander-online/',
    });

    expect(findSeoRouteByPath('en/play-commander-online')).toEqual({
      routeKey: 'playCommanderOnline',
      locale: 'en',
      path: '/en/play-commander-online/',
    });

    expect(findSeoRouteByPath('/es/?utm_source=test')).toEqual({
      routeKey: 'home',
      locale: 'es',
      path: '/es/',
    });
  });

  it('does not match internal app routes or unsupported locales', () => {
    const internalPaths = [
      '/dashboard',
      '/decks',
      '/rooms',
      '/table-assistant',
      '/app/table-assistant',
      '/auth/login',
      '/room/demo-room',
    ];

    for (const path of internalPaths) {
      expect(findSeoRouteByPath(path)).toBeUndefined();
    }

    expect(findSeoRouteByPath('/mx/play-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/ja/commander-online-play/')).toBeUndefined();
    expect(findSeoRouteByPath('/ko/chinguwa-magic-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/zh-hans/zaixian-commander/')).toBeUndefined();
    expect(findSeoRouteByPath('/zh-hant/zaixian-commander/')).toBeUndefined();
    expect(findSeoRouteByPath('/nl/commander-online-spelen/')).toBeUndefined();
    expect(findSeoRouteByPath('/ca/jugar-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/ru/faq/')).toBeUndefined();
    expect(findSeoRouteByPath('/en/')).toBeUndefined();
  });

  it('does not match mixed locale and slug SEO paths', () => {
    expect(findSeoRouteByPath('/en/jugar-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/es/play-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/en/asistente-mesa-commander/')).toBeUndefined();
    expect(findSeoRouteByPath('/es/commander-table-assistant/')).toBeUndefined();
  });

  it('keeps all generated SEO-indexable paths unique across route and locale pairs', () => {
    const paths = SEO_ROUTE_KEYS.flatMap((routeKey) =>
      SEO_LOCALE_CODES.map((locale) => getSeoPath(routeKey, locale)),
    );

    expect(paths).toHaveLength(60);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
