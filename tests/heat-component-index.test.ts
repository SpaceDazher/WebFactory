import { RECIPES } from '../src/data/recipes';
import { PROTOS } from '../src/data/entities';
import { DX, DY } from '../src/core/types';
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { heatNet, heatPorts, isHeatType, reactorCause, stepHeat } from '../src/sim/heat';

let failed = false;
function check(condition: unknown, message: string) {
  if (condition) console.log(`  ✔ ${message}`);
  else { console.error(`  ✘ ${message}`); failed = true; }
}

function clear(g: Game, x: number, y: number, size = 20) {
  for (let ty = y; ty < y + size; ty++) for (let tx = x; tx < x + size; tx++) {
    const c = g.world.chunkAt(tx, ty), i = g.world.idx(tx, ty);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) g.world.removeDecor(tx, ty);
  }
}

const g = new Game(17, true, { enemies: 'none' });
for (const recipe of Object.values(RECIPES)) g.enabled.add(recipe.id);
g.freePower = true;

function plant(x: number, y: number, dir: number, pipes = false): [Entity, Entity] {
  clear(g, x - 8, y - 8, 24);
  const reactor = g.build('nuclear-reactor', x, y, 0, false);
  if (!reactor) throw new Error(`test fixture reactor failed to build at ${x},${y}`);
  const rp = heatPorts(reactor).find(p => p.d === dir)!;
  const hp = heatPorts({ proto: 'heat-exchanger', t: 'hexch', x: 0, y: 0, dir } as any)[0];
  const hxX = rp.x + DX[dir] - hp.x, hxY = rp.y + DY[dir] - hp.y;
  const exchanger = g.build('heat-exchanger', hxX, hxY, dir as any, false);
  if (!exchanger) throw new Error(`test fixture exchanger failed to build at ${hxX},${hxY}`);
  if (pipes) for (let dx = 5; dx < 10; dx++) {
    if (!g.build('heat-pipe', x + dx, y + 2, 0, false)) throw new Error(`test fixture pipe failed at ${x + dx},${y + 2}`);
  }
  return [reactor, exchanger];
}

function previousEdgeOrder(game: Game): string[] {
  const entities = [...game.ents.values()].filter(e => isHeatType(e.t)).sort((a, b) => a.id - b.id);
  const edges: [Entity, Entity][] = [], seen = new Set<string>();
  for (const a of entities) for (const pa of heatPorts(a)) {
    const bx = pa.x + DX[pa.d], by = pa.y + DY[pa.d];
    const b = game.entAt(bx, by);
    if (!b || b === a || b.id < a.id || !isHeatType(b.t)) continue;
    const bd = (pa.d + 2) % 4, key = `${a.id},${b.id}`;
    if (!seen.has(key) && heatPorts(b).some(p => p.x === bx && p.y === by && p.d === bd)) { seen.add(key); edges.push([a, b]); }
  }
  edges.sort((a, b) => a[0].id - b[0].id || a[1].id - b[1].id);
  return edges.map(([a, b]) => `${a.id},${b.id}`);
}

