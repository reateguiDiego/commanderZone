import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import {
  SeoRouteMetadata,
  SeoService,
  buildSeoAlternateLinks,
  buildSeoCanonicalUrl,
  buildSeoMetaTags,
  normalizeSeoOrigin,
  toSeoAbsoluteUrl,
} from './seo.service';

describe('SeoService helpers', () => {
  it('builds an absolute canonical URL for the localized route', () => {
    expect(buildSeoCanonicalUrl('tableAssistant', 'es', 'https://commanderzone.test/')).toBe(
      'https://commanderzone.test/es/asistente-de-mesa-magic/',
    );
  });

  it('builds hreflang alternates for every locale plus x-default', () => {
    const links = buildSeoAlternateLinks('playCommanderOnline', 'https://commanderzone.test');

    expect(links).toHaveLength(14);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hreflang: 'es',
        href: 'https://commanderzone.test/es/jugar-commander-online/',
      }),
      expect.objectContaining({
        hreflang: 'zh-Hans',
        href: 'https://commanderzone.test/zh-hans/zaixian-commander/',
      }),
      expect.objectContaining({
        hreflang: 'x-default',
        href: 'https://commanderzone.test/es/jugar-commander-online/',
      }),
    ]));
  });

  it('builds indexable Open Graph and Twitter meta tags', () => {
    const metadata = createMetadata();
    const tags = buildSeoMetaTags(metadata, 'https://commanderzone.test/en/play-commander-online/');

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'description', content: metadata.description }),
      expect.objectContaining({ name: 'robots', content: 'index, follow' }),
      expect.objectContaining({ property: 'og:url', content: 'https://commanderzone.test/en/play-commander-online/' }),
      expect.objectContaining({ property: 'og:site_name', content: 'CommanderZone' }),
      expect.objectContaining({ property: 'og:image', content: 'https://commanderzone.test/assets/og/play-commander-og.png' }),
      expect.objectContaining({ property: 'og:image:width', content: '1200' }),
      expect.objectContaining({ property: 'og:image:height', content: '630' }),
      expect.objectContaining({ name: 'twitter:card', content: 'summary' }),
      expect.objectContaining({ name: 'twitter:image', content: 'https://commanderzone.test/assets/og/play-commander-og.png' }),
    ]));
  });

  it('normalizes origins and keeps absolute URLs untouched', () => {
    expect(normalizeSeoOrigin('https://commanderzone.test///')).toBe('https://commanderzone.test');
    expect(toSeoAbsoluteUrl('/es/', 'https://commanderzone.test/')).toBe('https://commanderzone.test/es/');
    expect(toSeoAbsoluteUrl('https://example.com/es/', 'https://commanderzone.test')).toBe('https://example.com/es/');
  });
});

describe('SeoService', () => {
  let document: Document;
  let service: SeoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    document = TestBed.inject(DOCUMENT);
    service = TestBed.inject(SeoService);
    document.head.querySelectorAll('[data-cz-seo="true"], [data-seo-landing="true"]').forEach((element) => element.remove());
  });

  afterEach(() => {
    service.clearSeoRouteMetadata();
  });

  it('sets centralized SEO metadata and JSON-LD scripts', () => {
    const title = TestBed.inject(Title);

    service.applySeoRouteMetadata(createMetadata());

    expect(title.getTitle()).toBe('Play Commander online | CommanderZone');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="description"]')?.getAttribute('content')).toBe(
      'Play Commander online with static localized content.',
    );
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="canonical"]')?.getAttribute('href')).toBe(
      `${document.location.origin}/en/play-commander-online/`,
    );
    expect(document.head.querySelectorAll('link[data-cz-seo="true"][rel="alternate"]').length).toBe(14);
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="alternate"][hreflang="x-default"]')).toBeTruthy();
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:title"]')?.getAttribute('content')).toBe(
      'Play Commander online | CommanderZone',
    );
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:title"]')?.getAttribute('content')).toBe(
      'Play Commander online | CommanderZone',
    );
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:image"]')?.getAttribute('content')).toBe(
      `${document.location.origin}/assets/og/play-commander-og.png`,
    );
    expect(document.head.querySelector('script[data-cz-seo="true"][type="application/ld+json"]')?.textContent).toContain(
      '"@type":"WebPage"',
    );
  });

  it('cleans previous route tags before adding the next route tags', () => {
    service.applySeoRouteMetadata(createMetadata());
    service.applySeoRouteMetadata({
      ...createMetadata(),
      routeKey: 'faq',
      locale: 'es',
      title: 'FAQ | CommanderZone',
      openGraphTitle: 'FAQ | CommanderZone',
    });

    expect(document.head.querySelectorAll('link[data-cz-seo="true"][rel="canonical"]').length).toBe(1);
    expect(document.head.querySelectorAll('script[data-cz-seo="true"][type="application/ld+json"]').length).toBe(1);
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="canonical"]')?.getAttribute('href')).toBe(
      `${document.location.origin}/es/faq/`,
    );
  });
});

function createMetadata(): SeoRouteMetadata {
  return {
    routeKey: 'playCommanderOnline',
    locale: 'en',
    title: 'Play Commander online | CommanderZone',
    description: 'Play Commander online with static localized content.',
    siteName: 'CommanderZone',
    openGraphTitle: 'Play Commander online | CommanderZone',
    openGraphDescription: 'Play Commander online with static localized content.',
    openGraphImage: '/assets/og/play-commander-og.png',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Play Commander online',
      },
    ],
  };
}
