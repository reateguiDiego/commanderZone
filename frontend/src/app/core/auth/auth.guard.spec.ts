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
            isAuthenticated: () => false,
            refreshSession: vi.fn().mockResolvedValue(null),
            loadMe: vi.fn(),
            clearSession: vi.fn(),
          },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/rooms/room-1/waiting' } as never));

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/auth/login'], { queryParams: { redirect: '/rooms/room-1/waiting' } }));
  });

  it('redirects authenticated guests to dashboard', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            isAuthenticated: () => true,
          },
        },
      ],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({ redirect: '/rooms/room-1/waiting' }) } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/rooms/room-1/waiting'));
  });
});
