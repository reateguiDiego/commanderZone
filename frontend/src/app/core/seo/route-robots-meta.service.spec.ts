import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { RouteRobotsMetaService } from './route-robots-meta.service';

describe('RouteRobotsMetaService', () => {
  let document: Document;
  let events: Subject<NavigationEnd>;
  let childRoute: ActivatedRoute;
  let rootRoute: ActivatedRoute;
  let service: RouteRobotsMetaService;

  beforeEach(() => {
    events = new Subject<NavigationEnd>();
    childRoute = createActivatedRoute('login');
    rootRoute = {
      firstChild: childRoute,
      snapshot: { data: {} },
    } as unknown as ActivatedRoute;

    TestBed.configureTestingModule({
      providers: [
        RouteRobotsMetaService,
        {
          provide: Router,
          useValue: { events },
        },
        {
          provide: ActivatedRoute,
          useValue: rootRoute,
        },
      ],
    });

    document = TestBed.inject(DOCUMENT);
    document.head.querySelectorAll('[data-cz-route-robots="true"]').forEach((element) => element.remove());
    service = TestBed.inject(RouteRobotsMetaService);
  });

  afterEach(() => {
    document.head.querySelectorAll('[data-cz-route-robots="true"]').forEach((element) => element.remove());
  });

  it('sets noindex, nofollow for private runtime routes', () => {
    service.initialize();

    expect(routeRobotsMeta()?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('sets noindex, nofollow for out-of-scope routes', () => {
    setCurrentPageKey('gameDebug');

    service.initialize();

    expect(routeRobotsMeta()?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('sets noindex, follow for the wildcard 404 route', () => {
    setCurrentPageKey('wildcardRedirect');

    service.initialize();

    expect(routeRobotsMeta()?.getAttribute('content')).toBe('noindex, follow');
  });

  it('sets noindex, follow for legal routes', () => {
    setCurrentPageKey('legal');

    service.initialize();

    expect(routeRobotsMeta()?.getAttribute('content')).toBe('noindex, follow');
  });

  it('clears route-level robots meta for SEO-static routes', () => {
    service.initialize();
    expect(routeRobotsMeta()).toBeTruthy();

    setCurrentPageKey('playCommanderOnline');
    events.next(new NavigationEnd(1, '/en/play-commander-online/', '/en/play-commander-online/'));

    expect(routeRobotsMeta()).toBeNull();
  });

  function setCurrentPageKey(pageKey: string): void {
    childRoute = createActivatedRoute(pageKey);
    (rootRoute as { firstChild: ActivatedRoute }).firstChild = childRoute;
  }

  function routeRobotsMeta(): HTMLMetaElement | null {
    return document.head.querySelector('meta[data-cz-route-robots="true"][name="robots"]');
  }
});

function createActivatedRoute(pageKey: string): ActivatedRoute {
  return {
    firstChild: null,
    snapshot: {
      data: { pageKey },
    },
  } as unknown as ActivatedRoute;
}
