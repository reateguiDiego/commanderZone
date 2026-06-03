import { SUPPORTED_LOCALE_CODES } from './locale-config';
import { SEO_ROUTE_KEYS, getSeoPath } from './seo-routes';

export const SEO_PRERENDER_ROUTES = SEO_ROUTE_KEYS.flatMap((routeKey) =>
  SUPPORTED_LOCALE_CODES.map((locale) => getSeoPath(routeKey, locale)),
);

export function toAngularServerRoutePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
