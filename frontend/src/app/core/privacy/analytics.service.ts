import { inject, Injectable, InjectionToken } from '@angular/core';

export type AnalyticsConsentValue = 'granted' | 'denied';

export interface AnalyticsConsentState {
  readonly adPersonalization: AnalyticsConsentValue;
  readonly adStorage: AnalyticsConsentValue;
  readonly adUserData: AnalyticsConsentValue;
  readonly analyticsStorage: AnalyticsConsentValue;
}

export type AnalyticsEventParameter = string | number | boolean | null;

export interface AnalyticsEvent {
  readonly name: string;
  readonly parameters?: Readonly<Record<string, AnalyticsEventParameter>>;
}

export interface AnalyticsService {
  updateConsent(consent: AnalyticsConsentState): void;
  trackPageView(path: string, title?: string): void;
  trackEvent(event: AnalyticsEvent): void;
}

@Injectable({ providedIn: 'root' })
export class NoopAnalyticsService implements AnalyticsService {
  updateConsent(_consent: AnalyticsConsentState): void {
    return;
  }

  trackPageView(_path: string, _title?: string): void {
    return;
  }

  trackEvent(_event: AnalyticsEvent): void {
    return;
  }
}

export const ANALYTICS_SERVICE = new InjectionToken<AnalyticsService>('CommanderZone AnalyticsService', {
  providedIn: 'root',
  factory: () => inject(NoopAnalyticsService),
});
