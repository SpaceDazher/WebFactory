import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import * as management from '../src/sim/mgmt';
import { RECIPES } from '../src/data/recipes';
import { tkey } from '../src/core/types';
import { Inventory } from '../src/sim/inventory';
import { stateHash } from '../src/sim/save';
import { CHUNK } from '../src/core/types';
import { R_URAN } from '../src/sim/world';
import { XUi } from '../src/ui/xui';
import { rebuildPower, stepPower } from '../src/sim/networks';

const g = new Game(116, true, { enemies: 'none' });
for (const id in RECIPES) g.enabled.add(id);
for (let x = 90; x < 155; x++) for (let y = 90; y < 145; y++) {
  const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
  c.terrain[i] = c.res[i] = c.decor[i] = c.amt[i] = 0;
}
const factory = g.build('assembling-machine-2', 100, 100, 0, false)!;
g.applyRecipe(factory, 'iron-gear-wheel'); factory.status = 'no-input';
const hand = g.build('inserter', 103, 101, 3, false)!;
const target = g.build('requester-chest', 104, 101, 0, false)!;
const source = g.build('passive-provider-chest', 112, 101, 0, false)!;
source.inv!.add('iron-plate', 3); target.req = [{ item: 'iron-plate', n: 3 }];
g.robots.push({ id: 1, x: 109, y: 101, home: -1, e: 100000, k: 'deliver', src: source.id, tgt: target.id, it: 'iron-plate', n: 3, step: 0, cargo: [], chg: -1, lg: 1 });
const flatten = (n: any): any[] => n ? [n, ...n.kids.flatMap(flatten)] : [];
const logicalDepth = (n: any, depth = 0): number => {
  if (!n) return depth;
  const ref = n.id >= 0 && /уже в отчёте выше \(цикл\)/.test(n.cause);
  const next = depth + (n.id >= 0 && !ref || n.name === 'Логистический робот' ? 1 : 0);
  return Math.max(next, ...n.kids.map((kid: any) => logicalDepth(kid, next)));
};
const addDiagEntity = (world: Game, extra: Record<string, any> = {}) => {
  const id = world.nextId++;
  const e = { id, proto: 'chemical-plant', t: 'factory', x: 100, y: 100, w: 3, h: 3, dir: 0, ...extra } as any;
  world.ents.set(id, e); return e;
};
let fails = 0;
const verify = async (name: string, f: () => void | Promise<void>) => { try { await f(); console.log('PASS:', name); } catch (e) { fails++; console.error('FAIL:', name, (e as Error).message); } };
await verify('diagnostics use latest mined ore when productivity bonus belongs to older ore', () => {
  const world = new Game(122, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  const drill = { id: world.nextId++, proto: 'electric-mining-drill', t: 'drill', x: 100, y: 100, w: 3, h: 3, dir: 1, status: 'no-ore', lastOre: 'coal', lastIt: 'iron-ore' } as any;
  world.ents.set(drill.id, drill);
  const out = world.drillOut(drill);
  const belt = { id: world.nextId++, proto: 'transport-belt', t: 'belt', x: out.x, y: out.y, w: 1, h: 1, dir: out.d, lanes: [[[], []]] } as any;
  const hand = { id: world.nextId++, proto: 'inserter', t: 'inserter', x: out.x + 1, y: out.y, w: 1, h: 1, dir: 1 } as any;
  const target = { id: world.nextId++, proto: 'chemical-plant', t: 'factory', x: out.x + 2, y: out.y - 1, w: 3, h: 3, dir: 0, recipe: 'plastic-bar', status: 'no-input', input: {} } as any;
  world.ents.set(belt.id, belt); world.ents.set(hand.id, hand); world.ents.set(target.id, target);
  world.world.setOcc(belt.x, belt.y, belt.id);
  const report = management.diagnose(world, target.id);
  assert(flatten(report.root).some(n => n.id === drill.id), 'the physical drill still supplies coal after running out of ore; stale productivity output must not replace its last mined ore');
});
await verify('diagnostic count includes every visible node and never exceeds 64', () => {
  const key = '__diagnostic_v116_many_fluid_nodes';
  const previous = (RECIPES as any)[key];
  (RECIPES as any)[key] = { cat: 'chem', in: [['water', 1], ['water', 1], ['water', 1]], out: [['water', 1]] };
  try {
    const world = new Game(123, true, { enemies: 'none' });
    for (const id in RECIPES) world.enabled.add(id);
    world.fluidNets = [{ fluid: 'water', amount: 0, cap: 100, conflict: false, se: 1 }] as any;
    let root: any = null;
    for (let i = 0; i < 70; i++) {
      const e = addDiagEntity(world, { recipe: key, status: 'no-input', input: {}, _fn: [0] });
      if (!root) root = e;
    }
    const report = management.diagnose(world, root.id);
    const visible = flatten(report.root).length;
    assert(visible <= 64, `visible diagnostic tree must stay within 64 nodes, got ${visible}`);
    assert.equal(report.nodes, visible, 'the displayed node total includes source-missing markers, cut markers, robot nodes, and cycle references');
  } finally {
    if (previous === undefined) delete (RECIPES as any)[key]; else (RECIPES as any)[key] = previous;
  }
});
await verify('group power usage includes real roboport charging at ordinary priority', () => {
  const world = new Game(124, true, { enemies: 'none' });
  world.tick = 0; // full daylight makes the single real panel supply 60 kW.
  for (let x = 96; x < 113; x++) for (let y = 94; y < 109; y++) {
    const c = world.world.chunkAt(x, y), i = world.world.idx(x, y);
    c.terrain[i] = c.res[i] = c.decor[i] = c.amt[i] = 0; c.occ[i] = -1; c.mods.delete(i);
  }
  const solar = world.build('solar-panel', 100, 100, 0, false);
  const pole = world.build('small-electric-pole', 104, 100, 0, false);
  const port = world.build('roboport', 106, 99, 0, false);
  assert(solar && pole && port, 'real power fixture entities must build on the cleared area');
  management.groupOp(world, { op: 'gnew', name: 'Buffer draw', ids: [port.id] });
  port.pp = 0; // its 50 kW operating drain is critical; its separate charge request remains ordinary.
  rebuildPower(world); stepPower(world);
  const net = world.powerNets.get(port._net!);
  const ordinaryShare = net?.sl?.[1];
  assert(net && port._rq! > 0 && ordinaryShare !== undefined && ordinaryShare > 0 && ordinaryShare < 1,
    `real network must partially charge the buffer at ordinary priority (rq ${port._rq}, shares ${JSON.stringify(net?.sl)})`);
  const actualKW = (world.pstats.ec.roboport || 0) * 60;
  const reported = management.groupInfo(world, port.grp!).kwUse;
  assert(Math.abs(reported - actualKW) < 1e-6,
    `group usage ${reported} kW must match stepPower's actual roboport draw ${actualKW} kW`);
  assert(reported > 50, `usage includes standby drain plus actual buffer charge, got ${reported} kW`);

  // `_rq` can still contain the previous connected request for this render tick.
  // A detached port has no real supply and must not report that stale request.
  port._net = -1;
  assert.equal(management.groupInfo(world, port.grp!).kwUse, 0,
    'disconnected roboport contributes neither stale buffer request nor unsupplied standby drain');
});
await verify('actual robot assignment reaches its source chest', () => {
  const report = management.diagnose(g, factory.id), nodes = flatten(report.root);
  assert(nodes.some(n => n.id === source.id));
  assert(nodes.some(n => n.name === 'Логистический робот'));
  assert.equal(report.nodes, nodes.length, 'node count includes every visible node, including delivery hops and cycle references');
  assert(logicalDepth(report.root) <= 8, 'the eight-level limit includes the delivery hop');
});
await verify('output-full logistics nodes are included in the report count', () => {
  const world = new Game(121, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  for (let x = 90; x < 115; x++) for (let y = 90; y < 115; y++) {
    const c = world.world.chunkAt(x, y), i = world.world.idx(x, y);
    c.terrain[i] = c.res[i] = c.decor[i] = c.amt[i] = 0;
  }
  const machine = world.build('assembling-machine-1', 100, 100, 0, false)!;
  const taker = world.build('inserter', 101, 99, 0, false)!;
  assert(machine && taker, 'output fixture must use valid in-world entities');
  machine.status = 'output-full';
  const report = management.diagnose(world, machine.id), nodes = flatten(report.root);
  assert(nodes.some(n => n.id === taker.id && /пустую землю/.test(n.cause)), 'output branch should include the real inserter');
  assert.equal(report.nodes, nodes.length, 'the count includes presentation markers attached to an output chain');
});

// Вагон занимает клетки carCells, а не статическую world.occ клетки забора.
g.robots.length = 0;
const wagon: any = { id: g.nextId++, proto: 'cargo-wagon', t: 'wagon', x: 130, y: 130, w: 2, h: 6, dir: 0, inv: new Inventory(40), hp: 600, tr: 1 };
wagon.inv.add('iron-plate', 5); g.ents.set(wagon.id, wagon);
g.carCells.set(tkey(104, 101), wagon.id);
g.removeEntity(target, false);
await verify('actual wagon cell is traced through the unloading inserter', () => {
  assert.equal(g.entAt(104, 101), null);
  assert(flatten(management.diagnose(g, factory.id).root).some(n => n.id === wagon.id));
  g.trains.push({ id: 1, name: 'Тестовый поезд', st: 'стоит', si: 0, sched: [{ st: 'Склад' }] } as any);
  const trainReport = management.diagnose(g, factory.id);
  const train = flatten(trainReport.root).find(n => n.id === wagon.id);
  assert(train && /поезд Тестовый поезд/.test(train.cause), train?.cause);
  g.trains.length = 0;
});
g.carCells.clear(); g.ents.delete(wagon.id); g.removeEntity(hand, false);

await verify('a furnace running iron is never invented as a copper supplier', () => {
  const f = g.build('stone-furnace', 104, 101, 0, false)!;
  f.recipe = 'iron-plate'; f.status = 'no-input';
  g.build('inserter', 103, 101, 3, false);
  g.applyRecipe(factory, 'copper-cable');
  assert(!flatten(management.diagnose(g, factory.id).root).some(n => n.id === f.id));
  assert(flatten(management.diagnose(g, factory.id).root).some(n => n.id === -1 && /поставка не найдена/.test(n.cause)));
});

await verify('incremental diagnostic API exists', () => {
  assert.equal(typeof (management as any).diagnoseAsync, 'function');
});
await verify('fluid index follows renumbered fluid networks without an entity rebuild', () => {
  const a = g.build('chemical-plant', 110, 115, 0, false)!;
  const b = g.build('chemical-plant', 120, 115, 0, false)!;
  g.research.done.add('uranium-processing');
  const ore = g.world.chunkAt(140, 115), oreIndex = g.world.idx(140, 115);
  ore.res[oreIndex] = R_URAN; ore.amt[oreIndex] = 1000;
  const drill = g.build('electric-mining-drill', 140, 115, 0, false)!;
  g.applyRecipe(a, 'sulfuric-acid'); g.applyRecipe(b, 'sulfuric-acid');
  drill.status = 'no-acid'; a._fn = [0]; b._fn = [1]; drill._fn = [0];
  g.fluidNets = [{ fluid: 'sulfuric-acid', amount: 0, cap: 100, conflict: false, se: 1 }, { fluid: 'sulfuric-acid', amount: 0, cap: 100, conflict: false, se: 1 }] as any;
  assert(flatten(management.diagnose(g, drill.id).root).some(n => n.id === a.id));
  // Воспроизводим выход rebuildFluids после смены рецепта: IDs и массив
  // сетей меняются, а ents.ver и beltVer остаются прежними.
  const version = g.ents.ver;
  a._fn = [1]; b._fn = [0]; g.fluidNets = g.fluidNets.map(n => ({ ...n }));
  const nodes = flatten(management.diagnose(g, drill.id).root);
  assert.equal(g.ents.ver, version);
  assert(nodes.some(n => n.id === b.id) && !nodes.some(n => n.id === a.id));
});
await verify('diagnostics do not generate chunks while checking an unknown drill', async () => {
  const world = new Game(117, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  const target = addDiagEntity(world, { recipe: 'battery', status: 'no-input', _fn: [0] });
  target.recipe = 'battery'; target.status = 'no-input'; target._fn = [0];
  world.fluidNets = [{ fluid: 'sulfuric-acid', amount: 0, cap: 100, conflict: false, se: 1 }] as any;
  const cx = 100000, cy = 100000, ck = Math.floor(cx / CHUNK), cyk = Math.floor(cy / CHUNK);
  const hiddenFactory = addDiagEntity(world, { x: cx + 5, y: cy + 5, recipe: 'sulfuric-acid', status: 'no-input', _fn: [0] });
  const unknownDrill = addDiagEntity(world, { proto: 'electric-mining-drill', t: 'drill', x: cx, y: cy, status: 'working', _fn: [0] });
  assert.equal(world.world.hasChunk(ck, cyk), false);
  const report = management.diagnose(world, target.id);
  assert(flatten(report.root).some(n => n.id === hiddenFactory.id), 'diagnostic includes the hidden supplier without revealing its chunk');
  assert.equal(world.world.hasChunk(ck, cyk), false, 'diagnostic lookup must not generate a hidden resource chunk');
  const calls: string[] = [];
  world.world.chunkAt(target.x, target.y);
  const ui = new XUi({
    game: () => world, render: () => {}, close: () => {}, toggle: () => {}, open: () => null,
    query: async (kind: string, arg: any) => kind === 'diag' ? management.diagnose(world, arg) : [{ x: target.x, y: target.y, w: target.w, h: target.h }],
    openEnt: id => { calls.push(`open:${id}`); }, hl: () => { calls.push('highlight'); },
  } as any);
  ui.act('x-why', { dataset: { id: String(target.id) } } as any);
  assert(ui.entExtra(target).includes('Считаю цепочку'), 'clicking “Why did it stop?” starts the Worker report UI state');
  await Promise.resolve();
  const markup = ui.entExtra(target);
  assert(markup.includes(`data-act="x-go" data-id="${target.id}"`), 'a known node is rendered as an actionable map link');
  assert(!markup.includes(`data-id="${hiddenFactory.id}"`), 'a hidden supplier is rendered without a map link');
  ui.act('x-go', { dataset: { id: String(unknownDrill.id) } } as any);
  assert.equal(calls.length, 0, 'a hidden source cannot be opened or highlighted through the diagnostic link');
  ui.act('x-go', { dataset: { id: String(target.id) } } as any);
  await Promise.resolve();
  assert(calls.includes(`open:${target.id}`) && calls.includes('highlight'), 'known source opens and highlights its map segment');
  let finishIds: (rects: any[]) => void = () => {};
  const delayedUi = new XUi({
    game: () => world, render: () => {}, close: () => {}, toggle: () => {}, open: () => null,
    query: () => new Promise(resolve => { finishIds = resolve; }), openEnt: () => {},
    hl: () => { calls.push('highlight-after-snapshot'); },
  } as any);
  delayedUi.act('x-go', { dataset: { id: String(target.id) } } as any);
  world.ents.set(target.id, { ...world.ents.get(target.id)! });
  finishIds([{ x: target.x, y: target.y, w: target.w, h: target.h }]);
  await Promise.resolve();
  assert(calls.includes('highlight-after-snapshot'), 'a normal snapshot replacing an entity object with the same live ID does not drop the delayed map highlight');
  let finishHiddenIds: (rects: any[]) => void = () => {};
  const movedUi = new XUi({
    game: () => world, render: () => {}, close: () => {}, toggle: () => {}, open: () => null,
    query: () => new Promise(resolve => { finishHiddenIds = resolve; }), openEnt: () => {},
    hl: () => { calls.push('highlight-after-fog'); },
  } as any);
  movedUi.act('x-go', { dataset: { id: String(target.id) } } as any);
  world.ents.set(target.id, { ...world.ents.get(target.id)!, x: cx + 5, y: cy + 5 });
  finishHiddenIds([{ x: target.x, y: target.y, w: target.w, h: target.h }]);
  await Promise.resolve();
  assert(!calls.includes('highlight-after-fog'), 'if the entity moves into fog while ids is in flight, its stale result is not highlighted');
  world.ents.set(target.id, { ...target });
  let window: string | null = 'ent', windowId = target.id;
  const togglingUi = new XUi({
    game: () => world, render: () => {}, close: () => { window = null; }, toggle: () => {}, open: () => window,
    query: async () => [{ x: target.x, y: target.y, w: target.w, h: target.h }],
    openEnt: id => { if (window === 'ent' && windowId === id) window = null; else { window = 'ent'; windowId = id; } }, hl: () => {},
  } as any);
  togglingUi.act('x-go', { dataset: { id: String(target.id) } } as any);
  assert.equal(window, 'ent', 'opening the currently selected root from its report must keep its window open');
});
await verify('cyclic fluid chains are bounded by visited nodes and depth eight', () => {
  const world = new Game(118, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  const target = addDiagEntity(world, { recipe: 'battery', status: 'no-input', _fn: [0] });
  target.recipe = 'battery'; target.status = 'no-input'; target._fn = [0];
  const old = RECIPES['sulfuric-acid'];
  RECIPES['sulfuric-acid'] = { ...old, in: [['sulfuric-acid', 1]] } as any;
  try {
    world.fluidNets = Array.from({ length: 11 }, () => ({ fluid: 'sulfuric-acid', amount: 0, cap: 100, conflict: false, se: 1 })) as any;
    for (let i = 0; i < 10; i++) {
      addDiagEntity(world, { x: 110 + i * 3, recipe: 'sulfuric-acid', status: 'no-input', _fn: [i, i + 1] });
    }
    const report = management.diagnose(world, target.id), nodes = flatten(report.root);
    assert(report.cut, 'long recursive chain should show a continuation marker');
    assert(report.nodes <= 64 && nodes.length <= 64);
    assert(logicalDepth(report.root) <= 8, 'the eight-level limit applies to the displayed production chain');
    assert(nodes.some(n => /уже в отчёте выше \(цикл\)/.test(n.cause)), 'cycle should be closed by a visited-node marker');
  } finally { RECIPES['sulfuric-acid'] = old; }
});
await verify('large fluid candidate scans yield within the shared diagnostic budget', async () => {
  const world = new Game(116, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  for (let x = 90; x < 155; x++) for (let y = 90; y < 145; y++) {
    const c = world.world.chunkAt(x, y), i = world.world.idx(x, y);
    c.terrain[i] = c.res[i] = c.decor[i] = c.amt[i] = 0;
  }
  const target = world.build('chemical-plant', 100, 100, 0, false)!;
  const source = world.build('chemical-plant', 110, 115, 0, false)!;
  assert(target && source, 'large-scan fixture must use valid in-world entities');
  world.applyRecipe(target, 'battery'); target.status = 'no-input'; target._fn = [0, 1];
  world.applyRecipe(source, 'sulfuric-acid'); source.status = 'no-input'; source._fn = [0, 1];
  world.fluidNets = Array.from({ length: 2 }, () => ({ fluid: 'sulfuric-acid', amount: 0, cap: 100, conflict: false, se: 1 })) as any;
  world.dirtyFluid = false;
  for (let i = 0; i < 3000; i++) {
    const e = { ...source, id: world.nextId++, x: 300 + i * 3, y: 300, _fn: [0, 1], input: {} };
    world.ents.set(e.id, e);
  }
  const samples: number[] = [], realSetTimeout = globalThis.setTimeout.bind(globalThis);
  let callbacks = 0, steppedTicks = 0, pausedSlices = 0;
  (globalThis as any).setTimeout = (f: (...args: any[]) => void, ms?: number, ...args: any[]) => realSetTimeout(() => {
    const start = performance.now(); f(...args); samples.push(performance.now() - start); callbacks++;
    if (callbacks % 2 === 0) { world.step(); steppedTicks++; } else pausedSlices++;
  }, ms, ...args);
  try {
    const reports = await Promise.all(Array.from({ length: 12 }, () => (management as any).diagnoseAsync(world, target.id)));
    const sorted = [...samples].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * 0.95) - 1], maxSliceMs = sorted.at(-1) || 0;
    assert(reports.every(r => r.root?.id === target.id && r.nodes <= 64), 'all simultaneous requests must finish against the requested root');
    assert(samples.length >= 12, `expected multiple scheduler slices for concurrent work, observed ${samples.length}`);
    assert(steppedTicks > 0 && pausedSlices > 0, 'measurement must include both normal Game.step and paused slices');
    assert(p95 <= 1, `p95 scheduler callback was ${p95.toFixed(2)} ms`);
    console.log(`diagnostic fluid budget sample: ${world.ents.size} entities, 12 requests, ${samples.length} real timer slices, p95 ${p95.toFixed(2)} ms, max ${maxSliceMs.toFixed(2)} ms, Game.step ${steppedTicks}, paused ${pausedSlices}`);
  } finally { (globalThis as any).setTimeout = realSetTimeout; }
});
await verify('deleting the requested entity cancels before scanning the world', async () => {
  const world = new Game(120, true, { enemies: 'none' });
  for (const id in RECIPES) world.enabled.add(id);
  const target = addDiagEntity(world, { recipe: 'battery', status: 'no-input' });
  for (let i = 0; i < 2000; i++) { const id = world.nextId++; world.ents.set(id, { id, proto: 'wooden-chest', t: 'chest', x: 0, y: 0, w: 1, h: 1, dir: 0 } as any); }
  const timers: (() => void)[] = [], setTimeout0 = globalThis.setTimeout, now0 = performance.now.bind(performance);
  let clock = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (clock += 0.25) });
  (globalThis as any).setTimeout = (f: () => void) => { timers.push(f); return 0; };
  try {
    const pending = (management as any).diagnoseAsync(world, target.id) as Promise<any>;
    world.removeEntity(target, false);
    timers.shift()!();
    const scheduledAfterFirstSlice = timers.length;
    let slices = 0;
    while (timers.length) { assert(slices++ < 10000, 'diagnostic failed to finish after deletion'); timers.shift()!(); }
    const report = await pending;
    assert.equal(report.root, null);
    assert.equal(scheduledAfterFirstSlice, 0, 'deleted root should not schedule another scan slice');
  } finally {
    (globalThis as any).setTimeout = setTimeout0;
    Object.defineProperty(performance, 'now', { configurable: true, value: now0 });
  }
});
if (typeof (management as any).diagnoseAsync === 'function') {
  const before = stateHash(g);
  const report = await (management as any).diagnoseAsync(g, factory.id);
  assert(report.nodes <= 64 && report.root?.id === factory.id);
  assert.equal(stateHash(g), before, 'diagnosis never mutates simulation state');
  const cancelled = await (management as any).diagnoseAsync(g, factory.id, () => false);
  assert.equal(cancelled.root, null, 'world reset cancels an old diagnostic');
}
assert.equal(fails, 0, `${fails} diagnostic requirements failed`);
