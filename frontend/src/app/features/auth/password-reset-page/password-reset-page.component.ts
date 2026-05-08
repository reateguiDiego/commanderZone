import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';

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
  private readonly formBuilder = inject(FormBuilder);

  readonly resetLoading = signal(false);
  readonly resetSuccess = signal(false);
  readonly resetError = signal<string | null>(null);
  readonly newPasswordVisible = signal(false);
  readonly confirmPasswordVisible = signal(false);

  readonly resetForm = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  });

  passwordsMatch(): boolean {
    return this.resetForm.controls.newPassword.value === this.resetForm.controls.confirmPassword.value;
  }

  canSubmitReset(): boolean {
    return this.resetForm.valid && this.passwordsMatch() && !this.resetLoading();
  }

  async submitReset(): Promise<void> {
    if (!this.canSubmitReset()) {
      this.resetForm.markAllAsTouched();
      if (!this.passwordsMatch()) {
        this.resetError.set('Las contrasenas no coinciden.');
      }
      return;
    }

    this.resetLoading.set(true);
    this.resetError.set(null);

    try {
      const response = await firstValueFrom(this.authApi.confirmPasswordReset({
        email: this.resetForm.controls.email.value.trim(),
        newPassword: this.resetForm.controls.newPassword.value,
      }));
      this.resetSuccess.set(response.updated);
      this.resetForm.reset({ email: '', newPassword: '', confirmPassword: '' });
    } catch {
      this.resetError.set('No se pudo actualizar la contrasena con ese email.');
    } finally {
      this.resetLoading.set(false);
    }
  }
}
