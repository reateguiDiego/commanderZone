import { RenderMode } from '@angular/ssr';
import { LEGAL_PRERENDER_ROUTES } from './core/legal/legal-routes';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './core/localization/seo-prerender-routes';
import { serverRoutes } from './app.routes.server';

describe('server routes', () => {
  const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'] as const;

  it('prerenders every localized SEO URL', () => {
    const prerenderPaths = serverRoutes
      .filter((route) => route.renderMode === RenderMode.Prerender)
      .map((route) => route.path);

    const seoPrerenderPaths = SEO_PRERENDER_ROUTES.map((path) => toAngularServerRoutePath(path));

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

    expect(prerenderPaths).toHaveLength(SEO_PRERENDER_ROUTES.length + LEGAL_PRERENDER_ROUTES.length);
    expect(prerenderPaths).toEqual(expect.arrayContaining(legalPrerenderPaths));
    expect(SEO_PRERENDER_ROUTES).not.toContain('/privacy-policy/');
    expect(SEO_PRERENDER_ROUTES).not.toContain('/cookie-policy/');
  });

  it('keeps private and dynamic runtime routes out of prerender mode', () => {
    const clientOnlyPaths = ['games/:id', 'profile', 'settings', 'app', 'dashboard', 'table-assistant', 'welcome'];

    for (const path of clientOnlyPaths) {
      const route = serverRoutes.find((candidate) => candidate.path === path);
      expect(route?.renderMode).not.toBe(RenderMode.Prerender);
    }
  });

  it('uses client rendering as the fallback server route', () => {
    expect(serverRoutes.at(-1)).toEqual({ path: '**', renderMode: RenderMode.Client, status: 404 });
  });
});
