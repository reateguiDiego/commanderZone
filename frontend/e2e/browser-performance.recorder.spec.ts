import { expect, test } from '@playwright/test';
import { installRecorder, resourceCategory, summarize, type Sample } from './support/browser-performance';
import { diagnosticRoute, installNetworkRecorder, timingSummary, type NetworkRecord } from './support/browser-performance-network';
import { createServer } from 'node:http';

test('recorder measures a real main-thread stall without persisting resource identifiers', async ({ page }) => {
  const samples: Sample[] = [];
  await installRecorder(page, sample => samples.push(sample));
  await page.goto('data:text/html,<button>Measure</button>');
  await page.evaluate(() => {
    document.querySelector('button')!.onclick = () => {
      const start = performance.now();
      // Deliberate workload under measurement, not a synchronization sleep.
      while (performance.now() - start < 100) { Math.sqrt(Math.random()); }
    };
  });
  await page.getByRole('button').click();
  await expect.poll(() => samples.filter(s => s.kind === 'longtask').length).toBeGreaterThan(0);
  expect(summarize(samples).longTaskMs).toBeGreaterThanOrEqual(50);
  expect(resourceCategory('https://api.example/decks/private-id?token=secret')).toBe('/decks/*');
  expect(resourceCategory('https://example/img/private-name.webp?signature=secret')).toBe('image');
  expect(resourceCategory('data:text/plain,secret')).toBe('other');
});

test('summary distinguishes unobserved interactions from zero latency', () => {
  expect(summarize([]).worstInteractionMs).toBeNull();
  expect(summarize([
    { kind: 'longtask', at: 1, duration: 125 },
    { kind: 'event', at: 2, duration: 96, inputDelay: 30 },
    { kind: 'hidden', at: 3, duration: 0 },
  ])).toMatchObject({ longTasks: 1, blockingBeyond50ms: 75, worstInteractionMs: 96, worstInputDelayMs: 30, hiddenEvents: 1 });
});

test('iframe observers cannot multiply main-frame task samples', async ({ page }) => {
  const samples: Sample[] = [];
  await installRecorder(page, sample => samples.push(sample));
  await page.goto('data:text/html,<iframe srcdoc="child"></iframe>');
  await expect.poll(() => page.frames().length).toBe(2);
  const child = page.frames().find(frame => frame !== page.mainFrame())!;
  expect(await child.evaluate(() => typeof (window as any).__czPerfFlush)).toBe('undefined');
  await child.evaluate(async () => {
    await (window as any).__czPerfSample({ kind: 'longtask', at: 123, duration: 9999 });
  });
  expect(samples.some(sample => sample.duration === 9999)).toBe(false);
  await page.evaluate(async () => {
    await (window as any).__czPerfSample({ kind: 'longtask', at: 124, duration: 1234 });
  });
  expect(samples.some(sample => sample.duration === 1234)).toBe(true);
});

test('network capture correlates a delayed response to its original step without private data', async ({ page }) => {
  let release: (() => void) | undefined;
  const requestId = '01a13969-d5e0-7c55-bdd4-2e0034a647aa';
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/decks/')) {
      release = () => {
        release = undefined;
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-ID': requestId, 'Set-Cookie': 'secret=do-not-export' });
        res.end('{"private":"do-not-export"}');
      };
    } else { res.end('<html>Network fixture</html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const first: NetworkRecord[] = [];
  const second: NetworkRecord[] = [];
  let bucket = first;
  const recorder = installNetworkRecorder(page, origin, () => bucket);
  try {
    await page.goto(origin);
    await page.evaluate(() => { void fetch('/decks/private-deck/analysis?token=secret').then(r => r.text()); });
    await expect.poll(() => !!release).toBe(true);
    expect(first).toHaveLength(1);
    expect(first[0].state).toBe('pending');
    bucket = second;
    release!();
    await expect.poll(() => first[0].state).toBe('complete');
    await recorder.flush();
    expect(first[0]).toMatchObject({ route: '/decks/:id/analysis', status: 200, requestId });
    expect(first[0].timing!.totalMs).not.toBeNull();
    expect(second).toHaveLength(0);
    expect(JSON.stringify(first)).not.toMatch(/private-deck|token=|secret|do-not-export/);
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('route and timing allowlists preserve missing data and redact identifiers', () => {
  expect(diagnosticRoute('https://api.example/cards/search?oracle=aterrizaje')).toBe('/cards/search');
  expect(diagnosticRoute('https://api.example/decks/by-slug/private-name')).toBe('/decks/by-slug/:slug');
  expect(diagnosticRoute('https://api.example/auth/login')).toBeNull();
  expect(diagnosticRoute('https://api.example/unknown/secret')).toBeNull();
  expect(timingSummary({ startTime: 1000, domainLookupStart: -1, domainLookupEnd: -1, connectStart: -1, connectEnd: -1,
    secureConnectionStart: -1, requestStart: 20, responseStart: 120, responseEnd: 150 })).toMatchObject({
      totalMs: 150, beforeRequestMs: 20, waitingForResponseMs: 100, receivingMs: 30, dnsMs: null, tlsMs: null,
    });
});
