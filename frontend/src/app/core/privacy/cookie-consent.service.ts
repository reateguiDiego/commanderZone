import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, inject, Injectable, signal } from '@angular/core';
import { AnalyticsConsentState } from './analytics.service';

export type CookieConsentDecision = 'pending' | 'accepted' | 'rejected' | 'custom';

export interface CookieConsentPreferences {
  readonly analytics: boolean;
}

export interface CookieConsentState extends CookieConsentPreferences {
  readonly decision: CookieConsentDecision;
  readonly updatedAt: string | null;
}

const STORAGE_KEY = 'commanderzone.cookieConsent';
const DEFAULT_STATE: CookieConsentState = {
  analytics: false,
  decision: 'pending',
  updatedAt: null,
};

@Injectable({ providedIn: 'root' })
export class CookieConsentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly stateSignal = signal<CookieConsentState>(this.readStoredState());

  readonly state = this.stateSignal.asReadonly();
  readonly hasDecision = computed(() => this.state().decision !== 'pending');
  readonly canUseAnalytics = computed(() => this.state().analytics);
  readonly googleConsentModeState = computed<AnalyticsConsentState>(() => ({
    adPersonalization: 'denied',
    adStorage: 'denied',
    adUserData: 'denied',
    analyticsStorage: this.canUseAnalytics() ? 'granted' : 'denied',
  }));

  acceptAll(): void {
    this.saveState({
      analytics: true,
      decision: 'accepted',
      updatedAt: new Date().toISOString(),
    });
  }

  rejectAll(): void {
    this.saveState({
      analytics: false,
      decision: 'rejected',
      updatedAt: new Date().toISOString(),
    });
  }

  savePreferences(preferences: CookieConsentPreferences): void {
    this.saveState({
      analytics: preferences.analytics,
      decision: 'custom',
      updatedAt: new Date().toISOString(),
    });
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
      const parsed = JSON.parse(rawState) as Partial<CookieConsentState>;
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

function normalizeStoredState(state: Partial<CookieConsentState>): CookieConsentState {
  if (!isConsentDecision(state.decision)) {
    return DEFAULT_STATE;
  }

  return {
    analytics: state.analytics === true,
    decision: state.decision,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
  };
}

function isConsentDecision(value: unknown): value is CookieConsentDecision {
  return value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'custom';
}
