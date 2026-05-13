import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { AUTH_PASSWORD_REGEX, AUTH_PASSWORD_REQUIREMENT_MESSAGE } from '../auth-password-policy';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Component({
  selector: 'app-password-reset-page',
  imports: [ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './password-reset-page.component.html',
  styleUrl: './password-reset-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordResetPageComponent {
  private readonly authApi = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly requestLoading = signal(false);
  readonly requestSuccess = signal(false);
  readonly requestError = signal<string | null>(null);
  readonly resetLoading = signal(false);
  readonly resetSuccess = signal(false);
  readonly resetError = signal<string | null>(null);
  readonly newPasswordVisible = signal(false);
  readonly confirmPasswordVisible = signal(false);
  readonly resetToken = signal<string | null>(null);
  readonly passwordRequirementMessage = AUTH_PASSWORD_REQUIREMENT_MESSAGE;

  readonly resetForm = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    newPassword: ['', [Validators.required, Validators.pattern(AUTH_PASSWORD_REGEX)]],
    confirmPassword: ['', [Validators.required]],
  });

  constructor() {
    const tokenFromQuery = this.route.snapshot.queryParamMap.get('token');
    if (tokenFromQuery && tokenFromQuery.trim() !== '') {
      this.resetToken.set(tokenFromQuery.trim());
    }
  }

  canRequestReset(): boolean {
    return this.resetForm.controls.email.valid && !this.requestLoading();
  }

  passwordsMatch(): boolean {
    return this.resetForm.controls.newPassword.value === this.resetForm.controls.confirmPassword.value;
  }

  canSubmitReset(): boolean {
    return this.resetForm.controls.email.valid
      && this.resetForm.controls.newPassword.valid
      && this.resetForm.controls.confirmPassword.valid
      && this.passwordsMatch()
      && this.resetToken() !== null
      && !this.resetLoading();
  }

  async requestResetEmail(): Promise<void> {
    if (!this.canRequestReset()) {
      this.resetForm.controls.email.markAsTouched();
      return;
    }

    this.requestLoading.set(true);
    this.requestError.set(null);
    this.requestSuccess.set(false);

    try {
      const response = await firstValueFrom(this.authApi.requestPasswordReset(this.resetForm.controls.email.value.trim()));
      this.requestSuccess.set(response.accepted);
    } catch {
      this.requestError.set('No se pudo solicitar el correo de recuperacion.');
    } finally {
      this.requestLoading.set(false);
    }
  }

  async submitReset(): Promise<void> {
    if (!this.canSubmitReset()) {
      this.resetForm.controls.email.markAsTouched();
      this.resetForm.controls.newPassword.markAsTouched();
      this.resetForm.controls.confirmPassword.markAsTouched();
      if (!this.resetToken()) {
        this.resetError.set('El enlace de recuperacion no es valido o ha caducado.');
      }
      if (!this.passwordsMatch()) {
        this.resetError.set('Las contrasenas no coinciden.');
      }
      return;
    }

    this.resetLoading.set(true);
    this.resetError.set(null);
    this.resetSuccess.set(false);

    try {
      const email = this.resetForm.controls.email.value.trim();
      const newPassword = this.resetForm.controls.newPassword.value;
      const response = await firstValueFrom(this.authApi.confirmPasswordReset({
        email,
        token: this.resetToken() ?? '',
        newPassword,
      }));
      await this.auth.login(email, newPassword);
      this.resetSuccess.set(response.updated);
      this.resetForm.reset({ email: '', newPassword: '', confirmPassword: '' });
      await this.router.navigate(['/dashboard']).catch(() => false);
    } catch {
      this.resetSuccess.set(false);
      this.resetError.set('No se pudo actualizar la contrasena con ese token.');
    } finally {
      this.resetLoading.set(false);
    }
  }
}
