import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
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
      providers: [{ provide: Router, useValue: router }],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    router.events.complete();
  });

  it('detects the locale from supported localized invalid paths', () => {
    expect(localeFromNotFoundUrl('/es/ruta-rota')).toBe('es');
    expect(localeFromNotFoundUrl('/en/missing?from=test')).toBe('en');
    expect(localeFromNotFoundUrl('/zh-hans/missing#section')).toBe('zh-hans');
    expect(localeFromNotFoundUrl('/en/jugar-commander-online/')).toBe('en');
    expect(localeFromNotFoundUrl('/unknown/path')).toBe('es');
  });

  it('renders localized home and FAQ links for the invalid locale path', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/', '/en/faq/']);
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | CommanderZone');
  });

  it('updates the localized links after navigation to another invalid locale path', () => {
    router.events.next(new NavigationEnd(1, '/es/ruta-rota', '/es/ruta-rota'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Pagina no encontrada');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/es/', '/es/faq/']);
    expect(TestBed.inject(Title).getTitle()).toBe('Pagina no encontrada | CommanderZone');
  });

  it('keeps invalid mixed SEO paths on the localized not-found page', () => {
    router.events.next(new NavigationEnd(1, '/fr/play-commander-online/', '/fr/play-commander-online/'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('.not-found-page')?.getAttribute('lang')).toBe('fr');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page introuvable');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/fr/', '/fr/faq/']);
  });
});
