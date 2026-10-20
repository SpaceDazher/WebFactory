import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/sim/save';
import { makeSnapper, VP } from '../src/sim/snapshot';
import { DYN_STRIDE } from '../src/sim/protocol';
import { WorkerSim } from '../src/client/mirror';
import { ckey } from '../src/core/types';

const fixture = JSON.parse(readFileSync('integration-logs/mp-bugfix-20261014/fixtures/zavod7-bug-20261013-2140.json', 'utf8'));
const vp: VP = { x0: -100_000, y0: -100_000, x1: 100_000, y1: 100_000 };
const ctx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 };

function steppedSave() {
  const g = deserialize(fixture);
  for (let i = 0; i < 60; i++) g.step();
  return g;
}

{
  // This is the state loaded by the Worker and by the main-thread fallback.
  // Runtime caches must not leak into the snapshot after simulation starts.
  const g = steppedSave();
  g.trash.slots[0] = { item: 'iron-plate', count: 3 };
  assert(g.ents.size > 5_000, 'report save has its full entity set');
  assert([...g.ents.values()].some(e => e._tg || e._fd || e._io), 'stepping populated belt/inserter caches');

  const snapper = makeSnapper();
  const first = snapper.take(g, ctx, vp, [], true);
  assert.equal(first.trash?.slots[0]?.count, 3, 'full snapshot carries the active player trash inventory');
  assert.equal(first.full.length, g.ents.size, 'initial full snapshot contains every saved entity');
  for (const view of first.full) {
    const entity = g.ents.get(view.id)!;
    assert.ok(view !== entity, 'snapshot uses an entity DTO');
    assert.equal((view as any)._tg, undefined, 'snapshot omits belt target cache');
    assert.equal((view as any)._fd, undefined, 'snapshot omits feeder entity cache');
    assert.equal((view as any)._io, undefined, 'snapshot omits inserter entity cache');
  }
  assert.doesNotThrow(() => structuredClone(first), 'DTO snapshot is structured-cloneable');

  // A failed postMessage must invalidate the sent-entity cache so the retry
  // cannot silently turn the dropped full entities into dyn-only updates.
  snapper.failed(first);
  const retry = snapper.take(g, ctx, vp, [], true);
  assert.equal(retry.full.length, g.ents.size, 'retry after failed delivery resends all full entities');
  snapper.delivered(retry);
  const steady = snapper.take(g, ctx, vp, [], true);
  assert.ok(steady.full.length < g.ents.size, 'successful retry returns to delta snapshots');
}

{
  const g = steppedSave();
  const snapper = makeSnapper();
  const first = snapper.take(g, ctx, vp, [], true);
  assert.equal(first.full.length, g.ents.size, 'initial delivery includes the full mirror');
  snapper.delivered(first);

  const victim = [...g.ents.values()].find(e => e.t === 'belt');
  assert.ok(victim, 'report save contains a removable entity');
  g.removeEntity(victim!, false);
  const failedRemoval = snapper.take(g, ctx, vp, [], true);
  assert.ok(failedRemoval.removed.includes(victim!.id), 'failed frame carries the removal');

  // Worker.postMessage can fail after the builder has mutated its sent cache.
  // A retry must resend the removal as well as restoring the full entity set.
  snapper.failed(failedRemoval);
  const retry = snapper.take(g, ctx, vp, [], true);
  assert.ok(retry.removed.includes(victim!.id), 'retry preserves removals from a failed frame');
  assert.equal(retry.full.length, g.ents.size, 'removal retry restores a complete snapshot');
  snapper.failed(retry);
  const secondRetry = snapper.take(g, ctx, vp, [], true);
  assert.ok(secondRetry.removed.includes(victim!.id), 'removal survives two consecutive send failures');
  assert.equal(secondRetry.full.length, g.ents.size, 'second retry remains a complete snapshot');
  snapper.delivered(secondRetry);
  const steady = snapper.take(g, ctx, vp, [], true);
  assert.ok(!steady.removed.includes(victim!.id), 'successfully delivered removal is cleared');
}

