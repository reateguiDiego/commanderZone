import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
    expect(authApi.login).toHaveBeenCalledWith({ email: 'player@example.test', password: 'password123' });
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
});
