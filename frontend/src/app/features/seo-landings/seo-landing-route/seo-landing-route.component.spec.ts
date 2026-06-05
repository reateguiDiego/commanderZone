import { DOCUMENT } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { SeoLandingRouteComponent } from './seo-landing-route.component';

describe('SeoLandingRouteComponent', () => {
  let fixture: ComponentFixture<SeoLandingRouteComponent>;
  let document: Document;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeoLandingRouteComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ routeKey: 'tableAssistant', locale: 'es' }),
          },
        },
      ],
    }).compileComponents();

    document = TestBed.inject(DOCUMENT);
    document.head.querySelectorAll('[data-cz-seo="true"], [data-seo-landing="true"]').forEach((element) => element.remove());

    fixture = TestBed.createComponent(SeoLandingRouteComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.head.querySelectorAll('[data-cz-seo="true"], [data-seo-landing="true"]').forEach((element) => element.remove());
  });

  it('renders the localized static SEO landing through the shared landing page', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('app-seo-landing-page')).toBeTruthy();
    expect(element.querySelector('h1')?.textContent?.toLowerCase()).toContain('contador de vidas');
    expect(element.textContent).toContain('Contador de vidas');
    expect(element.textContent).toContain('daño de comandante');
  });

  it('applies localized SEO metadata, canonical, hreflang and JSON-LD', () => {
    const title = TestBed.inject(Title);
    const canonical = document.head.querySelector('link[data-cz-seo="true"][rel="canonical"]');
    const preload = document.head.querySelector('link[data-cz-seo="true"][rel="preload"][as="image"]');
    const alternates = document.head.querySelectorAll('link[data-cz-seo="true"][rel="alternate"]');
    const xDefault = document.head.querySelector('link[data-cz-seo="true"][rel="alternate"][hreflang="x-default"]');
    const jsonLdScripts = document.head.querySelectorAll('script[data-cz-seo="true"][type="application/ld+json"]');
    const jsonLd = document.head.querySelector('script[data-cz-seo="true"][type="application/ld+json"]');

    expect(title.getTitle()).toContain('Contador de vidas');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="description"]')?.getAttribute('content')?.toLowerCase()).toContain('contador de vidas');
    expect(document.documentElement.lang).toBe('es');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="robots"]')?.getAttribute('content')).toBe('index, follow');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:title"]')?.getAttribute('content')).toContain('Contador de vidas');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:description"]')?.getAttribute('content')?.toLowerCase()).toContain('contador de vidas');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:type"]')?.getAttribute('content')).toBe('website');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:url"]')?.getAttribute('content')).toBe('https://www.commanderzone.com/es/contador-vidas-commander/');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:image"]')?.getAttribute('content')).toBe('https://www.commanderzone.com/assets/og/table-assistant-og.png');
    expect(document.head.querySelector('meta[data-cz-seo="true"][property="og:locale"]')?.getAttribute('content')).toBe('es_ES');
    expect(document.head.querySelectorAll('meta[data-cz-seo="true"][property="og:locale:alternate"]').length).toBe(5);
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:title"]')?.getAttribute('content')).toContain('Contador de vidas');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:description"]')?.getAttribute('content')?.toLowerCase()).toContain('contador de vidas');
    expect(document.head.querySelector('meta[data-cz-seo="true"][name="twitter:image"]')?.getAttribute('content')).toBe('https://www.commanderzone.com/assets/og/table-assistant-og.png');
    expect(canonical?.getAttribute('href')).toBe('https://www.commanderzone.com/es/contador-vidas-commander/');
    expect(preload?.getAttribute('href')).toBe('https://www.commanderzone.com/assets/seo/commander-life-counter-hero.webp');
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(alternates.length).toBe(7);
    expect(xDefault?.getAttribute('href')).toBe('https://www.commanderzone.com/en/commander-life-counter/');
    expect(jsonLdScripts.length).toBe(1);
    const jsonLdGraph = jsonLd?.textContent ? getJsonLdGraph(jsonLd.textContent) : [];
    expect(jsonLdGraph.map((node) => node['@type'])).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'WebApplication',
      'FAQPage',
    ]));
    expect(jsonLdGraph.find((node) => node['@type'] === 'WebApplication')?.['url']).toBe(
      'https://www.commanderzone.com/es/contador-vidas-commander/',
    );
    expect(jsonLdGraph.find((node) => node['@type'] === 'WebApplication')?.['@id']).toBe(
      'https://www.commanderzone.com/es/contador-vidas-commander/#software',
    );
    expect(jsonLdGraph.find((node) => node['@type'] === 'FAQPage')?.['mainEntity']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'Question',
        name: expect.stringMatching(/Asistente de mesa|asistente de mesa/),
      }),
    ]));
  });

  it('keeps FAQ crawlable in the public footer without header CTA navigation', () => {
    const element: HTMLElement = fixture.nativeElement;
    const footerFaqLink = element.querySelector('.seo-landing-layout__footer a[href="/es/faq/"]');

    expect(element.querySelector('.seo-landing-layout__nav')).toBeNull();
    expect(footerFaqLink).toBeTruthy();
  });
});

type JsonLdObject = Readonly<Record<string, unknown>>;

function getJsonLdGraph(serializedJsonLd: string): readonly JsonLdObject[] {
  const jsonLd = JSON.parse(serializedJsonLd) as JsonLdObject;
  const graph = jsonLd['@graph'];

  return Array.isArray(graph)
    ? graph.filter((node): node is JsonLdObject => node !== null && typeof node === 'object' && !Array.isArray(node))
    : [];
}
