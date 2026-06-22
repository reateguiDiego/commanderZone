import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import { User } from '../models/user.model';
import { AuthStore } from './auth.store';

describe('AuthStore backend auth', () => {
  let authApi: {
    login: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    me: ReturnType<typeof vi.fn>;
    offline: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  const user: User = {
    id: 'user-1',
    email: 'player@example.test',
    displayName: 'Player',
    roles: ['ROLE_USER'],
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.classList.remove('dashboard-background');
    document.documentElement.style.removeProperty('--app-session-background');
    authApi = {
      login: vi.fn().mockReturnValue(of({ token: 'jwt-token' })),
      register: vi.fn().mockReturnValue(of({ user })),
      me: vi.fn().mockReturnValue(of({ user })),
      offline: vi.fn().mockReturnValue(of(undefined)),
      refresh: vi.fn().mockReturnValue(of({ token: 'refresh-token' })),
      logout: vi.fn().mockReturnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApi, useValue: authApi }],
    });
  });

  it('does not initialize the visual session background until an auth transition needs it', () => {
    TestBed.inject(AuthStore);

    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('');
  });

  it('stores backend token in memory and user in local storage on login', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('player@example.test', 'password123');

    expect(authApi.login).toHaveBeenCalledWith({ identifier: 'player@example.test', password: 'password123' });
    expect(authApi.me).toHaveBeenCalled();
    expect(store.token()).toBe('jwt-token');
    expect(store.user()).toEqual(user);
    expect(localStorage.getItem('commanderzone.jwt')).toBeNull();
    expect(localStorage.getItem('commanderzone.user')).toContain('player@example.test');
  });

  it('registers with backend and does not auto-login', async () => {
    const store = TestBed.inject(AuthStore);

    await store.register('player@example.test', 'Player', 'password123');

    expect(authApi.register).toHaveBeenCalledWith({
      email: 'player@example.test',
      displayName: 'Player',
      password: 'password123',
    });
    expect(authApi.login).not.toHaveBeenCalled();
    expect(store.token()).toBeNull();
    expect(store.user()).toBeNull();
  });

  it('can establish a session directly from a token', async () => {
    const store = TestBed.inject(AuthStore);

    await store.loginWithToken('jwt-token');

    expect(authApi.me).toHaveBeenCalled();
    expect(store.token()).toBe('jwt-token');
    expect(store.user()?.displayName).toBe('Player');
  });

  it('restores from refresh cookie on initialize', async () => {
    localStorage.setItem('commanderzone.user', JSON.stringify(user));
    const store = TestBed.inject(AuthStore);
    await store.initialize();

    expect(authApi.refresh).toHaveBeenCalledTimes(1);
    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(store.token()).toBe('refresh-token');
    expect(store.user()?.displayName).toBe('Player');
  });

  it('removes legacy localStorage token during initialize', async () => {
    localStorage.setItem('commanderzone.jwt', 'legacy-token');
    const store = TestBed.inject(AuthStore);

    await store.initialize();

    expect(localStorage.getItem('commanderzone.jwt')).toBeNull();
  });

  it('clears token and user on logout', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('player@example.test', 'password123');
    await store.logout();

    expect(authApi.offline).toHaveBeenCalled();
    expect(authApi.logout).toHaveBeenCalled();
    expect(store.token()).toBeNull();
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('commanderzone.user')).toBeNull();
  });

  it('clears session when /me fails during login', async () => {
    authApi.me.mockReturnValue(throwError(() => new Error('failed')));
    const store = TestBed.inject(AuthStore);

    await expect(store.login('player@example.test', 'password123')).rejects.toThrow('failed');

    expect(store.token()).toBeNull();
    expect(localStorage.getItem('commanderzone.user')).toBeNull();
  });

  it('stores login failure count from backend auth errors', async () => {
    authApi.login.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 401,
      error: { error: 'Invalid credentials.', count: 3 },
    })));
    const store = TestBed.inject(AuthStore);

    await expect(store.login('player@example.test', 'bad-password')).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(store.error()).toBe('Invalid credentials.');
    expect(store.loginFailureCount()).toBe(3);

    store.clearError();

    expect(store.error()).toBeNull();
    expect(store.loginFailureCount()).toBeNull();
  });

  it('ignores stale /me responses from a previous token during auto-login', async () => {
    const previousUser: User = {
      id: 'user-prev',
      email: 'previous@example.test',
      displayName: 'Previous',
      roles: ['ROLE_USER'],
    };
    const nextUser: User = {
      id: 'user-next',
      email: 'next@example.test',
      displayName: 'Next',
      roles: ['ROLE_USER'],
    };
    const previousMe = new Subject<{ user: User }>();
    const nextMe = new Subject<{ user: User }>();

    authApi.me
      .mockReturnValueOnce(previousMe.asObservable())
      .mockReturnValueOnce(nextMe.asObservable());
    const store = TestBed.inject(AuthStore);
    const firstLogin = store.loginWithToken('previous-token');
    const secondLogin = store.loginWithToken('next-token');

    nextMe.next({ user: nextUser });
    nextMe.complete();
    await secondLogin;

    previousMe.next({ user: previousUser });
    previousMe.complete();
    await firstLogin;

    expect(store.token()).toBe('next-token');
    expect(store.user()?.id).toBe('user-next');
    expect(store.user()?.email).toBe('next@example.test');
  });

  it('does not clear a new session if an old /me request fails late', async () => {
    const nextUser: User = {
      id: 'user-next',
      email: 'next@example.test',
      displayName: 'Next',
      roles: ['ROLE_USER'],
    };
    const previousMe = new Subject<{ user: User }>();

    authApi.me
      .mockReturnValueOnce(previousMe.asObservable())
      .mockReturnValueOnce(of({ user: nextUser }));
    const store = TestBed.inject(AuthStore);
    const firstLogin = store.loginWithToken('previous-token');
    await store.loginWithToken('next-token');
    previousMe.error(new Error('stale failed'));
    await expect(firstLogin).rejects.toThrow('stale failed');

    expect(store.token()).toBe('next-token');
    expect(store.user()?.id).toBe('user-next');
  });
});
