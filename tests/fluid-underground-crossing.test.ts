import assert from 'node:assert/strict';
import { DX, DY } from '../src/core/types';
import { Game, type Entity } from '../src/sim/game';
import { boxNeighbors, rebuildFluids } from '../src/sim/networks';
import { deserialize, serialize } from '../src/sim/save';

type Pipe = { x: number; y: number; dir: 0 | 1 | 2 | 3 };

function emptyGame(seed: number) {
  const g = new Game(seed, true, { enemies: 'none' });
  g.batchBuild = true;
  for (let y = 82; y <= 150; y++) for (let x = 82; x <= 150; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) g.world.removeDecor(x, y);
  }
  return g;
}

function place(g: Game, spec: Pipe): Entity {
  const e = g.build('pipe-to-ground', spec.x, spec.y, spec.dir, false);
  assert.ok(e, `underground pipe builds at ${spec.x},${spec.y} facing ${spec.dir}`);
  return e;
}

function hasNeighbor(g: Game, from: Entity, to: Entity) {
  return boxNeighbors(g, from, 0).some(([other]) => other === to);
}

function buildTopology(seed: number, dir: 0 | 1 | 2 | 3, reverseOrder: boolean) {
  const g = emptyGame(seed);
  const start: Pipe = { x: 110, y: 110, dir };
  const end: Pipe = {
    x: start.x + DX[dir] * 8,
    y: start.y + DY[dir] * 8,
    dir: ((dir + 2) % 4) as Pipe['dir'],
  };
  const crossing: Pipe = {
    x: start.x + DX[dir] * 4,
    y: start.y + DY[dir] * 4,
    dir: ((dir + 1) % 4) as Pipe['dir'],
  };
  const crossingEnd: Pipe = {
    x: crossing.x + DX[crossing.dir] * 8,
    y: crossing.y + DY[crossing.dir] * 8,
    dir: ((crossing.dir + 2) % 4) as Pipe['dir'],
  };
  const specs = reverseOrder
    ? [crossing, end, crossingEnd, start]
    : [start, crossing, end, crossingEnd];
  const entities = specs.map(spec => place(g, spec));
  const lookup = new Map(specs.map((spec, i) => [`${spec.x},${spec.y}`, entities[i]]));
  g.batchBuild = false;
  rebuildFluids(g);
  return {
    g,
    start: lookup.get(`${start.x},${start.y}`)!,
    end: lookup.get(`${end.x},${end.y}`)!,
    crossing: lookup.get(`${crossing.x},${crossing.y}`)!,
    crossingEnd: lookup.get(`${crossingEnd.x},${crossingEnd.y}`)!,
  };
}

for (let dir = 0; dir < 4; dir++) for (const reverseOrder of [false, true]) {
  const { g, start, end, crossing, crossingEnd } = buildTopology(0x11620 + dir * 2 + Number(reverseOrder), dir as Pipe['dir'], reverseOrder);
  assert.equal(hasNeighbor(g, start, end), true, `rotation ${dir}, reverse order ${reverseOrder}: start pairs through perpendicular crossing`);
  assert.equal(hasNeighbor(g, end, start), true, `rotation ${dir}, reverse order ${reverseOrder}: underground pair is symmetric`);
  assert.equal(hasNeighbor(g, crossing, crossingEnd), true, `rotation ${dir}, reverse order ${reverseOrder}: crossing line keeps its own pair`);
  assert.equal(hasNeighbor(g, crossingEnd, crossing), true, `rotation ${dir}, reverse order ${reverseOrder}: crossing pair is symmetric`);
  assert.notEqual(start._fn?.[0], crossing._fn?.[0], `rotation ${dir}, reverse order ${reverseOrder}: perpendicular fluids stay isolated`);

  const water = g.fluidNets[start._fn![0]];
  const oil = g.fluidNets[crossing._fn![0]];
  water.fluid = 'water'; water.amount = 37.125;
  oil.fluid = 'petroleum-gas'; oil.amount = 23.5;
  rebuildFluids(g);
  assert.equal(g.fluidNets[start._fn![0]].amount, 37.125, 'rebuild keeps all water when the perpendicular line crosses');
  assert.equal(g.fluidNets[start._fn![0]].fluid, 'water', 'rebuild keeps water identity');
  assert.equal(g.fluidNets[crossing._fn![0]].amount, 23.5, 'rebuild keeps the other line inventory');
  assert.equal(g.fluidNets[crossing._fn![0]].fluid, 'petroleum-gas', 'rebuild does not mix the crossing line');
}

