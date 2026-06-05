import { RuntimeTranslatePipe } from '../core/localization/runtime-translate.pipe';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { LoadingStore } from '../core/loading/loading.store';
import { findSeoRouteByPath } from '../core/localization/seo-routes';
import { CookieConsentBannerComponent } from '../core/privacy/cookie-consent-banner/cookie-consent-banner.component';
import { RouteRobotsMetaService } from '../core/seo/route-robots-meta.service';
import { FooterDisclaimerComponent } from '../shared/components/footer-disclaimer/footer-disclaimer.component';
import { NoindexFooterDisclaimerComponent } from '../shared/components/noindex-footer-disclaimer/noindex-footer-disclaimer.component';
import { RuntimeLanguageSelectorService } from '../core/localization/runtime-language-selector.service';
import { AppThemeService } from '../core/theme/app-theme.service';
import { AppBackgroundService } from '../core/ui/app-background.service';

@Component({
  selector: 'app-root',
  imports: [
    RuntimeTranslatePipe,
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
  private readonly runtimeLanguageSelector = inject(RuntimeLanguageSelectorService);
  private readonly routeRobots = inject(RouteRobotsMetaService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly theme = inject(AppThemeService);
  readonly loading = inject(LoadingStore);
  private readonly currentPath = signal(this.normalizedPath(this.router.url));
  readonly showDisclaimer = computed(() => !this.isDisclaimerHiddenPath(this.currentPath()));
  readonly showNoindexDisclaimer = computed(() => this.isNoindexFooterDisclaimerPath(this.currentPath()));
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

    if (firstSegment === 'table-assistant' && segments.length > 1) {
      return false;
    }

    return this.isNoindexAppPath(path);
  }
}
