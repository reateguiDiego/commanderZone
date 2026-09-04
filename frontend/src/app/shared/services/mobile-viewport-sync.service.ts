import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { DeviceProfileService } from './device-profile.service';

export const MOBILE_VIEWPORT_HEIGHT_CSS_VARIABLE = '--cz-mobile-viewport-height';

@Injectable({ providedIn: 'root' })
export class MobileViewportSyncService {
  private readonly documentRef = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly device = inject(DeviceProfileService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private animationFrameId: number | null = null;
  private lastSyncedHeight: number | null = null;

  readonly height = signal<number | null>(null);

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const visualViewport = this.documentRef.defaultView?.visualViewport;
    if (!visualViewport) {
      return;
    }

    visualViewport.addEventListener('resize', this.scheduleSync, { passive: true });
    this.destroyRef.onDestroy(() => {
      visualViewport.removeEventListener('resize', this.scheduleSync);
      this.cancelPendingSync();
    });
  }

  syncAfterSharedSelectChange(): void {
    this.scheduleSync();
  }

  private readonly scheduleSync = (): void => {
    if (!this.isBrowser || !this.device.isMobile() || this.animationFrameId !== null) {
      return;
    }

    const view = this.documentRef.defaultView;
    if (!view?.visualViewport) {
      return;
    }

    this.animationFrameId = view.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.syncHeight(view.visualViewport?.height);
    });
  };

  private syncHeight(nextHeight: number | undefined): void {
    if (typeof nextHeight !== 'number' || !Number.isFinite(nextHeight) || nextHeight <= 0) {
      return;
    }

    const roundedHeight = Math.round(nextHeight);
    if (roundedHeight === this.lastSyncedHeight) {
      return;
    }

    this.lastSyncedHeight = roundedHeight;
    this.height.set(roundedHeight);
    this.documentRef.documentElement.style.setProperty(MOBILE_VIEWPORT_HEIGHT_CSS_VARIABLE, `${roundedHeight}px`);
  }

  private cancelPendingSync(): void {
    if (this.animationFrameId === null) {
      return;
    }

    this.documentRef.defaultView?.cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }
}
