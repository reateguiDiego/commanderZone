import { signal } from '@angular/core';

export type ResourceState = 'idle' | 'loading' | 'loaded' | 'stale';
export const HEADER_FRESHNESS_MS = 60_000;

/** One request per resource; invalidation during a read cannot bless an old response. */
export class FreshResource {
  readonly state = signal<ResourceState>('idle');
  readonly loadedAt = signal<number | null>(null);
  private pending?: Promise<void>;
  private revision = 0;
  private epoch = 0;

  reset(): void {
    this.epoch++;
    this.pending = undefined;
    this.loadedAt.set(null);
    this.state.set('idle');
  }

  invalidate(): void {
    this.revision++;
    this.state.set('stale');
  }

  invalidatePendingRead(): void {
    if (this.pending) this.invalidate();
  }

  load<T>(read: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    if (this.pending) return this.pending;
    const timestamp = this.loadedAt();
    if (this.state() === 'loaded' && timestamp !== null && Date.now() - timestamp < HEADER_FRESHNESS_MS) {
      return Promise.resolve();
    }
    this.state.set('loading');
    const epoch = this.epoch;
    this.pending = Promise.resolve().then(async () => {
      if (epoch !== this.epoch) return;
      let revision: number;
      do {
        revision = this.revision;
        const result = await read();
        if (epoch !== this.epoch) return;
        if (revision === this.revision) apply(result);
      } while (revision !== this.revision);
      this.loadedAt.set(Date.now());
      this.state.set('loaded');
    }).catch((error: unknown) => {
      if (epoch !== this.epoch) return;
      this.state.set('stale');
      throw error;
    }).finally(() => { if (epoch === this.epoch) this.pending = undefined; });
    return this.pending;
  }
}
