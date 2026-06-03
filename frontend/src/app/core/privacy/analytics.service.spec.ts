import { TestBed } from '@angular/core/testing';
import { ANALYTICS_SERVICE, AnalyticsService, NoopAnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('uses a no-op implementation by default', () => {
    const analytics = TestBed.inject(ANALYTICS_SERVICE);

    expect(analytics instanceof NoopAnalyticsService).toBe(true);
  });

  it('does not throw when consent or events are reported before a real provider exists', () => {
    const analytics: AnalyticsService = TestBed.inject(ANALYTICS_SERVICE);

    expect(() => {
      analytics.updateConsent({
        adPersonalization: 'denied',
        adStorage: 'denied',
        adUserData: 'denied',
        analyticsStorage: 'denied',
      });
      analytics.trackPageView('/es/jugar-commander-online/', 'Jugar Commander online');
      analytics.trackEvent({ name: 'cookie_banner_rejected', parameters: { analytics: false } });
    }).not.toThrow();
  });
});
