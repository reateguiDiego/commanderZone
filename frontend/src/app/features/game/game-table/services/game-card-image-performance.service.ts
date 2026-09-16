import { Injectable, OnDestroy, inject, isDevMode } from '@angular/core';
import {
  ImagePreloadQueueService,
  type ImagePreloadQueueSnapshot,
} from '../../../../shared/services/image-preload-queue.service';

export interface GameCardImagePerformanceSnapshot {
  readonly observedAt: number;
  readonly imageRequestCount: number;
  readonly uniqueImageCount: number;
  readonly transferredBytes: number;
  readonly cacheHitCount: number;
  readonly firstCardVisibleMs: number | null;
  readonly scheduler: ImagePreloadQueueSnapshot | null;
}

declare global {
  interface Window {
    __commanderZoneGameImageMetrics?: () => GameCardImagePerformanceSnapshot;
  }
}

/** Development-only resource timing for real game image loads. */
@Injectable()
export class GameCardImagePerformanceService implements OnDestroy {
  private readonly scheduler = inject(ImagePreloadQueueService, { optional: true });
  private readonly enabled =
    typeof window !== 'undefined' &&
    typeof performance !== 'undefined' &&
    (isDevMode() || isLocalDevelopmentHost(window.location.hostname));
  private readonly sessionStartedAt = this.enabled ? performance.now() : 0;
  private readonly resources = new Map<string, PerformanceResourceTiming>();
  private observer: PerformanceObserver | null = null;
  private firstCardVisibleMs: number | null = null;

  constructor() {
    if (!this.enabled) {
      return;
    }

    this.observeResources();
    window.__commanderZoneGameImageMetrics = () => this.snapshot();
    this.publishSnapshot();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.enabled) {
      delete window.__commanderZoneGameImageMetrics;
      document.documentElement.removeAttribute('data-commander-zone-game-image-metrics');
    }
  }

  recordCardVisible(imageUrl: string | null): void {
    if (!this.enabled || this.firstCardVisibleMs !== null || !isScryfallCardImage(imageUrl)) {
      return;
    }

    this.firstCardVisibleMs = Math.round(performance.now() - this.sessionStartedAt);
    this.publishSnapshot();
  }

  private observeResources(): void {
    const record = (entries: readonly PerformanceEntry[]): void => {
      let changed = false;
      for (const entry of entries) {
        if (entry.entryType !== 'resource' || !isScryfallCardImage(entry.name)) {
          continue;
        }

        const resource = entry as PerformanceResourceTiming;
        this.resources.set(`${resource.name}:${resource.startTime}`, resource);
        changed = true;
      }

      if (changed) {
        this.publishSnapshot();
      }
    };

    record(performance.getEntriesByType('resource'));
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    this.observer = new PerformanceObserver((list) => record(list.getEntries()));
    this.observer.observe({ type: 'resource', buffered: true });
  }

  private snapshot(): GameCardImagePerformanceSnapshot {
    const resources = [...this.resources.values()];

    return {
      observedAt: Date.now(),
      imageRequestCount: resources.length,
      uniqueImageCount: new Set(resources.map((resource) => resource.name)).size,
      transferredBytes: resources.reduce((total, resource) => total + resource.transferSize, 0),
      cacheHitCount: resources.filter((resource) => resource.transferSize === 0).length,
      firstCardVisibleMs: this.firstCardVisibleMs,
      scheduler: this.scheduler?.snapshot() ?? null,
    };
  }

  private publishSnapshot(): void {
    if (!this.enabled) {
      return;
    }

    document.documentElement.setAttribute(
      'data-commander-zone-game-image-metrics',
      JSON.stringify(this.snapshot()),
    );
  }
}

function isScryfallCardImage(imageUrl: string | null | undefined): boolean {
  try {
    return new URL(imageUrl ?? '').hostname === 'cards.scryfall.io';
  } catch {
    return false;
  }
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
