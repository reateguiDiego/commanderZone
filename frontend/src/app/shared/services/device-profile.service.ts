import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

export type DeviceFormFactor = 'server' | 'desktop' | 'tablet' | 'mobile';
export type DeviceLayoutSize = 'desktop' | 'tablet' | 'mobile';
export type DeviceOrientation = 'landscape' | 'portrait';

export interface DeviceProfile {
  readonly formFactor: DeviceFormFactor;
  readonly layoutSize: DeviceLayoutSize;
  readonly orientation: DeviceOrientation;
  readonly width: number;
  readonly height: number;
  readonly hasTouch: boolean;
  readonly hasCoarsePointer: boolean;
  readonly hasFinePointer: boolean;
  readonly hasHover: boolean;
  readonly hasAnyHover: boolean;
}

interface NavigatorWithUserAgentData extends Navigator {
  readonly userAgentData?: {
    readonly mobile?: boolean;
  };
}

const MOBILE_LAYOUT_MAX_WIDTH = 760;
const TABLET_LAYOUT_MAX_WIDTH = 1180;
const PHONE_SHORT_SIDE_MAX = 480;
const PHONE_LONG_SIDE_MAX = 932;
const TABLET_LONG_SIDE_MAX = 1366;

@Injectable({ providedIn: 'root' })
export class DeviceProfileService {
  private readonly documentRef = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly profileState = signal<DeviceProfile>(this.readProfile());
  private readonly mediaQueries: readonly MediaQueryList[] = this.isBrowser ? this.createMediaQueries() : [];

  readonly profile = this.profileState.asReadonly();
  readonly formFactor = computed(() => this.profile().formFactor);
  readonly layoutSize = computed(() => this.profile().layoutSize);
  readonly isDesktop = computed(() => this.profile().formFactor === 'desktop');
  readonly isMobile = computed(() => this.profile().formFactor === 'mobile');
  readonly isTablet = computed(() => this.profile().formFactor === 'tablet');
  readonly isMobileOrTablet = computed(() => this.isMobile() || this.isTablet());
  readonly isDesktopLayout = computed(() => this.profile().layoutSize === 'desktop');
  readonly isMobileLayout = computed(() => this.profile().layoutSize === 'mobile');
  readonly isTabletLayout = computed(() => this.profile().layoutSize === 'tablet');
  readonly isCompactLayout = computed(() => this.profile().layoutSize !== 'desktop');
  readonly hasTouch = computed(() => this.profile().hasTouch);
  readonly hasCoarsePointer = computed(() => this.profile().hasCoarsePointer);
  readonly hasFinePointer = computed(() => this.profile().hasFinePointer);
  readonly hasHover = computed(() => this.profile().hasHover);
  readonly hasAnyHover = computed(() => this.profile().hasAnyHover);

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const update = (): void => this.profileState.set(this.readProfile());
    const view = this.documentRef.defaultView;
    view?.addEventListener('resize', update, { passive: true });
    view?.addEventListener('orientationchange', update, { passive: true });
    view?.visualViewport?.addEventListener('resize', update, { passive: true });
    for (const query of this.mediaQueries) {
      query.addEventListener('change', update);
    }

