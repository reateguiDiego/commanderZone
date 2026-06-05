import { DOCUMENT, Location, isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, HostListener, PLATFORM_ID, inject } from '@angular/core';
import { Router } from '@angular/router';
import { findSeoRouteByPath } from '../../../core/localization/seo-routes';

@Directive({
  selector: 'a[appSeoInternalLink]',
})
export class SeoInternalLinkDirective {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLAnchorElement>>(ElementRef);
  private readonly location = inject(Location, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router, { optional: true });

  @HostListener('click', ['$event'])
  navigateWithoutReload(event: MouseEvent): void {
    if (!this.router || !isPlatformBrowser(this.platformId) || !this.shouldHandleClick(event)) {
      return;
    }

    const url = this.getSameOriginUrl();
    if (!url || !findSeoRouteByPath(url.pathname)) {
      return;
    }

    event.preventDefault();
    const canonicalPath = `${url.pathname}${url.search}${url.hash}`;
    void this.router.navigateByUrl(`${this.getRouterPath(url)}${url.search}${url.hash}`).then((navigated) => {
      if (navigated && this.location && canonicalPath !== this.document.location.pathname) {
        this.location.replaceState(canonicalPath);
      }
    });
  }

  private shouldHandleClick(event: MouseEvent): boolean {
    const anchor = this.host.nativeElement;
    const target = anchor.getAttribute('target');

    return !event.defaultPrevented
      && event.button === 0
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && (!target || target === '_self');
  }

  private getSameOriginUrl(): URL | null {
    const href = this.host.nativeElement.getAttribute('href');
    if (!href || href.startsWith('#')) {
      return null;
    }

    const url = new URL(href, this.document.location.href);
    return url.origin === this.document.location.origin ? url : null;
  }

  private getRouterPath(url: URL): string {
    return url.pathname.replace(/\/+$/, '') || '/';
  }
}
