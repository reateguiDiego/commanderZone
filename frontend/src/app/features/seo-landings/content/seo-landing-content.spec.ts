import { SUPPORTED_LOCALE_CODES } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS } from '../../../core/localization/seo-routes';
import {
  SEO_LANDING_CONTENT,
  getAllSeoLandingContentEntries,
  getSeoLandingContent,
  validateSeoLandingContentCoverage,
} from './seo-landing-content';

describe('SEO landing static content', () => {
  it('provides content for every SEO landing and every supported locale', () => {
    expect(Object.keys(SEO_LANDING_CONTENT).sort()).toEqual([...SEO_ROUTE_KEYS].sort());

    for (const routeKey of SEO_ROUTE_KEYS) {
      expect(Object.keys(SEO_LANDING_CONTENT[routeKey]).sort()).toEqual([...SUPPORTED_LOCALE_CODES].sort());
    }

    expect(getAllSeoLandingContentEntries()).toHaveLength(SEO_ROUTE_KEYS.length * SUPPORTED_LOCALE_CODES.length);
  });

  it('passes required SEO content coverage validation', () => {
    expect(validateSeoLandingContentCoverage()).toEqual([]);
  });

  it('returns SSR-ready static content without client fetch requirements', () => {
    const content = getSeoLandingContent('playCommanderOnline', 'en');

    expect(content.routeKey).toBe('playCommanderOnline');
    expect(content.locale).toBe('en');
    expect(content.seo.title).toContain('Play Commander online');
    expect(content.seo.description).toContain('static content');
    expect(content.hero.title).toBe('Play Commander online');
    expect(content.breadcrumb.items.length).toBeGreaterThan(0);
    expect(content.internalLinks.links.length).toBeGreaterThan(0);
    expect(content.faq.items.length).toBeGreaterThan(0);
    expect(content.jsonLd).toBeTruthy();
  });

  it('keeps table assistant SEO content separate from the internal table assistant app route', () => {
    const content = getSeoLandingContent('tableAssistant', 'es');

    expect(content.hero.title).toContain('Asistente de mesa');
    expect(content.internalLinks.links.map((link) => link.href)).not.toContain('/table-assistant');
    expect(content.internalLinks.links.every((link) => link.href.startsWith('/es/'))).toBe(true);
  });
});
