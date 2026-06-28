import { Component } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { loadingInterceptor } from './loading.interceptor';
import { LoadingStore } from './loading.store';
import { withGlobalLoading, withGlobalLoadingForFeature, withoutGlobalLoading } from './loading-context';

@Component({ template: '' })
class EmptyRouteComponent {}

describe('loadingInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let loading: LoadingStore;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loadingInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: EmptyRouteComponent },
          { path: 'cards', component: EmptyRouteComponent },
          { path: 'dashboard', component: EmptyRouteComponent },
          { path: 'games/:id', component: EmptyRouteComponent },
        ]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    loading = TestBed.inject(LoadingStore);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/dashboard');
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('tracks normal requests outside skipped features', () => {
    http.get('/api/decks').subscribe();

    const request = httpTesting.expectOne('/api/decks');
    expect(loading.active()).toBe(true);

    request.flush({});

    expect(loading.active()).toBe(false);
  });

  it('skips requests with the API loading opt-out', () => {
    http.get('/api/cards/search', { context: withoutGlobalLoading() }).subscribe();

    const request = httpTesting.expectOne('/api/cards/search');
    expect(loading.active()).toBe(false);

    request.flush({});
  });

  it('skips requests while the current feature owns local loading', async () => {
    await router.navigateByUrl('/games/game-1');

    http.get('/api/decks').subscribe();

    const request = httpTesting.expectOne('/api/decks');
    expect(loading.active()).toBe(false);

    request.flush({});
  });

  it('tracks requests that are enabled for the current feature', async () => {
    await router.navigateByUrl('/cards');

    http.get('/api/cards/search', { context: withGlobalLoadingForFeature('cards') }).subscribe();

    const request = httpTesting.expectOne('/api/cards/search');
    expect(loading.active()).toBe(true);

    request.flush({});

    expect(loading.active()).toBe(false);
  });

  it('skips feature-enabled requests outside their enabled feature', async () => {
    await router.navigateByUrl('/dashboard');

    http.get('/api/cards/search', { context: withGlobalLoadingForFeature('cards') }).subscribe();

    const request = httpTesting.expectOne('/api/cards/search');
    expect(loading.active()).toBe(false);

    request.flush({});
  });

  it('allows an API request to force the global loader inside a skipped feature', async () => {
    await router.navigateByUrl('/games/game-1');

    http.get('/api/cards/import', { context: withGlobalLoading() }).subscribe();

    const request = httpTesting.expectOne('/api/cards/import');
    expect(loading.active()).toBe(true);

    request.flush({});

    expect(loading.active()).toBe(false);
  });
});
