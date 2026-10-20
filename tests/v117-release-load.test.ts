import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { releaseLoadFixture } from './v117-load-fixture';
import { expireBioCorpses, bioCorpseRenderGroups } from '../src/sim/bio';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { makeSnapper } from '../src/sim/snapshot';

const out = 'logs/acceptance-20261020'; mkdirSync(out, { recursive: true });
const report: any = { at: new Date().toISOString(), cases: [], corpseMaintenanceBudgetMs: 1 };
function stats(samples: number[]) { const s = samples.slice().sort((a, b) => a - b); return { p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)], max: s.at(-1), n: s.length }; }
try {
  for (const weight of [0, 128, 256] as const) {
    const before = process.memoryUsage(), { g, owners, used } = releaseLoadFixture(weight), row: any = { weight, owners, ownerWeights: used, corpses: g.bioCorpses.length, forms: g.v117.genetics.forms.length, drones: g.v117.drones.instances.length };
    report.cases.push(row);
    assert.equal(g.bioCorpses.length, 50000); assert.equal(g.units.length, 0, 'corpses do not restart dead AI');
    const groups = bioCorpseRenderGroups(g, -1, -1, 225, 225, 100000);
    assert.equal(groups.reduce((n, c) => n + c.count, 0), 50000, 'all corpse IDs remain represented in grouping');
    row.renderGroups = groups.length;
    const start = g.v117.genetics.forms.map(f => [f.x, f.y]);
    const ticks: number[] = [];
    for (let i = 0; i < 720; i++) { const t = performance.now(); g.step(); if (i >= 120) ticks.push(performance.now() - t); }
    row.tickMs = stats(ticks);
    assert.equal(g.bioCorpses.length, 50000, 'no hidden premature deletion');
    if (weight) assert.ok(g.v117.genetics.forms.some((f, i) => f.x !== start[i][0] || f.y !== start[i][1]), 'mixed live army executes real paths');
    const saveStart = performance.now(), saved = serialize(g), json = JSON.stringify(saved); row.saveMs = performance.now() - saveStart; row.saveBytes = Buffer.byteLength(json);
    const loadStart = performance.now(), copy = deserialize(JSON.parse(json)); row.loadMs = performance.now() - loadStart;
    assert.equal(copy.bioCorpses.length, 50000); assert.equal(stateHash(copy), stateHash(g), 'large save restores the identical full state');
    const snapper = makeSnapper(), snapStart = performance.now();
    const snap = snapper.take(g, { tickMs: row.tickMs.p50, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 }, { x0: -1, y0: -1, x1: 225, y1: 225 }, [], false);
    row.snapshotMs = performance.now() - snapStart; row.snapshotBytes = Buffer.byteLength(JSON.stringify(snap));
    const maintenance: number[] = []; g.tick = Math.max(...g.bioCorpses.map(c => c.expiresTick));
    while (g.bioCorpses.length) { const t = performance.now(); expireBioCorpses(g); maintenance.push(performance.now() - t); }
    row.expiryMs = stats(maintenance); row.memory = { before, after: process.memoryUsage() };
    assert.ok(row.expiryMs.p95 <= 1, '50k corpse maintenance p95 <= 1 ms: ' + row.expiryMs.p95);
    writeFileSync(out + '/v117-release-load.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(row));
  }
  report.passed = true;
} finally { writeFileSync(out + '/v117-release-load.json', JSON.stringify(report, null, 2) + '\n'); }
