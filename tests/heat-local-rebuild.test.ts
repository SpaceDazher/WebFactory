import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { heatNet, isHeatType, stepHeat } from '../src/sim/heat';
import { deserialize, serialize, stateHash } from '../src/sim/save';
import { HeatStorage } from '../src/sim/heat-cache';

const g = new Game(11603, true, { enemies: 'none' });
g.batchBuild = true;
for (let y = 80; y < 125; y++) for (let x = 80; x < 155; x++) {
  const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
  c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
  if (c.decor[i]) g.world.removeDecor(x, y);
}
const reactor = g.build('nuclear-reactor', 140, 100, 0, false)!;
assert.ok(reactor);
assert.ok(g.build('heat-exchanger', 141, 98, 0, false));
for (let y = 100; y < 110; y++) for (let x = 100; x < 110; x++)
  assert.ok(g.build('heat-pipe', x, y, 0, false));
g.batchBuild = false;
g.step();
for (const e of heatNet(g).ents) e.hE = (e.id % 7 + 1) * 12345678;

function compareForcedFull() {
  const clone = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  clone.heatDirty = true;
  assert.deepEqual(heatNet(g).edges.map(([a, b]) => [a.id, b.id]),
    heatNet(clone).edges.map(([a, b]) => [a.id, b.id]));
  assert.deepEqual([...heatNet(g).componentById], [...heatNet(clone).componentById]);
  for (let i = 0; i < 30; i++) {
    g.step(); clone.step();
    assert.equal(stateHash(g), stateHash(clone), `save/full rebuild parity at tick ${g.tick}`);
    // Loader rebuild diagnostics may record a network rebuild at the load
    // tick. Compare physical state hashes plus every saved thermal entity and
    // the full nuclear counters, rather than treating those diagnostics as
    // physical differences.
    assert.deepEqual(serialize(g).ents.filter((e: any) => isHeatType(e.t)),
      serialize(clone).ents.filter((e: any) => isHeatType(e.t)), 'complete saved thermal entity state parity');
    assert.deepEqual(g.nuc, clone.nuc, 'nuclear energy counters and contamination parity');
  }
}

function assertCachedSlotPageReferences(net: ReturnType<typeof heatNet>, label: string) {
  const pages = net.storage.keys.map(key => net.storage.blocks.get(key)!);
  assert.equal(net.edgeSlotPages.length, pages.length, `${label} edge page count follows storage key order`);
  assert.equal(net.pipeSlotPages.length, pages.length, `${label} pipe page count follows storage key order`);
  for (let i = 0; i < pages.length; i++) {
    assert.strictEqual(net.edgeSlotPages[i], pages[i].edgeSlots, `${label} edge page ${i} reuses its canonical row`);
    assert.strictEqual(net.pipeSlotPages[i], pages[i].pipeSlots, `${label} pipe page ${i} reuses its canonical row`);
  }
}

function stablePipeStepBlockLookups() {
  const pipes = new Game(11612, true, { enemies: 'none' });
  pipes.batchBuild = true;
  for (let x = 100; x < 120; x++) {
    const c = pipes.world.chunkAt(x, 100), i = pipes.world.idx(x, 100);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) pipes.world.removeDecor(x, 100);
    assert.ok(pipes.build('heat-pipe', x, 100, 0, false));
  }
  pipes.batchBuild = false;
  const graph = heatNet(pipes), blocks = graph.storage.blocks;
  assert.ok(graph.storage.keys.length > 0, 'pipe-only lookup probe has heat pages');
  stepHeat(pipes); // first physics access materializes the canonical rows
  const originalGet = blocks.get;
  let lookups = 0;
  blocks.get = function (key: number) { lookups++; return originalGet.call(this, key); };
  try { stepHeat(pipes); } finally { blocks.get = originalGet; }
  return lookups;
}

