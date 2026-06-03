import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ANALYTICS_SERVICE } from '../analytics.service';
import { CookieConsentService } from '../cookie-consent.service';

@Component({
  selector: 'app-cookie-consent-banner',
  imports: [],
  templateUrl: './cookie-consent-banner.component.html',
  styleUrl: './cookie-consent-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookieConsentBannerComponent {
  private readonly analytics = inject(ANALYTICS_SERVICE);
  readonly consent = inject(CookieConsentService);

  readonly showSettings = signal(false);
  readonly analyticsEnabled = signal(false);
  readonly isVisible = computed(() => !this.consent.hasDecision());

  acceptAll(): void {
    this.consent.acceptAll();
    this.analytics.updateConsent(this.consent.googleConsentModeState());
  }

  rejectAll(): void {
    this.consent.rejectAll();
    this.analytics.updateConsent(this.consent.googleConsentModeState());
  }

  openSettings(): void {
    this.showSettings.set(true);
  }

  toggleAnalytics(): void {
    this.analyticsEnabled.update((enabled) => !enabled);
  }

  saveSettings(): void {
    this.consent.savePreferences({ analytics: this.analyticsEnabled() });
    this.analytics.updateConsent(this.consent.googleConsentModeState());
  }
}
