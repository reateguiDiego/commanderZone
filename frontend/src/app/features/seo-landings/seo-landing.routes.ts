import { Route } from '@angular/router';
import { guestGuard } from '../../core/auth/auth.guard';
import { SEO_LOCALE_CODES } from '../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, getSeoPath } from '../../core/localization/seo-routes';

export const SEO_INDEXABLE_LANDING_ROUTES: readonly Route[] = SEO_ROUTE_KEYS.flatMap((routeKey) =>
  SEO_LOCALE_CODES.map((locale) => {
    const isRootEnglishHome = routeKey === 'home' && locale === 'en';

    return {
      path: createAngularSeoRoutePath(getSeoPath(routeKey, locale)),
      pathMatch: 'full',
      ...(isRootEnglishHome ? { canActivate: [guestGuard] } : {}),
      loadComponent: () => import('./seo-landing-route/seo-landing-route.component')
        .then((component) => component.SeoLandingRouteComponent),
      data: {
        pageKey: routeKey,
        routeKey,
        locale,
        ...(isRootEnglishHome ? { authenticatedRedirect: '/dashboard' } : {}),
      },
    };
  }),
);

export const SEO_LANDING_ROUTES: readonly Route[] = [
  ...SEO_INDEXABLE_LANDING_ROUTES,
];

function createAngularSeoRoutePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
