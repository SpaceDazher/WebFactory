import assert from 'node:assert/strict';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { ckey } from '../src/core/types';
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { rebuildPower } from '../src/sim/networks';

function clear(g: Game, x: number, y: number, w: number, h: number) {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    const c = g.world.chunkAt(tx, ty), i = g.world.idx(tx, ty);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0;
  }
}

const ordinaryWorld = new Game(74, true, { enemies: 'none' }).world;
ordinaryWorld.chunkAt(-33, -33);
const weakMapPrototype = WeakMap.prototype as any;
const originalWeakMapGet = weakMapPrototype.get;
let weakMapReads = 0;
try {
  weakMapPrototype.get = function (...args: any[]) {
    weakMapReads++;
    return originalWeakMapGet.apply(this, args);
  };
  ordinaryWorld.occ(-33, -33);
  ordinaryWorld.setOcc(-33, -33, 17);
} finally {
  weakMapPrototype.get = originalWeakMapGet;
}
assert.equal(weakMapReads, 0, 'ordinary World.occ/setOcc do not retrieve scoped occupancy state from a WeakMap');

const scopedWorld = new Game(75, true, { enemies: 'none' }).world;
scopedWorld.chunkAt(-1, -1);
const originalChunkAt = scopedWorld.chunkAt;
const originalChunkAtDescriptor = Object.getOwnPropertyDescriptor(scopedWorld, 'chunkAt');
const scopeSentinel = new Error('scope sentinel');
assert.throws(() => scopedWorld.withOccChunkCache(() => {
  assert.equal(scopedWorld.chunkAt, originalChunkAt, 'scoped caching preserves the public chunkAt method identity');
  assert.deepEqual(Object.getOwnPropertyDescriptor(scopedWorld, 'chunkAt'), originalChunkAtDescriptor,
    'scoped caching leaves the public chunkAt own-property descriptor unchanged');
  scopedWorld.occ(-1, -1);
  scopedWorld.withOccChunkCache(() => {
    assert.equal(scopedWorld.chunkAt, originalChunkAt, 'nested caching preserves the public chunkAt method identity');
    scopedWorld.setOcc(-1, -1, 23);
    assert.equal(scopedWorld.occ(-1, -1), 23, 'cached chunks still expose live occupancy mutations');
  });
  assert.equal(scopedWorld.chunkAt, originalChunkAt, 'nested return preserves the public chunkAt method identity');
  throw scopeSentinel;
}), (error: unknown) => error === scopeSentinel);
assert.equal(scopedWorld.chunkAt, originalChunkAt, 'finally restores the exact original method after a throw');
assert.deepEqual(Object.getOwnPropertyDescriptor(scopedWorld, 'chunkAt'), originalChunkAtDescriptor,
  'finally leaves the public chunkAt own-property descriptor unchanged');
const oldOccupancyChunk = scopedWorld.chunkAt(-1, -1);
const replacementOccupancyChunk = { ...oldOccupancyChunk, occ: new Int32Array(oldOccupancyChunk.occ) };
replacementOccupancyChunk.occ[scopedWorld.idx(-1, -1)] = 47;
scopedWorld.chunks.set(ckey(oldOccupancyChunk.cx, oldOccupancyChunk.cy), replacementOccupancyChunk);
assert.equal(scopedWorld.occ(-1, -1), 47, 'a replacement chunk is read after a scoped call throws');

const dynamicOverrideWorld = new Game(77, true, { enemies: 'none' }).world;
const dynamicOriginalChunk = dynamicOverrideWorld.chunkAt(-1, -1);
const dynamicOriginalChunkAt = dynamicOverrideWorld.chunkAt;
const dynamicReplacementChunk = { ...dynamicOriginalChunk, occ: new Int32Array(dynamicOriginalChunk.occ) };
dynamicReplacementChunk.occ[dynamicOverrideWorld.idx(-1, -1)] = 59;
const dynamicOwner = dynamicOverrideWorld as any;
dynamicOverrideWorld.withOccChunkCache(() => {
  dynamicOverrideWorld.occ(-1, -1); // populate the scoped chunk cache first
  dynamicOwner.chunkAt = () => dynamicReplacementChunk;
  assert.equal(dynamicOverrideWorld.occ(-1, -1), 59, 'a chunkAt override installed during the scope remains observable');
  dynamicOwner.chunkAt = dynamicOriginalChunkAt;
});