for (let dir = 0; dir < 4; dir++) {
  const d = dir as Pipe['dir'], opposite = ((d + 2) % 4) as Pipe['dir'];
  const g = emptyGame(0x11630 + dir);
  const start = place(g, { x: 110, y: 110, dir: d });
  const boundary = place(g, { x: 110 + DX[d] * 10, y: 110 + DY[d] * 10, dir: opposite });
  const outside = place(g, { x: 110 + DX[d] * 11, y: 110 + DY[d] * 11, dir: opposite });
  g.batchBuild = false;
  rebuildFluids(g);
  assert.equal(hasNeighbor(g, start, boundary), true, `rotation ${dir}: underground reach includes its exact boundary`);
  assert.equal(hasNeighbor(g, start, outside), false, `rotation ${dir}: underground reach excludes the next cell`);
  assert.equal(start._fn?.[0], boundary._fn?.[0], `rotation ${dir}: rebuild uses the exact reach boundary`);
  assert.notEqual(start._fn?.[0], outside._fn?.[0], `rotation ${dir}: rebuild preserves the reach limit`);
}

for (let dir = 0; dir < 4; dir++) {
  const d = dir as Pipe['dir'], opposite = ((d + 2) % 4) as Pipe['dir'];
  const g = emptyGame(0x11634 + dir);
  const start = place(g, { x: 110, y: 110, dir: d });
  const blocker = place(g, { x: 110 + DX[d] * 5, y: 110 + DY[d] * 5, dir: d });
  const farPair = place(g, { x: 110 + DX[d] * 9, y: 110 + DY[d] * 9, dir: opposite });
  g.batchBuild = false;
  rebuildFluids(g);
  assert.equal(hasNeighbor(g, start, farPair), false, `rotation ${dir}: same-axis endpoint still blocks a farther pair`);
  assert.equal(hasNeighbor(g, blocker, farPair), true, `rotation ${dir}: nearest opposite endpoint keeps its own pair`);
  assert.notEqual(start._fn?.[0], farPair._fn?.[0], `rotation ${dir}: rebuild keeps same-axis blocking semantics`);
  assert.equal(blocker._fn?.[0], farPair._fn?.[0], `rotation ${dir}: rebuild connects the nearest same-axis pair`);
}

for (let dir = 0; dir < 4; dir++) {
  const d = dir as Pipe['dir'], opposite = ((d + 2) % 4) as Pipe['dir'];
  const g = emptyGame(0x11638 + dir);
  const start = place(g, { x: 110, y: 110, dir: d });
  const near = place(g, { x: 110 + DX[d] * 3, y: 110 + DY[d] * 3, dir: opposite });
  const far = place(g, { x: 110 + DX[d] * 6, y: 110 + DY[d] * 6, dir: opposite });
  g.batchBuild = false;
  rebuildFluids(g);
  assert.equal(hasNeighbor(g, start, near), true, `rotation ${dir}: the nearest same-axis endpoint wins`);
  assert.equal(hasNeighbor(g, start, far), false, `rotation ${dir}: a farther same-axis endpoint is not also paired`);
  assert.equal(start._fn?.[0], near._fn?.[0], `rotation ${dir}: rebuild retains the nearest pair`);
  assert.notEqual(start._fn?.[0], far._fn?.[0], `rotation ${dir}: rebuild does not merge farther endpoints`);
}

