import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { AuthPageComponent } from './auth-page.component';

describe('AuthPageComponent', () => {
  async function create(path: 'auth/login' | 'auth/register'): Promise<ComponentFixture<AuthPageComponent>> {
    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path } } },
        },
        {
          provide: AuthStore,
          useValue: {
            error: signal<string | null>(null),
            loading: signal(false),
            login: vi.fn().mockResolvedValue(undefined),
            register: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();

    return TestBed.createComponent(AuthPageComponent);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('starts in login mode on the login route', async () => {
    const fixture = await create('auth/login');

    expect(fixture.componentInstance.mode()).toBe('login');
  });

  it('starts in register mode on the register route', async () => {
    const fixture = await create('auth/register');

    expect(fixture.componentInstance.mode()).toBe('register');
  });
});
