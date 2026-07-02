import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { LegalPageComponent } from './legal-page.component';

describe('LegalPageComponent', () => {
  let document: Document;

  async function configureLegalPageTest(routeData = { legalPageKey: 'privacy', locale: 'es' }): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [LegalPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            data: of(routeData),
            snapshot: { data: routeData },
          },
        },
      ],
    }).compileComponents();
  }

  beforeEach(async () => {
    await configureLegalPageTest();

    document = TestBed.inject(DOCUMENT);
    document.head.querySelectorAll('[data-cz-seo="true"], [data-cz-legal="true"]').forEach((element) => element.remove());
  });

  afterEach(() => {
    document.head.querySelectorAll('[data-cz-seo="true"], [data-cz-legal="true"]').forEach((element) => element.remove());
  });

  it('renders localized legal content instead of the SEO home', () => {
    const fixture = TestBed.createComponent(LegalPageComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Política de privacidad');
    expect(element.textContent).toContain('Qué datos tratamos');
    expect(element.textContent).toContain('CommanderZone');
    expect(element.textContent).toContain('info.dev.sunrise@gmail.com');
    expect(element.textContent).toContain('España');
    expect(element.textContent).toContain('No usa analítica');
    expect(element.textContent).not.toContain('Analítica opcional');
    const contactLink = element.querySelector('.legal-page__section-actions a[href="/contact"]') as HTMLAnchorElement | null;
    expect(contactLink?.textContent?.trim()).toBe('Ir a contacto');
    expect(Array.from(element.querySelectorAll('.legal-page__nav a')).map((link) => link.textContent?.trim())).toEqual([
      'Inicio de CommanderZone',
      'Privacidad',
      'Cookies',
      'Términos',
    ]);
    expect(element.textContent).not.toContain('Play Commander online with your pod');
  });

  it('applies localized legal metadata without hreflang or structured data', () => {
    const title = TestBed.inject(Title);
    const fixture = TestBed.createComponent(LegalPageComponent);
    fixture.detectChanges();

    expect(title.getTitle()).toBe('Política de privacidad | CommanderZone');
    expect(document.documentElement.lang).toBe('es');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.head.querySelector('meta[data-cz-legal="true"][name="description"]')?.getAttribute('content')).toContain(
      'CommanderZone trata datos de cuenta',
    );
    expect(document.head.querySelector('meta[data-cz-legal="true"][name="description"]')?.getAttribute('content')).toContain(
      'preparación publicitaria',
    );
    expect(document.head.querySelector('link[data-cz-legal="true"][rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.commanderzone.com/es/politica-privacidad/',
    );
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it('renders the cookie inventory for production readiness', async () => {
    TestBed.resetTestingModule();
    await configureLegalPageTest({ legalPageKey: 'cookies', locale: 'es' });

    const fixture = TestBed.createComponent(LegalPageComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Política de cookies');
    expect(element.textContent).toContain('commanderzone.refresh');
    expect(element.textContent).toContain('mercureAuthorization');
    expect(element.textContent).toContain('commanderzone.cookieConsent');
    expect(element.textContent).toContain('commanderzone.user');
    expect(element.textContent).toContain('commanderzone.theme');
    expect(element.textContent).toContain('commanderzone.deck-history');
    expect(element.textContent).toContain('no usa cookies de analítica');
    expect(element.textContent).toContain('no carga scripts publicitarios');
    expect(element.textContent).toContain('ni trata la publicidad como consentida');
    expect(element.textContent).toContain('scripts publicitarios');
    expect(element.textContent).not.toContain('Analítica opcional');
  });

});
