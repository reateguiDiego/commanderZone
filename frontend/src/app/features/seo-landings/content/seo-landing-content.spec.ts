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
    expect(content.seo.ogImage).toBe('/assets/og/play-commander-og.png');
    expect(content.hero.title).toBe('Play Commander online');
    expect(content.breadcrumb.items.length).toBeGreaterThan(0);
    expect(content.internalLinks.links.length).toBeGreaterThan(0);
    expect(content.faq.items.length).toBeGreaterThan(0);
    expect(content.jsonLd).toBeTruthy();
  });

  it('keeps table assistant SEO content separate from the internal table assistant app route', () => {
    const content = getSeoLandingContent('tableAssistant', 'es');

    expect(content.hero.title).toContain('Asistente de mesa');
    expect(content.seo.ogImage).toBe('/assets/og/table-assistant-og.png');
    expect(content.internalLinks.links.map((link) => link.href)).not.toContain('/table-assistant');
    expect(content.internalLinks.links.every((link) => link.href.startsWith('/es/'))).toBe(true);
  });

  it('provides default and route-specific Open Graph image paths', () => {
    expect(getSeoLandingContent('home', 'en').seo.ogImage).toBe('/assets/og/home-og.png');
    expect(getSeoLandingContent('faq', 'en').seo.ogImage).toBe('/assets/og/default-og.png');
  });

  it('provides the public FAQ with full FAQPage content', () => {
    const content = getSeoLandingContent('faq', 'es');

    expect(content.seo.title).toContain('FAQ');
    expect(content.hero.title).toContain('FAQ');
    expect(content.faq.items.length).toBeGreaterThanOrEqual(43);
    expect(content.faq.items.map((item) => item.question)).toContain('¿Qué es CommanderZone?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Puedo usar el móvil como contador de vidas de Magic?');
    expect(JSON.stringify(content.jsonLd)).toContain('FAQPage');
  });

  it('links to the FAQ from public navigation, footer and home content', () => {
    const content = getSeoLandingContent('home', 'en');
    const publicNavigationHrefs = content.publicNavigationLinks?.map((link) => link.href) ?? [];
    const footerHrefs = content.footerLinks?.map((link) => link.href) ?? [];
    const sectionHrefs = content.sections?.flatMap((section) => section.links?.map((link) => link.href) ?? []) ?? [];

    expect(publicNavigationHrefs).toContain('/en/faq/');
    expect(footerHrefs).toContain('/en/faq/');
    expect(sectionHrefs).toContain('/en/faq/');
  });
});
