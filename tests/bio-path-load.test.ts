// Opt-in performance regression from the SPEC 256W mixed-army load.
import assert from 'node:assert/strict';
import { releaseLoadFixture } from './v117-load-fixture';
import { stateHash } from '../src/sim/save';
const { g } = releaseLoadFixture(256, 0, true), samples: number[] = [];
for (let i = 0; i < 3; i++) { const t = performance.now(); g.step(); samples.push(performance.now() - t); }
const hash = stateHash(g);
console.log(JSON.stringify({ ticks: g.tick, ms: samples, hash }));
assert.equal(hash, '3abd87c7ce77151b', 'spatial query optimization preserves the baseline full state');
assert.ok(Math.max(...samples) < 500, 'three-tick mixed army start has no multi-second all-form path scan');
for (const [weight, expected] of [[128, '971ea974cb974802'], [256, '8a4b3fc6315967c0']] as const) {
  const { g: copy } = releaseLoadFixture(weight, 0, true);
  for (let i = 0; i < 90; i++) copy.step();
  assert.equal(stateHash(copy), expected, 'moving forms, cell crossings and path retries preserve the old full state at ' + weight + 'W');
}
