import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';

describe('AuthStore dummy auth', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('stores a dummy token and user on login', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('dummy@example.test', 'anything');

    expect(store.token()).toContain('dummy-dev-token');
    expect(store.user()).toEqual({
      id: 'dummy-dummy-example-test',
      email: 'dummy@example.test',
      displayName: 'dummy',
      roles: ['ROLE_USER'],
    });
    expect(localStorage.getItem('commanderzone.jwt')).toContain('dummy-dev-token');
    expect(localStorage.getItem('commanderzone.user')).toContain('dummy@example.test');
  });

  it('uses displayName when registering locally', async () => {
    const store = TestBed.inject(AuthStore);

    await store.register('jane@example.test', 'Jane Player', 'anything');

    expect(store.user()?.displayName).toBe('Jane Player');
  });

  it('restores the stored dummy user during initialize', async () => {
    localStorage.setItem('commanderzone.jwt', 'dummy-dev-token.restored');
    localStorage.setItem(
      'commanderzone.user',
      JSON.stringify({
        id: 'dummy-restored',
        email: 'restored@example.test',
        displayName: 'Restored Player',
        roles: ['ROLE_USER'],
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    const store = TestBed.inject(AuthStore);
    await store.initialize();

    expect(store.user()?.displayName).toBe('Restored Player');
  });

  it('clears token and user on logout', async () => {
    const store = TestBed.inject(AuthStore);

    await store.login('dummy@example.test', 'anything');
    store.logout();

    expect(store.token()).toBeNull();
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('commanderzone.jwt')).toBeNull();
    expect(localStorage.getItem('commanderzone.user')).toBeNull();
  });
});
