import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSnapshot, readSnapshot, serverFailures, httpFailures } from './load-test-gates.mjs';
const before = { deadlocks: 0, connections: 10, maxConnections: 100, queueFull: 0, restarts: { api:0, websocket:0, runtime:0, database:0 } };
test('missing metrics cannot pass', () => assert.ok(serverFailures(before, normalizeSnapshot(null)).length));
test('unchanged snapshots pass; deadlock and restart fail', () => {
  assert.deepEqual(serverFailures(before, before), []);
  assert.ok(serverFailures(before, {...before, deadlocks:1}).includes('new deadlock'));
  assert.ok(serverFailures(before, {...before, restarts:{...before.restarts, api:1}}).includes('container restarted: api'));
});
test('PowerShell nested database counters normalize', () => {
  const sessions = normalizeSnapshot({ postgres: { database: { sessions: 42, session_time: 1234, stats_reset: 'reset' } } });
  assert.equal(sessions.dbSessions, 42);
  assert.equal(sessions.dbSessionTimeMs, 1234);
  assert.equal(sessions.dbStatsReset, 'reset');
  assert.equal(normalizeSnapshot({ postgres:{ database:{ deadlocks:2 }, pool:{used:5,max:10}, locks:[{granted:false,count:3}] } }).waitingLocks, 3);
  assert.equal(normalizeSnapshot({ postgres:{database:{deadlocks:2}} }).deadlocks, 2);
});
test('advanced calculations have a separate stop budget', () => {
  const points = Array.from({length:20},()=>({metric:'cz_navigation_endpoint_ms',data:{value:3000,tags:{traffic_type:'deck_analysis'}}}));
  assert.deepEqual(httpFailures(points), []);
  points.forEach(p=>p.data.tags.traffic_type='light_read');
  assert.ok(httpFailures(points).length);
});

test('HTTP gates work without Object.groupBy during setup and mixed traffic', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object, 'groupBy');
  Object.defineProperty(Object, 'groupBy', { value: undefined, configurable: true });
  try {
    assert.deepEqual(httpFailures([]), []);
    const samples = type => Array.from({ length: 20 }, () => ({
      metric: 'cz_navigation_endpoint_ms', data: { value: 3000, tags: { traffic_type: type } },
    }));
    assert.deepEqual(httpFailures([...samples('deck_analysis'), ...samples('light_read')]), ['HTTP latency: light_read']);
  } finally {
    if (descriptor) Object.defineProperty(Object, 'groupBy', descriptor);
    else delete Object.groupBy;
  }
});

test('Bash manifest loads separate metric files instead of masking them', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-load-gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  write('server-metrics-live.json', { capturedAt: '2026-09-13T10:37:57Z', files: { postgres: 'postgres-live.json' } });
  write('postgres-live.json', { deadlocks: 2, waitingLocks: 0, sessions: 100, statsReset: 'reset' });
  write('postgres-detail-live.json', { pool: { used: 7, max: 100 } });
  write('runtime-live.json', { totals: { 'actor.queue_full_count': 3 } });
  fs.writeFileSync(path.join(dir, 'restarts-live.txt'), 'api=0\nwebsocket=0\nruntime=0\ndatabase=0\n');
  write('php-live.json', { status: 'available', totalThreads: 2, busyThreads: 2, queueDepth: null });
  fs.writeFileSync(path.join(dir, 'docker-stats-live.ndjson'), JSON.stringify({ Name: 'api', CPUPerc: '53.21%' })+'\n');
  const snapshot = readSnapshot(dir, 'live');
  assert.equal(snapshot.deadlocks, 2);
  assert.equal(snapshot.connections, 7);
  assert.equal(snapshot.dbSessions, 100);
  assert.equal(snapshot.dbStatsReset, 'reset');
  assert.equal(snapshot.maxConnections, 100);
  assert.equal(snapshot.queueFull, 3);
  assert.equal(snapshot.php.busyThreads, 2);
  assert.equal(snapshot.php.queueDepth, null);
  assert.equal(snapshot.dockerStats[0].CPUPerc, '53.21%');
  assert.deepEqual(serverFailures(snapshot, snapshot), []);
  fs.unlinkSync(path.join(dir, 'runtime-live.json'));
  const incomplete = readSnapshot(dir, 'live');
  assert.ok(serverFailures(incomplete, incomplete).includes('missing critical metric: queueFull'));
});
