import { cpus, arch, platform, release, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Game } from '../src/sim/game';
import { deserialize } from '../src/sim/save';
import { unpackStr } from '../src/core/pack';
import { REF_BASE } from '../src/data/refbase';
import { buildPerfWorld, PERF_LEVELS } from '../src/sim/perfworld';
import { CHUNK } from '../src/core/types';

const OUTPUT = 'docs/validation-v116-l45-fulltick.json';
const WARMUP_TICKS = 1800;
const SAMPLES = 3600;
const cpu = cpus()[0];
const report: any = {
  status: 'running', startedAt: new Date().toISOString(), node: process.version,
  runtime: { platform: platform(), arch: arch(), release: release(), cpu: cpu?.model ?? 'unknown', logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
  method: 'Existing buildPerfWorld L4/L5 fixtures from the same REF_BASE save; setup/build timed separately; warmup and samples are ordinary Game.step calls; each measured tick is timed individually with performance.now; no direct counter or physics writes.',
  warmupTicks: WARMUP_TICKS, samplesPerLevel: SAMPLES, levels: [],
};
const save = () => writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
const pctl = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil(p * xs.length) - 1];
const snapshot = (g: Game) => {
  const ents = [...g.ents.values()], chunks = [...g.world.chunks.values()];
  const counts: Record<string, number> = {};
  for (const e of ents) {
    counts[e.t] = (counts[e.t] || 0) + 1;
    const key = `proto:${e.proto}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const eb = ents.reduce((b, e) => ({
    minX: Math.min(b.minX, e.x), minY: Math.min(b.minY, e.y),
    maxXExclusive: Math.max(b.maxXExclusive, e.x + e.w), maxYExclusive: Math.max(b.maxYExclusive, e.y + e.h),
  }), { minX: Infinity, minY: Infinity, maxXExclusive: -Infinity, maxYExclusive: -Infinity });
  const cb = chunks.reduce((b, c) => ({
    minX: Math.min(b.minX, c.cx), minY: Math.min(b.minY, c.cy),
    maxXExclusive: Math.max(b.maxXExclusive, c.cx + 1), maxYExclusive: Math.max(b.maxYExclusive, c.cy + 1),
  }), { minX: Infinity, minY: Infinity, maxXExclusive: -Infinity, maxYExclusive: -Infinity });
  return {
    entities: ents.length, counts, trains: g.trains.length, robotsInFlight: g.robots?.length ?? 0,
    chunks: chunks.length, chunkBounds: cb,
    tileBounds: {
      entities: Object.fromEntries(Object.entries(eb).map(([k, v]) => [k, Number.isFinite(v) ? v : null])),
      chunks: { minX: cb.minX * CHUNK, minY: cb.minY * CHUNK, maxXExclusive: cb.maxXExclusive * CHUNK, maxYExclusive: cb.maxYExclusive * CHUNK },
    },
  };
};

try {
  const ref = await unpackStr(REF_BASE);
  for (const level of PERF_LEVELS.filter(x => x.id === 4 || x.id === 5)) {
    const buildStart = performance.now();
    const { g, info } = buildPerfWorld(level.id, deserialize(structuredClone(ref)), () => new Game(12345, true, { enemies: 'none' }));
    const buildMs = performance.now() - buildStart;
    const buildSnapshot = snapshot(g);
    const warmStart = g.tick;
    for (let i = 0; i < WARMUP_TICKS; i++) g.step();
    const sampleStartSnapshot = snapshot(g);
    const samples: number[] = [];
    const tickStart = g.tick;
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      g.step();
      samples.push(performance.now() - t0);
    }
    const sampleEndSnapshot = snapshot(g);
    const row = {
      id: level.id, name: level.name, builtMs: +buildMs.toFixed(3), info,
      buildSnapshot, warmup: { ticks: WARMUP_TICKS, startTick: warmStart, endTick: tickStart, endSnapshot: sampleStartSnapshot },
      measured: { ticks: SAMPLES, startTick: tickStart, endTick: g.tick,
        p50Ms: +pctl(samples, 0.50).toFixed(5), p95Ms: +pctl(samples, 0.95).toFixed(5),
        p99Ms: +pctl(samples, 0.99).toFixed(5), maxMs: +Math.max(...samples).toFixed(5),
        over16_67ms: samples.filter(x => x > 16.67).length, startSnapshot: sampleStartSnapshot, endSnapshot: sampleEndSnapshot, rawMs: samples },
    };
    report.levels.push(row);
    save();
    console.log(`L${row.id} ${row.name}: entities=${info.ents} chunks=${row.warmup.endSnapshot.chunks} build=${row.builtMs}ms fullTickP95=${row.measured.p95Ms}ms max=${row.measured.maxMs}ms`);
  }
  report.acceptance = {
    fullTickP95MaxMs: 16.67,
    pass: report.levels.length === 2 && report.levels.every((x: any) => x.measured.p95Ms <= 16.67),
  };
  report.status = report.acceptance.pass ? 'pass' : 'fail';
} catch (error) {
  report.status = 'error';
  report.error = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  report.finishedAt = new Date().toISOString();
  save();
}
if (report.status !== 'pass') process.exitCode = 1;
