import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { LegalLinksService } from '../../legal/legal-links.service';
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
  private readonly legalLinks = inject(LegalLinksService);
  readonly consent = inject(CookieConsentService);

  readonly showSettings = signal(false);
  readonly functionalPreferencesConsent = signal(false);
  readonly isVisible = computed(() => !this.consent.hasDecision() || this.consent.preferencesPanelOpen());
  readonly copy = this.legalLinks.chromeCopy;
  readonly privacyLink = computed(() => this.legalLinks.links().find((link) => link.pageKey === 'privacy'));
  readonly cookieLink = computed(() => this.legalLinks.links().find((link) => link.pageKey === 'cookies'));

  constructor() {
    effect(() => {
      if (!this.consent.preferencesPanelOpen()) {
        return;
      }

      this.openSettings();
    });
  }

  acceptAll(): void {
    this.consent.acceptAll();
  }

  rejectAll(): void {
    this.consent.rejectAll();
  }

  customize(): void {
    this.openSettings();
  }

  saveChoices(): void {
    this.consent.savePreferences(this.functionalPreferencesConsent());
  }

  setFunctionalPreferencesConsent(checked: boolean): void {
    this.functionalPreferencesConsent.set(checked);
  }

  private openSettings(): void {
    this.functionalPreferencesConsent.set(this.consent.hasDecision() ? this.consent.canUsePreferences() : true);
    this.showSettings.set(true);
  }
}