function heatNetConstructionDoesNotReadSlotRows() {
  const pipes = new Game(11613, true, { enemies: 'none' });
  pipes.batchBuild = true;
  for (let x = 100; x < 120; x++) {
    const c = pipes.world.chunkAt(x, 100), i = pipes.world.idx(x, 100);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) pipes.world.removeDecor(x, 100);
    assert.ok(pipes.build('heat-pipe', x, 100, 0, false));
  }
  pipes.batchBuild = false;

  const originalFinish = HeatStorage.prototype.finish;
  const descriptors: { page: object; edge: PropertyDescriptor; pipe: PropertyDescriptor }[] = [];
  let slotRowReads = 0;
  HeatStorage.prototype.finish = function () {
    const result = originalFinish.call(this);
    for (const key of this.keys) {
      const page = this.blocks.get(key)!;
      const edge = Object.getOwnPropertyDescriptor(page, 'edgeSlots')!;
      const pipe = Object.getOwnPropertyDescriptor(page, 'pipeSlots')!;
      let edgeValue = edge.value as Int32Array, pipeValue = pipe.value as Int32Array;
      descriptors.push({ page, edge, pipe });
      Object.defineProperty(page, 'edgeSlots', {
        configurable: true, enumerable: edge.enumerable,
        get() { slotRowReads++; return edgeValue; }, set(value: Int32Array) { edgeValue = value; },
      });
      Object.defineProperty(page, 'pipeSlots', {
        configurable: true, enumerable: pipe.enumerable,
        get() { slotRowReads++; return pipeValue; }, set(value: Int32Array) { pipeValue = value; },
      });
    }
    return result;
  };
  try {
    const net = heatNet(pipes);
    assert.ok(net.storage.keys.length > 0, 'lazy row-read probe has heat pages');
    assert.equal(slotRowReads, 0, 'heatNet construction leaves edge/pipe slot rows unread until physics needs them');
  } finally {
    HeatStorage.prototype.finish = originalFinish;
    for (const { page, edge, pipe } of descriptors) {
      Object.defineProperty(page, 'edgeSlots', edge);
      Object.defineProperty(page, 'pipeSlots', pipe);
    }
  }
  return slotRowReads;
}

const constructionSlotRowReads = heatNetConstructionDoesNotReadSlotRows();
assert.equal(constructionSlotRowReads, 0, 'heatNet construction does not eagerly collect ordered physics rows');
const pipeStepBlockLookups = stablePipeStepBlockLookups();
assert.equal(pipeStepBlockLookups, 0, 'stable pipe-only heat step reuses page rows without Map lookups');

for (let cycle = 0; cycle < 5; cycle++) {
  const before = heatNet(g);
  assertCachedSlotPageReferences(before, 'pre-split');
  const stableEdge = before.edges.find(([a]) => a === reactor)!;
  const oldNeighbors = before.neighborsById.get(g.entAt(103, 100)!.id)!.slice();
  const oldAdjacent = g.entAt(103, 100)!;
  g.batchBuild = true;
  for (let y = 100; y < 110; y++) g.removeEntity(g.entAt(104, y)!, false);
  g.batchBuild = false;
  assert.equal(g._heat, before, 'commands leave rebuild work inside lazy heat phase');
  const split = heatNet(g);
  assertCachedSlotPageReferences(before, 'retained pre-split snapshot');
  assertCachedSlotPageReferences(split, 'split');
  assert.notEqual(split, before, 'new graph wrapper after removal');
  assert.ok(split.edges.includes(stableEdge), 'unaffected canonical edge objects are reused');
  assert.equal(split.componentById, before.componentById, 'HX-free split reuses unaffected component membership');
  assert.equal(split.hexsByComponent, before.hexsByComponent, 'HX lists are reused only for unaffected components');
  assert.deepEqual(before.neighborsById.get(oldAdjacent.id), oldNeighbors, 'old adjacency snapshot remains intact');
  compareForcedFull();
  g.batchBuild = true;
  for (let y = 100; y < 110; y++) assert.ok(g.build('heat-pipe', 104, y, 0, false));
  g.batchBuild = false;
  const merged = heatNet(g);
  assertCachedSlotPageReferences(split, 'retained split snapshot');
  assertCachedSlotPageReferences(merged, 'merged');
  assert.equal(merged.componentById, split.componentById, 'HX-free merge reuses membership');
  compareForcedFull();
}