{
  const { g, start, end, crossing, crossingEnd } = buildTopology(0x11633, 0, false);
  g.fluidNets[start._fn![0]].fluid = 'water';
  g.fluidNets[start._fn![0]].amount = 40;
  g.fluidNets[crossing._fn![0]].fluid = 'petroleum-gas';
  g.fluidNets[crossing._fn![0]].amount = 28;
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  const a = loaded.ents.get(start.id)!;
  const b = loaded.ents.get(end.id)!;
  let c = loaded.ents.get(crossing.id)!;
  const d = loaded.ents.get(crossingEnd.id)!;
  assert.equal(a._fn?.[0], b._fn?.[0], 'save/load keeps the water pair connected');
  assert.equal(loaded.fluidNets[a._fn![0]].amount, 40, 'save/load preserves the water amount');
  assert.equal(loaded.fluidNets[c._fn![0]].fluid, 'petroleum-gas', 'save/load preserves the crossing fluid');
  assert.equal(loaded.fluidNets[c._fn![0]].amount, 28, 'save/load preserves the crossing amount');

  loaded.removeEntity(c, false);
  rebuildFluids(loaded);
  assert.equal(a._fn?.[0], b._fn?.[0], 'removing the perpendicular endpoint leaves the water pair connected');
  assert.equal(loaded.fluidNets[a._fn![0]].amount, 40, 'removing the crossing does not lose water');
  assert.equal(loaded.fluidNets[d._fn![0]].fluid, 'petroleum-gas', 'removal preserves the remaining crossing fluid');
  assert.equal(loaded.fluidNets[d._fn![0]].amount, 14, 'removal preserves the inventory in the remaining crossing endpoint');
  loaded.batchBuild = true;
  c = place(loaded, { x: crossing.x, y: crossing.y, dir: crossing.dir as Pipe['dir'] });
  loaded.batchBuild = false;
  rebuildFluids(loaded);
  assert.equal(a._fn?.[0], b._fn?.[0], 'reconnecting the perpendicular endpoint keeps the water pair');
  assert.equal(loaded.fluidNets[a._fn![0]].amount, 40, 'reconnecting the crossing keeps the water amount');
  assert.notEqual(c._fn?.[0], a._fn?.[0], 'reconnecting the crossing does not mix fluids');
  assert.equal(d._fn?.[0], c._fn?.[0], 'the crossing line reconnects to its remaining endpoint');
  assert.equal(loaded.fluidNets[c._fn![0]].fluid, 'petroleum-gas', 'reconnect preserves the independent crossing fluid');
  assert.equal(loaded.fluidNets[c._fn![0]].amount, 14, 'reconnect preserves remaining crossing inventory');
  const roundTrip = deserialize(JSON.parse(JSON.stringify(serialize(loaded))));
  assert.equal(roundTrip.fluidNets[roundTrip.ents.get(start.id)!._fn![0]].amount, 40,
    'save/load after reconnect still preserves water');
  const roundTripCrossing = roundTrip.ents.get(c.id)!;
  const roundTripCrossingEnd = roundTrip.ents.get(d.id)!;
  assert.equal(roundTripCrossing._fn?.[0], roundTripCrossingEnd._fn?.[0],
    'save/load after reconnect preserves the perpendicular pair');
  assert.equal(roundTrip.fluidNets[roundTripCrossing._fn![0]].fluid, 'petroleum-gas',
    'save/load after reconnect preserves the crossing fluid');
  assert.equal(roundTrip.fluidNets[roundTripCrossing._fn![0]].amount, 14,
    'save/load after reconnect preserves crossing inventory');
}

{
  const g = emptyGame(0x11634);
  const plant = g.build('chemical-plant', 120, 120, 0, false)!;
  assert.ok(plant, 'chemical plant builds for the powered recipe flow');
  const waterStart = place(g, { x: 113, y: 123, dir: 1 });
  const waterEnd = place(g, { x: 121, y: 123, dir: 3 });
  const crossing = place(g, { x: 117, y: 123, dir: 2 });
  const crossingEnd = place(g, { x: 117, y: 131, dir: 0 });
  assert.ok(g.build('pipe', 120, 123, 0, false), 'petroleum-gas input pipe builds');
  assert.ok(g.build('pipe', 122, 123, 0, false), 'water input pipe joins the underground outlet');
  assert.ok(g.build('substation', 116, 116, 0, false), 'substation builds near the plant');
  for (const [x, y] of [[107, 107], [111, 107], [107, 111], [111, 111]])
    assert.ok(g.build('solar-panel', x, y, 0, false), `solar panel builds at ${x},${y}`);
  g.batchBuild = false;
  g.step();
  assert.ok(g.sat(plant) > 0.99, 'the chemical plant receives power from working solar panels');
  plant.recipe = 'sulfur';
  g.setFluidFilters(plant);
  rebuildFluids(g);
  g.dirtyFluid = false;
  const gasInput = g.fluidNets[plant._fn![0]];
  const waterInput = g.fluidNets[plant._fn![1]];
  const crossingNet = g.fluidNets[crossing._fn![0]];
  assert.equal(waterStart._fn?.[0], waterEnd._fn?.[0], 'the water input receives its underground line');
  assert.equal(crossing._fn?.[0], crossingEnd._fn?.[0], 'the perpendicular gas line keeps its own underground pair');
  assert.equal(waterEnd._fn?.[0], plant._fn?.[1], 'the underground water pair reaches the sulfur recipe input');
  assert.notEqual(crossingNet, waterInput, 'the perpendicular gas line is independent from recipe water');
  gasInput.fluid = 'petroleum-gas'; gasInput.amount = 60;
  waterInput.fluid = 'water'; waterInput.amount = 60;
  crossingNet.fluid = 'petroleum-gas'; crossingNet.amount = 50;
  for (let i = 0; i < 70; i++) g.step();
  assert.ok((plant.output?.sulfur || 0) >= 2, 'powered chemical plant completes the real sulfur recipe');
  assert.equal(crossingNet.fluid, 'petroleum-gas', 'recipe flow does not change the crossing line fluid');
  assert.equal(crossingNet.amount, 50, 'recipe flow does not draw from the separate crossing line');
}

console.log('PASS: underground pairs pass perpendicular crossings without mixing, through rebuild, removal, reconnect, and save/load');
