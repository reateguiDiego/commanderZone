import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API = (__ENV.API_BASE_URL || 'https://api.commanderzone.com').replace(/\/+$/, '');
const failures = new Rate('transport_failures');
const requests = new Counter('transport_requests');
const total = new Trend('transport_total_ms', true);
const waiting = new Trend('transport_waiting_ms', true);
const receiving = new Trend('transport_receiving_ms', true);
export const options = {
  scenarios: { transport: { executor: 'per-vu-iterations', vus: 1, iterations: 8, maxDuration: '3m' } },
  thresholds: {
    transport_failures: ['rate==0'],
    'transport_requests{mode:default}': ['count==8'],
    'transport_requests{mode:gzip}': ['count==8'],
    'transport_total_ms{mode:default}': ['max>=0'],
    'transport_total_ms{mode:gzip}': ['max>=0'],
    'transport_waiting_ms{mode:default}': ['max>=0'],
    'transport_waiting_ms{mode:gzip}': ['max>=0'],
    'transport_receiving_ms{mode:default}': ['max>=0'],
    'transport_receiving_ms{mode:gzip}': ['max>=0'],
  },
  summaryTrendStats: ['count', 'med', 'p(95)', 'max'],
};
function json(response) { try { return response.json(); } catch (_) { return null; } }
function header(response, name) {
  const key = Object.keys(response.headers || {}).find(k => k.toLowerCase() === name);
  return key ? String(response.headers[key]) : '';
}
function params(token, mode) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (mode === 'gzip') headers['Accept-Encoding'] = 'gzip';
  return { headers, tags: { mode }, timeout: '15s' };
}
export function setup() {
  if (!__ENV.USER_PASSWORD) throw new Error('USER_PASSWORD is required');
  const login = http.post(`${API}/auth/login`, JSON.stringify({
    email: 'test01@test.com', password: __ENV.USER_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' }, timeout: '15s' });
  const token = json(login)?.token;
  if (login.status !== 200 || !token) throw new Error('Test login failed');
  const list = http.get(`${API}/decks?limit=1`, params(token, 'setup'));
  const deck = json(list)?.data?.[0];
  if (list.status !== 200 || !deck?.id) throw new Error('Test deck missing');
  const route = deck.slug ? `/decks/by-slug/${encodeURIComponent(deck.slug)}` : `/decks/${deck.id}`;
  for (const mode of ['default', 'gzip']) {
    const response = http.get(API + route, params(token, mode));
    if (response.status !== 200 || json(response)?.deck?.id !== deck.id) throw new Error('Warm-up failed');
  }
  return { token, route, deckId: deck.id };
}
export default function (data) {
  // Reverse each pair to reduce systematic order bias; reuse one VU connection.
  const modes = __ITER % 2 === 0 ? ['default', 'gzip'] : ['gzip', 'default'];
  for (const mode of modes) {
    const response = http.get(API + data.route, params(data.token, mode));
    const ok = response.status === 200 && json(response)?.deck?.id === data.deckId;
    failures.add(!ok, { mode }); requests.add(1, { mode });
    total.add(response.timings.duration, { mode });
    waiting.add(response.timings.waiting, { mode });
    receiving.add(response.timings.receiving, { mode });
    const requestId = header(response, 'x-request-id');
    const encoding = header(response, 'content-encoding').toLowerCase().trim();
    const length = header(response, 'content-length');
    console.log(JSON.stringify({ event: 'transport_ab', pair: __ITER + 1, mode,
      status: response.status, validDeck: ok,
      encoding: !encoding ? 'absent' : ['gzip', 'br', 'zstd', 'deflate', 'identity'].includes(encoding) ? encoding : 'other',
      contentLength: /^\d+$/.test(length) ? Number(length) : null,
      decodedBodyBytes: unescape(encodeURIComponent(response.body || '')).length,
      requestId: /^[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? requestId : null,
      total_ms: response.timings.duration, waiting_ms: response.timings.waiting,
      receiving_ms: response.timings.receiving }));
    sleep(1);
  }
}
export function handleSummary(data) {
  const rows = Object.entries(data.metrics)
    .filter(([name]) => /^transport_(total|waiting|receiving)_ms\{/.test(name))
    .map(([name, metric]) => ({ metric: name, ...metric.values }));
  return {
    '/reports/transport-ab-summary.json': JSON.stringify({ protocol: 'default-gzip-ab-v1', rows,
      failures: data.metrics.transport_failures?.values }, null, 2),
    stdout: JSON.stringify(rows, null, 2) + '\n',
  };
}
