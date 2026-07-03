import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GOOGLE_ADSENSE_CLIENT } from './adsense-client.token';
import { GOOGLE_ADSENSE_SCRIPT_ID } from './adsense-loader';
import { AdsenseService } from './adsense.service';
import { TcfConsentService } from './tcf-consent.service';

describe('AdsenseService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)?.remove();
    globalThis.adsbygoogle = undefined;
    globalThis.__tcfapi = undefined;
  });

  afterEach(() => {
    localStorage.clear();
    document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)?.remove();
    globalThis.adsbygoogle = undefined;
    globalThis.__tcfapi = undefined;
  });

  it('loads AdSense as non-personalized until certified TCF consent allows personalized ads', () => {
    const canRequestPersonalizedAds = signal(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: GOOGLE_ADSENSE_CLIENT, useValue: 'ca-pub-1234567890123456' },
        { provide: TcfConsentService, useValue: { canRequestPersonalizedAds, initialize: vi.fn() } },
      ],
    });

    TestBed.inject(AdsenseService);
    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).not.toBeNull();
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(1);

    canRequestPersonalizedAds.set(true);
    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).not.toBeNull();
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(0);
  });

  it('does not load AdSense when the configured client id is invalid', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: GOOGLE_ADSENSE_CLIENT, useValue: 'pub-1234567890123456' },
        { provide: TcfConsentService, useValue: { canRequestPersonalizedAds: signal(true), initialize: vi.fn() } },
      ],
    });

    TestBed.inject(AdsenseService);

    TestBed.flushEffects();

    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).toBeNull();
    expect(globalThis.adsbygoogle).toBeUndefined();
  });
});
