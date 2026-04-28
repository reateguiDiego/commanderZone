import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthStore } from '../../../core/auth/auth.store';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPageComponent {
  readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = signal<AuthMode>(this.route.snapshot.routeConfig?.path === 'auth/register' ? 'register' : 'login');

  email = '';
  displayName = '';
  password = '';

  async submit(): Promise<void> {
    if (this.mode() === 'login') {
      await this.auth.login(this.email, this.password);
    } else {
      await this.auth.register(this.email, this.displayName, this.password);
    }

    await this.router.navigate(['/dashboard']);
  }
}
