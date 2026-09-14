import fs from 'node:fs';
import path from 'node:path';

const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
export function normalizeSnapshot(value, detail = null) {
  const pg = value?.postgres ?? value;
  const runtime = value?.runtime ?? null;
  const counters = runtime?.totals ?? runtime?.actor ?? runtime;
  return {
    capturedAt: value?.capturedAt ?? pg?.capturedAt ?? null,
    deadlocks: pg?.database?.deadlocks ?? pg?.deadlocks ?? null,
    connections: pg?.pool?.used ?? detail?.pool?.used ?? null,
    maxConnections: pg?.pool?.max ?? detail?.pool?.max ?? null,
    dbSessions: pg?.database?.sessions ?? pg?.sessions ?? null,
    dbSessionTimeMs: pg?.database?.session_time ?? pg?.sessionTimeMs ?? null,
    dbStatsReset: pg?.database?.stats_reset ?? pg?.statsReset ?? null,
    waitingLocks: pg?.waitingLocks ?? (Array.isArray(pg?.locks) ? pg.locks.filter(l => l.granted === false).reduce((n, l) => n + Number(l.count), 0) : null),
    queueFull: counters?.['actor.queue_full_count'] ?? counters?.queue_full_count ?? null,
    restarts: value?.restarts ?? (Array.isArray(value?.dockerInspect) ? Object.fromEntries(value.dockerInspect.map(c => [c.Name, c.RestartCount])) : null),
    php: value?.php ?? { status: 'unavailable' },
    dockerStats: value?.dockerStats ?? [],
  };
}
export function readSnapshot(dir, label) {
  const ps = json(path.join(dir, `server-metrics-${label}.json`));
  // Bash writes a file manifest here; PowerShell embeds the metric values.
  if (ps && !ps.files) return normalizeSnapshot(ps);
  const pg = json(path.join(dir, `postgres-${label}.json`));
  const detail = json(path.join(dir, `postgres-detail-${label}.json`)) ?? json(path.join(dir, `postgres-details-${label}.json`));
  let restarts = null;
  try { restarts = Object.fromEntries(fs.readFileSync(path.join(dir, `restarts-${label}.txt`), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => { const [key, value] = line.split('='); return [key, Number(value)]; })); } catch {}
  let dockerStats = [];
  try { dockerStats = fs.readFileSync(path.join(dir, `docker-stats-${label}.ndjson`), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
  return normalizeSnapshot({ capturedAt: pg?.capturedAt, postgres: pg, runtime: json(path.join(dir, `runtime-${label}.json`)), restarts,
    php: json(path.join(dir, `php-${label}.json`)), dockerStats }, detail);
}
export function serverFailures(before, after) {
  const failures = [];
  for (const key of ['deadlocks', 'connections', 'maxConnections', 'queueFull']) {
    if (!Number.isFinite(after[key]) || !Number.isFinite(before[key])) failures.push(`missing critical metric: ${key}`);
  }
  if (!after.restarts || Object.keys(after.restarts).length < 4) failures.push('missing container restart metrics');
  if (after.deadlocks > before.deadlocks) failures.push('new deadlock');
  if (after.queueFull > before.queueFull) failures.push('runtime queue saturated');
  for (const [service, count] of Object.entries(after.restarts ?? {})) {
    if (!Number.isFinite(before.restarts?.[service])) failures.push(`missing baseline for ${service}`);
    else if (count > before.restarts[service]) failures.push(`container restarted: ${service}`);
  }
  return failures;
}
export function httpFailures(points) {
  const failures = [];
  const byType = new Map();
  for (const point of points) {
    if (point.metric !== 'cz_navigation_endpoint_ms') continue;
    const type = point.data.tags.traffic_type;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(point);
  }
  for (const [type, values] of byType) {
    if (values.length < 10) continue;
    const sorted = values.map(p => p.data.value).sort((a,b) => a-b);
    if (sorted[Math.ceil(sorted.length * .95) - 1] > (type === 'deck_analysis' ? 5000 : 2000)) failures.push(`HTTP latency: ${type}`);
  }
  const errors = points.filter(p => p.metric === 'cz_navigation_endpoint_errors');
  if (errors.length >= 10 && errors.reduce((sum,p) => sum + p.data.value, 0) / errors.length > .02) failures.push('HTTP errors above 2%');
  return failures;
}
