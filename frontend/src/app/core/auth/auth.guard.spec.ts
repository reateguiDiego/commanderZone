import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { authGuard, guestGuard } from './auth.guard';

describe('auth guards', () => {
  it('redirects anonymous users to login', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => false,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/rooms/room-1/waiting' } as never));

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/auth/login'], { queryParams: { redirect: '/rooms/room-1/waiting' } }));
  });

  it('redirects authenticated guests to dashboard when no redirect is provided', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({}) } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/dashboard'));
  });

  it('uses route data as the authenticated guest fallback redirect', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({
      queryParamMap: convertToParamMap({}),
      data: { authenticatedRedirect: '/decks' },
    } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/decks'));
  });

  it('keeps the query redirect above the route data redirect for authenticated guests', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({
      queryParamMap: convertToParamMap({ redirect: '/rooms' }),
      data: { authenticatedRedirect: '/decks' },
    } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/rooms'));
  });

  it('ignores unsafe route data redirects for authenticated guests', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({
      queryParamMap: convertToParamMap({}),
      data: { authenticatedRedirect: 'https://evil.test/decks' },
    } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/dashboard'));
  });

  it('allows server and prerender execution without initializing auth', () => {
    const initialize = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: AuthStore,
          useValue: {
            initialize,
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({
      queryParamMap: convertToParamMap({}),
      data: { authenticatedRedirect: '/decks' },
    } as never, {} as never));

    expect(result).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('allows unauthenticated guests', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => false,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({}) } as never, {} as never));

    expect(result).toBe(true);
  });

  it('redirects authenticated root visits to dashboard when no redirect is provided', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({}) } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/dashboard'));
  });

  it('allows anonymous guests to access public pages', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            isAuthenticated: () => false,
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({}) } as never, {} as never));

    expect(result).toBe(true);
  });
});
