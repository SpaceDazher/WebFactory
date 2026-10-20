import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function nativeSoakOptions(args) {
  const flags = args.filter(a => /^--soak-(hours|seconds)=/.test(a));
  if (!flags.length) return null;
  assert.equal(flags.length, 1, 'choose one soak duration');
  assert.ok(args.includes('--players') && !args.includes('--browser'), 'soak requires its own 16-player world');
  const smoke = flags[0].startsWith('--soak-seconds='), n = Number(flags[0].split('=')[1]);
  assert.ok(Number.isFinite(n) && n > 0 && n <= (smoke ? 300 : 48), 'bounded positive soak duration required');
  return { durationMs: n * (smoke ? 1000 : 3600000), releaseDuration: !smoke && n >= 24 };
}
const median = values => { const v = values.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };

export async function acceptNativeSoak({ clients, getStatus, options, metricsFile, reportFile, candidate }) {
  assert.equal(clients.length, 16);
  const started = performance.now(), at = Date.now(), rows = new Map();
  let checkpoints = 0, lastCheckpoint = null, nextCheckpointTick = 0;
  const report = { schema: 1, state: 'running', candidate, releaseDuration: options.releaseDuration, startedAt: new Date(at).toISOString(),
    durationMs: options.durationMs, elapsedMs: 0, clients: 16, commands: 0, checkpoints: 0, restartVerified: false,
    memoryMethod: 'packaged server process.memoryUsage after full GC once/minute; RSS and heap medians in minutes15–30 versus final15 minutes', samples: [] };
  await mkdir(dirname(reportFile), { recursive: true });
  const persist = () => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const observe = (client, snap) => {
    if (snap.tick < nextCheckpointTick && !rows.has(snap.tick)) return;
    const shared = { tick: snap.tick, units: snap.units, projectiles: snap.projectiles, corpses: snap.corpses, bioRobots: snap.bioRobots,
      shots: snap.shots, fires: snap.fires, acids: snap.acids, mut: snap.mut, research: snap.research, evolution: snap.evolution,
      rockets: snap.rockets, peers: snap.peers, v117: client.v117 };
    const hash = createHash('sha256').update(JSON.stringify(shared)).digest('hex');
    let row = rows.get(snap.tick); if (!row) { row = new Map(); rows.set(snap.tick, row); nextCheckpointTick = snap.tick + 600; }
    row.set(client, hash);
    if (row.size === 16) {
      assert.equal(new Set(row.values()).size, 1, 'all 16 clients receive the same shared authoritative state at tick ' + snap.tick);
      checkpoints++; lastCheckpoint = { tick: snap.tick, hash }; rows.delete(snap.tick);
    }
    while (rows.size > 12) rows.delete(rows.keys().next().value);
  };
  for (const client of clients) client.observeSnapshot = snap => observe(client, snap);
  let nextSample = 0, iteration = 0;
  try {
    console.log('SOAK started: ' + JSON.stringify({ reportFile, hours: options.durationMs / 3600000, releaseDuration: options.releaseDuration }));
    while (performance.now() - started < options.durationMs) {
      for (const [i, client] of clients.entries()) {
        assert.equal(client.error, null, 'bot has no protocol error'); assert.equal(client.ended, false, 'bot remains connected');
        assert.ok(Date.now() - client.snapshotAt < 15000, 'bot continues receiving actual snapshots');
        client.command({ t: 'input', mx: (iteration % 2 ? -1 : 1) * (i % 2 ? -1 : 1), my: 0 }); report.commands++;
      }
      if (performance.now() >= nextSample) {
        const status = await getStatus(); assert.equal(status.world.players, 16);
        report.elapsedMs = performance.now() - started; report.tick = status.world.tick; report.checkpoints = checkpoints; report.lastCheckpoint = lastCheckpoint;
        report.samples = (await readFile(metricsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        await persist(); nextSample = performance.now() + 60000;
        console.log('SOAK progress: ' + JSON.stringify({ elapsedHours: report.elapsedMs / 3600000, tick: report.tick, checkpoints, memory: report.samples.at(-1) }));
      }
      iteration++; await delay(Math.min(1000, Math.max(1, options.durationMs - (performance.now() - started))));
    }
    for (const client of clients) client.command({ t: 'input', mx: 0, my: 0 });
    report.elapsedMs = performance.now() - started; report.checkpoints = checkpoints; report.lastCheckpoint = lastCheckpoint;
    report.samples = (await readFile(metricsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(checkpoints > 0, 'real shared-state checkpoints were compared');
    if (options.releaseDuration) {
      const baseline = report.samples.filter(s => s.at >= at + 15 * 60000 && s.at <= at + 30 * 60000);
      const tail = report.samples.filter(s => s.at >= Date.now() - 15 * 60000);
      assert.ok(baseline.length >= 10 && tail.length >= 10, 'memory comparison has real warm and final windows');
      report.memory = {};
      for (const key of ['rss', 'heapUsed']) {
        const first = median(baseline.map(s => s[key])), last = median(tail.map(s => s[key])), growth = last / first - 1;
        report.memory[key] = { baseline: first, final: last, growth };
        assert.ok(growth <= .05, key + ' growth is at most 5%: ' + (growth * 100).toFixed(2) + '%');
      }
      assert.ok(checkpoints >= options.durationMs / 60000, 'shared state compared throughout actual wall time');
    }
    report.state = 'duration-passed-awaiting-restart'; await persist();
    return async () => { report.restartVerified = true; report.state = 'passed'; await persist(); console.log('SOAK passed: ' + reportFile); };
  } catch (error) {
    report.state = 'failed'; report.error = String(error.message); report.elapsedMs = performance.now() - started; await persist(); throw error;
  } finally { for (const client of clients) client.observeSnapshot = null; }
}
