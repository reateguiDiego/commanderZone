export const GOOGLE_ADSENSE_SCRIPT_ID = 'cz-google-adsense-script';

export type AdsensePersonalizationMode = 'personalized' | 'nonPersonalized';

interface AdsenseCommandQueue extends Array<Record<string, unknown>> {
  requestNonPersonalizedAds?: 0 | 1;
}

declare global {
  // Google AdSense async tag queue.
  // eslint-disable-next-line no-var
  var adsbygoogle: AdsenseCommandQueue | undefined;
}

const ADSENSE_CLIENT_PATTERN = /^ca-pub-\d{16}$/;
const ADSENSE_SCRIPT_BASE_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

export function normalizeAdsenseClient(value: string | null | undefined): string {
  const client = value?.trim() ?? '';

  return ADSENSE_CLIENT_PATTERN.test(client) ? client : '';
}

export function loadGoogleAdsenseScript(
  documentRef: Document,
  rawClient: string | null | undefined,
  personalizationMode: AdsensePersonalizationMode,
): boolean {
  const client = normalizeAdsenseClient(rawClient);
  if (!client) {
    return false;
  }

  configureAdsensePersonalization(personalizationMode);

  if (documentRef.getElementById(GOOGLE_ADSENSE_SCRIPT_ID)) {
    return true;
  }

  const script = documentRef.createElement('script');
  script.id = GOOGLE_ADSENSE_SCRIPT_ID;
  script.async = true;
  script.src = `${ADSENSE_SCRIPT_BASE_URL}?client=${encodeURIComponent(client)}`;
  script.crossOrigin = 'anonymous';

  documentRef.head.appendChild(script);
  return true;
}

export function configureAdsensePersonalization(mode: AdsensePersonalizationMode): void {
  const queue = globalThis.adsbygoogle ?? [];
  globalThis.adsbygoogle = queue;
  queue.requestNonPersonalizedAds = mode === 'nonPersonalized' ? 1 : 0;
}