const beforeHX = heatNet(g);
assertCachedSlotPageReferences(beforeHX, 'pre-HX-removal');
g.removeEntity(g.entAt(141, 98)!, false);
const afterHX = heatNet(g);
assertCachedSlotPageReferences(beforeHX, 'retained pre-HX-removal snapshot');
assertCachedSlotPageReferences(afterHX, 'post-HX-removal');
assert.notEqual(afterHX.componentById, beforeHX.componentById, 'HX removal recomputes affected membership');
assert.equal(afterHX.componentById.has(reactor.id), false);
compareForcedFull();
{
  const delta = new Game(11611, true, { enemies: 'none' });
  delta.batchBuild = true;
  for (let x = 100; x < 200; x++) {
    const c = delta.world.chunkAt(x, 100), i = delta.world.idx(x, 100);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) delta.world.removeDecor(x, 100);
  }
  const oldPipes = [] as NonNullable<ReturnType<Game['build']>>[];
  for (let x = 100; x < 200; x++) oldPipes.push(delta.build('heat-pipe', x, 100, 0, false)!);
  delta.batchBuild = false;
  const initial = heatNet(delta);
  assert.equal(initial.edges.length, 99, 'baseline pipe row has 99 canonical heat edges');
  const oldEdgeFlat = initial.edgeFlat, oldPipeFlat = initial.pipeFlat;
  const oldEdgeValues = Array.from(oldEdgeFlat), oldPipeValues = Array.from(oldPipeFlat);

  delta.batchBuild = true;
  for (const pipe of oldPipes) delta.removeEntity(pipe, false);
  const newPipes = [] as NonNullable<ReturnType<Game['build']>>[];
  for (let x = 100; x < 200; x++) newPipes.push(delta.build('heat-pipe', x, 100, 0, false)!);
  delta.batchBuild = false;

  const originalSet = Int32Array.prototype.set;
  let trackingSet = false, copiedSlotInts = 0;
  Int32Array.prototype.set = function (source: ArrayLike<number>, offset?: number) {
    if (trackingSet) copiedSlotInts += source.length;
    return originalSet.call(this, source, offset);
  };
  let rebuilt: ReturnType<typeof heatNet>;
  try {
    trackingSet = true;
    rebuilt = heatNet(delta);
  } finally {
    trackingSet = false;
    Int32Array.prototype.set = originalSet;
  }

  const expectedEdges = newPipes.slice(0, -1).map((pipe, i) => [pipe.id, newPipes[i + 1].id]);
  assert.deepEqual(rebuilt.edges.map(([a, b]) => [a.id, b.id]), expectedEdges,
    'page traversal retains exact heat edge order after a replacement');
  const expectedEdgeSlots = newPipes.slice(0, -1).flatMap((pipe, i) => [
    rebuilt.storage.get(pipe.id)!.slot, rebuilt.storage.get(newPipes[i + 1].id)!.slot,
  ]);
  assert.deepEqual(Array.from(rebuilt.edgeFlat.slice(0, rebuilt.edgeFlatLen)), expectedEdgeSlots, 'flattened compatibility edges preserve canonical slot order');
  assert.deepEqual(Array.from(rebuilt.pipeFlat.slice(0, rebuilt.pipeFlatLen)), newPipes.map(pipe => rebuilt.storage.get(pipe.id)!.slot),
    'flattened compatibility pipes preserve canonical node order');
  assert.strictEqual(rebuilt.edgeFlat, rebuilt.edgeFlat, 'repeated edge-flat reads return the same compatibility array');
  assert.strictEqual(rebuilt.pipeFlat, rebuilt.pipeFlat, 'repeated pipe-flat reads return the same compatibility array');
  assert.equal(rebuilt.edgeFlat.length, oldEdgeFlat.length, 'incremental edge-flat capacity remains compatible');
  assert.equal(rebuilt.pipeFlat.length, oldPipeFlat.length, 'incremental pipe-flat capacity remains compatible');
  assert.strictEqual(initial.edgeFlat, oldEdgeFlat, 'old edge-flat snapshot retains its original array');
  assert.strictEqual(initial.pipeFlat, oldPipeFlat, 'old pipe-flat snapshot retains its original array');
  assert.deepEqual(Array.from(oldEdgeFlat), oldEdgeValues, 'old edge-flat snapshot contents remain immutable');
  assert.deepEqual(Array.from(oldPipeFlat), oldPipeValues, 'old pipe-flat snapshot contents remain immutable');
  assert.equal(copiedSlotInts, 0,
    `dirty heat rebuild avoids copying full edge/pipe flat arrays, copied ${copiedSlotInts} slot integers`);
}

console.log(`✔ local heat split/merge: canonical edges, lazy flat compatibility, immutable adjacency and thermal state/save replay; pipe-only stable-step blocks.get calls=${pipeStepBlockLookups}`);
