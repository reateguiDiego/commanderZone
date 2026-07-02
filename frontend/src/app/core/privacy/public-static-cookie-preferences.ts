import { loadGoogleAdsenseScript } from '../ads/adsense-loader';
import { runtimeGoogleAdsenseClient } from '../config/runtime-config';

const STORAGE_KEY = 'commanderzone.cookieConsent';
const STORAGE_VERSION = 5;

type CookieDecision = 'accepted' | 'rejected' | 'custom';

interface StoredCookieConsentState {
  readonly version?: unknown;
  readonly decision?: unknown;
  readonly ads?: unknown;
  readonly personalizedAds?: unknown;
}

export function initializePublicStaticCookiePreferences(documentRef: Document): void {
  const bannerHost = documentRef.querySelector<HTMLElement>('app-cookie-consent-banner');
  if (!bannerHost) {
    return;
  }

  const controller = new PublicStaticCookieController(documentRef, bannerHost);
  controller.initialize();
}

class PublicStaticCookieController {
  private readonly settings: HTMLElement | null;
  private personalizedAdsConsent = false;

  constructor(
    private readonly documentRef: Document,
    private readonly bannerHost: HTMLElement,
  ) {
    this.settings = bannerHost.querySelector<HTMLElement>('[data-cz-cookie-settings]');
  }

  initialize(): void {
    const storedState = this.readStoredState();

    this.personalizedAdsConsent = this.hasStoredPersonalizedAdsConsent(storedState);
    this.setBannerVisible(!this.hasStoredDecision(storedState));
    this.setSettingsVisible(false);
    this.syncPersonalizedAdsToggle();
    this.loadAdsense();

    this.documentRef.addEventListener('click', (event) => this.handleDocumentClick(event));
  }

  private handleDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const preferencesTrigger = target.closest('[data-cz-cookie-preferences]');
    if (preferencesTrigger) {
      event.preventDefault();
      this.openPreferences();
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-cz-cookie-action]');
    const action = actionButton?.dataset['czCookieAction'];

    const personalizedAdsToggle = target.closest('[data-cz-cookie-personalized-ads-toggle]');
    if (personalizedAdsToggle) {
      this.setPersonalizedAdsConsent(!this.personalizedAdsConsent);
      return;
    }

    if (action === 'reject') {
      this.saveDecision('rejected', false);
      return;
    }

    if (action === 'customize') {
      this.openPreferences();
      return;
    }

    if (action === 'save') {
      this.saveDecision('custom', this.personalizedAdsConsent);
      return;
    }

    if (action === 'accept') {
      this.saveDecision('accepted', true);
    }
  }

  private openPreferences(): void {
    this.setBannerVisible(true);
    this.setSettingsVisible(true);
    this.syncPersonalizedAdsToggle();
    this.bannerHost.querySelector<HTMLButtonElement>('[data-cz-cookie-action="reject"]')?.focus();
  }

  private setBannerVisible(visible: boolean): void {
    this.bannerHost.hidden = !visible;
  }

  private setSettingsVisible(visible: boolean): void {
    if (this.settings) {
      this.settings.hidden = !visible;
    }
  }

  private setPersonalizedAdsConsent(personalizedAds: boolean): void {
    this.personalizedAdsConsent = personalizedAds;
    this.syncPersonalizedAdsToggle();
  }

  private syncPersonalizedAdsToggle(): void {
    const toggle = this.bannerHost.querySelector<HTMLElement>('[data-cz-cookie-personalized-ads-toggle] [role="switch"]');
    if (!toggle) {
      return;
    }

    toggle.setAttribute('aria-checked', String(this.personalizedAdsConsent));
    toggle.classList.toggle('is-on', this.personalizedAdsConsent);
  }

  private saveDecision(decision: CookieDecision, personalizedAds: boolean): void {
    this.personalizedAdsConsent = personalizedAds;
    this.storage()?.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: true,
      personalizedAds,
      decision,
      updatedAt: new Date().toISOString(),
    }));

    this.setBannerVisible(false);
    this.setSettingsVisible(false);
    this.syncPersonalizedAdsToggle();
    this.loadAdsense();
  }

  private hasStoredDecision(state: StoredCookieConsentState | null): boolean {
    return state?.decision === 'accepted' || state?.decision === 'rejected' || state?.decision === 'custom';
  }

  private hasStoredPersonalizedAdsConsent(state: StoredCookieConsentState | null): boolean {
    if (state?.version === STORAGE_VERSION) {
      return state.personalizedAds === true;
    }

    return state?.version === 4 && state.ads === true;
  }

  private loadAdsense(): void {
    loadGoogleAdsenseScript(
      this.documentRef,
      runtimeGoogleAdsenseClient(),
      this.personalizedAdsConsent ? 'personalized' : 'nonPersonalized',
    );
  }

  private readStoredState(): StoredCookieConsentState | null {
    const rawState = this.storage()?.getItem(STORAGE_KEY);
    if (!rawState) {
      return null;
    }

    try {
      return JSON.parse(rawState) as StoredCookieConsentState;
    } catch {
      return null;
    }
  }

  private storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
