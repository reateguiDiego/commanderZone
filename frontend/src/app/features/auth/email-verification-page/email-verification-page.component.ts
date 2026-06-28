import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';

type EmailVerificationStatus = 'verifying' | 'error';

@Component({
  selector: 'app-email-verification-page',
  imports: [RuntimeTranslatePipe, BackButtonComponent],
  templateUrl: './email-verification-page.component.html',
  styleUrl: './email-verification-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailVerificationPageComponent {
  private readonly authApi = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly status = signal<EmailVerificationStatus>('verifying');

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token')?.trim() ?? '';
    if (!token) {
      this.status.set('error');
      return;
    }

    void this.confirmToken(token);
  }

  private async confirmToken(token: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.authApi.confirmEmailVerification({ token }));
      await this.auth.loginWithResolvedUser(response.token, response.user);
      await this.router.navigate(['/dashboard']);
    } catch {
      this.status.set('error');
    }
  }
}
