const STORAGE_KEY = 'commanderzone.cookieConsent';
const STORAGE_VERSION = 3;

type CookieDecision = 'accepted' | 'rejected' | 'custom';

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

  constructor(
    private readonly documentRef: Document,
    private readonly bannerHost: HTMLElement,
  ) {
    this.settings = bannerHost.querySelector<HTMLElement>('[data-cz-cookie-settings]');
  }

  initialize(): void {
    this.setBannerVisible(!this.hasStoredDecision());
    this.setSettingsVisible(false);

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

    if (action === 'reject') {
      this.saveDecision('rejected');
      return;
    }

    if (action === 'accept') {
      this.saveDecision('accepted');
    }
  }

  private openPreferences(): void {
    this.setBannerVisible(true);
    this.setSettingsVisible(true);
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

  private saveDecision(decision: CookieDecision): void {
    this.storage()?.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision,
      updatedAt: new Date().toISOString(),
    }));

    this.setBannerVisible(false);
    this.setSettingsVisible(false);
  }

  private hasStoredDecision(): boolean {
    const rawState = this.storage()?.getItem(STORAGE_KEY);
    if (!rawState) {
      return false;
    }

    try {
      const state = JSON.parse(rawState) as { readonly decision?: unknown };
      return state.decision === 'accepted' || state.decision === 'rejected' || state.decision === 'custom';
    } catch {
      return false;
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
