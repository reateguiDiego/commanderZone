import { SEO_LOCALE_CODES } from './locale-config';
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
    expect(getSeoPath('home', 'es')).toBe('/es/');
    expect(getSeoPath('playCommanderOnline', 'en')).toBe('/en/play-commander-online/');
    expect(getSeoPath('commanderDeckBuilder', 'es')).toBe('/es/deck-builder-commander/');
    expect(getSeoPath('tableAssistant', 'es')).toBe('/es/asistente-de-mesa-magic/');
  });

  it('uses localized SEO terms for the table assistant route without reusing the internal app path', () => {
    expect(SEO_ROUTES.tableAssistant.slugs.es).toContain('asistente-de-mesa');
    expect(SEO_ROUTES.tableAssistant.slugs.en).toBe('commander-life-counter');
    expect(getSeoPath('tableAssistant', 'es')).not.toBe('/table-assistant/');
    expect(getSeoPath('tableAssistant', 'en')).not.toBe('/table-assistant/');
  });

  it('returns alternates only for SEO-indexable locales', () => {
    const alternates = getLocalizedRouteAlternates('playMagicOnlineWithFriends');

    expect(Object.keys(alternates).sort()).toEqual([...SEO_LOCALE_CODES].sort());
    expect(alternates.es).toBe('/es/jugar-magic-online-con-amigos/');
    expect(alternates.en).toBe('/en/play-magic-online-with-friends/');
    expect(alternates.fr).toBe('/fr/jouer-magic-en-ligne-avec-des-amis/');
    expect('ru' in alternates).toBe(false);
  });

  it('finds SEO routes by localized path', () => {
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
    expect(findSeoRouteByPath('/ru/faq/')).toBeUndefined();
    expect(findSeoRouteByPath('/ja/commander-online-play/')).toBeUndefined();
  });

  it('does not match mixed locale and slug SEO paths', () => {
    expect(findSeoRouteByPath('/en/jugar-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/es/play-commander-online/')).toBeUndefined();
    expect(findSeoRouteByPath('/en/asistente-de-mesa-magic/')).toBeUndefined();
    expect(findSeoRouteByPath('/es/commander-life-counter/')).toBeUndefined();
  });

  it('keeps all generated SEO-indexable paths unique across route and locale pairs', () => {
    const paths = SEO_ROUTE_KEYS.flatMap((routeKey) =>
      SEO_LOCALE_CODES.map((locale) => getSeoPath(routeKey, locale)),
    );

    expect(paths).toHaveLength(60);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
