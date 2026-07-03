import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';
import { runtimeGoogleAdsenseClient } from '../config/runtime-config';

export const GOOGLE_ADSENSE_CLIENT = new InjectionToken<string>('Google AdSense client id', {
  providedIn: 'root',
  factory: () => runtimeGoogleAdsenseClient() || environment.googleAdsenseClient,
});
