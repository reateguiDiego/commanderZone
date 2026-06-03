import { RenderMode } from '@angular/ssr';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './core/localization/seo-prerender-routes';
import { serverRoutes } from './app.routes.server';

describe('server routes', () => {
  it('prerenders every localized SEO URL', () => {
    const prerenderPaths = serverRoutes
      .filter((route) => route.renderMode === RenderMode.Prerender)
      .map((route) => route.path);

    expect(prerenderPaths).toHaveLength(130);
    expect(prerenderPaths).toEqual(SEO_PRERENDER_ROUTES.map((path) => toAngularServerRoutePath(path)));
  });

  it('keeps private and dynamic runtime routes out of prerender mode', () => {
    const clientOnlyPaths = ['games/:id', 'profile', 'settings', 'app', 'dashboard', 'table-assistant'];

    for (const path of clientOnlyPaths) {
      const route = serverRoutes.find((candidate) => candidate.path === path);
      expect(route?.renderMode).not.toBe(RenderMode.Prerender);
    }
  });

  it('uses client rendering as the fallback server route', () => {
    expect(serverRoutes.at(-1)).toEqual({ path: '**', renderMode: RenderMode.Client });
  });
});
