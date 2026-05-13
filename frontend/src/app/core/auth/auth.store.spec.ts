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
  };
  const user: User = {
    id: 'user-1',
    email: 'player@example.test',
    displayName: 'Player',
    roles: ['ROLE_USER'],
  };

  beforeEach(() => {
    localStorage.clear();
    authApi = {
      login: vi.fn().mockReturnValue(of({ token: 'jwt-token' })),
      register: vi.fn().mockReturnValue(of({ user })),
      me: vi.fn().mockReturnValue(of({ user })),
      offline: vi.fn().mockReturnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApi, useValue: authApi }],
    });
  });

  it('stores a backend token and user on login', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('player@example.test', 'password123');

    expect(authApi.login).toHaveBeenCalledWith({ email: 'player@example.test', password: 'password123' });
    expect(authApi.me).toHaveBeenCalled();
    expect(store.token()).toBe('jwt-token');
    expect(store.user()).toEqual(user);
    expect(localStorage.getItem('commanderzone.jwt')).toBe('jwt-token');
    expect(localStorage.getItem('commanderzone.user')).toContain('player@example.test');
  });

  it('registers then logs in with the backend', async () => {
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

  it('restores the stored token by loading /me', async () => {
    localStorage.setItem('commanderzone.jwt', 'stored-token');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApi, useValue: authApi }],
    });

    const store = TestBed.inject(AuthStore);
    await store.initialize();

    expect(authApi.me).toHaveBeenCalled();
    expect(store.user()?.displayName).toBe('Player');
  });

  it('clears token and user on logout', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('player@example.test', 'password123');
    await store.logout();

    expect(authApi.offline).toHaveBeenCalled();
    expect(store.token()).toBeNull();
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('commanderzone.jwt')).toBeNull();
    expect(localStorage.getItem('commanderzone.user')).toBeNull();
  });

  it('clears session when /me fails during login', async () => {
    authApi.me.mockReturnValue(throwError(() => new Error('failed')));
    const store = TestBed.inject(AuthStore);

    await expect(store.login('player@example.test', 'password123')).rejects.toThrow('failed');

    expect(store.token()).toBeNull();
    expect(localStorage.getItem('commanderzone.jwt')).toBeNull();
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

    localStorage.setItem('commanderzone.jwt', 'previous-token');
    authApi.me
      .mockReturnValueOnce(previousMe.asObservable())
      .mockReturnValueOnce(nextMe.asObservable());
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApi, useValue: authApi }],
    });

    const store = TestBed.inject(AuthStore);
    const initializePromise = store.initialize();
    const loginPromise = store.loginWithToken('next-token');

    nextMe.next({ user: nextUser });
    nextMe.complete();
    await loginPromise;

    previousMe.next({ user: previousUser });
    previousMe.complete();
    await initializePromise;

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

    localStorage.setItem('commanderzone.jwt', 'previous-token');
    authApi.me
      .mockReturnValueOnce(previousMe.asObservable())
      .mockReturnValueOnce(of({ user: nextUser }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApi, useValue: authApi }],
    });

    const store = TestBed.inject(AuthStore);
    const initializePromise = store.initialize();
    await store.loginWithToken('next-token');
    previousMe.error(new Error('stale failed'));
    await expect(initializePromise).rejects.toThrow('stale failed');

    expect(store.token()).toBe('next-token');
    expect(store.user()?.id).toBe('user-next');
  });
});
