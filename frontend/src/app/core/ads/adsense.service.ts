import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { effect, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { GOOGLE_ADSENSE_CLIENT } from './adsense-client.token';
import { loadGoogleAdsenseScript, normalizeAdsenseClient } from './adsense-loader';
import { TcfConsentService } from './tcf-consent.service';

@Injectable({ providedIn: 'root' })
export class AdsenseService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly client = inject(GOOGLE_ADSENSE_CLIENT);
  private readonly tcfConsent = inject(TcfConsentService);

  constructor() {
    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      if (!normalizeAdsenseClient(this.client)) {
        return;
      }

      this.tcfConsent.initialize();
      loadGoogleAdsenseScript(
        this.document,
        this.client,
        this.tcfConsent.canRequestPersonalizedAds() ? 'personalized' : 'nonPersonalized',
      );
    });
  }
}
