import assert from 'node:assert/strict';
import { CHUNK, ckey } from '../src/core/types';
import { PROTOS } from '../src/data/entities';
import { Game } from '../src/sim/game';
import { rebuildFluids } from '../src/sim/networks';
import { World } from '../src/sim/world';

function buildPipeGrid(size: number, origin = 8) {
  const g = new Game(0x11611, true, { enemies: 'none' });
  g.batchBuild = true;
  const pipes = [] as NonNullable<ReturnType<Game['build']>>[];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const pipe = g.build('pipe', origin + x, origin + y, 0, false);
    assert.ok(pipe, `pipe grid places ${x},${y}`);
    pipes.push(pipe);
  }
  g.batchBuild = false;
  return { g, pipes };
}

{
  const { g, pipes } = buildPipeGrid(16);
  rebuildFluids(g);
  assert.equal(g.fluidNets.length, 1, 'dense pipe grid forms one fluid network');
  assert.equal(g.fluidNets[0].nodes.length, pipes.length, 'network includes every built pipe box');
  const originalNodeOrder = g.fluidNets[0].nodes.map(([id, box]) => [id, box]);
  g.fluidNets[0].fluid = 'water';
  g.fluidNets[0].amount = 1234.567;
  g.fluidNets[0].se = 42.123456;

  const originalPush = Array.prototype.push;
  let transientEntityBoxTuplePushes = 0;
  let trackingRebuild = false;
  Array.prototype.push = function (...items: any[]) {
    if (trackingRebuild) for (const item of items) {
      if (Array.isArray(item) && item.length === 2 && item[0] && typeof item[0] === 'object'
        && typeof item[0].id === 'number' && typeof item[1] === 'number') transientEntityBoxTuplePushes++;
    }
    return Reflect.apply(originalPush, this, items) as number;
  };
  try {
    trackingRebuild = true;
    rebuildFluids(g);
  } finally {
    trackingRebuild = false;
    Array.prototype.push = originalPush;
  }

  const rebuilt = g.fluidNets[0];
  assert.deepEqual(rebuilt.nodes, originalNodeOrder, 'fluid traversal retains the exact node order');
  assert.equal(rebuilt.fluid, 'water', 'unfiltered fluid identity survives the rebuild');
  assert.equal(rebuilt.amount, 1234.567, 'the rebuilt amount retains its exact 1e-6 value');
  assert.equal(rebuilt.se, 42.123456, 'the rebuilt specific energy retains its exact 1e-6 value');
  assert.equal(transientEntityBoxTuplePushes, 0,
    `rebuild traversal avoids transient [Entity, box] tuple pushes, observed ${transientEntityBoxTuplePushes} for ${pipes.length} boxes`);
}

{
  const { g, pipes } = buildPipeGrid(8);
  rebuildFluids(g);
  const net = g.fluidNets[0];
  net.fluid = 'water';
  net.amount = 1234.567;
  net.se = 42.123456;
  const expectedNodes = net.nodes.map(([id, box]) => [id, box]);
  const pipeConns = PROTOS.pipe.fluid![0].conns;
  const originalMap = Array.prototype.map;
  let pipeConnectionMapCalls = 0;
  Array.prototype.map = function (this: unknown[], ...args: any[]) {
    if (this === pipeConns) pipeConnectionMapCalls++;
    return Reflect.apply(originalMap, this, args) as any;
  };
  try {
    rebuildFluids(g);
  } finally {
    Array.prototype.map = originalMap;
  }

  assert.deepEqual(g.fluidNets[0].nodes, expectedNodes, 'connection caching preserves exact fluid node order');
  assert.equal(g.fluidNets[0].fluid, 'water', 'connection caching preserves fluid identity');
  assert.equal(g.fluidNets[0].amount, 1234.567, 'connection caching preserves exact amount');
  assert.equal(g.fluidNets[0].se, 42.123456, 'connection caching preserves exact specific energy');
  assert.equal(g.fluidNets[0].nodes.length, pipes.length, 'connection cache visits every pipe box');
  assert.equal(pipeConnectionMapCalls, 0,
    `private rebuild avoids allocating mapped connection records for actual PROTOS.pipe connections; observed ${pipeConnectionMapCalls} calls`);
}

