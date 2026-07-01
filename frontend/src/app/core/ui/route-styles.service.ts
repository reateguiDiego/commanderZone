import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { findLegalRouteByPath } from '../legal/legal-routes';
import { findSeoRouteByPath } from '../localization/seo-routes';

export type RouteStyleScope = 'public' | 'private' | 'none';

const ROUTE_STYLES: Record<Exclude<RouteStyleScope, 'none'>, { readonly id: string; readonly href: string; readonly bodyClass: string }> = {
  public: {
    id: 'cz-public-route-stylesheet',
    href: '/route-styles/seo-public.css',
    bodyClass: 'cz-public-route',
  },
  private: {
    id: 'cz-private-route-stylesheet',
    href: '/route-styles/app-private.css',
    bodyClass: 'cz-private-route',
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
    if (findSeoRouteByPath(path) !== undefined || findLegalRouteByPath(path) !== undefined) {
      return 'public';
    }

    return this.isPrivateAppPath(path) ? 'private' : 'none';
  }

  private apply(scope: RouteStyleScope): void {
    for (const [candidateScope, config] of Object.entries(ROUTE_STYLES) as Array<[Exclude<RouteStyleScope, 'none'>, typeof ROUTE_STYLES.public]>) {
      this.document.body.classList.toggle(config.bodyClass, scope === candidateScope);

      if (scope === candidateScope) {
        this.ensureStylesheet(config.id, config.href);
      } else {
        this.document.getElementById(config.id)?.remove();
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
      'community',
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
