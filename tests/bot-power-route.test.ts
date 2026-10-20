import assert from 'node:assert/strict';
import { Run } from '../tools/bot/script';
import { key, portsOf } from '../tools/bot/map';
import { powerBlock } from '../tools/bot/layouts';
import { DX, DY } from '../src/core/types';
import { CREEP_BLOCK, creepAt } from '../src/sim/enemies';
import { D_TREE, T_GRASS } from '../src/sim/world';

const run = new Run(1);
const start: [number, number] = [-528, 521];
const target: [number, number] = [216, 160];
const path = run.tilePath(start[0], start[1],
  (x, y) => Math.hypot(x - target[0], y - target[1]) <= 7.4,
  () => true, 800000, [target]);
assert.ok(path, 'bounded route search must connect a remote field to the existing power network');
assert.deepEqual(path[0], start);
assert.ok(Math.hypot(path[path.length - 1][0] - target[0], path[path.length - 1][1] - target[1]) <= 7.4);
for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]), 1);
console.log(`✔ remote power route has ${path.length - 1} connected tiles`);

// A new multi-unit power block's internal pipe is not an existing water source.
// The external boiler feed must route to the old network before registering it.
const powerRun = new Run(1);
const coalPatch = { res: 3, tiles: 40, amt: 60000, c: [20, 40] as [number, number], box: [10, 30, 40, 50] as [number, number, number, number] };
powerRun.patches = [coalPatch];
(powerRun as any).oreSpot = () => ({ x: 20, y: 40 });
(powerRun as any).poles = () => [];
(powerRun as any).placeBlock = function* () { return { cells: [] }; };
const waterTargets = powerRun.netTiles('water-p'); waterTargets.add(key(0, 0));
let feedTargets: number[] = [];
(powerRun as any).pipeTo = function* (net: string) { feedTargets = [...powerRun.netTiles(net)]; };
powerRun.run(powerRun.power(2));
assert.ok(feedTargets.includes(key(0, 0)), 'the power block feed keeps the previously powered water network as its route target');
const targetsOwnPipe = feedTargets.includes(key(23, 51));

// Exercise the same power() path with real simulation entities: the new boilers
// must share the offshore pump's water net and produce steam after ticking.
const waterRun = new Run(1);
const shore = waterRun.shoreNear(0, 0);
assert.ok(shore, 'the seed has a reachable pump shoreline for the power-feed integration test');
for (let y = shore.y - 50; y <= shore.y + 50; y++) for (let x = shore.x - 50; x <= shore.x + 50; x++) {
  if (waterRun.g.world.decor(x, y)) waterRun.g.world.removeDecor(x, y);
}
const pump = { p: 'offshore-pump', x: shore.x, y: shore.y, d: shore.d };
const pumpEntity = waterRun.g.build(pump.p, pump.x, pump.y, pump.d as any, false);
assert.ok(pumpEntity, 'the test pump is placed at the selected shore');
const pumpPorts = portsOf(pump, { fixed: ['water-p'] });
waterRun.plan.add(pump, undefined, pumpPorts);
const sourcePort = pumpPorts[0];
waterRun.netTiles('water-p').add(key(sourcePort.x + DX[sourcePort.d], sourcePort.y + DY[sourcePort.d]));

const block = powerBlock(2);
const placedEntities = block.bp.entities.filter(e => e.p !== 'electric-mining-drill');
let site: { x: number; y: number } | null = null;
for (let r = 0; r <= 45 && !site; r++) {
  for (let dy = -r; dy <= r && !site; dy++) for (let dx = -r; dx <= r && !site; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = shore.x + 20 + dx, y = shore.y - 20 + dy;
    if (placedEntities.every(e => waterRun.g.canPlace(e.p, x + e.x, y + e.y, e.d, false).ok)) site = { x, y };
  }
}
assert.ok(site, 'a clear dry station site exists near the pump');
waterRun.patches = [{ res: 3, tiles: 40, amt: 60000, c: [site.x, site.y], box: [site.x - 8, site.y - 8, site.x + 8, site.y + 8] }];
(waterRun as any).oreSpot = () => site;
(waterRun as any).poles = () => [];
(waterRun as any).placeBlock = function* (_b: any, ox: number, oy: number) {
  const boilers: any[] = [];
  for (const e of placedEntities) {
    const placed = waterRun.g.build(e.p, ox + e.x, oy + e.y, e.d as any, false);
    assert.ok(placed, `the test station places ${e.p} at ${ox + e.x},${oy + e.y}`);
    if (e.p === 'boiler') { placed.fuel = { item: 'coal', count: 100 }; placed.fuelJ = 0; boilers.push(placed); }
  }
  return { cells: [], boilers };
};
(waterRun as any).makeAll = function* () {};
(waterRun as any).buildBp = function* (bp: any, ox: number, oy: number) {
  for (const e of bp.entities) {
    if (waterRun.g.world.decor(ox + e.x, oy + e.y)) waterRun.g.world.removeDecor(ox + e.x, oy + e.y);
    const placed = waterRun.g.build(e.p, ox + e.x, oy + e.y, e.d as any, false);
    assert.ok(placed, `the routed water pipe places ${e.p} at ${ox + e.x},${oy + e.y}`);
  }
};
waterRun.run(waterRun.power(2));
for (let i = 0; i < 120; i++) waterRun.g.step();
const stationBoilers = [...waterRun.g.ents.values()].filter(e => e.t === 'boiler' && e.x >= site.x && e.x <= site.x + 4 && e.y >= site.y + 10 && e.y <= site.y + 10);
assert.equal(stationBoilers.length, 2, 'the integration station has both boilers');
for (const boiler of stationBoilers) {
  const water = waterRun.g.fluidNets[boiler._fn![0]];
  const steam = waterRun.g.fluidNets[boiler._fn![1]];
  assert.ok(water.nodes.some(([id]) => id === pumpEntity.id), 'each new boiler shares the offshore pump water network');
  assert.equal(water.fluid, 'water');
  assert.notEqual(boiler.status, 'no-water');
  assert.equal(steam.fluid, 'steam');
  assert.ok(steam.amount > 0, 'each powered boiler produces real steam after simulation ticks');
}
assert.equal(targetsOwnPipe, false, 'the block does not route its water feed to its own internal pipe');
console.log('✔ power-block feed routes to the existing water network before registering internal pipes');
console.log('✔ new multi-unit station receives pump water and produces steam in the simulation');

