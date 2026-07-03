import { computed, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NotFoundNavigationService {
  private readonly returnUrlSignal = signal<string | null>(null);
  private goodHistory: string[] = [];

  readonly returnUrl = computed(() => this.returnUrlSignal());

  recordNavigationEnd(url: string, isNotFoundRoute: boolean): void {
    const internalUrl = this.internalUrl(url);
    if (internalUrl === null) {
      return;
    }

    if (isNotFoundRoute) {
      this.returnUrlSignal.set(this.latestGoodUrl(internalUrl));
      return;
    }

    this.returnUrlSignal.set(null);
    this.rememberGoodUrl(internalUrl);
  }

  markUrlAsNotFound(url: string): void {
    const invalidUrl = this.internalUrl(url);
    if (invalidUrl === null) {
      return;
    }

    const invalidPath = this.pathOnly(invalidUrl);
    this.goodHistory = this.goodHistory.filter((candidate) => this.pathOnly(candidate) !== invalidPath);

    const returnUrl = this.returnUrlSignal();
    if (returnUrl !== null && this.pathOnly(returnUrl) === invalidPath) {
      this.returnUrlSignal.set(this.latestGoodUrl(invalidUrl));
    }
  }

  private rememberGoodUrl(url: string): void {
    if (this.isKnownNotFoundUrl(url)) {
      return;
    }

    this.goodHistory = this.goodHistory.filter((candidate) => this.pathOnly(candidate) !== this.pathOnly(url));
    this.goodHistory.push(url);
  }

  private latestGoodUrl(currentNotFoundUrl: string): string | null {
    const currentPath = this.pathOnly(currentNotFoundUrl);

    for (let index = this.goodHistory.length - 1; index >= 0; index--) {
      const candidate = this.goodHistory[index];
      if (this.pathOnly(candidate) !== currentPath && !this.isKnownNotFoundUrl(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private internalUrl(url: string): string | null {
    const trimmed = url.trim();
    if (trimmed === '' || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return null;
    }

    return trimmed;
  }

  private pathOnly(url: string): string {
    return url.split(/[?#]/)[0] || '/';
  }

  private isKnownNotFoundUrl(url: string): boolean {
    return this.pathOnly(url) === '/404';
  }
}
