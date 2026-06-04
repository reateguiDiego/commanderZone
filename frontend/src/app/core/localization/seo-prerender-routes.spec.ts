import { SEO_LOCALE_CODES } from './locale-config';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './seo-prerender-routes';
import { SEO_ROUTE_KEYS, getSeoPath } from './seo-routes';

describe('SEO prerender routes', () => {
  it('contains every localized SEO landing URL', () => {
    expect(SEO_PRERENDER_ROUTES).toHaveLength(SEO_ROUTE_KEYS.length * SEO_LOCALE_CODES.length);

    for (const routeKey of SEO_ROUTE_KEYS) {
      for (const locale of SEO_LOCALE_CODES) {
        expect(SEO_PRERENDER_ROUTES).toContain(getSeoPath(routeKey, locale));
      }
    }

    expect(SEO_PRERENDER_ROUTES).not.toContain('/ru/faq/');
    expect(SEO_PRERENDER_ROUTES).not.toContain('/ja/commander-online-play/');
  });

  it('keeps prerender routes unique and public', () => {
    expect(new Set(SEO_PRERENDER_ROUTES).size).toBe(SEO_PRERENDER_ROUTES.length);

    for (const route of SEO_PRERENDER_ROUTES) {
      expect(route).toMatch(/^\/[a-z]/);
      expect(route).not.toContain('/games/');
      expect(route).not.toBe('/profile/');
      expect(route).not.toBe('/settings/');
      expect(route).not.toBe('/app/');
      expect(route).not.toBe('/table-assistant/');
    }
  });

  it('converts URL paths to Angular server route paths', () => {
    expect(toAngularServerRoutePath('/es/jugar-commander-online/')).toBe('es/jugar-commander-online');
    expect(toAngularServerRoutePath('/es/')).toBe('es');
  });
});
