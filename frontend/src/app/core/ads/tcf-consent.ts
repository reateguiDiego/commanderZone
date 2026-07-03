export type TcfPersonalizedAdsStatus = 'pending' | 'unavailable' | 'denied' | 'granted';

export interface TcfData {
  readonly cmpStatus?: string;
  readonly eventStatus?: string;
  readonly gdprApplies?: boolean;
  readonly listenerId?: number;
  readonly purpose?: {
    readonly consents?: Record<string, boolean | undefined>;
  };
  readonly tcString?: string;
  readonly vendor?: {
    readonly consents?: Record<string, boolean | undefined>;
  };
}

export type TcfApiCallback = (tcData: TcfData, success: boolean) => void;
export type TcfApi = (
  command: 'addEventListener' | 'removeEventListener',
  version: 2,
  callback: TcfApiCallback,
  parameter?: number,
) => void;

export interface TcfConsentSubscription {
  unsubscribe(): void;
}

export interface TcfConsentSubscriptionOptions {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

declare global {
  // IAB TCF API exposed by the configured certified CMP.
  // eslint-disable-next-line no-var
  var __tcfapi: TcfApi | undefined;
}

const GOOGLE_ADVERTISING_PRODUCTS_VENDOR_ID = 755;
const PERSONALIZED_AD_PURPOSE_IDS = [1, 3, 4] as const;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 250;

export function evaluateTcfPersonalizedAdsStatus(tcData: TcfData): TcfPersonalizedAdsStatus {
  if (tcData.gdprApplies === false) {
    return 'granted';
  }

  if (!isResolvedTcfEvent(tcData.eventStatus)) {
    return 'pending';
  }

  if (!tcData.tcString) {
    return 'denied';
  }

  if (!hasConsent(tcData.vendor?.consents, GOOGLE_ADVERTISING_PRODUCTS_VENDOR_ID)) {
    return 'denied';
  }

  return PERSONALIZED_AD_PURPOSE_IDS.every((purposeId) => hasConsent(tcData.purpose?.consents, purposeId))
    ? 'granted'
    : 'denied';
}

export function subscribeToTcfPersonalizedAdsStatus(
  onStatus: (status: TcfPersonalizedAdsStatus, tcData?: TcfData) => void,
  options: TcfConsentSubscriptionOptions = {},
): TcfConsentSubscription {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let listenerId: number | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let unsubscribed = false;

  const connect = (attempt: number): void => {
    if (unsubscribed) {
      return;
    }

    const tcfApi = globalThis.__tcfapi;
    if (typeof tcfApi !== 'function') {
      if (attempt >= maxAttempts) {
        onStatus('unavailable');
        return;
      }

      retryHandle = setTimeout(() => connect(attempt + 1), retryDelayMs);
      return;
    }

    tcfApi('addEventListener', 2, (tcData, success) => {
      if (unsubscribed) {
        return;
      }

      if (!success) {
        onStatus('unavailable');
        return;
      }

      listenerId = typeof tcData.listenerId === 'number' ? tcData.listenerId : listenerId;
      onStatus(evaluateTcfPersonalizedAdsStatus(tcData), tcData);
    });
  };

  connect(0);

  return {
    unsubscribe(): void {
      unsubscribed = true;
      if (retryHandle !== null) {
        clearTimeout(retryHandle);
      }

      const tcfApi = globalThis.__tcfapi;
      if (listenerId !== null && typeof tcfApi === 'function') {
        tcfApi('removeEventListener', 2, () => undefined, listenerId);
      }
    },
  };
}

function isResolvedTcfEvent(eventStatus: string | undefined): boolean {
  return eventStatus === 'tcloaded' || eventStatus === 'useractioncomplete';
}

function hasConsent(consents: Record<string, boolean | undefined> | undefined, id: number): boolean {
  return consents?.[String(id)] === true;
}
