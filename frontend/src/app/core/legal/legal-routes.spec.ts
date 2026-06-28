import { SEO_LOCALE_CODES } from '../localization/locale-config';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_PAGE_KEYS,
  LEGAL_PRERENDER_ROUTES,
  findLegalRouteByPath,
  getLegalLinks,
  getLegalPath,
} from './legal-routes';

describe('legal routes', () => {
  it('defines localized legal paths for every legal page and SEO locale', () => {
    expect(getLegalPath('privacy', 'en')).toBe('/privacy-policy/');
    expect(getLegalPath('cookies', 'en')).toBe('/cookie-policy/');
    expect(getLegalPath('terms', 'en')).toBe('/terms/');
    expect(getLegalPath('privacy', 'es')).toBe('/es/politica-privacidad/');
    expect(getLegalPath('cookies', 'de')).toBe('/de/cookie-richtlinie/');
    expect(getLegalPath('terms', 'fr')).toBe('/fr/conditions-utilisation/');
    expect(getLegalPath('terms', 'pt')).toBe('/pt/termos/');
    expect(getLegalPath('terms', 'it')).toBe('/it/termini/');
  });

  it('keeps legal prerender routes separate from SEO indexable routes', () => {
    expect(LEGAL_PRERENDER_ROUTES).toHaveLength(LEGAL_PAGE_KEYS.length * SEO_LOCALE_CODES.length);
    expect(LEGAL_PRERENDER_ROUTES).toContain('/privacy-policy/');
    expect(LEGAL_PRERENDER_ROUTES).toContain('/es/terminos/');
    expect(new Set(LEGAL_PRERENDER_ROUTES).size).toBe(LEGAL_PRERENDER_ROUTES.length);
  });

  it('finds legal routes by path', () => {
    expect(findLegalRouteByPath('/privacy-policy/')).toEqual({
      pageKey: 'privacy',
      locale: 'en',
      path: '/privacy-policy/',
    });
    expect(findLegalRouteByPath('/es/politica-cookies/?utm_source=test')).toEqual({
      pageKey: 'cookies',
      locale: 'es',
      path: '/es/politica-cookies/',
    });
    expect(findLegalRouteByPath('/es/')).toBeUndefined();
  });

  it('builds localized legal footer links', () => {
    expect(getLegalLinks('en').map((link) => [link.label, link.href])).toEqual([
      ['Privacy Policy', '/privacy-policy/'],
      ['Cookie Policy', '/cookie-policy/'],
      ['Terms', '/terms/'],
    ]);
    expect(getLegalLinks('es').map((link) => [link.label, link.href])).toEqual([
      ['Privacidad', '/es/politica-privacidad/'],
      ['Cookies', '/es/politica-cookies/'],
      ['Términos', '/es/terminos/'],
    ]);
  });

  it('centralizes the legal contact email', () => {
    expect(LEGAL_CONTACT_EMAIL).toBe('info.dev.sunrise@gmail.com');
  });
});
