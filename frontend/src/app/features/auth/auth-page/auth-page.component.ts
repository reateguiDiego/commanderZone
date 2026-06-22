import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { isPlatformBrowser } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { AppThemeAssetsService } from '../../../core/theme/app-theme-assets.service';
import { AUTH_PASSWORD_REGEX } from '../auth-password-policy';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { TabListComponent, type TabListItem } from '../../../shared/ui/tab-list/tab-list.component';

type AuthMode = 'login' | 'register';
type EmailAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type UserNameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type PasswordRequirementId = 'minLength' | 'lowercase' | 'uppercase' | 'number' | 'special';

interface PasswordRequirementState {
  readonly id: PasswordRequirementId;
  readonly labelKey: string;
  readonly met: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_NAME_MIN_LENGTH = 2;
const USER_NAME_MAX_LENGTH = 20;
const DISPLAY_NAME_AVAILABILITY_DEBOUNCE_MS = 900;
const PASSWORD_REQUIREMENTS: readonly { id: PasswordRequirementId; labelKey: string }[] = [
  { id: 'minLength', labelKey: 'auth.authPage.passwordRequirements.minLength' },
  { id: 'lowercase', labelKey: 'auth.authPage.passwordRequirements.lowercase' },
  { id: 'uppercase', labelKey: 'auth.authPage.passwordRequirements.uppercase' },
  { id: 'number', labelKey: 'auth.authPage.passwordRequirements.number' },
  { id: 'special', labelKey: 'auth.authPage.passwordRequirements.special' },
];
const AUTH_TAB_ITEMS: readonly TabListItem[] = [
  { id: 'login', label: 'auth.authPage.login' },
  { id: 'register', label: 'auth.authPage.register' },
];
const AUTH_ERROR_TRANSLATION_KEYS: Readonly<Record<string, string>> = {
  'Invalid credentials.': 'auth.authPage.invalidCredentials',
  'Too many failed login attempts. Please try again later.': 'auth.authPage.tooManyLoginAttempts',
};

@Component({
  selector: 'app-auth-page',
  imports: [RuntimeTranslatePipe, ReactiveFormsModule, LucideAngularModule, RouterLink, CzButtonDirective, TabListComponent],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPageComponent implements AfterViewInit {
  readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly themeAssets = inject(AppThemeAssetsService);

  readonly mode = signal<AuthMode>(this.route.snapshot.routeConfig?.path === 'auth/register' ? 'register' : 'login');
  readonly emailAvailability = signal<EmailAvailability>('idle');
  readonly userNameAvailability = signal<UserNameAvailability>('idle');
  readonly loginIdentifierFeedbackReady = signal(false);
  readonly registerEmailFeedbackReady = signal(false);
  readonly loginPasswordVisible = signal(false);
  readonly loginAutocompleteReady = signal(false);
  readonly registerPasswordVisible = signal(false);
  readonly registerConfirmPasswordVisible = signal(false);
  readonly registerPasswordsMatch = signal(false);
  readonly registerDisplayNameLength = signal(0);
  readonly registerPasswordFocused = signal(false);
  readonly registerPasswordValue = signal('');
  readonly registrationCompletedNotice = signal(this.route.snapshot.queryParamMap.get('registered') === '1');
  readonly userNameMaxLength = USER_NAME_MAX_LENGTH;
  readonly authTabItems = AUTH_TAB_ITEMS;
  readonly authErrorMessage = computed(() => localizedAuthError(this.auth.error()));
  readonly loginLockoutWarningVisible = computed(() => {
    const failureCount = this.auth.loginFailureCount();

    return failureCount !== null && failureCount >= 3 && failureCount < 5;
  });
  readonly loginLockoutWarningParams = computed(() => ({
    count: this.auth.loginFailureCount() ?? 0,
  }));
  readonly registerPasswordRequirements = computed<readonly PasswordRequirementState[]>(() => {
    const password = this.registerPasswordValue();

    return PASSWORD_REQUIREMENTS.map((requirement) => ({
      ...requirement,
      met: this.passwordRequirementMet(requirement.id, password),
    }));
  });
  private readonly loginFormValid = signal(false);
  private readonly registerFormValid = signal(false);

  readonly loginForm = this.formBuilder.group({
    identifier: ['', [Validators.required, Validators.minLength(USER_NAME_MIN_LENGTH)]],
    password: ['', [Validators.required]],
  });

  readonly registerForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    displayName: ['', [Validators.required, Validators.minLength(USER_NAME_MIN_LENGTH), Validators.maxLength(USER_NAME_MAX_LENGTH)]],
    password: ['', [Validators.required, Validators.pattern(AUTH_PASSWORD_REGEX)]],
    confirmPassword: ['', [Validators.required]],
  });

  readonly canSubmitLogin = computed(() => this.loginFormValid() && !this.auth.loading());
  readonly canSubmitRegister = computed(
    () =>
      this.registerFormValid() &&
      this.registerPasswordsMatch() &&
      this.emailAvailability() === 'available' &&
      this.userNameAvailability() === 'available' &&
      !this.auth.loading(),
  );

  constructor() {
    this.trackFormValidity();
    this.trackEmailFeedback(this.loginForm.controls.identifier, this.loginIdentifierFeedbackReady);
    this.trackEmailFeedback(this.registerForm.controls.email, this.registerEmailFeedbackReady);
    this.trackRegisterEmailAvailability();
    this.trackUserNameAvailability();
    this.trackRegisterDisplayNameLength();
    this.trackRegisterPasswordValue();
    this.trackRegisterPasswordMatch();
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    window.setTimeout(() => this.clearInitialLoginAutofill());
  }

  setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.auth.clearError();
  }