    this.destroyRef.onDestroy(() => {
      view?.removeEventListener('resize', update);
      view?.removeEventListener('orientationchange', update);
      view?.visualViewport?.removeEventListener('resize', update);
      for (const query of this.mediaQueries) {
        query.removeEventListener('change', update);
      }
    });
  }

  refresh(): void {
    this.profileState.set(this.readProfile());
  }

  private readProfile(): DeviceProfile {
    if (!this.isBrowser) {
      return {
        formFactor: 'server',
        layoutSize: 'desktop',
        orientation: 'landscape',
        width: 0,
        height: 0,
        hasTouch: false,
        hasCoarsePointer: false,
        hasFinePointer: false,
        hasHover: true,
        hasAnyHover: true,
      };
    }

    const view = this.documentRef.defaultView;
    const width = Math.round(view?.visualViewport?.width ?? view?.innerWidth ?? 0);
    const height = Math.round(view?.visualViewport?.height ?? view?.innerHeight ?? 0);
    const hasCoarsePointer = this.matches('(pointer: coarse)');
    const hasAnyCoarsePointer = this.matches('(any-pointer: coarse)');
    const hasFinePointer = this.matches('(pointer: fine)');
    const hasHover = this.matches('(hover: hover)');
    const hasAnyHover = this.matches('(any-hover: hover)');
    const hasTouch = this.hasTouchCapability();

    return {
      formFactor: this.resolveFormFactor(width, height, hasCoarsePointer, hasAnyCoarsePointer),
      layoutSize: this.resolveLayoutSize(width),
      orientation: height > width ? 'portrait' : 'landscape',
      width,
      height,
      hasTouch,
      hasCoarsePointer,
      hasFinePointer,
      hasHover,
      hasAnyHover,
    };
  }

  private resolveLayoutSize(width: number): DeviceLayoutSize {
    if (width <= MOBILE_LAYOUT_MAX_WIDTH) {
      return 'mobile';
    }

    return width <= TABLET_LAYOUT_MAX_WIDTH ? 'tablet' : 'desktop';
  }

  private resolveFormFactor(width: number, height: number, hasCoarsePointer: boolean, hasAnyCoarsePointer: boolean): DeviceFormFactor {
    const navigatorRef = this.navigatorRef();
    const userAgent = navigatorRef.userAgent;
    const platform = navigatorRef.platform;
    const maxTouchPoints = navigatorRef.maxTouchPoints ?? 0;
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    const clientHintsMobile = navigatorRef.userAgentData?.mobile === true;
    const explicitTablet = /ipad|tablet|kindle|silk|playbook|nexus 7|nexus 9|sm-t|tab/i.test(userAgent)
      || (/macintosh/i.test(userAgent) && /Mac/i.test(platform) && maxTouchPoints > 1);
    const explicitMobile = clientHintsMobile || /mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent);

    if (explicitTablet) {
      return 'tablet';
    }

    if (explicitMobile || (hasCoarsePointer && shortSide <= PHONE_SHORT_SIDE_MAX && longSide <= PHONE_LONG_SIDE_MAX)) {
      return 'mobile';
    }

    if ((maxTouchPoints > 0 || hasCoarsePointer || hasAnyCoarsePointer) && longSide <= TABLET_LONG_SIDE_MAX && (hasCoarsePointer || shortSide >= PHONE_SHORT_SIDE_MAX)) {
      return 'tablet';
    }

    return 'desktop';
  }

  private createMediaQueries(): readonly MediaQueryList[] {
    const view = this.documentRef.defaultView;
    if (!view || typeof view.matchMedia !== 'function') {
      return [];
    }

    return [
      '(pointer: coarse)',
      '(pointer: fine)',
      '(hover: hover)',
      '(any-hover: hover)',
      `(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`,
      `(max-width: ${TABLET_LAYOUT_MAX_WIDTH}px)`,
      '(orientation: portrait)',
    ].map((query) => view.matchMedia(query));
  }

  private matches(query: string): boolean {
    const view = this.documentRef.defaultView;
    if (!view || typeof view.matchMedia !== 'function') {
      return false;
    }

    return view.matchMedia(query).matches;
  }

  private hasTouchCapability(): boolean {
    const view = this.documentRef.defaultView;
    const navigatorRef = this.navigatorRef();

    return navigatorRef.maxTouchPoints > 0 || Boolean(view && 'ontouchstart' in view) || this.matches('(any-pointer: coarse)');
  }

  private navigatorRef(): NavigatorWithUserAgentData {
    return this.documentRef.defaultView?.navigator as NavigatorWithUserAgentData;
  }
}