for (const method of ['getChunk', 'chunkAt', 'occ', 'setOcc'] as const) {
  const guardedWorld = new Game(76, true, { enemies: 'none' }).world;
  const owner = guardedWorld as any;
  const original = owner[method];
  let calls = 0;
  owner[method] = function (...args: any[]) {
    calls++;
    return original.apply(this, args);
  };
  try {
    guardedWorld.withOccChunkCache(() => {
      if (method === 'setOcc') guardedWorld.setOcc(-1, -1, 31);
      else guardedWorld.occ(-1, -1);
    });
    assert.ok(calls > 0, `withOccChunkCache preserves the instance override for ${method}`);
  } finally {
    owner[method] = original;
  }
}

const poleProto = PROTOS['small-electric-pole'];
const radarProto = PROTOS.radar;
const oldSupply = poleProto.supply!, oldWire = poleProto.wire!;
const oldRadarSize: [number, number] = [radarProto.w, radarProto.h];
try {
  poleProto.supply = 48;
  poleProto.wire = 4;
  radarProto.w = 5;
  radarProto.h = 4;
  const g = new Game(73, true, { enemies: 'none' });
  for (const recipe of Object.values(RECIPES)) g.enabled.add(recipe.id);
  g.freePower = true;
  clear(g, -64, -64, 160, 160);

  const first = g.build('small-electric-pole', -2, -2, 0, false);
  const second = g.build('small-electric-pole', 28, -2, 0, false);
  const spanningConsumer = g.build('radar', 13, -3, 0, false);
  const remoteConsumer = g.build('radar', 65, -3, 0, false);
  assert.ok(first && second && spanningConsumer && remoteConsumer, 'negative-coordinate mod fixture builds');
  rebuildPower(g);
  assert.equal(first._net, first.id, 'first covering pole owns a large consumer footprint intersection');
  assert.equal(spanningConsumer._net, first._net, 'overlapping coverage keeps first-pole assignment order');
  assert.equal(remoteConsumer._net, second._net, 'large modded coverage reaches a remote consumer');
  assert.deepEqual(g.wires, [], 'coverage does not join poles outside their wire radius');

  poleProto.wire = 30;
  rebuildPower(g);
  const wiresAfterTie = g.wires as [number, number][];
  assert.ok(wiresAfterTie.some(([a, b]) => a === first.id && b === second.id), 'an exact wire-radius tie remains connected');

  const overriddenLookupConsumer = g.build('radar', -40, -40, 0, false);
  assert.ok(overriddenLookupConsumer, 'override fixture consumer builds');
  for (let y = overriddenLookupConsumer.y; y < overriddenLookupConsumer.y + overriddenLookupConsumer.h; y++)
    for (let x = overriddenLookupConsumer.x; x < overriddenLookupConsumer.x + overriddenLookupConsumer.w; x++) g.world.setOcc(x, y, -1);
  overriddenLookupConsumer._net = -1;
  const originalLookup = g.entAt;
  let overriddenLookups = 0;
  g.entAt = function (x, y) {
    overriddenLookups++;
    return x === overriddenLookupConsumer.x && y === overriddenLookupConsumer.y
      ? overriddenLookupConsumer : originalLookup.call(this, x, y);
  };
  rebuildPower(g);
  g.entAt = originalLookup;
  assert.ok(overriddenLookups > 0 && overriddenLookupConsumer._net === first._net,
    'custom Game.entAt overrides still control coverage lookup results');
  g.removeEntity(overriddenLookupConsumer, false);

  const hookX = 10001, hookY = -1001;
  clear(g, hookX - 2, hookY - 2, 5, 5);
  const hookChunkX = Math.floor((hookX - poleProto.supply!) / 32);
  const hookChunkY = Math.floor((hookY - poleProto.supply!) / 32);
  const hookTileX = hookX - poleProto.supply! + 1, hookTileY = hookY - poleProto.supply! + 1;
  const hookEvents: string[] = [];
  let hookConsumer: Entity | null = null;
  g.world.onChunkGen = c => hookEvents.push(`chunk:${c.cx},${c.cy}`);
  g.world.onAnyGen = c => hookEvents.push(`any:${c.cx},${c.cy}`);
  g.world.onGenScript = c => {
    hookEvents.push(`script:${c.cx},${c.cy}`);
    if (c.cx !== hookChunkX || c.cy !== hookChunkY || hookConsumer) return;

    // The first tile reads the original generated chunk. The script hook then
    // replaces it and installs a consumer at a later tile in the same scan.
    const key = ckey(c.cx, c.cy);
    const replacement = { ...c, occ: new Int32Array(c.occ) };
    replacement.occ.fill(-1);
    g.world.chunks.set(key, replacement);
    clear(g, hookTileX, hookTileY, 5, 4);
    hookConsumer = { id: 1_900_000_000, proto: 'radar', t: 'radar', x: hookTileX, y: hookTileY,
      w: radarProto.w, h: radarProto.h, dir: 0, hp: radarProto.hp, _net: -1 };
    g.ents.set(hookConsumer.id, hookConsumer);
    for (let y = hookTileY; y < hookTileY + hookConsumer.h; y++)
      for (let x = hookTileX; x < hookTileX + hookConsumer.w; x++) g.world.setOcc(x, y, hookConsumer.id);
  };
  g.batchBuild = true;
  const hookPole = g.build('small-electric-pole', hookX, hookY, 0, false);
  g.batchBuild = false;
  assert.ok(hookPole, 'far coverage pole builds');
  rebuildPower(g);
  const observedHookConsumer = hookConsumer as Entity | null;
  assert.ok(observedHookConsumer && observedHookConsumer._net === hookPole._net,
    'live occupancy written by generation hooks is observed after a chunk replacement');
  assert.ok(hookEvents.length >= 3 && hookEvents.length % 3 === 0,
    'empty ungenerated coverage still runs all three hooks for each new chunk');
  for (let i = 0; i < hookEvents.length; i += 3) {
    const coords = hookEvents[i].slice('chunk:'.length);
    assert.deepEqual(hookEvents.slice(i, i + 3), [`chunk:${coords}`, `any:${coords}`, `script:${coords}`],
      `chunk hook order is preserved for ${coords}`);
  }

  g.world.onChunkGen = null;
  g.world.onAnyGen = null;
  g.world.onGenScript = null;
  g.removeEntity(observedHookConsumer!, false);
  const replacementConsumer = g.build('radar', hookTileX, hookTileY, 0, false);
  assert.ok(replacementConsumer, 'consumer can be rebuilt after live occupancy is cleared');
  rebuildPower(g);
  assert.equal(replacementConsumer._net, hookPole._net, 'the next rebuild sees occupancy mutations after its chunk cache closes');

  const occupantChunk = g.world.chunkAt(hookTileX, hookTileY);
  const chunkKey = ckey(occupantChunk.cx, occupantChunk.cy);
  const swappedChunk = { ...occupantChunk, occ: new Int32Array(occupantChunk.occ) };
  swappedChunk.occ.fill(-1);
  g.world.chunks.set(chunkKey, swappedChunk);
  for (let y = replacementConsumer.y; y < replacementConsumer.y + replacementConsumer.h; y++)
    for (let x = replacementConsumer.x; x < replacementConsumer.x + replacementConsumer.w; x++)
      swappedChunk.occ[g.world.idx(x, y)] = replacementConsumer.id;
  replacementConsumer._net = -1;
  rebuildPower(g);
  assert.equal(replacementConsumer._net, hookPole._net, 'rebuild reads the replacement chunk object, not a stale cached one');
  console.log('✔ power coverage, ordering, hooks, and live occupancy regressions');
} finally {
  poleProto.supply = oldSupply;
  poleProto.wire = oldWire;
  radarProto.w = oldRadarSize[0];
  radarProto.h = oldRadarSize[1];
}
