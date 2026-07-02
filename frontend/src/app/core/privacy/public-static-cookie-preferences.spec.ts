import { initializePublicStaticCookiePreferences } from './public-static-cookie-preferences';

describe('initializePublicStaticCookiePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <button type="button" data-cz-cookie-preferences>Cookie preferences</button>
      <app-cookie-consent-banner>
        <section data-cz-cookie-banner>
          <div data-cz-cookie-settings hidden>
            <div data-cz-cookie-personalized-ads-toggle>
              <button type="button" role="switch" aria-checked="false">Personalized ads</button>
            </div>
          </div>
          <button type="button" data-cz-cookie-action="reject">Reject</button>
          <button type="button" data-cz-cookie-action="customize">Customize</button>
          <button type="button" data-cz-cookie-action="save">Save</button>
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

  it('stores v5 consent with personalized ads from accept all on a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="accept"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly version?: unknown;
      readonly decision?: unknown;
      readonly ads?: unknown;
      readonly personalizedAds?: unknown;
    };

    expect(storedState.version).toBe(5);
    expect(storedState.decision).toBe('accepted');
    expect(storedState.ads).toBe(true);
    expect(storedState.personalizedAds).toBe(true);
    expect(document.querySelector<HTMLElement>('app-cookie-consent-banner')?.hidden).toBe(true);
  });

  it('stores granular personalized ads consent from a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="customize"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-cz-cookie-personalized-ads-toggle] [role="switch"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="save"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly decision?: unknown;
      readonly ads?: unknown;
      readonly personalizedAds?: unknown;
    };

    expect(storedState.decision).toBe('custom');
    expect(storedState.ads).toBe(true);
    expect(storedState.personalizedAds).toBe(true);
  });
});
