import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';

describe('auth guards', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    });
  });

  it('redirects anonymous users to login', () => {
    const result = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/auth/login']));
  });

  it('redirects authenticated guests to dashboard', () => {
    localStorage.setItem('commanderzone.jwt', 'token');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/dashboard']));
  });
});

