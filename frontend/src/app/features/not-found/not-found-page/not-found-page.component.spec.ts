import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotFoundPageComponent, localeFromNotFoundUrl } from './not-found-page.component';

class RouterStub {
  readonly events = new Subject<NavigationEnd>();
  url = '/en/missing-page';
}

describe('NotFoundPageComponent', () => {
  let authenticated: ReturnType<typeof signal<boolean>>;
  let fixture: ComponentFixture<NotFoundPageComponent>;
  let router: RouterStub;

  beforeEach(async () => {
    authenticated = signal(false);
    router = new RouterStub();

    await TestBed.configureTestingModule({
      imports: [NotFoundPageComponent],
      providers: [
        { provide: Router, useValue: router },
        {
          provide: AuthStore,
          useValue: {
            isAuthenticated: authenticated.asReadonly(),
          },
        },
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

  it('renders the English premium 404 with one anonymous CTA to root', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));
    const image = element.querySelector('.not-found-page__media img') as HTMLImageElement | null;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('This card got exiled');
    expect(element.textContent).toContain('The page you were looking for has vanished from the battlefield.');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/');
    expect(links[0]?.textContent?.trim()).toBe('Back to dashboard');
    expect(links[0]?.classList.contains('primary-button')).toBe(true);
    expect(image?.getAttribute('src')).toBe('/assets/og/404-og.png');
    expect(image?.getAttribute('alt')).toBe('CommanderZone 404 illustration with a card disappearing into a portal.');
    expect(TestBed.inject(Title).getTitle()).toBe('404 — Page not found | CommanderZone');
    expect(TestBed.inject(Meta).getTag('name="description"')?.getAttribute('content')).toBe(
      'The page you were looking for does not exist or has vanished from the battlefield.',
    );
  });

  it('points the single CTA to dashboard for authenticated users', () => {
    authenticated.set(true);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.primary-button') as HTMLAnchorElement | null;

    expect(link?.getAttribute('href')).toBe('/dashboard');
  });

  it('updates localized copy and image alt after navigation', () => {
    router.events.next(new NavigationEnd(1, '/es/ruta-rota', '/es/ruta-rota'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const image = element.querySelector('.not-found-page__media img') as HTMLImageElement | null;

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('es');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Esta carta se ha exiliado');
    expect(element.textContent).toContain('La página que buscabas ha desaparecido del campo de batalla.');
    expect(image?.getAttribute('alt')).toBe('Ilustración 404 de CommanderZone con una carta desapareciendo en un portal.');
    expect(TestBed.inject(Title).getTitle()).toBe('404 — Página no encontrada | CommanderZone');
  });

  it('keeps invalid mixed SEO paths on the localized not-found page', () => {
    router.events.next(new NavigationEnd(1, '/fr/play-commander-online/', '/fr/play-commander-online/'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('fr');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Cette carte a été exilée');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/');
  });
});
