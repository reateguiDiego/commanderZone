import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SeoLocaleCode } from '../localization/locale-config';
import { findSeoRouteByPath } from '../localization/seo-routes';
import { getPublicChromeCopy } from '../localization/public-chrome-copy';
import { findLegalRouteByPath, getLegalLinks } from './legal-routes';

@Injectable({ providedIn: 'root' })
export class LegalLinksService {
  private readonly router = inject(Router);
  private readonly currentPath = signal(this.normalizePath(this.router.url));

  readonly currentLocale = computed(() => this.resolveLocale(this.currentPath()));
  readonly links = computed(() => getLegalLinks(this.currentLocale()));
  readonly chromeCopy = computed(() => getPublicChromeCopy(this.currentLocale()));

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.currentPath.set(this.normalizePath(event.urlAfterRedirects)));
  }

  private resolveLocale(path: string): SeoLocaleCode {
    const legalMatch = findLegalRouteByPath(path);
    if (legalMatch) {
      return legalMatch.locale;
    }

    const seoMatch = findSeoRouteByPath(path);
    if (seoMatch) {
      return seoMatch.locale;
    }

    return 'en';
  }

  private normalizePath(url: string): string {
    return url.split(/[?#]/)[0];
  }
}
