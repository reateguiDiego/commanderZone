import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { findSeoRouteByPath } from '../localization/seo-routes';

export type GlobalLoadingFeature =
  | 'auth'
  | 'cards'
  | 'community'
  | 'decks'
  | 'email-verification'
  | 'games'
  | 'landing'
  | 'room'
  | 'rooms'
  | 'table-assistant'
  | 'welcome';

const SKIP_GLOBAL_LOADING_FEATURES: ReadonlySet<GlobalLoadingFeature> = new Set([
  'auth',
  'community',
  'decks',
  'email-verification',
  'games',
  'landing',
  'room',
  'rooms',
  'table-assistant',
  'welcome',
]);

@Injectable({ providedIn: 'root' })
export class GlobalLoadingFeaturePolicy {
  private readonly router = inject(Router, { optional: true });

  skipsCurrentFeature(): boolean {
    return this.skipsFeatureForUrl(this.router?.url ?? '/');
  }

  skipsFeatureForUrl(url: string): boolean {
    const feature = this.featureFromUrl(url);

    return feature !== null && SKIP_GLOBAL_LOADING_FEATURES.has(feature);
  }

  matchesCurrentFeature(features: readonly string[]): boolean {
    return this.matchesFeatureForUrl(this.router?.url ?? '/', features);
  }

  matchesFeatureForUrl(url: string, features: readonly string[]): boolean {
    const feature = this.featureFromUrl(url);

    return feature !== null && features.includes(feature);
  }

  private featureFromUrl(url: string): GlobalLoadingFeature | null {
    const path = url.split(/[?#]/)[0] ?? '';
    if (findSeoRouteByPath(path)) {
      return 'landing';
    }

    const [firstSegment] = path.split('/').filter(Boolean);

    return this.isGlobalLoadingFeature(firstSegment) ? firstSegment : null;
  }

  private isGlobalLoadingFeature(value: string | undefined): value is GlobalLoadingFeature {
    return value === 'auth'
      || value === 'cards'
      || value === 'community'
      || value === 'decks'
      || value === 'email-verification'
      || value === 'games'
      || value === 'room'
      || value === 'rooms'
      || value === 'table-assistant'
      || value === 'welcome';
  }
}
