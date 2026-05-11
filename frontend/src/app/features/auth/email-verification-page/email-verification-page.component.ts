import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Component({
  selector: 'app-email-verification-page',
  imports: [ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './email-verification-page.component.html',
  styleUrl: './email-verification-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailVerificationPageComponent {
  private readonly authApi = inject(AuthApi);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  readonly verifyLoading = signal(false);
  readonly verifySuccess = signal(false);
  readonly verifyError = signal<string | null>(null);
  readonly resendLoading = signal(false);
  readonly resendSuccess = signal(false);
  readonly resendError = signal<string | null>(null);

  readonly verificationForm = this.formBuilder.nonNullable.group({
    token: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
  });

  constructor() {
    const tokenFromQuery = this.route.snapshot.queryParamMap.get('token');
    if (tokenFromQuery && tokenFromQuery.trim() !== '') {
      this.verificationForm.controls.token.setValue(tokenFromQuery.trim());
      void this.confirmToken();
    }
  }

  canConfirm(): boolean {
    return this.verificationForm.controls.token.valid && !this.verifyLoading();
  }

  canResend(): boolean {
    return this.verificationForm.controls.email.valid && !this.resendLoading();
  }

  async confirmToken(): Promise<void> {
    if (!this.canConfirm()) {
      this.verificationForm.controls.token.markAsTouched();
      return;
    }

    this.verifyLoading.set(true);
    this.verifyError.set(null);
    this.verifySuccess.set(false);

    try {
      const response = await firstValueFrom(this.authApi.confirmEmailVerification({
        token: this.verificationForm.controls.token.value.trim(),
      }));
      this.verifySuccess.set(response.verified);
    } catch {
      this.verifyError.set('No se pudo verificar el email con ese token.');
    } finally {
      this.verifyLoading.set(false);
    }
  }

  async resendVerificationEmail(): Promise<void> {
    if (!this.canResend()) {
      this.verificationForm.controls.email.markAsTouched();
      return;
    }

    this.resendLoading.set(true);
    this.resendError.set(null);
    this.resendSuccess.set(false);

    try {
      const response = await firstValueFrom(
        this.authApi.requestEmailVerification(this.verificationForm.controls.email.value.trim()),
      );
      this.resendSuccess.set(response.accepted);
    } catch {
      this.resendError.set('No se pudo reenviar el correo de verificacion.');
    } finally {
      this.resendLoading.set(false);
    }
  }
}

