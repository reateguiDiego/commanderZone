import type { Page } from '@playwright/test';

export interface Sample {
  kind: string;
  at: number;
  duration: number;
  value?: number;
  inputDelay?: number;
  processing?: number;
  interactionId?: number;
  resource?: string;
  transferBytes?: number;
  decodedBytes?: number;
  ttfb?: number;
}

// Only categories are exported: no query strings, IDs, names or hostnames.
export function resourceCategory(raw: string): string {
  try {
    const path = new URL(raw).pathname;
    if (/\.(avif|webp|png|jpe?g|gif|svg)$/i.test(path)) return 'image';
    if (/\.(js|css|woff2?)$/i.test(path)) return path.split('.').pop()!.toLowerCase();
    const match = path.match(/^\/(cards|decks|rooms|games|friends|messages|auth|community)(?:\/|$)/);
    return match ? '/' + match[1] + '/*' : 'other';
  } catch { return 'other'; }
}

export async function installRecorder(page: Page, receive: (sample: Sample) => void) {
  await page.exposeBinding('__czPerfSample', (source, sample: Sample) => {
    if (source.frame !== page.mainFrame()) return;
    if (sample.resource) sample.resource = resourceCategory(sample.resource);
    receive(sample);
  });
  await page.addInitScript(() => {
    // Init scripts also run inside iframes. Their observers can report the same
    // shared main-thread task, multiplying totals without distinct work.
    if (window.top !== window) return;
    const emit = (sample: object) => {
      void (window as any).__czPerfSample(sample).catch(() => {});
    };
    const observers: PerformanceObserver[] = [];
    const consume = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const e = entry as any;
        if (e.target instanceof Element && e.target.closest('#cz-perf-controls, [data-cz-perf-control]')) continue;
        const sample: any = { kind: entry.entryType, at: performance.timeOrigin + entry.startTime, duration: entry.duration };
        if (entry.entryType === 'layout-shift') {
          if (e.hadRecentInput) continue;
          sample.value = e.value;
        }
        if (entry.entryType === 'event') {
          if (!e.interactionId) continue;
          sample.inputDelay = Math.max(0, e.processingStart - e.startTime);
          sample.processing = Math.max(0, e.processingEnd - e.processingStart);
          sample.interactionId = e.interactionId;
        }
        if (entry.entryType === 'resource') {
          sample.resource = entry.name;
          sample.transferBytes = e.transferSize;
          sample.decodedBytes = e.decodedBodySize;
          sample.ttfb = e.responseStart > 0 ? e.responseStart - e.requestStart : null;
        }
        emit(sample);
      }
    };
    for (const type of ['longtask', 'event', 'layout-shift', 'largest-contentful-paint', 'paint', 'resource']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver(list => consume(list.getEntries()));
      observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      observers.push(observer);
    }
    (window as any).__czPerfFlush = () => observers.forEach(observer => consume(observer.takeRecords()));
    document.addEventListener('visibilitychange', () => emit({ kind: document.hidden ? 'hidden' : 'visible', at: performance.timeOrigin + performance.now(), duration: 0 }));
  });
}

export function summarize(samples: Sample[]) {
  const tasks = samples.filter(s => s.kind === 'longtask');
  const events = samples.filter(s => s.kind === 'event');
  const resources = samples.filter(s => s.kind === 'resource');
  return {
    longTasks: tasks.length,
    longTaskMs: tasks.reduce((sum, s) => sum + s.duration, 0),
    blockingBeyond50ms: tasks.reduce((sum, s) => sum + Math.max(0, s.duration - 50), 0),
    worstInteractionMs: events.length ? Math.max(...events.map(s => s.duration)) : null,
    worstInputDelayMs: events.length ? Math.max(...events.map(s => s.inputDelay || 0)) : null,
    layoutShiftSum: samples.filter(s => s.kind === 'layout-shift').reduce((sum, s) => sum + (s.value || 0), 0),
    completedResources: resources.length,
    observedTransferBytes: resources.reduce((sum, s) => sum + (s.transferBytes || 0), 0),
    hiddenEvents: samples.filter(s => s.kind === 'hidden').length,
    slowestResources: [...resources].sort((a, b) => b.duration - a.duration).slice(0, 10),
  };
}
