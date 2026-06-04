import { SEO_LOCALE_CODES } from './locale-config';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './seo-prerender-routes';
import { SEO_ROUTE_KEYS, getSeoPath } from './seo-routes';

describe('SEO prerender routes', () => {
  const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'] as const;

  it('contains every localized SEO landing URL', () => {
    expect(SEO_PRERENDER_ROUTES).toHaveLength(SEO_ROUTE_KEYS.length * SEO_LOCALE_CODES.length);
    expect(SEO_PRERENDER_ROUTES).toContain('/');
    expect(SEO_PRERENDER_ROUTES).not.toContain('/en/');

    for (const routeKey of SEO_ROUTE_KEYS) {
      for (const locale of SEO_LOCALE_CODES) {
        expect(SEO_PRERENDER_ROUTES).toContain(getSeoPath(routeKey, locale));
      }
    }

    for (const locale of nonSeoLocaleCodes) {
      expect(SEO_PRERENDER_ROUTES.some((route) => route === `/${locale}/` || route.startsWith(`/${locale}/`))).toBe(false);
    }
  });

  it('keeps prerender routes unique and public', () => {
    expect(new Set(SEO_PRERENDER_ROUTES).size).toBe(SEO_PRERENDER_ROUTES.length);

    for (const route of SEO_PRERENDER_ROUTES) {
      expect(route).toMatch(/^\/(?:$|[a-z])/);
      expect(route).not.toContain('/games/');
      expect(route).not.toBe('/profile/');
      expect(route).not.toBe('/settings/');
      expect(route).not.toBe('/app/');
      expect(route).not.toBe('/table-assistant/');
    }
  });

  it('converts URL paths to Angular server route paths', () => {
    expect(toAngularServerRoutePath('/')).toBe('');
    expect(toAngularServerRoutePath('/es/jugar-commander-online/')).toBe('es/jugar-commander-online');
    expect(toAngularServerRoutePath('/es/')).toBe('es');
  });
});
