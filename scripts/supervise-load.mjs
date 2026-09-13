import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readSnapshot, serverFailures, httpFailures } from './load-test-gates.mjs';

// Config contains argv, never a shell command or credential values.
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const run = (argv, timeout = 60000) => new Promise((resolve, reject) => {
  const child = spawn(argv[0], argv.slice(1), { shell: false, windowsHide: true, stdio: 'ignore', timeout });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`Collector exit ${code}`)));
});
const baseline = readSnapshot(config.reportDir, 'before');
if (config.requireMetrics && serverFailures(baseline, baseline).length) {
  fs.writeFileSync(path.join(config.reportDir, 'watchdog.json'), JSON.stringify({ status: 'failed', reasons: serverFailures(baseline, baseline) }, null, 2));
  process.exit(2);
}
const log = fs.createWriteStream(path.join(config.reportDir, 'k6-output.log'));
const child = spawn(config.command[0], config.command.slice(1), { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
let done = false, exitCode = 1, aborted = false, offset = 0, buffer = '', points = [], badSince = null;
const finished = new Promise(resolve => {
  child.on('error', error => { done = true; log.write(error.message); resolve(); });
  child.on('close', code => { done = true; exitCode = code ?? 1; resolve(); });
});
async function stop(reasons) {
  if (aborted) return;
  aborted = true;
  fs.writeFileSync(path.join(config.reportDir, 'watchdog.json'), JSON.stringify({ status: 'failed', reasons, at: new Date().toISOString() }, null, 2));
  await run(['docker', 'stop', '--time', '5', config.containerName], 15000).catch(() => child.kill());
}
process.on('SIGINT', () => void stop(['operator interruption']));
process.on('SIGTERM', () => void stop(['operator interruption']));
while (!done) {
  await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (done) break;
  try {
    const file = path.join(config.reportDir, 'k6-points.ndjson');
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, 'r');
      const chunk = Buffer.alloc(size - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset); fs.closeSync(fd); offset = size;
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) { try { const p = JSON.parse(line); if (p.type === 'Point') points.push(p); } catch {} }
      points = points.filter(p => Date.parse(p.data.time) >= Date.now() - 30000);
    }
    let transient = httpFailures(points);
    if (config.requireMetrics) {
      await run(config.snapshotCommand);
      const snapshot = readSnapshot(config.reportDir, 'live');
      fs.appendFileSync(path.join(config.reportDir, 'server-samples.ndjson'), JSON.stringify(snapshot)+'\n');
      const failures = serverFailures(baseline, snapshot);
      if (failures.length) { await stop(failures); break; }
      if (snapshot.connections / snapshot.maxConnections >= .9) transient.push('connections above 90%');
      if (snapshot.waitingLocks > 0) transient.push('persistent waiting locks');
    }
    badSince = transient.length ? badSince ?? Date.now() : null;
    if (badSince !== null && Date.now() - badSince >= 30000) { await stop(transient); break; }
  } catch (error) { await stop([`metric collection failed: ${error.message}`]); break; }
}
await finished;
log.end();
if (!aborted) fs.writeFileSync(path.join(config.reportDir, 'watchdog.json'), JSON.stringify({ status: exitCode === 0 ? 'passed' : 'failed', metricsRequired: config.requireMetrics, exitCode }, null, 2));
process.exit(aborted ? 2 : exitCode);
