import { SUPPORTED_LOCALE_CODES } from '../../core/localization/locale-config';
import { getSeoPath, SEO_ROUTE_KEYS } from '../../core/localization/seo-routes';
import { SEO_LANDING_ROUTES } from './seo-landing.routes';

describe('SEO landing routes', () => {
  it('creates one public route for every SEO landing and locale', () => {
    expect(SEO_LANDING_ROUTES).toHaveLength(SEO_ROUTE_KEYS.length * SUPPORTED_LOCALE_CODES.length);
  });

  it('uses localized SEO paths from SEO_ROUTES', () => {
    const routePaths = SEO_LANDING_ROUTES.map((route) => `/${route.path}/`);

    expect(routePaths).toContain(getSeoPath('home', 'es'));
    expect(routePaths).toContain(getSeoPath('playCommanderOnline', 'en'));
    expect(routePaths).toContain(getSeoPath('tableAssistant', 'es'));
    expect(routePaths).toContain(getSeoPath('waysToPlayCommanderOnline', 'de'));
    expect(routePaths).toContain(getSeoPath('faq', 'ru'));
  });

  it('keeps SEO landings public and separate from internal app routes', () => {
    const tableAssistantRoute = SEO_LANDING_ROUTES.find((route) => route.path === 'es/asistente-de-mesa-magic');

    expect(tableAssistantRoute).toBeDefined();
    expect(tableAssistantRoute?.canActivate).toBeUndefined();
    expect(SEO_LANDING_ROUTES.some((route) => route.path === 'table-assistant')).toBe(false);
    expect(SEO_LANDING_ROUTES.some((route) => route.path === 'rooms')).toBe(false);
  });
});