const [reactorA, exchangerA] = plant(100, 100, 0, true);
const [reactorB, exchangerB] = plant(200, 100, 1);
plant(300, 100, 2);
plant(-100, -100, 3);
const isolatedPipe = g.build('heat-pipe', 320, 320, 0, false);
if (!isolatedPipe) throw new Error('test fixture failed to build isolated pipe');
const previousReactorBId = reactorB.id;
g.ents.delete(previousReactorBId); reactorB.id = 2_000_000_000; g.ents.set(reactorB.id, reactorB);
for (let y = reactorB.y; y < reactorB.y + reactorB.h; y++) for (let x = reactorB.x; x < reactorB.x + reactorB.w; x++) g.world.setOcc(x, y, reactorB.id);
g.ents.delete(reactorA.id); g.ents.set(reactorA.id, reactorA); // force the ID-order fallback too
const graph = heatNet(g);
check(JSON.stringify(graph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'optimized edge builder preserves the former port scan and entity-id order across rotations and negative coordinates');
check(graph.edges.some(([a, b]) => (a === reactorA && b === exchangerA) || (b === reactorA && a === exchangerA))
  && graph.edges.some(([a, b]) => a.t === 'hpipe' && b.t === 'hpipe'),
  'reactor, exchanger, and pipe links remain connected');
check(graph.ents.includes(isolatedPipe) && !graph.edges.some(([a, b]) => a === isolatedPipe || b === isolatedPipe),
  'an unconnected pipe at an unknown chunk edge is present and stays isolated');

exchangerA.status = 'no-water';
exchangerB.status = 'output-full';
let edgeIterations = 0;
graph.edges = new Proxy(graph.edges, {
  get(target, key, receiver) {
    if (key === Symbol.iterator) edgeIterations++;
    return Reflect.get(target, key, receiver);
  },
});
check(reactorCause(g, reactorA) === 'теплообменникам не хватает воды', 'reactor cause uses exchangers in its own component');
check(reactorCause(g, reactorB) === 'пар не расходуется — проверьте турбины, двигатели и трубы пара', 'another reactor reads only its component status');
exchangerA.status = 'output-full';
check(reactorCause(g, reactorA) === 'пар не расходуется — проверьте турбины, двигатели и трубы пара', 'cached component membership reads live exchanger status');
exchangerA.status = 'no-heat';
check(reactorCause(g, reactorA) === 'теплообменники не прогреты — тепловая труба слишком длинная или тонкая', 'cause reflects a live no-heat status');
exchangerA.status = 'working';
check(reactorCause(g, reactorA) === 'теплообменников мало: 1 шт. не успевают отвести 0 МВт', 'working exchangers retain the fallback cause and MW interpolation');
exchangerA.status = 'no-water';
check(edgeIterations === 0, 'reactor cause does not rescan the full heat edge list');

const componentA = graph.componentById.get(reactorA.id)!;
const componentHx = graph.hexsByComponent.get(componentA)!;
let statusReads = 0;
const stableWorkingHx = Array.from({ length: 32 }, (_, id) => Object.defineProperty({ id }, 'status', {
  get() { statusReads++; return 'working'; },
}));
graph.hexsByComponent.set(componentA, stableWorkingHx as any);
const repeatedStatusCause = reactorCause(g, reactorA);
graph.hexsByComponent.set(componentA, componentHx);
check(repeatedStatusCause === 'теплообменников мало: 32 шт. не успевают отвести 0 МВт' && statusReads === stableWorkingHx.length,
  'one cause query reads each live exchanger status once');

const beforeRemoval = g._heat;
g.removeEntity(exchangerA, false);
check(g.heatDirty, 'removing an exchanger invalidates the heat graph');
let portLookups = 0;
const originalEntAt = g.entAt.bind(g);
g.entAt = (x, y) => { portLookups++; return originalEntAt(x, y); };
const removedGraph = heatNet(g);
g.entAt = originalEntAt;
check(reactorCause(g, reactorA) === 'реактор не соединён с теплообменником — проверьте тепловые трубы и порты' && removedGraph !== beforeRemoval && !g.heatDirty,
  'the next heat query updates component membership after removal');
check(portLookups === 0, 'removing a node reuses unchanged cached port connections');
check(JSON.stringify(removedGraph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'incremental removal preserves exact full-scan edge order');

const replacement = g.build('heat-exchanger', 101, 98, 0, false);
if (!replacement) throw new Error('test fixture failed to restore the exchanger');
replacement.status = 'no-water';
const beforeRestoreQuery = g._heat;
g.entAt = (x, y) => { portLookups++; return originalEntAt(x, y); };
const restoredGraph = heatNet(g);
g.entAt = originalEntAt;
check(g.heatDirty === false && reactorCause(g, reactorA) === 'теплообменникам не хватает воды' && restoredGraph !== beforeRestoreQuery,
  'the next heat query reconnects a restored exchanger');
check(portLookups <= 4, 'adding a node probes only its own heat ports');
check(JSON.stringify(restoredGraph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'incremental addition preserves exact full-scan edge order');

const oldDirection = replacement.dir;
replacement.dir = ((oldDirection + 1) % 4) as typeof replacement.dir;
g.topoChanged(replacement);
portLookups = 0;
g.entAt = (x, y) => { portLookups++; return originalEntAt(x, y); };
const rotatedGraph = heatNet(g);
g.entAt = originalEntAt;
check(portLookups <= 4 && JSON.stringify(rotatedGraph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'tracked port rotation probes only the changed node and preserves exact edge order');
replacement.dir = oldDirection;
g.topoChanged(replacement);
heatNet(g);

const transient = g.build('heat-pipe', 500, 500, 0, false);
if (!transient) throw new Error('test fixture failed to build transient heat pipe');
check(!g._heatDirtyFull && g._heatDirtyIds.has(transient.id), 'topology callbacks retain an explicit changed-node delta');
g.heatDirty = true;
check(g._heatDirtyFull && g._heatDirtyIds.size === 0, 'a direct dirty assignment discards pending deltas and forces a full rebuild');
portLookups = 0;
g.entAt = (x, y) => { portLookups++; return originalEntAt(x, y); };
const forcedFullGraph = heatNet(g);
g.entAt = originalEntAt;
check(portLookups > forcedFullGraph.ents.length, 'manual dirty fallback scans ports for the complete graph');
check(JSON.stringify(forcedFullGraph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'manual full fallback preserves exact edge order');

const oldHeatCapacity = PROTOS[replacement.proto].heatC!;
replacement.dir = ((oldDirection + 1) % 4) as typeof replacement.dir;
PROTOS[replacement.proto].heatC = oldHeatCapacity + 1;
g.heatDirty = true;
const modGraph = heatNet(g);
const replacementIndex = modGraph.ents.findIndex(e => e.id === replacement.id);
check(modGraph.caps[replacementIndex] === (oldHeatCapacity + 1) * 1e6,
  'manual full dirty observes modded heat capacity changes');
check(JSON.stringify(modGraph.edges.map(([a, b]) => `${a.id},${b.id}`)) === JSON.stringify(previousEdgeOrder(g)),
  'manual full dirty observes external port orientation changes');
PROTOS[replacement.proto].heatC = oldHeatCapacity;
replacement.dir = oldDirection;
g.heatDirty = true;
heatNet(g);

g._heat = null;
portLookups = 0;
g.entAt = (x, y) => { portLookups++; return originalEntAt(x, y); };
const deletedCacheGraph = heatNet(g);
g.entAt = originalEntAt;
check(portLookups > deletedCacheGraph.ents.length, 'a missing graph cache falls back to a full rebuild');

const warningGame = new Game(41, true, { enemies: 'none' });
for (const recipe of Object.values(RECIPES)) warningGame.enabled.add(recipe.id);
warningGame.freePower = true;
clear(warningGame, -32, -32, 24);
const warningReactor = warningGame.build('nuclear-reactor', -20, -20, 0, false);
if (!warningReactor) throw new Error('warning fixture reactor failed to build');
const warningReactorPort = heatPorts(warningReactor).find(p => p.d === 0)!;
const warningHxPort = heatPorts({ proto: 'heat-exchanger', t: 'hexch', x: 0, y: 0, dir: 0 } as any)[0];
const warningHx = warningGame.build('heat-exchanger', warningReactorPort.x + DX[0] - warningHxPort.x,
  warningReactorPort.y + DY[0] - warningHxPort.y, 0, false);
if (!warningHx) throw new Error('warning fixture exchanger failed to build');
if (!warningGame.build('heat-exchanger', 30, 30, 0, false)) throw new Error('warning fixture isolated exchanger failed to build');
warningReactor.hE = Math.floor((950 - 15) * 10e6);
warningHx.hE = 1e9;
stepHeat(warningGame);
const warningWaterCause = 'теплообменникам не хватает воды';
check(warningReactor._cause === warningWaterCause && warningReactor._why === 'Нет стержней'
  && warningGame.messages.map(m => m.text).join('|') === [
    `ОСКАР: реактор 950 °C — тревога. Вероятная причина: ${warningWaterCause}.`,
    '⚠ Реактор: 950 °C',
  ].join('|')
  && warningGame.alerts.map(a => a.text).join('|') === 'Реактор: 950 °C',
  'reactor warning preserves exact cause, _why, and first message/alert order');
warningHx.status = 'output-full';
check(reactorCause(warningGame, warningReactor) === 'пар не расходуется — проверьте турбины, двигатели и трубы пара',
  'same-tick cause reads an exchanger status change without a stale cache');
warningGame.removeEntity(warningHx, false);
warningReactor._wa = false;
stepHeat(warningGame);
const disconnectedCause = 'реактор не соединён с теплообменником — проверьте тепловые трубы и порты';
check(warningReactor._cause === disconnectedCause && warningReactor._why === 'Нет стержней'
  && warningGame.messages.map(m => m.text).join('|') === [
    `ОСКАР: реактор 950 °C — тревога. Вероятная причина: ${warningWaterCause}.`,
    '⚠ Реактор: 950 °C',
    `ОСКАР: реактор 950 °C — тревога. Вероятная причина: ${disconnectedCause}.`,
  ].join('|')
  && warningGame.messages.every(m => m.tick === 0)
  && warningGame.alerts.map(a => a.text).join('|') === 'Реактор: 950 °C|Реактор: 950 °C'
  && warningGame.alerts.every(a => a.tick === 0) && warningGame.nucEv.length === 0,
  'same-tick exchanger destruction refreshes cause while preserving ordered messages and alerts');

console.log(failed ? '✘ heat component index regressions' : '✔ heat component index regressions');
process.exit(failed ? 1 : 0);
