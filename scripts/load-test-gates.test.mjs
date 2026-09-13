import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, serverFailures, httpFailures } from './load-test-gates.mjs';
const before = { deadlocks: 0, connections: 10, maxConnections: 100, queueFull: 0, restarts: { api:0, websocket:0, runtime:0, database:0 } };
test('missing metrics cannot pass', () => assert.ok(serverFailures(before, normalizeSnapshot(null)).length));
test('unchanged snapshots pass; deadlock and restart fail', () => {
  assert.deepEqual(serverFailures(before, before), []);
  assert.ok(serverFailures(before, {...before, deadlocks:1}).includes('new deadlock'));
  assert.ok(serverFailures(before, {...before, restarts:{...before.restarts, api:1}}).includes('container restarted: api'));
});
test('PowerShell nested database counters normalize', () => {
  assert.equal(normalizeSnapshot({ postgres:{ database:{ deadlocks:2 }, pool:{used:5,max:10}, locks:[{granted:false,count:3}] } }).waitingLocks, 3);
  assert.equal(normalizeSnapshot({ postgres:{database:{deadlocks:2}} }).deadlocks, 2);
});
test('advanced calculations have a separate stop budget', () => {
  const points = Array.from({length:20},()=>({metric:'cz_navigation_endpoint_ms',data:{value:3000,tags:{traffic_type:'deck_analysis'}}}));
  assert.deepEqual(httpFailures(points), []);
  points.forEach(p=>p.data.tags.traffic_type='light_read');
  assert.ok(httpFailures(points).length);
});