  selectModeFromTab(tabId: string): void {
    if (tabId === 'login' || tabId === 'register') {
      this.setMode(tabId);
    }
  }

  enableLoginAutocomplete(): void {
    this.loginAutocompleteReady.set(true);
  }

  showRegisterPasswordRequirements(): void {
    this.registerPasswordFocused.set(true);
  }

  async submitLogin(): Promise<void> {
    if (!this.canSubmitLogin()) {
      this.loginForm.markAllAsTouched();
      this.loginIdentifierFeedbackReady.set(true);
      return;
    }

    const { identifier, password } = this.loginForm.getRawValue();
    await this.authenticate(() => this.auth.login(identifier.trim(), password));
  }

  async submitRegister(): Promise<void> {
    if (!this.canSubmitRegister()) {
      this.registerForm.markAllAsTouched();
      this.registerEmailFeedbackReady.set(true);
      return;
    }

    const { email, displayName, password } = this.registerForm.getRawValue();
    try {
      await this.auth.register(email, displayName.trim(), password);
      this.resetRegisterState();
      this.mode.set('login');
      this.registrationCompletedNotice.set(true);
      await this.router.navigate(['/auth/login'], { queryParams: { registered: '1' } });
    } catch {
      return;
    }
  }

  loginIdentifierInvalid(): boolean {
    const control = this.loginForm.controls.identifier;

    return control.invalid && this.loginIdentifierFeedbackReady() && (control.dirty || control.touched);
  }

  registerEmailInvalid(): boolean {
    return this.emailInvalid(this.registerForm.controls.email, this.registerEmailFeedbackReady());
  }

  registerEmailAvailabilityVisible(): boolean {
    return this.emailAvailability() !== 'idle' && !this.registerEmailInvalid();
  }

  controlInvalid(controlName: 'displayName' | 'password' | 'confirmPassword'): boolean {
    const control = this.registerForm.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  registerPasswordMismatchVisible(): boolean {
    return this.registerForm.controls.confirmPassword.touched && !this.registerPasswordsMatch();
  }

  private trackFormValidity(): void {
    this.loginForm.statusChanges
      .pipe(startWith(this.loginForm.status), takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.loginFormValid.set(status === 'VALID'));

    this.registerForm.statusChanges
      .pipe(startWith(this.registerForm.status), takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.registerFormValid.set(status === 'VALID'));
  }

  private trackEmailFeedback(control: FormControl<string>, feedbackReady: WritableSignal<boolean>): void {
    control.valueChanges
      .pipe(
        tap(() => feedbackReady.set(false)),
        debounceTime(650),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => feedbackReady.set(control.dirty || control.touched));
  }

  private trackRegisterPasswordMatch(): void {
    this.registerForm.valueChanges
      .pipe(startWith(this.registerForm.getRawValue()), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.registerPasswordsMatch.set(
          this.registerForm.controls.password.value === this.registerForm.controls.confirmPassword.value,
        );
      });
  }

