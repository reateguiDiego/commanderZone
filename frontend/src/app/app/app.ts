import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthStore } from '../core/auth/auth.store';
import { GlobalLoadingFeaturePolicy } from '../core/loading/global-loading-feature-policy.service';
import { LoadingStore } from '../core/loading/loading.store';
import { findSeoRouteByPath } from '../core/localization/seo-routes';
import { CookieConsentBannerComponent } from '../core/privacy/cookie-consent-banner/cookie-consent-banner.component';
import { RouteRobotsMetaService } from '../core/seo/route-robots-meta.service';
import { FooterDisclaimerComponent } from '../shared/components/footer-disclaimer/footer-disclaimer.component';
import { NoindexFooterDisclaimerComponent } from '../shared/components/noindex-footer-disclaimer/noindex-footer-disclaimer.component';
import { AppThemeService } from '../core/theme/app-theme.service';
import { AppBackgroundService } from '../core/ui/app-background.service';
import { RouteStylesService } from '../core/ui/route-styles.service';

@Component({
  selector: 'app-root',
  imports: [
    CookieConsentBannerComponent,
    FooterDisclaimerComponent,
    NoindexFooterDisclaimerComponent,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthStore);
  private readonly document = inject(DOCUMENT);
  private readonly routeRobots = inject(RouteRobotsMetaService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly theme = inject(AppThemeService);
  private readonly routeStyles = inject(RouteStylesService);
  private readonly globalLoadingFeaturePolicy = inject(GlobalLoadingFeaturePolicy);
  readonly loading = inject(LoadingStore);
  private readonly currentPath = signal(this.initialPath());
  private readonly navigationLoading = signal(this.shouldShowInitialNavigationLoading(this.currentPath()));
  readonly showDisclaimer = computed(() => !this.isDisclaimerHiddenPath(this.currentPath()));
  readonly showNoindexDisclaimer = computed(() => this.isNoindexFooterDisclaimerPath(this.currentPath()));
  readonly showGlobalLoading = computed(
    () => this.navigationLoading()
      || (
        this.loading.active()
        && !this.isSeoLandingPath(this.currentPath())
        && !this.globalLoadingFeaturePolicy.skipsFeatureForUrl(this.currentPath())
      ),
  );
  readonly showFooterDisclaimer = computed(() => this.showDisclaimer() && !this.showGlobalLoading());
  readonly showNoindexFooterDisclaimer = computed(() => this.showNoindexDisclaimer() && !this.showGlobalLoading());

  constructor() {
    this.theme.initialize();

    if (isPlatformBrowser(this.platformId)) {
      void this.auth.initialize().catch(() => undefined);
    }

    this.routeRobots.initialize();
    this.syncRouteState(this.currentPath());
    this.router.events
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.navigationLoading.set(true);
          this.syncRouteState(event.url);
          return;
        }

        if (event instanceof NavigationEnd) {
          this.syncRouteState(event.urlAfterRedirects);
          this.navigationLoading.set(false);
          return;
        }

        if (event instanceof NavigationCancel || event instanceof NavigationError) {
          this.navigationLoading.set(false);
          this.syncRouteState(this.router.url);
        }
      });
  }

  private syncRouteState(url: string): void {
    const path = this.normalizedPath(url);
    this.currentPath.set(path);
    this.routeStyles.applyForPath(path);

    if (isPlatformBrowser(this.platformId)) {
      const isDashboardShellPath = this.isDashboardShellPath(path);

      if (isDashboardShellPath) {
        this.injector.get(AppBackgroundService).setDashboardMode(path === '/dashboard');
      } else {
        this.document.body.classList.remove('dashboard-background');
        this.document.documentElement.style.removeProperty('--app-session-background');
      }
    }
  }

  private normalizedPath(url: string): string {
    return url.split(/[?#]/)[0];
  }

  private initialPath(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return this.normalizedPath(this.router.url);
    }

    return this.normalizedPath(this.document.location.pathname);
  }

  private shouldShowInitialNavigationLoading(path: string): boolean {
    return isPlatformBrowser(this.platformId)
      && !this.router.navigated
      && this.isNoindexAppPath(path);
  }

  private isDisclaimerHiddenPath(path: string): boolean {
    return this.isNoindexAppPath(path);
  }

  private isSeoLandingPath(path: string): boolean {
    return findSeoRouteByPath(path) !== undefined;
  }

  private isDashboardShellPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    const firstSegment = segments[0];

    return [
      'cards',
      'community',
      'dashboard',
      'decks',
      'rooms',
      'table-assistant',
    ].includes(firstSegment);
  }

  private isNoindexAppPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    const firstSegment = segments[0];

    if (!firstSegment) {
      return false;
    }

    return [
      'auth',
      'cards',
      'community',
      'dashboard',
      'decks',
      'email-verification',
      'games',
      'room',
      'rooms',
      'table-assistant',
      'welcome',
    ].includes(firstSegment);
  }

  private isNoindexFooterDisclaimerPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    const firstSegment = segments[0];

    if (!firstSegment || firstSegment === 'games') {
      return false;
    }

    if (this.isAuthEntryPath(path)) {
      return false;
    }

    if (firstSegment === 'table-assistant' && segments.length > 1) {
      return false;
    }

    return this.isNoindexAppPath(path);
  }

  private isAuthEntryPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);

    return segments.length === 2
      && segments[0] === 'auth'
      && ['login', 'register'].includes(segments[1]);
  }
}
