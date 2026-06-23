import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LegalLinksService } from '../../legal/legal-links.service';
import { ANALYTICS_SERVICE } from '../analytics.service';
import { CookieConsentService } from '../cookie-consent.service';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { ToggleComponent } from '../../../shared/ui/toggle/toggle.component';

@Component({
  selector: 'app-cookie-consent-banner',
  imports: [CzButtonDirective, ToggleComponent],
  templateUrl: './cookie-consent-banner.component.html',
  styleUrl: './cookie-consent-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookieConsentBannerComponent {
  private readonly analytics = inject(ANALYTICS_SERVICE);
  private readonly legalLinks = inject(LegalLinksService);
  readonly consent = inject(CookieConsentService);

  readonly showSettings = signal(false);
  readonly analyticsEnabled = signal(false);
  readonly isVisible = computed(() => !this.consent.hasDecision());
  readonly copy = this.legalLinks.chromeCopy;
  readonly privacyLink = computed(() => this.legalLinks.links().find((link) => link.pageKey === 'privacy'));
  readonly cookieLink = computed(() => this.legalLinks.links().find((link) => link.pageKey === 'cookies'));

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

  setAnalyticsEnabled(enabled: boolean): void {
    this.analyticsEnabled.set(enabled);
  }

  saveSettings(): void {
    this.consent.savePreferences({ analytics: this.analyticsEnabled() });
    this.analytics.updateConsent(this.consent.googleConsentModeState());
  }
}
