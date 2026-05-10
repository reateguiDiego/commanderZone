import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { LoadingStore } from '../core/loading/loading.store';
import { AppBackgroundService } from '../core/ui/app-background.service';
import { FooterDisclaimerComponent } from '../shared/components/footer-disclaimer/footer-disclaimer.component';

@Component({
  selector: 'app-root',
  imports: [FooterDisclaimerComponent, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthStore);
  private readonly background = inject(AppBackgroundService);
  private readonly router = inject(Router);
  readonly loading = inject(LoadingStore);
  private readonly currentPath = signal(this.normalizedPath(this.router.url));
  readonly showDisclaimer = computed(() => !this.isTableAssistantRoomPath(this.currentPath()));

  constructor() {
    void this.auth.initialize().catch(() => undefined);
    this.syncRouteState(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.syncRouteState(event.urlAfterRedirects));
  }

  private syncRouteState(url: string): void {
    const path = this.normalizedPath(url);
    this.currentPath.set(path);
    this.background.setDashboardMode(path === '/dashboard');
  }

  private normalizedPath(url: string): string {
    return url.split(/[?#]/)[0];
  }

  private isTableAssistantRoomPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    return segments[0] === 'table-assistant' && segments.length > 1;
  }
}