  private trackRegisterEmailAvailability(): void {
    this.registerForm.controls.email.valueChanges
      .pipe(
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap(() => this.emailAvailability.set('idle')),
        debounceTime(650),
        switchMap((email) => {
          if (!EMAIL_PATTERN.test(email)) {
            return of<EmailAvailability>('idle');
          }

          this.emailAvailability.set('checking');
          return this.authApi.checkEmailAvailability(email).pipe(
            map((response) => (response.available ? 'available' : 'taken') satisfies EmailAvailability),
            catchError(() => of<EmailAvailability>('error')),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((availability) => this.emailAvailability.set(availability));
  }

  private trackUserNameAvailability(): void {
    this.registerForm.controls.displayName.valueChanges
      .pipe(
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap(() => this.userNameAvailability.set('idle')),
        debounceTime(DISPLAY_NAME_AVAILABILITY_DEBOUNCE_MS),
        switchMap((displayName) => {
          if (displayName.length < USER_NAME_MIN_LENGTH || displayName.length > USER_NAME_MAX_LENGTH) {
            return of<UserNameAvailability>('idle');
          }

          this.userNameAvailability.set('checking');
          return this.authApi.checkDisplayNameAvailability(displayName).pipe(
            map((response) => (response.available ? 'available' : 'taken') satisfies UserNameAvailability),
            catchError(() => of<UserNameAvailability>('error')),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((availability) => this.userNameAvailability.set(availability));
  }

  private trackRegisterDisplayNameLength(): void {
    this.registerForm.controls.displayName.valueChanges
      .pipe(
        startWith(this.registerForm.controls.displayName.value),
        map((displayName) => displayName.length),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((length) => this.registerDisplayNameLength.set(length));
  }

  private trackRegisterPasswordValue(): void {
    this.registerForm.controls.password.valueChanges
      .pipe(
        startWith(this.registerForm.controls.password.value),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((password) => this.registerPasswordValue.set(password));
  }

  private passwordRequirementMet(requirement: PasswordRequirementId, password: string): boolean {
    switch (requirement) {
      case 'minLength':
        return password.length >= 8;
      case 'lowercase':
        return /[a-z]/.test(password);
      case 'uppercase':
        return /[A-Z]/.test(password);
      case 'number':
        return /\d/.test(password);
      case 'special':
        return /[^A-Za-z0-9]/.test(password);
    }
  }

  private resetRegisterState(): void {
    this.registerForm.reset({
      email: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    });
    this.emailAvailability.set('idle');
    this.userNameAvailability.set('idle');
    this.registerEmailFeedbackReady.set(false);
    this.registerPasswordFocused.set(false);
    this.registerPasswordVisible.set(false);
    this.registerConfirmPasswordVisible.set(false);
  }

  private async authenticate(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      const redirect = this.safeRedirectUrl(this.route.snapshot.queryParamMap?.get('redirect') ?? null);
      if (redirect) {
        await this.router.navigateByUrl(redirect);
        return;
      }

      await this.router.navigate(['/dashboard']);
    } catch {
      return;
    }
  }

  private clearInitialLoginAutofill(): void {
    if (this.mode() !== 'login' || this.loginForm.dirty) {
      return;
    }

    this.loginForm.reset({ identifier: '', password: '' }, { emitEvent: true });
  }

  private emailInvalid(control: FormControl<string>, feedbackReady: boolean): boolean {
    return control.invalid && feedbackReady && (control.dirty || control.touched);
  }

  private safeRedirectUrl(url: string | null): string | null {
    if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('://')) {
      return null;
    }

    return url;
  }
}

function localizedAuthError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  return AUTH_ERROR_TRANSLATION_KEYS[error] ?? error;
}
