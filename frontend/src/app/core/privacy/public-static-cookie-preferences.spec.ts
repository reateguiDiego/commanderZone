import { initializePublicStaticCookiePreferences } from './public-static-cookie-preferences';

describe('initializePublicStaticCookiePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.commanderZoneRuntimeConfig = { googleAdsenseClient: 'ca-pub-1234567890123456' };
    globalThis.adsbygoogle = undefined;
    globalThis.__tcfapi = (_command, _version, callback) => {
      callback({
        eventStatus: 'tcloaded',
        gdprApplies: true,
        tcString: 'tc-string',
        purpose: { consents: { 1: false, 3: false, 4: false } },
        vendor: { consents: { 755: false } },
      }, true);
    };
    document.body.innerHTML = `
      <button type="button" data-cz-cookie-preferences>Cookie preferences</button>
      <app-cookie-consent-banner>
        <section data-cz-cookie-banner>
          <div data-cz-cookie-settings hidden>
            <button type="button" role="switch" aria-checked="true">Essential cookies</button>
            <div data-cz-cookie-functional-preferences-toggle>
              <button type="button" role="switch" aria-checked="false">Functional preferences</button>
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
    globalThis.__tcfapi = undefined;
    globalThis.adsbygoogle = undefined;
    globalThis.commanderZoneRuntimeConfig = undefined;
    document.body.innerHTML = '';
  });

  it('opens the prerendered preferences panel from the static footer trigger', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-preferences]')?.click();

    expect(document.querySelector<HTMLElement>('app-cookie-consent-banner')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-cz-cookie-settings]')?.hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="reject"]'));
  });

  it('stores v6 internal preferences without personalized ads from accept all on a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="accept"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly version?: unknown;
      readonly decision?: unknown;
      readonly preferences?: unknown;
      readonly personalizedAds?: unknown;
    };

    expect(storedState.version).toBe(6);
    expect(storedState.decision).toBe('accepted');
    expect(storedState.preferences).toBe(true);
    expect(storedState.personalizedAds).toBe(false);
    expect(document.querySelector<HTMLElement>('app-cookie-consent-banner')?.hidden).toBe(true);
  });

  it('stores default functional preferences without personalized ads from a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="customize"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="save"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly decision?: unknown;
      readonly preferences?: unknown;
      readonly ads?: unknown;
      readonly personalizedAds?: unknown;
    };

    expect(storedState.decision).toBe('custom');
    expect(storedState.preferences).toBe(true);
    expect(storedState.ads).toBe(true);
    expect(storedState.personalizedAds).toBe(false);
  });

  it('stores disabled functional preferences from a static public page', () => {
    initializePublicStaticCookiePreferences(document);

    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="customize"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-cz-cookie-functional-preferences-toggle] [role="switch"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-cz-cookie-action="save"]')?.click();

    const storedState = JSON.parse(localStorage.getItem('commanderzone.cookieConsent') ?? '{}') as {
      readonly decision?: unknown;
      readonly preferences?: unknown;
    };

    expect(storedState.decision).toBe('custom');
    expect(storedState.preferences).toBe(false);
  });

  it('switches static AdSense to personalized only when TCF grants Google advertising consent', () => {
    globalThis.adsbygoogle = undefined;
    globalThis.__tcfapi = (_command, _version, callback) => {
      callback({
        eventStatus: 'useractioncomplete',
        gdprApplies: true,
        tcString: 'tc-string',
        purpose: { consents: { 1: true, 3: true, 4: true } },
        vendor: { consents: { 755: true } },
      }, true);
    };

    initializePublicStaticCookiePreferences(document);

    expect((globalThis.adsbygoogle as { requestNonPersonalizedAds?: 0 | 1 } | undefined)?.requestNonPersonalizedAds).toBe(0);
  });
});
