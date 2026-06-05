import { Route } from '@angular/router';
import { LEGAL_PAGE_KEYS, getLegalPath } from '../../core/legal/legal-routes';
import { SEO_LOCALE_CODES } from '../../core/localization/locale-config';

export const LEGAL_ROUTES: readonly Route[] = LEGAL_PAGE_KEYS.flatMap((legalPageKey) =>
  SEO_LOCALE_CODES.map((locale) => ({
    path: createAngularLegalRoutePath(getLegalPath(legalPageKey, locale)),
    pathMatch: 'full',
    loadComponent: () => import('./legal-page/legal-page.component')
      .then((component) => component.LegalPageComponent),
    data: {
      pageKey: 'legal',
      legalPageKey,
      locale,
    },
  })),
);

function createAngularLegalRoutePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
