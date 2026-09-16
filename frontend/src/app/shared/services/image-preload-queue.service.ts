import { Injectable } from '@angular/core';
import { preloadImage, type ImagePreloadPriority } from '../utils/image-preload';

export type ImagePreloadQueuePriority = 'critical' | 'visible' | 'interaction' | 'background';

export interface ImagePreloadRequest {
  readonly completed: Promise<boolean>;
  cancel(): void;
}

export interface ScheduledImageRequest {
  readonly key: string;
  readonly priority: ImagePreloadQueuePriority;
  start(complete: (loaded: boolean) => void): void | (() => void);
}

export interface ImagePreloadQueueSnapshot {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly activeByPriority: Readonly<Record<ImagePreloadQueuePriority, number>>;
  readonly queuedByPriority: Readonly<Record<ImagePreloadQueuePriority, number>>;
  readonly requestCount: number;
  readonly completedRequestCount: number;
  readonly cancelledRequestCount: number;
  readonly averageQueueWaitMs: number;
  readonly longestQueueWaitMs: number;
  readonly startedWorkCountByPriority: Readonly<Record<ImagePreloadQueuePriority, number>>;
  readonly averageQueueWaitMsByPriority: Readonly<Record<ImagePreloadQueuePriority, number>>;
  readonly longestQueueWaitMsByPriority: Readonly<Record<ImagePreloadQueuePriority, number>>;
}

interface ScheduledImageWork {
  readonly key: string;
  priority: ImagePreloadQueuePriority;
  readonly consumers: Set<ScheduledImageConsumer>;
  started: boolean;
  startedAsBackground: boolean;
  readonly queuedAt: number;
}

interface ScheduledImageConsumer {
  readonly start: ScheduledImageRequest['start'];
  readonly resolve: (loaded: boolean) => void;
  cleanup: (() => void) | null;
  completed: boolean;
}

const PRIORITY_WEIGHT: Readonly<Record<ImagePreloadQueuePriority, number>> = {
  critical: 0,
  interaction: 1,
  visible: 2,
  background: 3,
};

const FETCH_PRIORITY: Readonly<Record<ImagePreloadQueuePriority, ImagePreloadPriority>> = {
  critical: 'high',
  interaction: 'high',
  visible: 'auto',
  background: 'low',
};

const MAX_CONCURRENT_WORK = 6;
const MAX_NON_URGENT_WORK = 4;
const MAX_BACKGROUND_WORK = 2;

/**
 * The single scheduler for speculative preloads and visible game card images.
 * A caller starts its actual image work only after receiving a bounded slot.
 */
@Injectable({ providedIn: 'root' })
export class ImagePreloadQueueService {
  private readonly workByKey = new Map<string, ScheduledImageWork>();
  private readonly queue: ScheduledImageWork[] = [];
  private activeWorkCount = 0;
  private activeBackgroundWorkCount = 0;
  private requestCount = 0;
  private completedRequestCount = 0;
  private cancelledRequestCount = 0;
  private totalQueueWaitMs = 0;
  private startedWorkCount = 0;
  private longestQueueWaitMs = 0;
  private readonly startedWorkCountByPriority = this.emptyPriorityCounts();
  private readonly totalQueueWaitMsByPriority = this.emptyPriorityCounts();
  private readonly longestQueueWaitMsByPriority = this.emptyPriorityCounts();

  preload(
    imageUrl: string | null,
    priority: ImagePreloadQueuePriority = 'background',
  ): Promise<boolean> {
    return this.request(imageUrl, priority).completed;
  }

  request(
    imageUrl: string | null,
    priority: ImagePreloadQueuePriority = 'background',
  ): ImagePreloadRequest {
    const normalizedUrl = imageUrl?.trim();
    if (!normalizedUrl) {
      return { completed: Promise.resolve(false), cancel: () => undefined };
    }

    const requestUrl = normalizedUrl;

    const abortController = new AbortController();
    return this.schedule({
      key: requestUrl,
      priority,
      start: (complete) => {
        void preloadImage(requestUrl, {
          fetchPriority: FETCH_PRIORITY[priority],
          signal: abortController.signal,
        }).then(complete);
        return () => abortController.abort();
      },
    });
  }

  schedule(request: ScheduledImageRequest): ImagePreloadRequest {
    const key = request.key.trim();
    if (!key) {
      return { completed: Promise.resolve(false), cancel: () => undefined };
    }

    let work = this.workByKey.get(key);
    if (!work) {
      work = {
        key,
        priority: request.priority,
        consumers: new Set(),
        started: false,
        startedAsBackground: false,
        queuedAt: performance.now(),
      };
      this.workByKey.set(key, work);
      this.queue.push(work);
    } else if (!work.started && PRIORITY_WEIGHT[request.priority] < PRIORITY_WEIGHT[work.priority]) {
      work.priority = request.priority;
    }

    this.requestCount += 1;

    let consumer!: ScheduledImageConsumer;
    const completed = new Promise<boolean>((resolve) => {
      consumer = {
        start: request.start,
        resolve,
        cleanup: null,
        completed: false,
      };
    });
    work.consumers.add(consumer);
    if (work.started) {
      this.startConsumer(work, consumer);
    } else {
      this.drain();
    }

    return {
      completed,
      cancel: () => this.completeConsumer(work!, consumer, false, true),
    };
  }

