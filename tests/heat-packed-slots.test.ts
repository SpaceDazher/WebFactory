import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { heatNet } from '../src/sim/heat';
import { stateHash, serialize, deserialize } from '../src/sim/save';

const g = new Game(1160502, true, { enemies: 'none' });
g.batchBuild = true;
for (let y = 90; y < 120; y++) for (let x = 90; x < 120; x++) {
  const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
  c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
  if (c.decor[i]) g.world.removeDecor(x, y);
}
for (let y = 100; y < 110; y++) for (let x = 100; x < 110; x++)
  assert.ok(g.build('heat-pipe', x, y, 0, false));
g.batchBuild = false;
for (const e of g.ents.values()) e.hE = (e.id % 7 + 1) * 30_000_000;
const net = heatNet(g), page = net.storage.blocks.get(net.storage.keys[0])! as any;
assert.ok(page.edgeSlots instanceof Int32Array, 'a page uses one interleaved typed slot vector');
const frozenVector = [...page.edgeSlots];
for (const p of net.storage.blocks.values()) for (const node of p) if (node) {
  const slot = node.slot;
  Object.defineProperty(node, 'slot', { configurable: true, get() {
    throw new Error(`temperature initialization traversed node metadata for slot ${slot}`);
  } });
}
assert.doesNotThrow(() => g.step(), 'dense temperature initialization consumes stable entity slots directly');
// Remove the guards before a topology edit (which legitimately reads slots).
for (const p of net.storage.blocks.values()) for (const node of p) if (node) {
  const slot = net.storage.slots.flat().indexOf(node.entity);
  Object.defineProperty(node, 'slot', { configurable: true, writable: true, value: slot });
}
g.removeEntity(g.entAt(101, 100)!, false);
g.step();
assert.deepEqual([...page.edgeSlots], frozenVector, 'old packed index snapshot remains immutable');
const current = heatNet(g);
for (const p of current.storage.blocks.values()) {
  const expected: number[] = [];
  for (const node of p) if (node) for (const edge of node.edges) expected.push(edge.a, edge.b);
  assert.deepEqual([...p.edgeSlots], expected, 'packed vector preserves every canonical edge and endpoint order');
}
const clone = deserialize(JSON.parse(JSON.stringify(serialize(g))));
for (let i = 0; i < 50; i++) {
  g.step(); clone.step();
  assert.equal(stateHash(g), stateHash(clone), 'packed slot transfer preserves save/replay');
  assert.deepEqual(g.nuc, clone.nuc);
}
console.log('✔ packed heat slots: direct dense initialization, canonical interleaved rows, immutable indices and replay');