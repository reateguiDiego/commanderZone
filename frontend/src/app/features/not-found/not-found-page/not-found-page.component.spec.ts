import { DOCUMENT } from '@angular/common';
import { Signal, signal } from '@angular/core';
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
  let authenticated: ReturnType<typeof signal<boolean | undefined>>;
  let fixture: ComponentFixture<NotFoundPageComponent>;
  let router: RouterStub;

  beforeEach(async () => {
    authenticated = signal<boolean | undefined>(false);
    router = new RouterStub();

    await TestBed.configureTestingModule({
      imports: [NotFoundPageComponent],
      providers: [
        { provide: Router, useValue: router },
        {
          provide: AuthStore,
          useValue: {
            isAuthenticated: authenticated.asReadonly() as Signal<boolean>,
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

  it('renders the English 404 with exactly one anonymous CTA to root', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));
    const image = element.querySelector('.not-found-page__media img') as HTMLImageElement | null;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    expect(element.textContent).toContain('This page slipped into exile. Return to CommanderZone and keep playing.');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/');
    expect(links[0]?.textContent?.trim()).toBe('Back home');
    expect(image?.getAttribute('src')).toBe('/assets/og/404-og.png');
    expect(image?.getAttribute('alt')).toBe('CommanderZone 404 illustration');
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | CommanderZone');
    expect(TestBed.inject(Meta).getTag('name="description"')?.getAttribute('content')).toBe(
      'This page slipped into exile. Return to CommanderZone and keep playing.',
    );
  });

  it('points the single CTA to dashboard for authenticated users', () => {
    authenticated.set(true);
    fixture.detectChanges();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];

    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/dashboard');
    expect(links[0]?.textContent?.trim()).toBe('Back to dashboard');
  });

  it('keeps the CTA on root when auth is false or unresolved', () => {
    authenticated.set(false);
    fixture.detectChanges();
    expect(primaryCta()?.getAttribute('href')).toBe('/');
    expect(primaryCta()?.textContent?.trim()).toBe('Back home');

    authenticated.set(undefined);
    fixture.detectChanges();
    expect(primaryCta()?.getAttribute('href')).toBe('/');
    expect(primaryCta()?.textContent?.trim()).toBe('Back home');
  });

  it('does not render SEO landing links or extra CTAs', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));
    const visibleText = element.textContent ?? '';

    expect(links).toHaveLength(1);
    expect(links.some((link) => link.getAttribute('href')?.includes('/en/faq/'))).toBe(false);
    expect(links.some((link) => link.getAttribute('href')?.includes('/en/play-commander-online/'))).toBe(false);
    expect(visibleText).not.toContain('FAQ');
    expect(visibleText).not.toContain('Play Commander Online');
    expect(visibleText).not.toContain('SpellTable Alternative');
    expect(visibleText).not.toContain('How to Play Commander Online');
  });

  it('clears managed SEO canonical, hreflang and JSON-LD tags on navigation', () => {
    const document = TestBed.inject(DOCUMENT);
    document.head.insertAdjacentHTML('beforeend', `
      <link data-cz-seo="true" rel="canonical" href="https://www.commanderzone.com/">
      <link data-cz-seo="true" rel="alternate" hreflang="en" href="https://www.commanderzone.com/">
      <script data-cz-seo="true" type="application/ld+json">{}</script>
    `);

    router.events.next(new NavigationEnd(1, '/missing-again', '/missing-again'));
    fixture.detectChanges();

    expect(document.head.querySelector('link[data-cz-seo="true"][rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('link[data-cz-seo="true"][rel="alternate"]')).toBeNull();
    expect(document.head.querySelector('script[data-cz-seo="true"][type="application/ld+json"]')).toBeNull();
  });

  it('updates localized title, copy, CTA and alt after navigation', () => {
    router.events.next(new NavigationEnd(1, '/es/ruta-rota', '/es/ruta-rota'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a');
    const image = element.querySelector('.not-found-page__media img') as HTMLImageElement | null;

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('es');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Página no encontrada');
    expect(element.textContent).toContain('Esta página se ha ido al exilio. Vuelve a CommanderZone y sigue jugando.');
    expect(link?.getAttribute('href')).toBe('/');
    expect(link?.textContent?.trim()).toBe('Volver al inicio');
    expect(image?.getAttribute('alt')).toBe('Ilustración 404 de CommanderZone');
    expect(TestBed.inject(Title).getTitle()).toBe('Página no encontrada | CommanderZone');
  });

  it('keeps invalid mixed SEO paths on the localized not-found page', () => {
    router.events.next(new NavigationEnd(1, '/fr/play-commander-online/', '/fr/play-commander-online/'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('fr');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page introuvable');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  function primaryCta(): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('a.primary-button');
  }
});
