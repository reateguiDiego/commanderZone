import { ChangeDetectionStrategy, Component, DestroyRef, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';

type AuthMode = 'login' | 'register';
type EmailAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type UserNameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_NAME_MIN_LENGTH = 4;

@Component({
  selector: 'app-auth-page',
  imports: [ReactiveFormsModule, LucideAngularModule, RouterLink],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPageComponent {
  readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly mode = signal<AuthMode>(this.route.snapshot.routeConfig?.path === 'auth/register' ? 'register' : 'login');
  readonly emailAvailability = signal<EmailAvailability>('idle');
  readonly userNameAvailability = signal<UserNameAvailability>('idle');
  readonly loginEmailFeedbackReady = signal(false);
  readonly registerEmailFeedbackReady = signal(false);
  readonly loginPasswordVisible = signal(false);
  readonly registerPasswordVisible = signal(false);
  readonly registerConfirmPasswordVisible = signal(false);
  readonly registerPasswordsMatch = signal(false);
  private readonly loginFormValid = signal(false);
  private readonly registerFormValid = signal(false);

  readonly loginForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    password: ['', [Validators.required]],
  });

  readonly registerForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    displayName: ['', [Validators.required, Validators.minLength(USER_NAME_MIN_LENGTH)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
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
    this.trackEmailFeedback(this.loginForm.controls.email, this.loginEmailFeedbackReady);
    this.trackEmailFeedback(this.registerForm.controls.email, this.registerEmailFeedbackReady);
    this.trackRegisterEmailAvailability();
    this.trackUserNameAvailability();
    this.trackRegisterPasswordMatch();
  }

  setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.auth.clearError();
  }

  async submitLogin(): Promise<void> {
    if (!this.canSubmitLogin()) {
      this.loginForm.markAllAsTouched();
      this.loginEmailFeedbackReady.set(true);
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    await this.authenticate(() => this.auth.login(email, password));
  }

  async submitRegister(): Promise<void> {
    if (!this.canSubmitRegister()) {
      this.registerForm.markAllAsTouched();
      this.registerEmailFeedbackReady.set(true);
      return;
    }

    const { email, displayName, password } = this.registerForm.getRawValue();
    await this.authenticate(() => this.auth.register(email, displayName.trim(), password));
  }

  loginEmailInvalid(): boolean {
    return this.emailInvalid(this.loginForm.controls.email, this.loginEmailFeedbackReady());
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
        debounceTime(450),
        switchMap((displayName) => {
          if (displayName.length < USER_NAME_MIN_LENGTH) {
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