{
  const { g, pipes } = buildPipeGrid(8);
  const originalGetChunk = g.world.getChunk;
  let getChunkCalls = 0;
  g.world.getChunk = function (cx: number, cy: number) {
    getChunkCalls++;
    return originalGetChunk.call(this, cx, cy);
  };
  try {
    rebuildFluids(g);
  } finally {
    g.world.getChunk = originalGetChunk;
  }
  assert.equal(g.fluidNets.length, 1, 'an instance getChunk override retains fluid topology');
  assert.equal(g.fluidNets[0].nodes.length, pipes.length, 'override fallback visits all fluid boxes');
  assert.ok(getChunkCalls >= pipes.length * 4,
    `instance getChunk override remains observable during every port lookup (${getChunkCalls} calls)`);
}

{
  const g = new Game(0x11612, true, { enemies: 'none' });
  g.batchBuild = true;
  const first = g.build('pipe-to-ground', 31, 100, 1, false);
  const surface = g.build('pipe', 30, 100, 0, false);
  const second = g.build('pipe-to-ground', 39, 100, 3, false);
  assert.ok(surface && first && second, 'surface neighbor and underground pair straddling a chunk boundary build');
  g.batchBuild = false;
  rebuildFluids(g);
  assert.equal(first._fn?.[0], second._fn?.[0], 'underground reach connects both endpoints');
  assert.equal(first._fn?.[0], surface._fn?.[0], 'pipe-to-ground joins its surface neighbor');
  const originalNodeOrder = g.fluidNets[first._fn![0]].nodes.map(([id, box]) => [id, box]);

  const chunkX = Math.floor(second.x / CHUNK), chunkY = Math.floor(second.y / CHUNK);
  const key = ckey(chunkX, chunkY);
  const originalChunk = g.world.chunks.get(key)!;
  const hookEvents: string[] = [];
  const originalOnChunkGen = g.world.onChunkGen;
  const originalOnAnyGen = g.world.onAnyGen;
  const originalOnGenScript = g.world.onGenScript;
  let replacement: typeof originalChunk | null = null;
  g.world.onChunkGen = chunk => hookEvents.push(`chunk:${chunk.cx},${chunk.cy}`);
  g.world.onAnyGen = chunk => hookEvents.push(`any:${chunk.cx},${chunk.cy}`);
  g.world.onGenScript = chunk => {
    hookEvents.push(`script:${chunk.cx},${chunk.cy}`);
    if (chunk.cx !== chunkX || chunk.cy !== chunkY) return;
    replacement = { ...chunk, occ: new Int32Array(chunk.occ) };
    replacement.occ.fill(-1);
    g.world.chunks.set(key, replacement);
    g.world.setOcc(second.x, second.y, second.id);
    surface.ffilter = ['water'];
  };
  g.world.chunks.delete(key);
  try {
    rebuildFluids(g);
  } finally {
    g.world.onChunkGen = originalOnChunkGen;
    g.world.onAnyGen = originalOnAnyGen;
    g.world.onGenScript = originalOnGenScript;
  }

  assert.deepEqual(hookEvents, [`chunk:${chunkX},${chunkY}`, `any:${chunkX},${chunkY}`, `script:${chunkX},${chunkY}`],
    'fluid rebuild preserves generated-chunk callback order');
  assert.equal(g.world.chunks.get(key), replacement, 'fluid rebuild observes the chunk replaced by the script hook');
  assert.equal(first._fn?.[0], second._fn?.[0], 'live occupancy in a replacement chunk restores the underground connection');
  assert.deepEqual(g.fluidNets[first._fn![0]].nodes, originalNodeOrder,
    'late neighbor filter mutation and replacement occupancy preserve ordered fluid nodes');
  assert.equal(g.fluidNets[first._fn![0]].fluid, 'water',
    'a generated-chunk callback can still mutate an already scanned neighbor filter before discovery');
  assert.notEqual(g.world.chunks.get(key), originalChunk, 'the fixture replaced the original chunk object');
}

console.log('PASS: fluid rebuild avoids transient traversal tuples while preserving fluid order, exact values, overrides, and generated-chunk hooks');
