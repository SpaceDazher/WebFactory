import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';

function fixture(energy: number, remainder: number) {
  const g = new Game(11605, true, { enemies: 'none' });
  g.batchBuild = true;
  for (let y = 90; y < 115; y++) for (let x = 90; x < 115; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) g.world.removeDecor(x, y);
  }
  for (let y = 100; y < 110; y++) for (let x = 100; x < 110; x++) {
    const e = g.build('heat-pipe', x, y, 0, false);
    assert.ok(e); e.hE = energy; e.hL = remainder;
  }
  g.batchBuild = false;
  return g;
}

for (const initial of [0, .5, Number.MAX_SAFE_INTEGER, 2 ** 54, 1e20, NaN]) {
  for (const [energy, remainder] of [[10_000_000, 0], [.25, 3_000_000]]) {
    const g = fixture(energy, remainder);
    let actual = initial, writes = 0;
    Object.defineProperty(g.nuc.st, 'lost', {
      enumerable: true, configurable: true, get: () => actual,
      set: value => { writes++; actual = value; },
    });
    const loss = Math.min(energy, Math.floor((remainder + energy) / 3e6));
    let expected = initial;
    // Deliberately reproduce each original Number addition, not sum(losses).
    // At 2**54, adding 3 a hundred times differs from adding 300 once.
    for (let i = 0; i < 100; i++) expected = (expected || 0) + loss;
    g.step();
    assert.equal(actual, expected, `sequential counter rounding for ${initial}, loss ${loss}`);
    assert.equal(writes, 1, 'pipe phase commits the counter once, not once per pipe');
    for (const e of g.ents.values()) {
      assert.equal(e.hE, energy - loss);
      assert.equal(e.hL, remainder + energy - Math.floor((remainder + energy) / 3e6) * 3e6);
    }
  }
}
const cold = fixture(0, 0);
cold.step();
assert.equal(Object.hasOwn(cold.nuc.st, 'lost'), false, 'no-loss tick does not create a counter');
console.log('✔ heat loss register: original addition order, precision boundary, fractional/clipped loss, NaN normalization and no-loss state');