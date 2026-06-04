import { RuntimeTranslatePipe } from '../core/localization/runtime-translate.pipe';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { LoadingStore } from '../core/loading/loading.store';
import { findSeoRouteByPath } from '../core/localization/seo-routes';
import { CookieConsentBannerComponent } from '../core/privacy/cookie-consent-banner/cookie-consent-banner.component';
import { RouteRobotsMetaService } from '../core/seo/route-robots-meta.service';
import { AppBackgroundService } from '../core/ui/app-background.service';
import { FooterDisclaimerComponent } from '../shared/components/footer-disclaimer/footer-disclaimer.component';
import { RuntimeLanguageSelectorService } from '../core/localization/runtime-language-selector.service';
import { AppThemeService } from '../core/theme/app-theme.service';

@Component({
  selector: 'app-root',
  imports: [RuntimeTranslatePipe, CookieConsentBannerComponent, FooterDisclaimerComponent, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthStore);
  private readonly background = inject(AppBackgroundService);
  private readonly runtimeLanguageSelector = inject(RuntimeLanguageSelectorService);
  private readonly routeRobots = inject(RouteRobotsMetaService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly theme = inject(AppThemeService);
  readonly loading = inject(LoadingStore);
  private readonly currentPath = signal(this.normalizedPath(this.router.url));
  readonly showDisclaimer = computed(() => !this.isDisclaimerHiddenPath(this.currentPath()));
  readonly showGlobalLoading = computed(() => this.loading.active() && !this.isSeoLandingPath(this.currentPath()));

  constructor() {
    this.theme.initialize();

    if (isPlatformBrowser(this.platformId)) {
      void this.auth.initialize().catch(() => undefined);
    }

    this.routeRobots.initialize();
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

  private isGameTablePath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    return segments[0] === 'games' && segments.length > 1;
  }

  private isDisclaimerHiddenPath(path: string): boolean {
    return this.isTableAssistantRoomPath(path) || this.isGameTablePath(path);
  }

  private isSeoLandingPath(path: string): boolean {
    return findSeoRouteByPath(path) !== undefined;
  }
}
