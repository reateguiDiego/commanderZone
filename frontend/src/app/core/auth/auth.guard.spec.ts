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