// Planning must respect the same creep threshold as real construction.
const slimeRun = new Run(1);
for (let y = 996; y <= 1004; y++) for (let x = 998; x <= 1020; x++) {
  const chunk = slimeRun.g.world.chunkAt(x, y), i = slimeRun.g.world.idx(x, y);
  chunk.terrain[i] = T_GRASS; chunk.res[i] = 0; chunk.amt[i] = 0; chunk.decor[i] = 0;
}
const slimeChunk = slimeRun.g.world.chunkAt(1008, 1000);
slimeChunk.creep ||= new Uint8Array(32 * 32);
slimeChunk.creep[slimeRun.g.world.idx(1008, 1000)] = CREEP_BLOCK;
const plannedPolePositions: [number, number][] = [];
(slimeRun as any).makeAll = function* () {};
(slimeRun as any).buildBp = function* (bp: any, ox: number, oy: number) {
  for (const e of bp.entities) plannedPolePositions.push([ox + e.x, oy + e.y]);
};
slimeRun.run(slimeRun.poleLine(1000, 1000,
  (x, y) => Math.hypot(x - 1015, y - 1000) <= 7.4, [[1015, 1000]]));
assert.ok(plannedPolePositions.length > 0, 'the generator actually plans a pole connection');
assert.ok(plannedPolePositions.every(([x, y]) => creepAt(slimeRun.g, x, y) < CREEP_BLOCK),
  'pole route avoids construction-blocking creep cells');
for (const [x, y] of plannedPolePositions) {
  assert.ok(slimeRun.g.canPlace('small-electric-pole', x, y, 0, false).ok,
    `the real simulation allows construction at planned pole ${x},${y}`);
}
console.log('✔ planned power poles avoid blocking slime and pass real canPlace checks');

// The route must also avoid other real construction blockers, not just slime.
const decorRun = new Run(1);
for (let y = 996; y <= 1004; y++) for (let x = 998; x <= 1020; x++) {
  const chunk = decorRun.g.world.chunkAt(x, y), i = decorRun.g.world.idx(x, y);
  chunk.terrain[i] = T_GRASS; chunk.res[i] = 0; chunk.amt[i] = 0; chunk.decor[i] = 0;
}
const decorCell: [number, number] = [1008, 1000];
const decorChunk = decorRun.g.world.chunkAt(...decorCell);
decorChunk.creep = new Uint8Array(32 * 32);
decorChunk.decor[decorRun.g.world.idx(...decorCell)] = D_TREE;
const decorPolePositions: [number, number][] = [];
(decorRun as any).makeAll = function* () {};
(decorRun as any).buildBp = function* (bp: any, ox: number, oy: number) {
  for (const e of bp.entities) decorPolePositions.push([ox + e.x, oy + e.y]);
};
decorRun.run(decorRun.poleLine(1000, 1000,
  (x, y) => Math.hypot(x - 1015, y - 1000) <= 7.4, [[1015, 1000]]));
assert.ok(decorPolePositions.length > 0, 'the route creates a pole around a tree blocker');
for (const [x, y] of decorPolePositions) assert.ok(decorRun.g.canPlace('small-electric-pole', x, y, 0, false).ok,
  `the route avoids real construction blockers at ${x},${y}`);
console.log('✔ pole routes avoid real decor blockers validated by canPlace');
