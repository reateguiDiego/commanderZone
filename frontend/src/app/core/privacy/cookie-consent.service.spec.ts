import { TestBed } from '@angular/core/testing';
import { CookieConsentService } from './cookie-consent.service';

const deniedConsentModeState = {
  adPersonalization: 'denied',
  adStorage: 'denied',
  adUserData: 'denied',
  analyticsStorage: 'denied',
} as const;

describe('CookieConsentService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts pending with version 3 and no optional consent granted', () => {
    const service = TestBed.inject(CookieConsentService);

    expect(service.state()).toEqual({
      version: 3,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision: 'pending',
      updatedAt: null,
    });
    expect(service.canUsePreferences()).toBe(true);
    expect(service.canUseAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('keeps ads and analytics consent denied after accepting all cookies', () => {
    const service = TestBed.inject(CookieConsentService);

    service.acceptAll();

    expect(service.hasDecision()).toBe(true);
    expect(service.state().decision).toBe('accepted');
    expect(service.state().adsAvailable).toBe(true);
    expect(service.canUseAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('keeps optional consent denied after rejecting cookies', () => {
    const service = TestBed.inject(CookieConsentService);

    service.rejectAll();

    expect(service.state().decision).toBe('rejected');
    expect(service.canUsePreferences()).toBe(true);
    expect(service.canUseAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('migrates a version 2 analytics consent without preserving analytics or ads consent', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 2, analytics: true, decision: 'custom', updatedAt: '2026-06-03T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state()).toEqual({
      version: 3,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision: 'custom',
      updatedAt: '2026-06-03T00:00:00.000Z',
    });
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('forces ads denied when restoring an old accepted state', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 2, analytics: true, ads: true, decision: 'accepted', updatedAt: '2026-06-04T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state().adsAvailable).toBe(true);
    expect(service.state().ads).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('opens and closes the reusable preferences panel', () => {
    const service = TestBed.inject(CookieConsentService);

    service.openPreferences();
    expect(service.preferencesPanelOpen()).toBe(true);

    service.savePreferences();
    expect(service.preferencesPanelOpen()).toBe(false);
    expect(service.state().decision).toBe('custom');
    expect(service.canUseAds()).toBe(false);
  });
});
