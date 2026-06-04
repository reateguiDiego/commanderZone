import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { LegalPageComponent } from './legal-page.component';

describe('LegalPageComponent', () => {
  let document: Document;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LegalPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ legalPageKey: 'privacy', locale: 'es' }),
            snapshot: { data: { legalPageKey: 'privacy', locale: 'es' } },
          },
        },
      ],
    }).compileComponents();

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
    expect(element.textContent).toContain('CommanderZone es contenido de fans no oficial');
    expect(Array.from(element.querySelectorAll('.legal-page__footer a')).map((link) => link.textContent?.trim())).toEqual([
      'Preguntas frecuentes',
      'Asistente de mesa',
      'Importar mazo Commander',
      'Privacidad',
      'Cookies',
      'Términos',
      'Contacto',
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
    expect(document.head.querySelector('link[data-cz-legal="true"][rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.commanderzone.com/es/politica-privacidad/',
    );
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
