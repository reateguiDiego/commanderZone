import { SEO_LOCALE_CODES } from '../../core/localization/locale-config';
import { LEGAL_PAGE_KEYS, getLegalPath } from '../../core/legal/legal-routes';
import { LEGAL_ROUTES } from './legal.routes';

describe('legal routes', () => {
  it('creates one public noindex route for every legal page and locale', () => {
    expect(LEGAL_ROUTES).toHaveLength(LEGAL_PAGE_KEYS.length * SEO_LOCALE_CODES.length);

    const paths = LEGAL_ROUTES.map((route) => route.path ? `/${route.path}/` : '/');
    expect(paths).toContain('/privacy-policy/');
    expect(paths).toContain('/cookie-policy/');
    expect(paths).toContain('/es/politica-privacidad/');
    expect(paths).toContain('/de/datenschutzerklaerung/');
    expect(paths).toContain('/fr/contact/');
    expect(paths).toContain('/pt/termos/');
    expect(paths).toContain('/it/contatto/');
  });

  it('keeps route data explicit for metadata and robots handling', () => {
    for (const pageKey of LEGAL_PAGE_KEYS) {
      for (const locale of SEO_LOCALE_CODES) {
        const angularPath = getLegalPath(pageKey, locale).replace(/^\/+|\/+$/g, '');
        const route = LEGAL_ROUTES.find((candidate) => candidate.path === angularPath);

        expect(route?.data).toEqual({
          pageKey: 'legal',
          legalPageKey: pageKey,
          locale,
        });
        expect(route?.loadComponent).toBeDefined();
        expect(route?.redirectTo).toBeUndefined();
      }
    }
  });
});
