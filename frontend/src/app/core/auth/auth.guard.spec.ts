import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';

describe('auth guards', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    });
  });

  it('redirects anonymous users to login', () => {
    const result = TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/rooms/room-1/waiting' } as never));

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/auth/login'], { queryParams: { redirect: '/rooms/room-1/waiting' } }));
  });

  it('redirects authenticated guests to dashboard', () => {
    localStorage.setItem('commanderzone.jwt', 'token');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({ queryParamMap: convertToParamMap({ redirect: '/rooms/room-1/waiting' }) } as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).parseUrl('/rooms/room-1/waiting'));
  });
});
