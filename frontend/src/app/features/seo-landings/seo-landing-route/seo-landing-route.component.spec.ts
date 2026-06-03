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
    document.head.querySelectorAll('[data-seo-landing="true"]').forEach((element) => element.remove());

    fixture = TestBed.createComponent(SeoLandingRouteComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.head.querySelectorAll('[data-seo-landing="true"]').forEach((element) => element.remove());
  });

  it('renders the localized static SEO landing through the shared landing page', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('app-seo-landing-page')).toBeTruthy();
    expect(element.querySelector('h1')?.textContent).toContain('Asistente de mesa');
    expect(element.textContent).toContain('contador de vidas Magic');
    expect(element.textContent).toContain('daño de comandante');
  });

  it('applies localized SEO metadata, canonical, hreflang and JSON-LD', () => {
    const title = TestBed.inject(Title);
    const canonical = document.head.querySelector('link[data-seo-landing="true"][rel="canonical"]');
    const alternates = document.head.querySelectorAll('link[data-seo-landing="true"][rel="alternate"]');
    const jsonLd = document.head.querySelector('script[data-seo-landing="true"][type="application/ld+json"]');

    expect(title.getTitle()).toContain('Asistente de mesa');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('Asistente de mesa');
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain('Asistente de mesa');
    expect(canonical?.getAttribute('href')).toBe('/es/asistente-de-mesa-magic/');
    expect(alternates.length).toBe(13);
    expect(jsonLd?.textContent).toContain('"@type":"WebPage"');
  });
});
