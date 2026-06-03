import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { PAGE_TRANSLATION_STRATEGIES, PageKey } from '../localization/page-translation-strategy';
import { getPageRobotsMeta, isSeoIndexablePage } from './route-robots';

const ROUTE_ROBOTS_ATTRIBUTE = 'data-cz-route-robots';
const ROUTE_ROBOTS_SELECTOR = `meta[${ROUTE_ROBOTS_ATTRIBUTE}="true"]`;

@Injectable({ providedIn: 'root' })
export class RouteRobotsMetaService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private initialized = false;

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.applyCurrentRouteRobotsMeta();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.applyCurrentRouteRobotsMeta());
  }

  applyCurrentRouteRobotsMeta(): void {
    const pageKey = this.currentPageKey();

    if (!pageKey || isSeoIndexablePage(pageKey)) {
      this.clearRouteRobotsMeta();
      return;
    }

    this.upsertRouteRobotsMeta(getPageRobotsMeta(pageKey));
  }

  private currentPageKey(): PageKey | undefined {
    let route = this.activatedRoute;

    while (route.firstChild) {
      route = route.firstChild;
    }

    const pageKey = route.snapshot.data['pageKey'];
    return isPageKey(pageKey) ? pageKey : undefined;
  }

  private upsertRouteRobotsMeta(content: string): void {
    const meta = this.document.head.querySelector(ROUTE_ROBOTS_SELECTOR)
      ?? this.document.createElement('meta');

    meta.setAttribute(ROUTE_ROBOTS_ATTRIBUTE, 'true');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', content);

    if (!meta.parentElement) {
      this.document.head.appendChild(meta);
    }
  }

  private clearRouteRobotsMeta(): void {
    this.document.head.querySelectorAll(ROUTE_ROBOTS_SELECTOR).forEach((element) => element.remove());
  }
}

function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && value in PAGE_TRANSLATION_STRATEGIES;
}
