import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { effect, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { CookieConsentService } from '../privacy/cookie-consent.service';
import { GOOGLE_ADSENSE_CLIENT } from './adsense-client.token';
import { loadGoogleAdsenseScript } from './adsense-loader';

@Injectable({ providedIn: 'root' })
export class AdsenseService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly cookieConsent = inject(CookieConsentService);
  private readonly client = inject(GOOGLE_ADSENSE_CLIENT);

  constructor() {
    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      loadGoogleAdsenseScript(
        this.document,
        this.client,
        this.cookieConsent.canUsePersonalizedAds() ? 'personalized' : 'nonPersonalized',
      );
    });
  }
}
