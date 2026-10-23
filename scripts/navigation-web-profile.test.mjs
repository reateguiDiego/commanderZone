import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness({ missingDeck = false, malformedSearch = false, malformedTokens = false, slug = 'fixture-slug' } = {}) {
  const calls = [], samples = [], logs = [];
  class Metric {
    constructor(name) { this.name = name; }
    add(value, tags) { samples.push({ name: this.name, value, tags }); }
  }
  const response = data => ({ status: 200, json: () => data, body: JSON.stringify(data),
    headers: { 'Content-Encoding': 'gzip', 'X-Request-ID': 'request-123', 'Set-Cookie': 'secret-cookie' },
    timings: { duration: 5, waiting: 3, receiving: 2 } });
  const source = readFileSync(new URL('../load-tests/commanderzone-navigation.k6.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default function (data)', 'function iteration(data)')
    .replaceAll('export ', '');
  const api = runInNewContext(source + '\n({setup, iteration, options, handleSummary})', {
    __ENV: { NAVIGATION_MIX: 'web', PROFILE: 'ci', USERS: '1', USER_PASSWORD: 'fixture' }, __VU: 1,
    execution: { vu: { iterationInScenario: 0 } }, Counter: Metric, Rate: Metric, Trend: Metric,
    check: () => true, sleep: () => {},
    console: { log: message => logs.push(message) },
    http: {
      post: (url, body, options) => { assert.equal(options.headers['Accept-Encoding'], 'gzip'); calls.push(url); return response({ token: 'fixture' }); },
      get: (url, options) => {
        assert.equal(options.headers['Accept-Encoding'], 'gzip');
        calls.push(url);
        if (url.endsWith('/decks?limit=1')) return response({ data: missingDeck ? [] : [{ id: 'fixture-deck', slug }] });
        if (url.includes('/tokens/editor')) return response({ data: [{ tokenRef: 'token-a' }], tokens: malformedTokens ? {} : { 'token-a': { name: 'Token' } }, unresolved: [] });
        if (url.includes('/decks/by-slug/') || url.endsWith('/decks/fixture-deck')) return response({ deck: { id: 'fixture-deck' } });
        return response(malformedSearch && url.includes('/cards/search?') ? {} : { data: [] });
      },
    },
  });
  return { ...api, calls, samples, logs };
}

test('web journey exercises each required endpoint and records first visits', () => {
  const h = harness();
  h.iteration(h.setup());
  const measured = h.samples.filter(s => s.name === 'cz_navigation_requests');
  assert.equal(measured.length, 12);
  assert.equal(new Set(measured.map(s => s.tags.endpoint)).size, 12);
  for (const s of measured) {
    assert.equal(s.tags.visit, 'first');
    assert.ok(h.options.thresholds[`cz_navigation_requests{endpoint:${s.tags.endpoint},phase:stable}`]);
  }
  assert.ok(h.calls.some(url => url.endsWith('/decks/by-slug/fixture-slug')));
  assert.equal(h.calls.filter(url => url.endsWith('/decks/fixture-deck/tokens/editor')).length, 1);
  assert.ok(!h.calls.some(url => url.endsWith('/sections')));
  assert.ok(!h.samples.some(s => s.name === 'cz_navigation_incomplete' && s.value));
  assert.ok(h.calls.some(url => url.includes('lang=es')));
  assert.ok(!h.calls.some(url => url.includes('/analysis') || url.includes('/games')));
});

test('legacy decks without slug still use the detail endpoint', () => {
  const h = harness({ slug: null });
  h.iteration(h.setup());
  assert.ok(h.calls.some(url => url.endsWith('/decks/fixture-deck')));
});

test('missing token references fail completeness', () => {
  const h = harness({ malformedTokens: true });
  h.iteration(h.setup());
  assert.equal(h.samples.filter(s => s.name === 'cz_navigation_incomplete' && s.value === true).length, 1);
});

test('transport diagnostics are bounded and do not expose credentials or payloads', () => {
  const h = harness();
  h.iteration(h.setup());
  assert.equal(h.logs.length, 3);
  for (const line of h.logs) {
    const entry = JSON.parse(line);
    assert.equal(entry.encoding, 'gzip');
    assert.equal(entry.requestId, 'request-123');
    assert.equal(entry.waiting_ms, 3);
    assert.equal(entry.receiving_ms, 2);
    assert.ok(!line.includes('fixture') && !line.includes('secret-cookie'));
  }
  assert.equal(h.samples.filter(s => s.name === 'cz_navigation_response_encoding' && s.tags.encoding === 'gzip').length, 12);
  const report = JSON.parse(h.handleSummary({ metrics: {} })['/reports/navigation-report.json']);
  assert.equal(report.scenarioVersion, 'web-editor-v2-gzip');
  assert.equal(report.transportEncodingPolicy, 'explicit-gzip');
});

test('missing deck fixtures stop setup', () => {
  assert.throws(() => harness({ missingDeck: true }).setup(), /Web fixture missing/);
});

test('HTTP 200 with malformed search results fails completeness', () => {
  const h = harness({ malformedSearch: true });
  h.iteration(h.setup());
  assert.equal(h.samples.filter(s => s.name === 'cz_navigation_incomplete' && s.value === true).length, 5);
});
