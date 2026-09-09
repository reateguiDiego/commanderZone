import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { findLegalRouteByPath } from '../legal/legal-routes';
import { findSeoRouteByPath } from '../localization/seo-routes';

export type RouteStyleScope = 'public' | 'private' | 'none';

interface RouteStylesheet {
  readonly id: string;
  readonly href: string;
}

interface RouteStyleConfig {
  readonly bodyClass: string;
  readonly stylesheets: readonly RouteStylesheet[];
}

const ROUTE_STYLES: Record<Exclude<RouteStyleScope, 'none'>, RouteStyleConfig> = {
  public: {
    bodyClass: 'cz-public-route',
    stylesheets: [
      {
        id: 'cz-public-route-stylesheet',
        href: '/route-styles/seo-public.css',
      },
    ],
  },
  private: {
    bodyClass: 'cz-private-route',
    stylesheets: [
      {
        id: 'cz-private-theme-stylesheet',
        href: '/route-styles/themes.css',
      },
      {
        id: 'cz-private-route-stylesheet',
        href: '/route-styles/app-private.css',
      },
    ],
  },
};

@Injectable({ providedIn: 'root' })
export class RouteStylesService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  applyForPath(path: string): void {
    if (!this.isBrowser) {
      return;
    }

    this.apply(this.scopeForPath(path));
  }

  scopeForPath(path: string): RouteStyleScope {
    if (path === '/community' || path.startsWith('/community/')) {
      return 'private';
    }

    if (findSeoRouteByPath(path) !== undefined || findLegalRouteByPath(path) !== undefined) {
      return 'public';
    }

    return this.isPrivateAppPath(path) ? 'private' : 'none';
  }

  private apply(scope: RouteStyleScope): void {
    for (const [candidateScope, config] of Object.entries(ROUTE_STYLES) as Array<[Exclude<RouteStyleScope, 'none'>, RouteStyleConfig]>) {
      const applies = scope === candidateScope;
      this.document.body.classList.toggle(config.bodyClass, applies);

      if (applies) {
        for (const stylesheet of config.stylesheets) {
          this.ensureStylesheet(stylesheet.id, stylesheet.href);
        }
      } else {
        for (const stylesheet of config.stylesheets) {
          this.document.getElementById(stylesheet.id)?.remove();
        }
      }
    }
  }

  private ensureStylesheet(id: string, href: string): void {
    if (this.document.getElementById(id)) {
      return;
    }

    const link = this.document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    this.document.head.appendChild(link);
  }

  private isPrivateAppPath(path: string): boolean {
    const firstSegment = path.split('/').filter(Boolean)[0];

    return [
      'admin',
      'auth',
      'cards',
      'contact',
      'dashboard',
      'decks',
      'email-verification',
      'games',
      'room',
      'rooms',
      'table-assistant',
      'welcome',
    ].includes(firstSegment ?? '');
  }
}
