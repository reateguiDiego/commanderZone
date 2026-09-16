import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlDelta } from './sql-load-delta.mjs';
const row = (queryid, calls, total) => ({ dbid: 1, userid: 2, toplevel: true, queryid, calls, total_exec_time: total, rows: calls, shared_blks_hit: calls, shared_blks_read: 0, temp_blks_written: 0, query: 'SELECT $1' });
const snapshot = statements => ({ complete: true, capturedAt: 'now', statsReset: 'reset', dealloc: 0, statements });
test('delta preserves large IDs and includes new entries only with full snapshots', () => {
  const before = snapshot([row('9223372036854775806', 10, 100)]);
  const after = snapshot([row('9223372036854775806', 12, 120), row('9223372036854775807', 3, 30)]);
  const result = sqlDelta(before, after).statements;
  assert.deepEqual(result.map(r => r.calls), [3, 2]);
  assert.equal(result[0].queryid, '9223372036854775807');
  assert.equal(result[1].mean_exec_time, 10);
});
test('resets, evictions, partial files and decreasing counters cannot yield a delta', () => {
  const before = snapshot([row('1', 10, 100)]);
  for (const after of [
    { ...before, statsReset: 'new' }, { ...before, dealloc: 1 },
    { ...before, complete: false }, snapshot([]), snapshot([row('1', 2, 20)]),
    snapshot([row(1, 11, 110)]),
  ]) assert.throws(() => sqlDelta(before, after));
});
