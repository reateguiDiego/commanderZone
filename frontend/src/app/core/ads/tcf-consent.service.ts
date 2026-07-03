import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import {
  subscribeToTcfPersonalizedAdsStatus,
  TcfConsentSubscription,
  TcfPersonalizedAdsStatus,
} from './tcf-consent';

@Injectable({ providedIn: 'root' })
export class TcfConsentService implements OnDestroy {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly statusSignal = signal<TcfPersonalizedAdsStatus>(this.isBrowser ? 'pending' : 'unavailable');
  private subscription: TcfConsentSubscription | null = null;

  readonly status = this.statusSignal.asReadonly();
  readonly canRequestPersonalizedAds = computed(() => this.status() === 'granted');

  initialize(): void {
    if (!this.isBrowser || this.subscription) {
      return;
    }

    this.subscription = subscribeToTcfPersonalizedAdsStatus((status) => this.statusSignal.set(status));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
