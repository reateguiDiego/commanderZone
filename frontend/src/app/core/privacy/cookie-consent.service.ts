import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, inject, Injectable, signal } from '@angular/core';

export type CookieConsentDecision = 'pending' | 'accepted' | 'rejected' | 'custom';

export type ConsentModeValue = 'granted' | 'denied';

export interface GoogleConsentModeState {
  readonly adPersonalization: ConsentModeValue;
  readonly adStorage: ConsentModeValue;
  readonly adUserData: ConsentModeValue;
  readonly analyticsStorage: ConsentModeValue;
}

export interface CookieConsentState {
  readonly version: 3;
  readonly essential: true;
  readonly preferences: true;
  readonly adsAvailable: true;
  readonly ads: false;
  readonly decision: CookieConsentDecision;
  readonly updatedAt: string | null;
}

interface StoredCookieConsentState {
  readonly decision?: unknown;
  readonly updatedAt?: unknown;
  readonly analytics?: unknown;
  readonly ads?: unknown;
}

const STORAGE_KEY = 'commanderzone.cookieConsent';
const STORAGE_VERSION = 3;
const DEFAULT_STATE: CookieConsentState = {
  version: STORAGE_VERSION,
  essential: true,
  preferences: true,
  adsAvailable: true,
  ads: false,
  decision: 'pending',
  updatedAt: null,
};

@Injectable({ providedIn: 'root' })
export class CookieConsentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly stateSignal = signal<CookieConsentState>(this.readStoredState());
  private readonly preferencesPanelOpenSignal = signal(false);

  readonly state = this.stateSignal.asReadonly();
  readonly hasDecision = computed(() => this.state().decision !== 'pending');
  readonly canUsePreferences = computed(() => this.state().preferences);
  readonly canUseAds = computed(() => this.state().ads);
  readonly preferencesPanelOpen = this.preferencesPanelOpenSignal.asReadonly();
  readonly googleConsentModeState = computed<GoogleConsentModeState>(() => ({
    adPersonalization: 'denied',
    adStorage: 'denied',
    adUserData: 'denied',
    analyticsStorage: 'denied',
  }));

  acceptAll(): void {
    this.saveState({
      version: STORAGE_VERSION,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision: 'accepted',
      updatedAt: new Date().toISOString(),
    });
    this.closePreferences();
  }

  rejectAll(): void {
    this.saveState({
      version: STORAGE_VERSION,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision: 'rejected',
      updatedAt: new Date().toISOString(),
    });
    this.closePreferences();
  }

  savePreferences(): void {
    this.saveState({
      version: STORAGE_VERSION,
      essential: true,
      preferences: true,
      adsAvailable: true,
      ads: false,
      decision: 'custom',
      updatedAt: new Date().toISOString(),
    });
    this.closePreferences();
  }

  openPreferences(): void {
    this.preferencesPanelOpenSignal.set(true);
  }

  closePreferences(): void {
    this.preferencesPanelOpenSignal.set(false);
  }

  private saveState(state: CookieConsentState): void {
    this.stateSignal.set(state);

    const storage = this.storage();
    if (!storage) {
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  private readStoredState(): CookieConsentState {
    const storage = this.storage();
    if (!storage) {
      return DEFAULT_STATE;
    }

    const rawState = storage.getItem(STORAGE_KEY);
    if (!rawState) {
      return DEFAULT_STATE;
    }

    try {
      const parsed = JSON.parse(rawState) as StoredCookieConsentState;
      return normalizeStoredState(parsed);
    } catch {
      storage.removeItem(STORAGE_KEY);
      return DEFAULT_STATE;
    }
  }

  private storage(): Storage | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }
}

function normalizeStoredState(state: StoredCookieConsentState): CookieConsentState {
  if (!isConsentDecision(state.decision)) {
    return DEFAULT_STATE;
  }

  return {
    version: STORAGE_VERSION,
    essential: true,
    preferences: true,
    adsAvailable: true,
    ads: false,
    decision: state.decision,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
  };
}

function isConsentDecision(value: unknown): value is CookieConsentDecision {
  return value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'custom';
}
