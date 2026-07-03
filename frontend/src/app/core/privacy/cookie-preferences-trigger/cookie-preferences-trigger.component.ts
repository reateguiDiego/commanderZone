import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CookieConsentService } from '../cookie-consent.service';

export type CookiePreferencesTriggerElement = 'button' | 'link';
export type CookiePreferencesTriggerVariant = 'footer' | 'noindex-footer' | 'seo-footer';

@Component({
  selector: 'app-cookie-preferences-trigger',
  templateUrl: './cookie-preferences-trigger.component.html',
  styleUrl: './cookie-preferences-trigger.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookiePreferencesTriggerComponent {
  private readonly cookieConsent = inject(CookieConsentService);

  readonly label = input.required<string>();
  readonly element = input<CookiePreferencesTriggerElement>('button');
  readonly variant = input<CookiePreferencesTriggerVariant>('footer');
  readonly cssClass = computed(() => `cookie-preferences-trigger cookie-preferences-trigger--${this.variant()}`);

  openCookiePreferences(event: Event): void {
    event.preventDefault();
    this.cookieConsent.openPreferences();
  }
}
