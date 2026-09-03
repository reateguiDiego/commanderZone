import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DeviceProfileService } from './device-profile.service';
import { MOBILE_VIEWPORT_HEIGHT_CSS_VARIABLE, MobileViewportSyncService } from './mobile-viewport-sync.service';

describe('MobileViewportSyncService', () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
  const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame');
  const isMobile = vi.fn<() => boolean>();
  let queuedFrames: FrameRequestCallback[];
  let visualViewport: VisualViewport;

  beforeEach(() => {
    queuedFrames = [];
    visualViewport = {
      height: 720,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as VisualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: visualViewport });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback): number => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: vi.fn() });
    isMobile.mockReturnValue(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: DeviceProfileService, useValue: { isMobile } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.style.removeProperty(MOBILE_VIEWPORT_HEIGHT_CSS_VARIABLE);
    restoreWindowProperty('visualViewport', originalVisualViewport);
    restoreWindowProperty('requestAnimationFrame', originalRequestAnimationFrame);
    restoreWindowProperty('cancelAnimationFrame', originalCancelAnimationFrame);
  });

  it('queues one mobile synchronization for repeated select changes in the same frame', () => {
    const service = TestBed.inject(MobileViewportSyncService);

    service.syncAfterSharedSelectChange();
    service.syncAfterSharedSelectChange();

    expect(queuedFrames).toHaveLength(1);
    queuedFrames[0]?.(0);

    expect(service.height()).toBe(720);
    expect(document.documentElement.style.getPropertyValue(MOBILE_VIEWPORT_HEIGHT_CSS_VARIABLE)).toBe('720px');
  });

  it('does not write again when the visual viewport height is unchanged', () => {
    const service = TestBed.inject(MobileViewportSyncService);
    const setProperty = vi.spyOn(document.documentElement.style, 'setProperty');

    service.syncAfterSharedSelectChange();
    queuedFrames.shift()?.(0);
    service.syncAfterSharedSelectChange();
    queuedFrames.shift()?.(0);

    expect(setProperty).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside mobile form factors', () => {
    isMobile.mockReturnValue(false);
    const service = TestBed.inject(MobileViewportSyncService);

    service.syncAfterSharedSelectChange();

    expect(queuedFrames).toHaveLength(0);
    expect(service.height()).toBeNull();
  });
});

function restoreWindowProperty(name: keyof Window, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);

    return;
  }

  Reflect.deleteProperty(window, name);
}
