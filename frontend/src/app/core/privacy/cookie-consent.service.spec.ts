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

  it('starts pending with version 6 and keeps advertising consent outside local preferences', () => {
    const service = TestBed.inject(CookieConsentService);

    expect(service.state()).toEqual({
      version: 6,
      essential: true,
      preferences: false,
      adsAvailable: true,
      ads: true,
      personalizedAds: false,
      decision: 'pending',
      updatedAt: null,
    });
    expect(service.canUsePreferences()).toBe(false);
    expect(service.canUseAds()).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('accepts internal cookie preferences without granting personalized ads or analytics', () => {
    const service = TestBed.inject(CookieConsentService);

    service.acceptAll();

    expect(service.hasDecision()).toBe(true);
    expect(service.state().decision).toBe('accepted');
    expect(service.canUsePreferences()).toBe(true);
    expect(service.state().adsAvailable).toBe(true);
    expect(service.canUseAds()).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('keeps optional consent denied after rejecting cookies', () => {
    const service = TestBed.inject(CookieConsentService);

    service.rejectAll();

    expect(service.state().decision).toBe('rejected');
    expect(service.canUsePreferences()).toBe(false);
    expect(service.canUseAds()).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('migrates an old analytics consent without preserving analytics or personalized ads consent', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 2, analytics: true, decision: 'custom', updatedAt: '2026-06-03T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state()).toEqual({
      version: 6,
      essential: true,
      preferences: false,
      adsAvailable: true,
      ads: true,
      personalizedAds: false,
      decision: 'custom',
      updatedAt: '2026-06-03T00:00:00.000Z',
    });
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('forces personalized ads denied when restoring an old accepted state', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 2, analytics: true, ads: true, decision: 'accepted', updatedAt: '2026-06-04T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state().adsAvailable).toBe(true);
    expect(service.state().ads).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('does not restore personalized ads consent from the previous consent version', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 5, ads: true, personalizedAds: true, decision: 'custom', updatedAt: '2026-07-02T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.canUseAds()).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
    expect(service.googleConsentModeState()).toEqual(deniedConsentModeState);
  });

  it('does not migrate v4 ads consent into personalized ads consent', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ version: 4, ads: true, decision: 'accepted', updatedAt: '2026-07-02T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state().version).toBe(6);
    expect(service.canUsePersonalizedAds()).toBe(false);
  });

  it('opens and closes the reusable preferences panel', () => {
    const service = TestBed.inject(CookieConsentService);

    service.openPreferences();
    expect(service.preferencesPanelOpen()).toBe(true);

    service.savePreferences(true);
    expect(service.preferencesPanelOpen()).toBe(false);
    expect(service.state().decision).toBe('custom');
    expect(service.canUsePreferences()).toBe(true);
    expect(service.canUseAds()).toBe(true);
    expect(service.canUsePersonalizedAds()).toBe(false);
  });
});
