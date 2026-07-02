import { TestBed } from '@angular/core/testing';
import { GOOGLE_ADSENSE_CLIENT } from './adsense-client.token';
import { GOOGLE_ADSENSE_SCRIPT_ID } from './adsense-loader';
import { AdsenseService } from './adsense.service';
import { CookieConsentService } from '../privacy/cookie-consent.service';

describe('AdsenseService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)?.remove();
    globalThis.adsbygoogle = undefined;
  });

  afterEach(() => {
    localStorage.clear();
    document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)?.remove();
    globalThis.adsbygoogle = undefined;
  });

  it('loads AdSense as non-personalized before personalized ads consent', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: GOOGLE_ADSENSE_CLIENT, useValue: 'ca-pub-1234567890123456' },
      ],
    });

    const consent = TestBed.inject(CookieConsentService);
    TestBed.inject(AdsenseService);
    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).not.toBeNull();
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(1);

    consent.acceptAll();
    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).not.toBeNull();
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(0);
  });

  it('does not load AdSense when the configured client id is invalid', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: GOOGLE_ADSENSE_CLIENT, useValue: 'pub-1234567890123456' },
      ],
    });

    const consent = TestBed.inject(CookieConsentService);
    TestBed.inject(AdsenseService);

    consent.acceptAll();
    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).toBeNull();
    expect(globalThis.adsbygoogle).toBeUndefined();
  });
});
