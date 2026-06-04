import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import {
  SEO_CANONICAL_ORIGIN,
  SEO_DEFAULT_OPEN_GRAPH_IMAGE,
  SeoRouteMetadata,
  SeoService,
  buildSearchConsoleVerificationMetaTags,
  buildOpenGraphLocaleAlternates,
  buildSeoAlternateLinks,
  buildSeoCanonicalUrl,
  buildSeoMetaTags,
  getOpenGraphLocale,
  normalizeSeoOrigin,
  toSeoAbsoluteUrl,
} from './seo.service';
import { SEARCH_CONSOLE_VERIFICATION_TOKEN, normalizeSearchConsoleVerificationToken } from './search-console-verification.config';

describe('SeoService helpers', () => {
  it('uses the production canonical origin by default', () => {
    expect(SEO_CANONICAL_ORIGIN).toBe('https://www.commanderzone.com');
    expect(buildSeoCanonicalUrl('tableAssistant', 'es')).toBe(
      'https://www.commanderzone.com/es/asistente-mesa-commander/',
    );
    expect(toSeoAbsoluteUrl('/assets/og/play-commander-og.png')).toBe(
      'https://www.commanderzone.com/assets/og/play-commander-og.png',
    );
  });

  it('builds an absolute canonical URL for the localized route', () => {
    expect(buildSeoCanonicalUrl('tableAssistant', 'es', 'https://commanderzone.test/')).toBe(
      'https://commanderzone.test/es/asistente-mesa-commander/',
    );
  });

  it('builds hreflang alternates for every SEO-indexable locale plus x-default', () => {
    const links = buildSeoAlternateLinks('playCommanderOnline', 'https://commanderzone.test');

    expect(links).toHaveLength(7);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hreflang: 'es',
        href: 'https://commanderzone.test/es/jugar-commander-online/',
      }),
      expect.objectContaining({
        hreflang: 'it',
        href: 'https://commanderzone.test/it/giocare-commander-online/',
      }),
      expect.objectContaining({
        hreflang: 'x-default',
        href: 'https://commanderzone.test/en/play-commander-online/',
      }),
    ]));
    expect(links.some((link) => link.hreflang === 'zh-Hans')).toBe(false);
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
      expect.objectContaining({ property: 'og:locale', content: 'en_US' }),
      expect.objectContaining({ property: 'og:locale:alternate', content: 'es_ES' }),
      expect.objectContaining({ property: 'og:locale:alternate', content: 'it_IT' }),
      expect.objectContaining({ name: 'twitter:card', content: 'summary_large_image' }),
      expect.objectContaining({ name: 'twitter:image', content: 'https://commanderzone.test/assets/og/play-commander-og.png' }),
    ]));
  });

  it('uses the default Open Graph image fallback and localized OG locale mapping', () => {
    const metadata: SeoRouteMetadata = {
      ...createMetadata(),
      locale: 'it',
      openGraphImage: undefined,
    };
    const tags = buildSeoMetaTags(metadata, 'https://commanderzone.test/it/giocare-commander-online/');

    expect(SEO_DEFAULT_OPEN_GRAPH_IMAGE).toBe('/assets/og/default-og.png');
    expect(getOpenGraphLocale('it')).toBe('it_IT');
    expect(getOpenGraphLocale('pt')).toBe('pt_PT');
    expect(buildOpenGraphLocaleAlternates('it')).toHaveLength(5);
    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'og:image', content: 'https://commanderzone.test/assets/og/default-og.png' }),
      expect.objectContaining({ name: 'twitter:image', content: 'https://commanderzone.test/assets/og/default-og.png' }),
      expect.objectContaining({ property: 'og:locale', content: 'it_IT' }),
      expect.objectContaining({ property: 'og:locale:alternate', content: 'pt_PT' }),
    ]));
    expect(tags).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'og:locale:alternate', content: 'zh_CN' }),
    ]));
  });

  it('normalizes origins and keeps absolute URLs untouched', () => {
    expect(normalizeSeoOrigin('https://commanderzone.test///')).toBe('https://commanderzone.test');
    expect(toSeoAbsoluteUrl('/es/', 'https://commanderzone.test/')).toBe('https://commanderzone.test/es/');
    expect(toSeoAbsoluteUrl('https://example.com/es/', 'https://commanderzone.test')).toBe('https://example.com/es/');
  });

  it('builds Search Console verification meta tags only when a real token is configured', () => {
    expect(normalizeSearchConsoleVerificationToken('  real-search-console-token  ')).toBe('real-search-console-token');
    expect(buildSearchConsoleVerificationMetaTags('')).toEqual([]);
    expect(buildSearchConsoleVerificationMetaTags('  ')).toEqual([]);
    expect(buildSearchConsoleVerificationMetaTags('real-search-console-token')).toEqual([
      { name: 'google-site-verification', content: 'real-search-console-token' },
    ]);
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
      'https://www.commanderzone.com/en/play-commander-online/',
    );
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="preload"][as="image"]')?.getAttribute('href')).toBe(
      'https://www.commanderzone.com/assets/og/play-commander-og.png',
    );
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="preload"][as="image"]')?.getAttribute('fetchpriority')).toBe(
      'high',
    );
    expect(document.head.querySelectorAll('link[data-cz-seo="true"][rel="alternate"]').length).toBe(7);
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="alternate"][hreflang="x-default"]')).toBeTruthy();
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:title"]')?.getAttribute('content')).toBe(
      'Play Commander online | CommanderZone',
    );
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:title"]')?.getAttribute('content')).toBe(
      'Play Commander online | CommanderZone',
    );
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:locale"]')?.getAttribute('content')).toBe(
      'en_US',
    );
    expect(document.head.querySelectorAll('meta[data-cz-seo="true"][property="og:locale:alternate"]').length).toBe(5);
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary_large_image',
    );
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:image"]')?.getAttribute('content')).toBe(
      'https://www.commanderzone.com/assets/og/play-commander-og.png',
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
      'https://www.commanderzone.com/es/faq/',
    );
  });
});

describe('SeoService with Search Console verification configured', () => {
  let document: Document;
  let service: SeoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: SEARCH_CONSOLE_VERIFICATION_TOKEN, useValue: 'real-search-console-token' }],
    });
    document = TestBed.inject(DOCUMENT);
    service = TestBed.inject(SeoService);
    document.head.querySelectorAll('[data-cz-seo="true"], [data-seo-landing="true"]').forEach((element) => element.remove());
  });

  afterEach(() => {
    service.clearSeoRouteMetadata();
  });

  it('can expose the configured verification meta tag on the public home route', () => {
    service.applySeoRouteMetadata({
      ...createMetadata(),
      routeKey: 'home',
      locale: 'es',
      title: 'CommanderZone',
      openGraphTitle: 'CommanderZone',
    });

    expect(document.head.querySelector('meta[data-cz-seo="true"][name="google-site-verification"]')?.getAttribute('content')).toBe(
      'real-search-console-token',
    );
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.commanderzone.com/es/',
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
    preloadImage: '/assets/og/play-commander-og.png',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Play Commander online',
      },
    ],
  };
}
