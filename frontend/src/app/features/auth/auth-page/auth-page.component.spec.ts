import { importProvidersFrom, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Eye, EyeOff, LogIn, LucideAngularModule } from 'lucide-angular';
import { of } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { AuthPageComponent } from './auth-page.component';

describe('AuthPageComponent', () => {
  async function create(path: 'auth/login' | 'auth/register'): Promise<ComponentFixture<AuthPageComponent>> {
    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Eye, EyeOff, LogIn })),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path } } },
        },
        {
          provide: AuthStore,
          useValue: {
            error: signal<string | null>(null),
            loading: signal(false),
            clearError: vi.fn(),
            login: vi.fn().mockResolvedValue(undefined),
            register: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthApi,
          useValue: {
            checkEmailAvailability: vi.fn().mockReturnValue(of({ available: true })),
            checkDisplayNameAvailability: vi.fn().mockReturnValue(of({ available: true })),
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

  it('keeps login disabled until email and password are valid', async () => {
    const fixture = await create('auth/login');
    const component = fixture.componentInstance;

    expect(component.canSubmitLogin()).toBe(false);

    component.loginForm.setValue({ email: 'bad-email', password: 'password123' });
    expect(component.canSubmitLogin()).toBe(false);

    component.loginForm.setValue({ email: 'player@example.test', password: 'password123' });
    expect(component.canSubmitLogin()).toBe(true);
  });

  it('keeps login fields readonly until user focuses them', async () => {
    const fixture = await create('auth/login');
    fixture.detectChanges();

    const emailInput = fixture.nativeElement.querySelector(
      'input[formControlName="email"]',
    ) as HTMLInputElement;

    expect(emailInput.readOnly).toBe(true);
    emailInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(emailInput.readOnly).toBe(false);
  });

  it('requires valid fields, available email and available user name before enabling register', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;

    component.registerForm.setValue({
      email: 'player@example.test',
      displayName: 'Player',
      password: 'password123',
      confirmPassword: 'password123',
    });

    expect(component.canSubmitRegister()).toBe(false);

    component.emailAvailability.set('available');
    expect(component.canSubmitRegister()).toBe(false);

    component.userNameAvailability.set('available');
    expect(component.canSubmitRegister()).toBe(true);

    component.registerForm.controls.confirmPassword.setValue('different-password');
    expect(component.canSubmitRegister()).toBe(false);
  });
});
