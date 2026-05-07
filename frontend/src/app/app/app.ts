import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { LoadingStore } from '../core/loading/loading.store';
import { AppBackgroundService } from '../core/ui/app-background.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthStore);
  private readonly background = inject(AppBackgroundService);
  private readonly router = inject(Router);
  readonly loading = inject(LoadingStore);

  constructor() {
    void this.auth.initialize().catch(() => undefined);
    this.syncBackgroundMode(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.syncBackgroundMode(event.urlAfterRedirects));
  }

  private syncBackgroundMode(url: string): void {
    const path = url.split(/[?#]/)[0];
    this.background.setDashboardMode(path === '/dashboard');
  }
}
