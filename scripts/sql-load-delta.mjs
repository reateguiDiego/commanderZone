import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function sqlDelta(before, after) {
  for (const snapshot of [before, after]) {
    if (snapshot?.complete !== true || !Array.isArray(snapshot.statements) || !snapshot.statsReset || !Number.isFinite(snapshot.dealloc)) {
      throw new Error('SQL delta requires complete snapshots with reset and eviction metadata.');
    }
  }
  if (before.statsReset !== after.statsReset || before.dealloc !== after.dealloc) {
    throw new Error('SQL statistics were reset or entries evicted; a reliable delta is unavailable.');
  }
  const key = r => {
    if (typeof r.queryid !== 'string') throw new Error('queryid must be text to preserve 64-bit precision.');
    return JSON.stringify([r.dbid, r.userid, r.toplevel, r.queryid]);
  };
  const previous = new Map(before.statements.map(r => [key(r), r]));
  const rows = after.statements.map(r => {
    const old = previous.get(key(r));
    const delta = { dbid: r.dbid, userid: r.userid, toplevel: r.toplevel, queryid: r.queryid, query: r.query };
    for (const field of ['calls', 'total_exec_time', 'rows', 'shared_blks_hit', 'shared_blks_read', 'temp_blks_written']) {
      const value = r[field] - (old?.[field] ?? 0);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid/decreasing SQL counter: ${field}`);
      delta[field] = value;
    }
    delta.mean_exec_time = delta.calls ? delta.total_exec_time / delta.calls : 0;
    return delta;
  }).filter(r => r.calls > 0).sort((a, b) => b.total_exec_time - a.total_exec_time);
  const current = new Set(after.statements.map(key));
  if ([...previous.keys()].some(k => !current.has(k))) throw new Error('SQL entries disappeared; delta is incomplete.');
  return { from: before.capturedAt, to: after.capturedAt, statements: rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dir = process.argv[2];
    const read = label => JSON.parse(fs.readFileSync(path.join(dir, `pg-stat-statements-${label}.json`), 'utf8').replace(/^\uFEFF/, ''));
    const result = sqlDelta(read('before'), read('after'));
    fs.writeFileSync(path.join(dir, 'pg-stat-statements-delta.json'), JSON.stringify(result, null, 2));
    console.table(result.statements.slice(0, 15).map(r => ({
      queryid: r.queryid, calls: r.calls, total_ms: Math.round(r.total_exec_time),
      mean_ms: Math.round(r.mean_exec_time * 100) / 100,
      query: r.query.replace(/\s+/g, ' ').slice(0, 140),
    })));
  } catch (error) {
    console.error(`SQL delta unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
