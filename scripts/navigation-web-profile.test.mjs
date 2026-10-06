import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness({ missingDeck = false, malformedSearch = false } = {}) {
  const calls = [], samples = [];
  class Metric {
    constructor(name) { this.name = name; }
    add(value, tags) { samples.push({ name: this.name, value, tags }); }
  }
  const response = data => ({ status: 200, json: () => data, body: JSON.stringify(data), timings: { duration: 5 } });
  const source = readFileSync(new URL('../load-tests/commanderzone-navigation.k6.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default function (data)', 'function iteration(data)')
    .replaceAll('export ', '');
  const api = runInNewContext(source + '\n({setup, iteration, options})', {
    __ENV: { NAVIGATION_MIX: 'web', PROFILE: 'ci', USERS: '1', USER_PASSWORD: 'fixture' }, __VU: 1,
    execution: { vu: { iterationInScenario: 0 } }, Counter: Metric, Rate: Metric, Trend: Metric,
    check: () => true, sleep: () => {},
    http: {
      post: url => { calls.push(url); return response({ token: 'fixture' }); },
      get: url => {
        calls.push(url);
        if (url.endsWith('/decks?limit=1')) return response({ data: missingDeck ? [] : [{ id: 'fixture-deck' }] });
        return response(malformedSearch && url.includes('/cards/search?') ? {} : { data: [] });
      },
    },
  });
  return { ...api, calls, samples };
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
  assert.ok(h.calls.some(url => url.endsWith('/decks/fixture-deck/sections')));
  assert.ok(h.calls.some(url => url.includes('lang=es')));
  assert.ok(!h.calls.some(url => url.includes('/analysis') || url.includes('/games')));
});

test('missing deck fixtures stop setup', () => {
  assert.throws(() => harness({ missingDeck: true }).setup(), /Web fixture missing/);
});

test('HTTP 200 with malformed search results fails completeness', () => {
  const h = harness({ malformedSearch: true });
  h.iteration(h.setup());
  assert.equal(h.samples.filter(s => s.name === 'cz_navigation_incomplete' && s.value === true).length, 5);
});
