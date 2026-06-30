import { importProvidersFrom, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Check, Eye, EyeOff, LogIn, LucideAngularModule, TriangleAlert, UserPlus } from 'lucide-angular';
import { of } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { AuthPageComponent } from './auth-page.component';

describe('AuthPageComponent', () => {
  type AuthStoreMock = {
    error: WritableSignal<string | null>;
    loginFailureCount: WritableSignal<number | null>;
    loading: WritableSignal<boolean>;
    clearError: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  };

  async function create(
    path: 'auth/login' | 'auth/register',
    queryParams: Record<string, string> = {},
  ): Promise<ComponentFixture<AuthPageComponent>> {
    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Check, Eye, EyeOff, LogIn, TriangleAlert, UserPlus })),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path }, queryParamMap: convertToParamMap(queryParams) } },
        },
        {
          provide: AuthStore,
          useValue: {
            error: signal<string | null>(null),
            loginFailureCount: signal<number | null>(null),
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

  it('shows the completed registration notice on the login route', async () => {
    const fixture = await create('auth/login', { registered: '1' });
    fixture.detectChanges();

    expect(fixture.componentInstance.registrationCompletedNotice()).toBe(true);
    const disclaimer = fixture.nativeElement.querySelector('.app-disclaimer-callout') as HTMLElement | null;
    expect(disclaimer).not.toBeNull();
    expect(disclaimer?.textContent).toContain('Registration complete');
  });

  it('keeps the completed registration notice when switching away from login and back', async () => {
    const fixture = await create('auth/login', { registered: '1' });
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.setMode('register');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.app-disclaimer-callout')).toBeNull();
    expect(component.registrationCompletedNotice()).toBe(true);

    component.setMode('login');
    fixture.detectChanges();

    const disclaimer = fixture.nativeElement.querySelector('.app-disclaimer-callout') as HTMLElement | null;
    expect(disclaimer).not.toBeNull();
    expect(disclaimer?.textContent).toContain('Registration complete');
  });

  it('uses the shared tab list to switch auth modes', async () => {
    const fixture = await create('auth/login');
    fixture.detectChanges();

    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    const registerTab = tabs.find((tab) => tab.textContent?.includes('Register'));

    expect(fixture.nativeElement.querySelector('app-tab-list')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tab-list')?.classList).toContain('size-lg');
    expect(registerTab).toBeDefined();

    registerTab?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.mode()).toBe('register');
    expect(registerTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps login disabled until identifier and password are valid', async () => {
    const fixture = await create('auth/login');
    const component = fixture.componentInstance;

    expect(component.canSubmitLogin()).toBe(false);

    component.loginForm.setValue({ identifier: 'A', password: 'Password123!' });
    expect(component.canSubmitLogin()).toBe(false);

    component.loginForm.setValue({ identifier: 'PlayerName', password: 'Password123!' });
    expect(component.canSubmitLogin()).toBe(true);

    component.loginForm.setValue({ identifier: 'player@example.test', password: 'Password123!' });
    expect(component.canSubmitLogin()).toBe(true);
  });

  it('keeps login fields readonly until user focuses them', async () => {
    const fixture = await create('auth/login');
    fixture.detectChanges();

    const identifierInput = fixture.nativeElement.querySelector(
      'input[formControlName="identifier"]',
    ) as HTMLInputElement;

    expect(identifierInput.readOnly).toBe(true);
    identifierInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(identifierInput.readOnly).toBe(false);
  });

  it('warns before login lockout on the third and fourth failed attempts', async () => {
    const fixture = await create('auth/login');
    const auth = fixture.componentInstance.auth as unknown as AuthStoreMock;

    auth.error.set('Invalid credentials.');
    auth.loginFailureCount.set(2);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Failed login attempt 2/5');

    auth.loginFailureCount.set(3);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Failed login attempt 3/5');

    auth.loginFailureCount.set(4);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Failed login attempt 4/5');

    auth.loginFailureCount.set(5);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Failed login attempt 5/5');
  });

  it('requires valid fields, available email and available user name before enabling register', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;

    component.registerForm.setValue({
      email: 'player@example.test',
      displayName: 'Player',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    });

    expect(component.canSubmitRegister()).toBe(false);

    component.emailAvailability.set('available');
    expect(component.canSubmitRegister()).toBe(false);

    component.userNameAvailability.set('available');
    expect(component.canSubmitRegister()).toBe(true);

    component.registerForm.controls.confirmPassword.setValue('different-password');
    expect(component.canSubmitRegister()).toBe(false);
  });

  it('clears register fields and switches to login with a registration notice after creating an account', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.registerForm.setValue({
      email: 'player@example.test',
      displayName: 'Player',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    });
    component.emailAvailability.set('available');
    component.userNameAvailability.set('available');

    await component.submitRegister();
    fixture.detectChanges();

    expect(component.auth.register).toHaveBeenCalledWith('player@example.test', 'Player', 'Password123!');
    expect(component.mode()).toBe('login');
    expect(component.registrationCompletedNotice()).toBe(true);
    const disclaimer = fixture.nativeElement.querySelector('.app-disclaimer-callout') as HTMLElement | null;
    expect(disclaimer?.textContent).toContain('Registration complete');
    expect(component.registerForm.getRawValue()).toEqual({
      email: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    });
    expect(component.emailAvailability()).toBe('idle');
    expect(component.userNameAvailability()).toBe('idle');
    expect(component.registerEmailFeedbackReady()).toBe(false);
    expect(component.registerPasswordFocused()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { registered: '1' } });
  });

  it('shows the register user name character counter', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('0/20');

    component.registerForm.controls.displayName.setValue('Player');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('6/20');
  });

  it('uses warning icons for register warnings and check icons for availability success', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.registerForm.controls.email.setValue('bad-email');
    component.registerForm.controls.email.markAsDirty();
    component.registerEmailFeedbackReady.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.field-error lucide-icon[name="triangle-alert"]')).not.toBeNull();

    component.registerForm.controls.email.setValue('player@example.test');
    component.emailAvailability.set('available');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.availability.available lucide-icon[name="check"]')).not.toBeNull();

    component.emailAvailability.set('taken');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.availability.taken lucide-icon[name="triangle-alert"]')).not.toBeNull();

    component.registerForm.controls.displayName.setValue('Player');
    component.userNameAvailability.set('available');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.field-feedback-messages .availability.available lucide-icon[name="check"]')).not.toBeNull();

    component.userNameAvailability.set('taken');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.field-feedback-messages .availability.taken lucide-icon[name="triangle-alert"]')).not.toBeNull();

    component.registerForm.controls.password.setValue('Password123!');
    component.registerForm.controls.confirmPassword.setValue('Password456!');
    component.registerForm.controls.confirmPassword.markAsTouched();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.field-error lucide-icon[name="triangle-alert"]')).not.toBeNull();
  });

  it('shows password requirements after focusing the register password and updates them individually', async () => {
    const fixture = await create('auth/register');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Minimum 8 characters');

    const passwordInput = fixture.nativeElement.querySelector('input[formControlName="password"]') as HTMLInputElement;
    passwordInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Minimum 8 characters');
    expect(fixture.nativeElement.textContent).toContain('At least 1 lowercase letter');
    expect(fixture.nativeElement.textContent).toContain('At least 1 uppercase letter');
    expect(fixture.nativeElement.textContent).toContain('At least 1 number');
    expect(fixture.nativeElement.textContent).toContain('At least 1 special character');
    expect(fixture.nativeElement.querySelectorAll('.password-requirements li.met')).toHaveLength(0);

    component.registerForm.controls.password.setValue('password');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.password-requirements li.met')).toHaveLength(2);

    component.registerForm.controls.password.setValue('Password1!');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.password-requirements li.met')).toHaveLength(5);
  });
});
