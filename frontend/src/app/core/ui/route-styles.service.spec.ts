import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { RouteStylesService } from './route-styles.service';

describe('RouteStylesService', () => {
  let documentRef: Document;
  let service: RouteStylesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    documentRef = TestBed.inject(DOCUMENT);
    service = TestBed.inject(RouteStylesService);
    cleanupRouteStyles();
  });

  afterEach(() => {
    cleanupRouteStyles();
  });

  it('loads only public route styles for SEO and legal pages', () => {
    service.applyForPath('/en/play-commander-online/');

    expect(publicStylesheet()).not.toBeNull();
    expect(privateStylesheet()).toBeNull();
    expect(documentRef.body.classList.contains('cz-public-route')).toBe(true);
    expect(documentRef.body.classList.contains('cz-private-route')).toBe(false);

    service.applyForPath('/privacy-policy/');

    expect(publicStylesheet()).not.toBeNull();
    expect(privateStylesheet()).toBeNull();
  });

  it('loads only private route styles for noindex app pages', () => {
    service.applyForPath('/dashboard');

    expect(privateStylesheet()).not.toBeNull();
    expect(publicStylesheet()).toBeNull();
    expect(documentRef.body.classList.contains('cz-private-route')).toBe(true);
    expect(documentRef.body.classList.contains('cz-public-route')).toBe(false);
  });

  it('loads private route styles for /contact', () => {
    service.applyForPath('/contact');

    expect(privateStylesheet()).not.toBeNull();
    expect(publicStylesheet()).toBeNull();
    expect(documentRef.body.classList.contains('cz-private-route')).toBe(true);
    expect(documentRef.body.classList.contains('cz-public-route')).toBe(false);
  });

  it('removes route styles for unclassified pages', () => {
    service.applyForPath('/dashboard');
    service.applyForPath('/unknown');

    expect(privateStylesheet()).toBeNull();
    expect(publicStylesheet()).toBeNull();
    expect(documentRef.body.classList.contains('cz-private-route')).toBe(false);
    expect(documentRef.body.classList.contains('cz-public-route')).toBe(false);
  });

  function publicStylesheet(): HTMLElement | null {
    return documentRef.getElementById('cz-public-route-stylesheet');
  }

  function privateStylesheet(): HTMLElement | null {
    return documentRef.getElementById('cz-private-route-stylesheet');
  }

  function cleanupRouteStyles(): void {
    documentRef.getElementById('cz-public-route-stylesheet')?.remove();
    documentRef.getElementById('cz-private-route-stylesheet')?.remove();
    documentRef.body.classList.remove('cz-public-route', 'cz-private-route');
  }
});
