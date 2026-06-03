import { TestBed } from '@angular/core/testing';
import { CookieConsentService } from './cookie-consent.service';

describe('CookieConsentService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts pending with analytics denied', () => {
    const service = TestBed.inject(CookieConsentService);

    expect(service.state().decision).toBe('pending');
    expect(service.canUseAnalytics()).toBe(false);
    expect(service.googleConsentModeState().analyticsStorage).toBe('denied');
  });

  it('enables analytics consent after accepting all cookies', () => {
    const service = TestBed.inject(CookieConsentService);

    service.acceptAll();

    expect(service.hasDecision()).toBe(true);
    expect(service.canUseAnalytics()).toBe(true);
    expect(service.googleConsentModeState()).toEqual({
      adPersonalization: 'denied',
      adStorage: 'denied',
      adUserData: 'denied',
      analyticsStorage: 'granted',
    });
  });

  it('keeps analytics denied after rejecting cookies', () => {
    const service = TestBed.inject(CookieConsentService);

    service.rejectAll();

    expect(service.state().decision).toBe('rejected');
    expect(service.canUseAnalytics()).toBe(false);
    expect(service.googleConsentModeState().analyticsStorage).toBe('denied');
  });

  it('restores a stored custom preference', () => {
    localStorage.setItem(
      'commanderzone.cookieConsent',
      JSON.stringify({ analytics: true, decision: 'custom', updatedAt: '2026-06-03T00:00:00.000Z' }),
    );

    const service = TestBed.inject(CookieConsentService);

    expect(service.state()).toEqual({
      analytics: true,
      decision: 'custom',
      updatedAt: '2026-06-03T00:00:00.000Z',
    });
  });
});
