import { SEO_LOCALE_CODES } from '../../core/localization/locale-config';
import { getSeoPath, SEO_ROUTE_KEYS } from '../../core/localization/seo-routes';
import {
  SEO_INDEXABLE_LANDING_ROUTES,
  SEO_LANDING_ROUTES,
} from './seo-landing.routes';

describe('SEO landing routes', () => {
  const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'] as const;

  it('creates one indexable public route for every SEO landing and SEO locale', () => {
    expect(SEO_INDEXABLE_LANDING_ROUTES).toHaveLength(SEO_ROUTE_KEYS.length * SEO_LOCALE_CODES.length);
    expect(SEO_LANDING_ROUTES).toHaveLength(SEO_ROUTE_KEYS.length * SEO_LOCALE_CODES.length);
  });

  it('uses localized SEO paths from SEO_ROUTES', () => {
    const routePaths = SEO_INDEXABLE_LANDING_ROUTES.map((route) => `/${route.path}/`);

    expect(routePaths).toContain(getSeoPath('home', 'es'));
    expect(routePaths).toContain(getSeoPath('playCommanderOnline', 'en'));
    expect(routePaths).toContain(getSeoPath('tableAssistant', 'es'));
    expect(routePaths).toContain(getSeoPath('waysToPlayCommanderOnline', 'de'));
    expect(routePaths).toContain(getSeoPath('faq', 'it'));
  });

  it('does not create SEO landing routes or redirects for removed locales', () => {
    const routePaths = SEO_LANDING_ROUTES.map((route) => route.path ?? '');

    for (const locale of nonSeoLocaleCodes) {
      expect(routePaths.some((path) => path === locale || path.startsWith(`${locale}/`))).toBe(false);
    }

    expect(SEO_LANDING_ROUTES.some((route) => 'redirectTo' in route)).toBe(false);
  });

  it('keeps SEO landings public and separate from internal app routes', () => {
    const tableAssistantRoute = SEO_LANDING_ROUTES.find((route) => route.path === 'es/asistente-mesa-commander');

    expect(tableAssistantRoute).toBeDefined();
    expect(tableAssistantRoute?.canActivate).toBeUndefined();
    expect(SEO_LANDING_ROUTES.some((route) => route.path === 'table-assistant')).toBe(false);
    expect(SEO_LANDING_ROUTES.some((route) => route.path === 'rooms')).toBe(false);
  });

  it('does not create mixed locale and slug routes', () => {
    const routePaths = SEO_LANDING_ROUTES.map((route) => route.path);

    expect(routePaths).not.toContain('en/jugar-commander-online');
    expect(routePaths).not.toContain('es/play-commander-online');
    expect(routePaths).not.toContain('en/asistente-mesa-commander');
    expect(routePaths).not.toContain('es/commander-table-assistant');
  });
});