{
  const g = steppedSave();
  const snapper = makeSnapper();
  const receivedStab = [''];
  const receivedStatus = new Map<number, string | undefined>();
  const receive = (snap: ReturnType<typeof snapper.take>) => {
    for (const entity of snap.full) receivedStatus.set(entity.id, entity.status);
    for (const id of snap.removed) receivedStatus.delete(id);
    if (snap.stabAdd) receivedStab.push(...snap.stabAdd);
    if (snap.dyn) for (let o = 0; o < snap.dyn.length; o += DYN_STRIDE) {
      const id = snap.dyn[o];
      if (receivedStatus.has(id)) receivedStatus.set(id, receivedStab[snap.dyn[o + 1]] || undefined);
    }
  };
  const entity = [...g.ents.values()].find(e => e.x + e.w >= vp.x0 && e.x <= vp.x1 && e.y + e.h >= vp.y0 && e.y <= vp.y1)!;
  assert.ok(entity, 'report save has an entity to exercise dynamic statuses');
  const initial = snapper.take(g, ctx, vp, [], true);
  receive(initial); snapper.delivered(initial);

  entity.status = 'delivered-status';
  const deliveredStatus = snapper.take(g, ctx, vp, [], true);
  receive(deliveredStatus); snapper.delivered(deliveredStatus);
  assert.equal(receivedStatus.get(entity.id), 'delivered-status', 'receiver decodes a successfully delivered status');

  entity.status = 'failed-status';
  const failed = snapper.take(g, ctx, vp, [], true);
  assert.ok(failed.stabAdd?.includes('failed-status'), 'undelivered status is added to the failed frame');
  assert.ok(failed.dyn?.some((value, index) => index % DYN_STRIDE === 0 && value === entity.id), 'failed frame carries the entity through the dynamic status table');
  snapper.failed(failed);
  const failedRetry = snapper.take(g, ctx, vp, [], true);
  assert.ok(failedRetry.full.some(view => view.id === entity.id && view.status === 'failed-status'), 'first retry resends the entity with its latest status');
  snapper.failed(failedRetry);
  const successfulRetry = snapper.take(g, ctx, vp, [], true);
  assert.ok(successfulRetry.full.some(view => view.id === entity.id && view.status === 'failed-status'), 'latest entity status survives two consecutive send failures');
  receive(successfulRetry); snapper.delivered(successfulRetry);
  assert.equal(receivedStatus.get(entity.id), 'failed-status', 'receiver decodes retried status at the correct dictionary index');

  entity.status = 'next-status';
  const next = snapper.take(g, ctx, vp, [], true);
  assert.ok(next.stabAdd?.includes('next-status'), 'next dynamic status extends the committed dictionary');
  receive(next); snapper.delivered(next);
  assert.equal(receivedStatus.get(entity.id), 'next-status', 'receiver dictionary stays aligned for the next dynamic status after retries');
}

{
  // Use the production mirror message handler, with transport replaced only.
  const OriginalWorker = globalThis.Worker;
  class Transport {
    onmessage: ((ev: { data: any }) => void) | null = null;
    onerror = null;
    constructor(src: string) { URL.revokeObjectURL(src); }
    postMessage() {}
  }
  globalThis.Worker = Transport as any;
  try {
    const mirror = new WorkerSim('');
    const deliver = (data: any) => (mirror.w as any).onmessage({ data });
    const g = steppedSave(), snapper = makeSnapper(); g.trash.slots[0] = { item: 'iron-plate', count: 2 };
    const entity = [...g.ents.values()][0];
    const receive = () => {
      const s = snapper.take(g, ctx, vp, [], true);
      deliver({ t: 'snap', s: structuredClone(s) }); snapper.delivered(s);
    };
    receive(); assert.equal(mirror.g.trash.slots[0]?.count, 2, 'worker mirror restores the current player trash inventory'); entity.status = 'previous-world-status'; receive();
    const sourceChunk = [...g.world.chunks.values()][0];
    assert.ok(sourceChunk, 'fixture world has a generated chunk for revision replication');
    const chunkKey = ckey(sourceChunk.cx, sourceChunk.cy);
    const chunkVersion = sourceChunk.version;
    sourceChunk.occ[0] = entity.id; sourceChunk.ov = (sourceChunk.ov || 0) + 1;
    receive();
    const mirroredChunk = mirror.g.world.chunks.get(chunkKey);
    assert.equal(sourceChunk.version, chunkVersion, 'occupancy fixture leaves the terrain version unchanged');
    assert.equal(mirroredChunk?.ov, sourceChunk.ov, 'worker chunk snapshots preserve the occupancy revision for LOD invalidation');

    sourceChunk.creep = new Uint8Array(sourceChunk.terrain.length); sourceChunk.creep[0] = 255;
    sourceChunk.cv = (sourceChunk.cv || 0) + 1; sourceChunk.cn = g.tick; g.creepSet.add(chunkKey);
    receive();
    assert.equal(mirroredChunk?.creep?.[0], 255, 'worker mirror receives creep strength');
    assert.equal(mirroredChunk?.cn, g.tick, 'worker mirror preserves the creep timestamp for rendering and simulation state');
    assert.ok(mirror.g.creepSet.has(chunkKey), 'worker mirror tracks chunks with live creep');

    sourceChunk.creep = undefined; sourceChunk.cv = (sourceChunk.cv || 0) + 1; sourceChunk.cn = undefined; g.creepSet.delete(chunkKey);
    receive();
    assert.equal(mirroredChunk?.creep, undefined, 'creep clear snapshots remove the previous array');
    assert.equal(mirroredChunk?.cn, undefined, 'creep clear snapshots remove the render marker');
    assert.ok(!mirror.g.creepSet.has(chunkKey), 'creep clear snapshots remove the chunk from the mirror set');
    assert.ok(mirror.stab.includes('previous-world-status'));
    snapper.reset();
    deliver({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil });
    receive(); entity.status = 'new-world-status'; receive();
    assert.equal(mirror.g.ents.get(entity.id)?.status, 'new-world-status', 'mirror resets its status dictionary with a new snapshot stream');
    assert.equal(mirror.g.world.chunks.get(chunkKey)?.creep, undefined, 'new snapshot streams do not resurrect creep cleared before reset');
    assert.ok(!mirror.g.creepSet.has(chunkKey), 'new snapshot streams keep cleared chunks out of the creep set');
  } finally { globalThis.Worker = OriginalWorker; }
}

console.log('MP snapshot regression: DTO graph, delivery retry, removals, and status dictionary lifecycle pass for the report save');
