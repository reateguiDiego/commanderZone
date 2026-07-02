import { initializePublicStaticCookiePreferences } from './public-static-cookie-preferences';

describe('initializePublicStaticCookiePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <button type="button" data-cz-cookie-preferences>Cookie preferences</button>
      <app-cookie-consent-banner>
        <section data-cz-cookie-banner>
          <div data-cz-cookie-settings hidden>Settings</div>
          <button type="button" data-cz-cookie-action="reject">Reject</button>
          <button type="button" data-cz-cookie-action="accept">Accept</button>
        </section>
      </app-cookie-consent-banner>
    `;
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('opens the prerendered preferences panel from the static footer trigger', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-preferences]')?.click();

    expect(document.querySelector<HTMLElement>('app-cookie-consent-banner')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-cz-cookie-settings]')?.hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="reject"]'));
  });

  it('stores v3 consent without granting advertising from a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="accept"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly version?: unknown;
      readonly decision?: unknown;
      readonly ads?: unknown;
    };

    expect(storedState.version).toBe(3);
    expect(storedState.decision).toBe('accepted');
    expect(storedState.ads).toBe(false);
    expect(document.querySelector<HTMLElement>('app-cookie-consent-banner')?.hidden).toBe(true);
  });
});
