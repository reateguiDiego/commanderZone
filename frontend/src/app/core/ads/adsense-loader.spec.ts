import { GOOGLE_ADSENSE_SCRIPT_ID, loadGoogleAdsenseScript, normalizeAdsenseClient } from './adsense-loader';

describe('adsense-loader', () => {
  afterEach(() => {
    document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)?.remove();
    globalThis.adsbygoogle = undefined;
  });

  it('normalizes only valid AdSense client ids', () => {
    expect(normalizeAdsenseClient(' ca-pub-1234567890123456 ')).toBe('ca-pub-1234567890123456');
    expect(normalizeAdsenseClient('pub-1234567890123456')).toBe('');
    expect(normalizeAdsenseClient('ca-pub-demo')).toBe('');
    expect(normalizeAdsenseClient('')).toBe('');
  });

  it('does not append the script without a valid client id', () => {
    expect(loadGoogleAdsenseScript(document, 'pub-1234567890123456', 'nonPersonalized')).toBe(false);
    expect(document.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)).toBeNull();
    expect(globalThis.adsbygoogle).toBeUndefined();
  });

  it('appends the managed AdSense script once with non-personalized ads by default', () => {
    expect(loadGoogleAdsenseScript(document, 'ca-pub-1234567890123456', 'nonPersonalized')).toBe(true);
    expect(loadGoogleAdsenseScript(document, 'ca-pub-1234567890123456', 'nonPersonalized')).toBe(true);

    const scripts = document.querySelectorAll(`#${GOOGLE_ADSENSE_SCRIPT_ID}`);
    const script = scripts.item(0) as HTMLScriptElement;

    expect(scripts).toHaveLength(1);
    expect(script.async).toBe(true);
    expect(script.crossOrigin).toBe('anonymous');
    expect(script.getAttribute('data-cz-managed-adsense')).toBe('true');
    expect(new URL(script.src).searchParams.get('client')).toBe('ca-pub-1234567890123456');
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(1);
  });

  it('can switch the AdSense queue to personalized requests after consent', () => {
    expect(loadGoogleAdsenseScript(document, 'ca-pub-1234567890123456', 'nonPersonalized')).toBe(true);
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(1);

    expect(loadGoogleAdsenseScript(document, 'ca-pub-1234567890123456', 'personalized')).toBe(true);

    expect(document.querySelectorAll(`#${GOOGLE_ADSENSE_SCRIPT_ID}`)).toHaveLength(1);
    expect(globalThis.adsbygoogle?.requestNonPersonalizedAds).toBe(0);
  });
});
