import type { Page, Request } from '@playwright/test';

export function diagnosticRoute(raw: string): string | null {
  const path = new URL(raw).pathname;
  if (/^\/cards\/(search(?:\/options)?|languages|resolve|bulk)$/.test(path)) return path;
  if (/^\/decks(?:\/summary)?$/.test(path)) return path;
  if (/^\/decks\/by-slug\/[^/]+$/.test(path)) return '/decks/by-slug/:slug';
  if (/^\/decks\/[^/]+$/.test(path)) return '/decks/:id';
  const deck = path.match(/^\/decks\/[^/]+\/(analysis(?:\/advanced)?|sections|tokens(?:\/editor)?)$/);
  if (deck) return '/decks/:id/' + deck[1];
  return null;
}

export interface NetworkRecord {
  route: string;
  method: string;
  startedAt: string;
  finishedAt?: string;
  state: 'pending' | 'complete' | 'aborted' | 'failed';
  status: number | null;
  requestId: string | null;
  timing?: ReturnType<typeof timingSummary>;
}

export function timingSummary(t: ReturnType<Request['timing']>) {
  const span = (start: number, end: number) => start >= 0 && end >= start ? end - start : null;
  return {
    totalMs: span(0, t.responseEnd),
    beforeRequestMs: t.requestStart >= 0 ? t.requestStart : null,
    dnsMs: span(t.domainLookupStart, t.domainLookupEnd),
    connectMs: span(t.connectStart, t.connectEnd),
    tlsMs: span(t.secureConnectionStart, t.connectEnd),
    waitingForResponseMs: span(t.requestStart, t.responseStart),
    receivingMs: span(t.responseStart, t.responseEnd),
  };
}

// Playwright's network timings do not require Timing-Allow-Origin. Export only
// allowlisted routes and a UUID correlation ID, never headers/bodies/query text.
export function installNetworkRecorder(page: Page, apiOrigin: string, bucket: () => NetworkRecord[] | undefined) {
  const tracked = new WeakMap<Request, NetworkRecord>();
  const pendingMetadata = new Set<Promise<void>>();
  page.on('request', request => {
    const records = bucket();
    if (!records || records.length >= 500 || new URL(request.url()).origin !== apiOrigin) return;
    if (!['GET', 'OPTIONS'].includes(request.method())) return;
    if (request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    const route = diagnosticRoute(request.url());
    if (!route) return;
    const record: NetworkRecord = { route, method: request.method(), startedAt: new Date().toISOString(), state: 'pending', status: null, requestId: null };
    records.push(record);
    tracked.set(request, record);
  });
  page.on('response', response => {
    const record = tracked.get(response.request());
    if (!record) return;
    record.status = response.status();
    const read = (async () => {
      const id = await response.headerValue('x-request-id');
      if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) record.requestId = id;
    })().catch(() => {});
    pendingMetadata.add(read);
    void read.then(() => pendingMetadata.delete(read));
  });
  const finish = (request: Request, failed: boolean) => {
    const record = tracked.get(request);
    if (!record) return;
    record.state = failed ? (/ERR_ABORTED/.test(request.failure()?.errorText || '') ? 'aborted' : 'failed') : 'complete';
    record.finishedAt = new Date().toISOString();
    record.timing = timingSummary(request.timing());
  };
  page.on('requestfinished', request => finish(request, false));
  page.on('requestfailed', request => finish(request, true));
  return { flush: () => Promise.all([...pendingMetadata]) };
}
