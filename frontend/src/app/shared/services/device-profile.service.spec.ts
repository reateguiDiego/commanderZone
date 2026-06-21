import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DeviceProfileService } from './device-profile.service';

describe('DeviceProfileService', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  const originalMatchMedia = window.matchMedia;
  const originalVisualViewport = window.visualViewport;
  const originalUserAgent = window.navigator.userAgent;
  const originalPlatform = window.navigator.platform;
  const originalMaxTouchPoints = window.navigator.maxTouchPoints;
  const originalUserAgentData = (window.navigator as Navigator & { userAgentData?: unknown }).userAgentData;

  afterEach(() => {
    TestBed.resetTestingModule();
    setViewport(originalInnerWidth, originalInnerHeight);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    setNavigator({
      maxTouchPoints: originalMaxTouchPoints,
      platform: originalPlatform,
      userAgent: originalUserAgent,
      userAgentData: originalUserAgentData,
    });
  });

  it('uses a non-interactive profile on the server', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.profile()).toEqual({
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
    });
  });

  it('classifies a coarse pointer phone viewport as mobile', () => {
    setViewport(390, 844);
    installMatchMedia({
      '(pointer: coarse)': true,
      '(pointer: fine)': false,
      '(hover: hover)': false,
      '(any-hover: hover)': false,
      '(any-pointer: coarse)': true,
    });
    setNavigator({
      maxTouchPoints: 5,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
      userAgentData: { mobile: true },
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.formFactor()).toBe('mobile');
    expect(service.layoutSize()).toBe('mobile');
    expect(service.isMobileOrTablet()).toBe(true);
    expect(service.profile().orientation).toBe('portrait');
    expect(service.hasHover()).toBe(false);
    expect(service.hasFinePointer()).toBe(false);
  });

  it('classifies iPadOS desktop-mode Safari as tablet', () => {
    setViewport(1024, 768);
    installMatchMedia({
      '(pointer: coarse)': true,
      '(pointer: fine)': false,
      '(hover: hover)': false,
      '(any-hover: hover)': false,
      '(any-pointer: coarse)': true,
    });
    setNavigator({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.formFactor()).toBe('tablet');
    expect(service.layoutSize()).toBe('tablet');
    expect(service.isTablet()).toBe(true);
  });

  it('keeps a narrow mouse desktop as desktop form factor with mobile layout', () => {
    setViewport(520, 900);
    installMatchMedia({
      '(pointer: coarse)': false,
      '(pointer: fine)': true,
      '(hover: hover)': true,
      '(any-hover: hover)': true,
      '(any-pointer: coarse)': false,
    });
    setNavigator({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.formFactor()).toBe('desktop');
    expect(service.layoutSize()).toBe('mobile');
    expect(service.isDesktop()).toBe(true);
    expect(service.isDesktopLayout()).toBe(false);
    expect(service.isMobileOrTablet()).toBe(false);
    expect(service.isMobileLayout()).toBe(true);
    expect(service.hasHover()).toBe(true);
  });

  it('does not classify a large touch desktop as tablet', () => {
    setViewport(1440, 900);
    installMatchMedia({
      '(pointer: coarse)': false,
      '(pointer: fine)': true,
      '(hover: hover)': true,
      '(any-hover: hover)': true,
      '(any-pointer: coarse)': true,
    });
    setNavigator({
      maxTouchPoints: 10,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.formFactor()).toBe('desktop');
    expect(service.layoutSize()).toBe('desktop');
    expect(service.isDesktop()).toBe(true);
    expect(service.isDesktopLayout()).toBe(true);
    expect(service.hasTouch()).toBe(true);
  });

  it('reports any hover separately from the primary input hover', () => {
    setViewport(1024, 768);
    installMatchMedia({
      '(pointer: coarse)': true,
      '(pointer: fine)': false,
      '(hover: hover)': false,
      '(any-hover: hover)': true,
      '(any-pointer: coarse)': true,
    });
    setNavigator({
      maxTouchPoints: 5,
      platform: 'iPad',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    });

    const service = TestBed.inject(DeviceProfileService);

    expect(service.hasHover()).toBe(false);
    expect(service.hasAnyHover()).toBe(true);
  });

  it('refreshes the viewport-derived layout size', () => {
    setViewport(1280, 800);
    installMatchMedia({ '(pointer: coarse)': false, '(pointer: fine)': true, '(hover: hover)': true, '(any-hover: hover)': true });
    setNavigator({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    });
    const service = TestBed.inject(DeviceProfileService);

    expect(service.layoutSize()).toBe('desktop');

    setViewport(740, 800);
    service.refresh();

    expect(service.layoutSize()).toBe('mobile');
  });
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
}

function setNavigator(options: {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  readonly userAgentData?: unknown;
}): void {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: options.userAgent });
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: options.platform });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: options.maxTouchPoints });
  Object.defineProperty(window.navigator, 'userAgentData', { configurable: true, value: options.userAgentData });
}

function installMatchMedia(matches: Record<string, boolean>): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}