  snapshot(): ImagePreloadQueueSnapshot {
    return {
      activeCount: this.activeWorkCount,
      queuedCount: this.queue.length,
      activeByPriority: this.workCountByPriority([...this.workByKey.values()].filter((work) => work.started)),
      queuedByPriority: this.workCountByPriority(this.queue),
      requestCount: this.requestCount,
      completedRequestCount: this.completedRequestCount,
      cancelledRequestCount: this.cancelledRequestCount,
      averageQueueWaitMs:
        this.startedWorkCount === 0 ? 0 : Math.round(this.totalQueueWaitMs / this.startedWorkCount),
      longestQueueWaitMs: Math.round(this.longestQueueWaitMs),
      startedWorkCountByPriority: { ...this.startedWorkCountByPriority },
      averageQueueWaitMsByPriority: this.averageQueueWaitMsByPriority(),
      longestQueueWaitMsByPriority: { ...this.longestQueueWaitMsByPriority },
    };
  }

  private drain(): void {
    while (this.canStartNextWork()) {
      const next = this.nextWork();
      if (!next) {
        return;
      }

      next.started = true;
      next.startedAsBackground = next.priority === 'background';
      const queueWaitMs = Math.max(0, performance.now() - next.queuedAt);
      this.totalQueueWaitMs += queueWaitMs;
      this.startedWorkCount += 1;
      this.longestQueueWaitMs = Math.max(this.longestQueueWaitMs, queueWaitMs);
      this.startedWorkCountByPriority[next.priority] += 1;
      this.totalQueueWaitMsByPriority[next.priority] += queueWaitMs;
      this.longestQueueWaitMsByPriority[next.priority] = Math.max(
        this.longestQueueWaitMsByPriority[next.priority],
        queueWaitMs,
      );
      this.activeWorkCount += 1;
      if (next.startedAsBackground) {
        this.activeBackgroundWorkCount += 1;
      }

      for (const consumer of [...next.consumers]) {
        this.startConsumer(next, consumer);
      }
    }
  }

  private startConsumer(work: ScheduledImageWork, consumer: ScheduledImageConsumer): void {
    if (consumer.completed) {
      return;
    }

    try {
      consumer.cleanup = consumer.start((loaded) => this.completeConsumer(work, consumer, loaded)) ?? null;
    } catch {
      this.completeConsumer(work, consumer, false);
    }
  }

  private completeConsumer(
    work: ScheduledImageWork,
    consumer: ScheduledImageConsumer,
    loaded: boolean,
    cancel = false,
  ): void {
    if (consumer.completed) {
      return;
    }

    consumer.completed = true;
    work.consumers.delete(consumer);
    if (cancel) {
      this.cancelledRequestCount += 1;
      consumer.cleanup?.();
    } else {
      this.completedRequestCount += 1;
    }
    consumer.cleanup = null;
    consumer.resolve(loaded);

    if (work.consumers.size === 0) {
      this.removeWork(work);
    }
  }

  private removeWork(work: ScheduledImageWork): void {
    const queuedIndex = this.queue.indexOf(work);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
    }
    if (this.workByKey.get(work.key) === work) {
      this.workByKey.delete(work.key);
    }
    if (work.started) {
      this.activeWorkCount -= 1;
      if (work.startedAsBackground) {
        this.activeBackgroundWorkCount -= 1;
      }
    }
    this.drain();
  }

  private canStartNextWork(): boolean {
    if (this.activeWorkCount >= MAX_CONCURRENT_WORK || this.queue.length === 0) {
      return false;
    }

    const next = this.nextWork(false);
    if (!next) {
      return false;
    }

    if (next.priority === 'critical' || next.priority === 'interaction') {
      return true;
    }

    // Keep two slots available for a hand update, hover or modal opened while
    // the battlefield is filling. Those requests must never wait behind a
    // fully saturated non-urgent queue.
    if (this.activeWorkCount >= MAX_NON_URGENT_WORK) {
      return false;
    }

    return next.priority !== 'background' || this.activeBackgroundWorkCount < MAX_BACKGROUND_WORK;
  }

  private nextWork(remove = true): ScheduledImageWork | null {
    const nextIndex = this.queue.reduce<number | null>((bestIndex, work, index) => {
      if (work.priority === 'background' && this.activeBackgroundWorkCount >= MAX_BACKGROUND_WORK) {
        return bestIndex;
      }
      if (
        bestIndex === null ||
        PRIORITY_WEIGHT[work.priority] < PRIORITY_WEIGHT[this.queue[bestIndex]!.priority]
      ) {
        return index;
      }
      return bestIndex;
    }, null);

    if (nextIndex === null) {
      return null;
    }

    return remove ? (this.queue.splice(nextIndex, 1)[0] ?? null) : (this.queue[nextIndex] ?? null);
  }

  private workCountByPriority(
    works: readonly ScheduledImageWork[],
  ): Record<ImagePreloadQueuePriority, number> {
    const counts = this.emptyPriorityCounts();

    for (const work of works) {
      counts[work.priority] += 1;
    }

    return counts;
  }

  private averageQueueWaitMsByPriority(): Record<ImagePreloadQueuePriority, number> {
    const averages = this.emptyPriorityCounts();

    for (const priority of Object.keys(averages) as ImagePreloadQueuePriority[]) {
      const startedWorkCount = this.startedWorkCountByPriority[priority];
      averages[priority] =
        startedWorkCount === 0
          ? 0
          : Math.round(this.totalQueueWaitMsByPriority[priority] / startedWorkCount);
    }

    return averages;
  }

  private emptyPriorityCounts(): Record<ImagePreloadQueuePriority, number> {
    return {
      critical: 0,
      interaction: 0,
      visible: 0,
      background: 0,
    };
  }
}
