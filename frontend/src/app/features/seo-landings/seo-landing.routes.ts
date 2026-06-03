import { Route } from '@angular/router';
import { SUPPORTED_LOCALE_CODES } from '../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, SEO_ROUTES } from '../../core/localization/seo-routes';

export const SEO_LANDING_ROUTES: readonly Route[] = SEO_ROUTE_KEYS.flatMap((routeKey) =>
  SUPPORTED_LOCALE_CODES.map((locale) => ({
    path: createAngularSeoRoutePath(locale, SEO_ROUTES[routeKey].slugs[locale]),
    pathMatch: 'full',
    loadComponent: () => import('./seo-landing-route/seo-landing-route.component')
      .then((component) => component.SeoLandingRouteComponent),
    data: {
      routeKey,
      locale,
    },
  })),
);

function createAngularSeoRoutePath(locale: string, slug: string): string {
  return slug ? `${locale}/${slug}` : locale;
}
