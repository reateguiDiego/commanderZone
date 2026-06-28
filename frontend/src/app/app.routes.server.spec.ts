import { RenderMode } from '@angular/ssr';
import { LEGAL_PRERENDER_ROUTES } from './core/legal/legal-routes';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './core/localization/seo-prerender-routes';
import { serverRoutes } from './app.routes.server';

describe('server routes', () => {
  const nonSeoLocaleCodes = ['ja', 'zh-hans', 'nl', 'ca', 'ru'] as const;

  it('prerenders every localized SEO URL', () => {
    const prerenderPaths = serverRoutes
      .filter((route) => route.renderMode === RenderMode.Prerender)
      .map((route) => route.path);

    const seoPrerenderPaths = SEO_PRERENDER_ROUTES.map((path) => toAngularServerRoutePath(path));

    expect(SEO_PRERENDER_ROUTES).toHaveLength(90);
    expect(prerenderPaths).toEqual(expect.arrayContaining(seoPrerenderPaths));
    expect(prerenderPaths).toContain('');
    expect(prerenderPaths).not.toContain('en');

    for (const locale of nonSeoLocaleCodes) {
      expect(prerenderPaths.some((path) => path === locale || path.startsWith(`${locale}/`))).toBe(false);
    }
  });

  it('prerenders localized legal noindex pages outside the SEO route manifest', () => {
    const prerenderPaths = serverRoutes
      .filter((route) => route.renderMode === RenderMode.Prerender)
      .map((route) => route.path);
    const legalPrerenderPaths = LEGAL_PRERENDER_ROUTES.map((path) => toAngularServerRoutePath(path));

    expect(LEGAL_PRERENDER_ROUTES).toHaveLength(18);
    expect(prerenderPaths).toEqual(expect.arrayContaining(legalPrerenderPaths));
    expect(prerenderPaths.filter((path) => legalPrerenderPaths.includes(path)).length).toBe(LEGAL_PRERENDER_ROUTES.length);
    expect(SEO_PRERENDER_ROUTES).not.toContain('/privacy-policy/');
    expect(SEO_PRERENDER_ROUTES).not.toContain('/cookie-policy/');
  });

  it('keeps the prerender list limited to SEO and legal routes', () => {
    const prerenderPaths = serverRoutes
      .filter((route) => route.renderMode === RenderMode.Prerender)
      .map((route) => route.path);

    expect(SEO_PRERENDER_ROUTES).toHaveLength(90);
    expect(LEGAL_PRERENDER_ROUTES).toHaveLength(18);
    expect(prerenderPaths).toHaveLength(SEO_PRERENDER_ROUTES.length + LEGAL_PRERENDER_ROUTES.length);
    expect(prerenderPaths).toHaveLength(108);
    expect(prerenderPaths).not.toContain('en');
    expect(prerenderPaths).not.toContain('auth/login');
    expect(prerenderPaths).not.toContain('auth/register');
  });

  it('keeps public auth entry pages in client render mode', () => {
    expect(serverRoutes.find((route) => route.path === 'auth/login')?.renderMode).toBe(RenderMode.Client);
    expect(serverRoutes.find((route) => route.path === 'auth/register')?.renderMode).toBe(RenderMode.Client);
  });

  it('keeps private and dynamic runtime routes out of prerender mode', () => {
    const clientOnlyPaths = [
      'auth/login',
      'auth/register',
      'auth/password-reset',
      'email-verification',
      'contact',
      'games/:id/debug',
      'games/:id',
      'dashboard',
      'cards',
      'community',
      'community/decks',
      'community/decks/:id',
      'community/top-commanders',
      'community/top-cards',
      'decks',
      'decks/:id',
      'rooms',
      'rooms/:id/waiting',
      'room/:id',
      'table-assistant',
      'table-assistant/:id',
      'welcome',
    ];

    for (const path of clientOnlyPaths) {
      const route = serverRoutes.find((candidate) => candidate.path === path);
      expect(route?.renderMode).toBe(RenderMode.Client);
    }
  });

  it('uses server rendering with 404 status as the fallback server route', () => {
    expect(serverRoutes.at(-1)).toEqual({ path: '**', renderMode: RenderMode.Server, status: 404 });
  });
});
