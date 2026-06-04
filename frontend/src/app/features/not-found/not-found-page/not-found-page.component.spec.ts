import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { NotFoundPageComponent, localeFromNotFoundUrl } from './not-found-page.component';

class RouterStub {
  readonly events = new Subject<NavigationEnd>();
  url = '/en/missing-page';
}

describe('NotFoundPageComponent', () => {
  let fixture: ComponentFixture<NotFoundPageComponent>;
  let router: RouterStub;

  beforeEach(async () => {
    router = new RouterStub();

    await TestBed.configureTestingModule({
      imports: [NotFoundPageComponent],
      providers: [
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    router.events.complete();
  });

  it('detects only supported SEO locales and falls back to English', () => {
    expect(localeFromNotFoundUrl('/es/ruta-rota')).toBe('es');
    expect(localeFromNotFoundUrl('/en/missing?from=test')).toBe('en');
    expect(localeFromNotFoundUrl('/de/kaputt')).toBe('de');
    expect(localeFromNotFoundUrl('/fr/inconnue')).toBe('fr');
    expect(localeFromNotFoundUrl('/pt/rota-errada')).toBe('pt');
    expect(localeFromNotFoundUrl('/it/percorso-rotto')).toBe('it');
    expect(localeFromNotFoundUrl('/zh-hans/missing#section')).toBe('en');
    expect(localeFromNotFoundUrl('/ca/ruta-rara')).toBe('en');
    expect(localeFromNotFoundUrl('/ja/not-found')).toBe('en');
    expect(localeFromNotFoundUrl('/unknown/path')).toBe('en');
  });

  it('renders the English 404 with public crawlable links', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));
    const image = element.querySelector('.not-found-page__media img') as HTMLImageElement | null;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    expect(element.textContent).toContain('The page you were looking for does not exist.');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/en/play-commander-online/',
      '/en/faq/',
    ]);
    expect(image?.getAttribute('src')).toBe('/assets/og/404-og.png');
    expect(image?.getAttribute('alt')).toBe('CommanderZone 404 image for a page not found.');
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | CommanderZone');
    expect(TestBed.inject(Meta).getTag('name="description"')?.getAttribute('content')).toBe(
      'The page you were looking for does not exist.',
    );
  });

  it('updates localized copy after navigation while keeping public links', () => {
    router.events.next(new NavigationEnd(1, '/es/ruta-rota', '/es/ruta-rota'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('es');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Pagina no encontrada');
    expect(element.textContent).toContain('La pagina que buscabas no existe.');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/en/play-commander-online/',
      '/en/faq/',
    ]);
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | CommanderZone');
  });

  it('keeps invalid mixed SEO paths on the localized not-found page', () => {
    router.events.next(new NavigationEnd(1, '/fr/play-commander-online/', '/fr/play-commander-online/'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('fr');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page introuvable');
  });
});
