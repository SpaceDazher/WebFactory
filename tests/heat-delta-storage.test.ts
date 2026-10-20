import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { heatNet } from '../src/sim/heat';
import { deserialize, serialize, stateHash } from '../src/sim/save';

const g = new Game(11604, true, { enemies: 'none' });
g.batchBuild = true;
for (let y = 80; y < 130; y++) for (let x = 80; x < 160; x++) {
  const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
  c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
  if (c.decor[i]) g.world.removeDecor(x, y);
}
for (let y = 100; y < 120; y++) for (let x = 100; x < 120; x++)
  assert.ok(g.build('heat-pipe', x, y, 0, false));
const reactor = g.build('nuclear-reactor', 145, 100, 0, false)!;
assert.ok(reactor && g.build('heat-exchanger', 146, 98, 0, false));
g.batchBuild = false;
g.step();
for (const e of heatNet(g).ents) e.hE = (e.id % 11 + 1) * 23456789;

const before = heatNet(g), oldEnts = before.ents, oldEdges = before.edges;
const oldAdj = before.neighborsById;
const forbidden = () => { throw new Error('full cached canonical array/adjacency traversal during delta rebuild'); };
before.ents = new Proxy(oldEnts, { get: forbidden });
before.edges = new Proxy(oldEdges, { get: forbidden });
before.neighborsById = new Proxy(oldAdj, {
  get(target, key) {
    if (key === Symbol.iterator || key === 'entries' || key === 'values' || key === 'forEach') return forbidden;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const removed = g.entAt(110, 110)!;
g.removeEntity(removed, false);
try {
  assert.doesNotThrow(() => heatNet(g), 'delta rebuild does not consume full cached arrays or neighbor entries');
} finally {
  before.ents = oldEnts; before.edges = oldEdges; before.neighborsById = oldAdj;
}
const after = heatNet(g);
const stats = (after as any).storage.updateStats;
assert.equal(stats.full, false);
assert.ok(stats.nodesCopied <= 5 && stats.edgeRowsUpdated <= 4, JSON.stringify(stats));
assert.equal(stats.edgesReindexed, 0, 'stable slot edges are not globally reindexed');
const unaffectedPair = oldEdges.find(([a, b]) => a.x === 100 && b.x === 101)!;
assert.ok(after.edges.includes(unaffectedPair), 'unchanged canonical pair identity remains stable');
assert.deepEqual(before.neighborsById.get(g.entAt(109, 110)!.id),
  [g.entAt(109, 109)!.id, removed.id, g.entAt(108, 110)!.id, g.entAt(109, 111)!.id].sort((a, b) => a - b),
  'old neighbor snapshot remains intact');

for (let cycle = 0; cycle < 40; cycle++) {
  assert.ok(g.build('heat-pipe', 110, 110, 0, false));
  const incremental = heatNet(g);
  const clone = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  clone.heatDirty = true;
  assert.deepEqual(incremental.edges.map(([a, b]) => [a.id, b.id]),
    heatNet(clone).edges.map(([a, b]) => [a.id, b.id]));
  for (let i = 0; i < 5; i++) {
    g.step(); clone.step();
    assert.equal(stateHash(g), stateHash(clone), 'slot reuse preserves save/replay');
    assert.deepEqual(g.nuc, clone.nuc, 'integer energy counters remain identical');
  }
  g.removeEntity(g.entAt(110, 110)!, false);
  heatNet(g);
}
const storage = (heatNet(g) as any).storage;
assert.ok(storage.nextSlot <= oldEnts.length + 1, 'repeated remove/build reuses slots instead of unbounded growth');
// Cache classification must remember the previous type, not reread a mutable
// Entity reference after a tracked external edit. No physics runs while this
// synthetic classification fixture is temporarily retyped.
const retyped = g.entAt(100, 100)!, oldType = retyped.t;
retyped.t = 'reactor'; g.markHeatDirty(retyped.id);
assert.ok(heatNet(g).reactors.includes(retyped));
retyped.t = oldType; g.markHeatDirty(retyped.id);
assert.ok(!heatNet(g).reactors.includes(retyped), 'tracked type change updates classifications both ways');
console.log('✔ delta heat storage: no full cached scans, local edge rows, stable slots, immutable adjacency and repeated save/replay');