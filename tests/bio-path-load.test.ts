// Opt-in performance regression from the SPEC 256W mixed-army load.
import assert from 'node:assert/strict';
import { releaseLoadFixture } from './v117-load-fixture';
import { stateHash } from '../src/sim/save';
const { g } = releaseLoadFixture(256, 0), samples: number[] = [];
for (let i = 0; i < 3; i++) { const t = performance.now(); g.step(); samples.push(performance.now() - t); }
const hash = stateHash(g);
console.log(JSON.stringify({ ticks: g.tick, ms: samples, hash }));
assert.ok(Math.max(...samples) < 500, 'three-tick mixed army start has no multi-second all-form path scan');
