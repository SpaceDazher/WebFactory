import { Game } from '../integration-logs/continuation-6/baseline-src/sim/game';
import type { Entity } from '../integration-logs/continuation-6/baseline-src/sim/game';
import { bp116 } from '../integration-logs/continuation-6/baseline-src/data/bp116';
import { PROTOS } from '../integration-logs/continuation-6/baseline-src/data/entities';
import { addWire } from '../integration-logs/continuation-6/baseline-src/sim/circuits';
import { heatNet, heatTemp } from '../integration-logs/continuation-6/baseline-src/sim/heat';
import { turbineKW } from '../integration-logs/continuation-6/baseline-src/sim/networks';
import { flatten } from '../integration-logs/continuation-6/baseline-src/sim/perfworld';
import { DX, DY } from '../integration-logs/continuation-6/baseline-src/core/types';
import { T_GRASS, T_SHALLOW } from '../integration-logs/continuation-6/baseline-src/sim/world';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const acceptanceFailures: string[] = [];
const rawSamples: Record<string, { fullTickMs: number[]; heatMs: number[] }> = {};
const rawSampleFile = 'docs/validation-v116-heat-performance-samples.json';
function persistRaw() { writeFileSync(rawSampleFile, JSON.stringify(rawSamples)); }
const partialReport: Record<string, any> = { status: 'in-progress', createdAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, stages: {}, acceptanceFailures };
partialReport.rawSampleFile = rawSampleFile;
function persistPartial() { try { writeFileSync('docs/validation-v116-heat-performance.json', JSON.stringify(partialReport, null, 2) + '\n'); } catch { /* uncaught monitor preserves the original non-zero exit */ } }
function assert(ok: unknown, text: string) { if (!ok) { acceptanceFailures.push(text); partialReport.status = 'failed'; partialReport.lastError = text; persistPartial(); throw new Error(text); } }
function recordAcceptanceFailure(text: string) { if (!acceptanceFailures.includes(text)) acceptanceFailures.push(text); partialReport.status = 'failed'; partialReport.lastError = text; persistPartial(); }
process.on('uncaughtExceptionMonitor', (error) => { const message = error instanceof Error ? error.message : String(error); if (!acceptanceFailures.includes(message)) acceptanceFailures.push(message); partialReport.status = 'failed'; partialReport.lastError = message; persistPartial(); });
const setupStarted = performance.now();
const g = new Game(20261009, true, { enemies: 'none' });
g.freePower = false;
const entry = bp116()[1], moduleRows = 5, moduleCols = 5, moduleX = 140, moduleY = 0;
const pitchX = entry.bp.w + 4, pitchY = entry.bp.h + 4;
const fixtureMaxX = moduleX + (moduleCols - 1) * pitchX + entry.bp.w;
const fixtureMaxY = moduleY + (moduleRows - 1) * pitchY + entry.bp.h;
partialReport.hotFixture = { status: 'building', worldBounds: { minX: -40, minY: -40, maxXExclusive: fixtureMaxX + 60, maxYExclusive: fixtureMaxY + 60 }, plannedModules: moduleRows * moduleCols, plannedReactors: 100, plannedCorePipes: 10000, plannedHeatExchangers: 1000, plannedTurbines: 2000 };
persistPartial();
flatten(g, -40, -40, fixtureMaxX + 100, fixtureMaxY + 100);
g.batchBuild = true;
const built: Entity[] = [];
const B = (p: string, x: number, y: number, d = 0) => { const e = g.build(p, x, y, d as any, false); if (!e) throw new Error(`placement failed: ${p} at ${x},${y}`); built.push(e); return e; };
const corePipes: Entity[] = [];
for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) corePipes.push(B('heat-pipe', x, y));
const corePipeIds = new Set(corePipes.map(e => e.id));
const moduleIds: Entity[][] = [];
for (let row = 0; row < moduleRows; row++) for (let col = 0; col < moduleCols; col++) {
  const ox = moduleX + col * pitchX, oy = moduleY + row * pitchY, ids: Entity[] = [];
  for (const b of entry.bp.entities) { const e = B(b.p, ox + b.x, oy + b.y, b.d); ids.push(e); }
  for (const w of entry.bp.wires || []) { const q = addWire(g, ids[w[0]].id, ids[w[1]].id, w[2], w[3] || 0, w[4] || 0); assert(q === 'ok', `blueprint wire ${w[0]}-${w[1]}: ${q}`); }
  entry.bp.entities.forEach((b, i) => { if (b.cc) g.enqueue({ t: 'cset', id: ids[i].id, cc: b.cc } as any); });
  moduleIds.push(ids);
}
g.batchBuild = false;
g.dirtyFluid = true; g.dirtyPower = true; g.step();
g.batchBuild = true;
for (let mi = 0; mi < moduleIds.length; mi++) {
  const live = moduleIds[mi].filter(e => g.ents.has(e.id));
  const hx = live.filter(e => e.proto === 'heat-exchanger'), byWater = new Map<number, Entity[]>();
  for (const e of hx) { const n = e._fn?.[0]; if (n == null || n < 0) throw new Error(`module ${mi} HX ${e.id} has no water network`); const a = byWater.get(n); if (a) a.push(e); else byWater.set(n, [e]); }
  assert(byWater.size === 4 && [...byWater.values()].every(a => a.length === 12), `module ${mi} expected four 12-HX water manifolds: ${[...byWater.values()].map(a => a.length).join('/')}`);
  for (const a of byWater.values()) for (const e of a.slice(10)) g.removeEntity(e, false);
  const turbines = live.filter(e => e.proto === 'steam-turbine'), bySteam = new Map<number, Entity[]>();
  for (const e of turbines) { const n = e._fn?.[0]; if (n == null || n < 0) throw new Error(`module ${mi} turbine ${e.id} has no steam network`); const a = bySteam.get(n); if (a) a.push(e); else bySteam.set(n, [e]); }
  assert(turbines.length === 84 && bySteam.size > 0, `module ${mi} turbine network setup is incomplete`);
  let remove = 4;
  const steamGroups = [...bySteam.values()].sort((a, b) => a.length - b.length);
  while (remove > 0) {
    const group = steamGroups.find(a => a.length > 1);
    if (!group) throw new Error(`module ${mi} cannot trim four turbines while preserving steam networks`);
    g.removeEntity(group.pop()!, false); remove--;
  }
}
g.batchBuild = false; g.dirtyFluid = true; g.dirtyPower = true; g.heatDirty = true; g.step();
const stationIds = moduleIds.flatMap(a => a.filter(e => g.ents.has(e.id)));
for (let mi = 0; mi < moduleIds.length; mi++) {
  const live = moduleIds[mi].filter(e => g.ents.has(e.id));
  assert(live.filter(e => e.t === 'reactor').length === 4 && live.filter(e => e.proto === 'heat-exchanger').length === 40 && live.filter(e => e.proto === 'steam-turbine').length === 80, `module ${mi} final counts mismatch`);
}
assert(stationIds.filter(e => e.t === 'reactor').length === 100 && stationIds.filter(e => e.proto === 'heat-exchanger').length === 1000 && stationIds.filter(e => e.proto === 'steam-turbine').length === 2000, '25-module count mismatch');
const radars: Entity[] = [], radarPlaces = new Set<string>();
const stationHX = stationIds.filter(e => e.proto === 'heat-exchanger');
let waterNets = [...new Set(stationHX.map(e => e._fn?.[0]).filter((n): n is number => n != null && n >= 0))];
assert(waterNets.length === 100, `expected 100 pump-fed water networks (four per module), got ${waterNets.length}`);
let pumpCount = 0;
g.batchBuild = true;
for (const netId of waterNets) {
  const pipes = [...g.ents.values()].filter(e => e.proto === 'pipe' && e._fn?.[0] === netId);
  for (let pumpIndex = 0; pumpIndex < 2; pumpIndex++) {
    let installed = false;
    for (const p of pipes) for (let d = 0; d < 4 && !installed; d++) {
      const px = p.x - DX[d], py = p.y - DY[d], wx = px - DX[d], wy = py - DY[d];
      if (g.world.occ(px, py) >= 0 || g.world.occ(wx, wy) >= 0 || g.world.terrain(px, py) >= T_SHALLOW) continue;
      const pc = g.world.chunkAt(px, py), pi = g.world.idx(px, py), wc = g.world.chunkAt(wx, wy), wi = g.world.idx(wx, wy);
      pc.terrain[pi] = T_GRASS; wc.terrain[wi] = T_SHALLOW;
      if (pc.decor[pi]) g.world.removeDecor(px, py); if (wc.decor[wi]) g.world.removeDecor(wx, wy);
      if (!g.canPlace('offshore-pump', px, py, d as any, false).ok) { wc.terrain[wi] = T_GRASS; continue; }
      if (g.build('offshore-pump', px, py, d as any, false)) { pumpCount++; installed = true; }
      else wc.terrain[wi] = T_GRASS;
    }
    assert(installed, `failed real offshore pump ${pumpIndex + 1}/2 for water network ${netId}`);
  }
}
g.batchBuild = false; g.dirtyFluid = true; g.dirtyPower = true; g.step();
waterNets = [...new Set(stationHX.map(e => e._fn?.[0]).filter((n): n is number => n != null && n >= 0))];
assert(waterNets.length === 100, `pump connection changed the 100 water networks to ${waterNets.length}`);
const water = waterNets.map(i => g.fluidNets[i]);
assert(pumpCount === 200 && water.every(n => n && !n.conflict && n.fluid === 'water' && n.amount > 0), 'real pumps did not supply all 100 station HX water networks');
const generatorNetIds = [...new Set(stationIds.filter(e => e.proto === 'steam-turbine').map(e => e._net).filter((n): n is number => n != null && n >= 0))].sort((a, b) => a - b);
assert(generatorNetIds.length > 0 && generatorNetIds.length <= 100 && stationIds.filter(e => e.proto === 'steam-turbine').every(e => e._net != null && e._net >= 0), `invalid turbine power networks: ${generatorNetIds.length}`);
const radarCandidate = (netId: number) => {
  const net = g.powerNets.get(netId); if (!net) return null;
  const poles = [...g.ents.values()].filter(e => e.t === 'pole'), radarProto = PROTOS.radar;
  const coversRadar = (pole: Entity, x: number, y: number) => {
    const s = PROTOS[pole.proto].supply || 0;
    return x <= pole.x + pole.w - 1 + s && x + radarProto.w - 1 >= pole.x - s && y <= pole.y + pole.h - 1 + s && y + radarProto.h - 1 >= pole.y - s;
  };
  for (const id of net.poles) {
    const p = g.ents.get(id); if (!p || p.t !== 'pole') continue;
    const supply = PROTOS[p.proto].supply || 0;
    const minX = p.x - supply - radarProto.w + 1, maxX = p.x + p.w - 1 + supply;
    const minY = p.y - supply - radarProto.h + 1, maxY = p.y + p.h - 1 + supply;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`; if (radarPlaces.has(key) || !g.canPlace('radar', x, y, 0, false).ok) continue;
      const firstCoveringPole = poles.find(q => coversRadar(q, x, y));
      if (firstCoveringPole?._net === netId) return { x, y, key };
    }
  }
  return null;
};
g.batchBuild = true;
for (const netId of generatorNetIds) {
  const spot = radarCandidate(netId); assert(!!spot, `no real radar load slot for turbine power net ${netId}`);
  radars.push(B('radar', spot!.x, spot!.y)); radarPlaces.add(spot!.key);
}
while (radars.length < 100) {
  let added = false;
  for (const netId of generatorNetIds) {
    if (radars.length >= 100) break;
    const spot = radarCandidate(netId); if (!spot) continue;
    radars.push(B('radar', spot.x, spot.y)); radarPlaces.add(spot.key); added = true;
  }
  if (!added) throw new Error(`cannot place 100 real radar loads across turbine networks; placed ${radars.length}`);
}
g.batchBuild = false; g.dirtyPower = true; g.step();
assert(radars.length === 100 && radars.every(e => e._net != null && generatorNetIds.includes(e._net)), `radar loads are not attached to turbine power networks: ${radars.filter(e => e._net != null && generatorNetIds.includes(e._net)).length}/100`);
const thermal = heatNet(g);
const counts = { reactors: [...g.ents.values()].filter(e => e.t === 'reactor').length, heatPipes: [...g.ents.values()].filter(e => e.t === 'hpipe').length, heatExchangers: [...g.ents.values()].filter(e => e.proto === 'heat-exchanger').length, turbines: [...g.ents.values()].filter(e => e.proto === 'steam-turbine').length };
assert(counts.reactors === 100 && counts.heatPipes >= 10000 && counts.heatExchangers === 1000 && counts.turbines === 2000, `stress counts mismatch: ${JSON.stringify(counts)}`);
const coreEdges = thermal.edges.filter(([a,b]) => corePipeIds.has(a.id) && corePipeIds.has(b.id)).length;
assert(corePipes.length === 10000 && coreEdges === 19800, `100×100 core-grid topology mismatch: ${coreEdges} edges`);
const heatConnectedIds = new Set<number>(); for (const [a, b] of thermal.edges) { heatConnectedIds.add(a.id); heatConnectedIds.add(b.id); }
const connectedHX = stationHX.filter(e => heatConnectedIds.has(e.id)).length;
assert(connectedHX === 1000, `only ${connectedHX}/1000 station HX are connected to heat`);
const fixtureBuildSeconds = (performance.now() - setupStarted) / 1000;
for (const e of thermal.ents) if (e.hE !== undefined) e.hE = Math.floor((550 - 15) * PROTOS[e.proto].heatC! * 1e6);
for (const r of stationIds.filter(e => e.t === 'reactor')) { r.rgo = true; r.input!['nuclear-fuel-cell'] = 1; }
const hxEver = new Set<number>();
const turbinesEver = new Set<number>();
for (let i = 0; i < 300; i++) {
  g.step();
  for (const e of stationHX) if ((e._hx || 0) > 0) hxEver.add(e.id);
  for (const e of stationIds) if (e.proto === 'steam-turbine' && (e._out || 0) > 0) turbinesEver.add(e.id);
}
const steam = g.fluidNets.filter(n => n?.fluid === 'steam').reduce((s,n) => s + n.amount, 0);
const waterFedHX = stationHX.filter(e => { const n = e._fn?.[0]; const f = n == null || n < 0 ? undefined : g.fluidNets[n]; return !!f && !f.conflict && f.fluid === 'water' && f.amount > 0; }).length;
const steamFedHX = stationHX.filter(e => { const n = e._fn?.[1]; const f = n == null || n < 0 ? undefined : g.fluidNets[n]; return !!f && !f.conflict && f.fluid === 'steam' && f.amount > 0; }).length;
const steamFedTurbines = stationIds.filter(e => e.proto === 'steam-turbine' && (() => { const n = e._fn?.[0]; const f = n == null || n < 0 ? undefined : g.fluidNets[n]; return !!f && !f.conflict && f.fluid === 'steam' && f.amount > 0; })()).length;
const activeRadars = radars.filter(e => e.active).length;
const poweredTurbines = stationIds.filter(e => e.proto === 'steam-turbine' && (e._out || 0) > 0).length;
const radarNetIds = new Set(radars.map(e => e._net).filter(n => n != null && n >= 0));
const powerNetworks = [...g.powerNets.values()].filter(n => radarNetIds.has(n.id)).map(n => ({ id: n.id, radars: radars.filter(e => e._net === n.id).length, activeRadars: radars.filter(e => e._net === n.id && e.active).length, demandKW: n.demand, supplyKW: n.supply, satisfaction: n.satisfaction, poles: n.poles.length, steamKW: n.steam }));
const unpoweredRadars = radars.filter(e => e._net == null || e._net < 0).map(e => ({ x: e.x, y: e.y, net: e._net }));
const report = { createdAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, ticks: g.tick, initialFixtureTemperatureC: 550, noBoom: g.settings.noBoom, counts, hotWorld: { bounds: { minX: -40, minY: -40, maxXExclusive: fixtureMaxX + 60, maxYExclusive: fixtureMaxY + 60 }, chunks: g.world.chunks.size, setupSeconds: fixtureBuildSeconds }, coreGrid: { rows: 100, columns: 100, pipes: corePipes.length, internalEdges: 19800 }, thermalNodes: thermal.ents.length, heatEdges: thermal.edges.length, heatConnectedExchangers: connectedHX, station: { modules: moduleIds.length, blueprint: entry.id, reactors: stationIds.filter(e => e.t === 'reactor').length, heatPipes: stationIds.filter(e => e.proto === 'heat-pipe').length, exchangers: stationHX.length, pumpFedHX: waterFedHX, steamFedHX, hxThatWorkedDuringPreflight: hxEver.size, turbines: stationIds.filter(e => e.proto === 'steam-turbine').length, steamFedTurbines, poweredTurbines, turbinesWithPositiveOutputDuringPreflight: turbinesEver.size, offshorePumps: pumpCount, waterNetworks: water.map(n => ({ amount: n!.amount, capacity: n!.cap })) }, load: { radars: radars.length, activeRadars, turbineKW: turbineKW(), steamAmount: steam, steamJ: g.nuc.st.steamJ || 0, powerNetworks, unpoweredRadars }, maxReactorC: Math.max(...[...g.ents.values()].filter(e => e.t === 'reactor').map(heatTemp)), booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length, elapsed: 'preflight-only; no latency measurements' };
partialReport.preflight = report; partialReport.setupSeconds = fixtureBuildSeconds; partialReport.hotWorldBounds = report.hotWorld.bounds; partialReport.hotWorldChunks = report.hotWorld.chunks;
writeFileSync('docs/validation-v116-heat-preflight.json', JSON.stringify(report, null, 2) + '\n');
persistPartial();
console.log(JSON.stringify(report));
assert(pumpCount === 200 && waterFedHX === 1000 && steamFedHX === 1000 && steamFedTurbines === 2000 && steam > 0 && (g.nuc.st.steamJ || 0) > 0 && hxEver.size === 1000, `full station did not circulate real water/steam through every HX/turbine: pumps=${pumpCount}, waterHX=${waterFedHX}, steamHX=${steamFedHX}, steamTurbines=${steamFedTurbines}, hxWorked=${hxEver.size}, steam=${steam}`);
assert((g.nuc.st.boom || 0) === 0 && g.nuc.zones.length === 0, 'unexpected accident in 300-tick 550°C preflight');
assert(activeRadars === 100 && turbineKW() >= 30000 && poweredTurbines === 2000 && turbinesEver.size === 2000, `actual full-count load not powered: radars ${activeRadars}/100, turbines=${poweredTurbines}/2000 (ever ${turbinesEver.size}/2000), output ${turbineKW()} kW`);
if (process.env.V116_HEAT_PREFLIGHT_ONLY === '1') {
  partialReport.status = 'preflight-passed'; partialReport.acceptanceFailures = acceptanceFailures; partialReport.result = report; persistPartial();
  process.exit(0);
}

const quantiles = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.max(0, Math.ceil(s.length * p) - 1)];
  return { samples: s.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: s.at(-1) };
};
const watched = new WeakMap<Game, number[]>();
function watchHeat(game: Game) {
  const samples: number[] = [], original = game.prof.add.bind(game.prof);
  game.prof.add = ((sub: string, ms: number) => { if (sub === 'heat') samples.push(ms); original(sub as any, ms); }) as typeof game.prof.add;
  watched.set(game, samples);
  return samples;
}
function sampleStage(game: Game, heatSamples: number[], name: string, warmTicks: number, measuredTicks: number) {
  const tickTimes: number[] = [], startTick = game.tick;
  let heatStart = heatSamples.length;
  let warmCompleted = 0, measuredCompleted = 0;
  try {
    for (; warmCompleted < warmTicks; warmCompleted++) game.step();
    heatStart = heatSamples.length;
    for (; measuredCompleted < measuredTicks; measuredCompleted++) { const t0 = performance.now(); game.step(); tickTimes.push(performance.now() - t0); }
  } finally {
    const q = (values: number[]) => values.length ? quantiles(values) : null;
    const result = { name, warmTicksRequested: warmTicks, warmTicksCompleted: warmCompleted, measuredTicksRequested: measuredTicks, measuredTicksCompleted: measuredCompleted, startTick, endTick: game.tick, fullTick: q(tickTimes), heat: q(heatSamples.slice(heatStart)) };
    rawSamples[name] = { fullTickMs: tickTimes, heatMs: heatSamples.slice(heatStart) }; persistRaw();
    partialReport.stages[name] = result; partialReport.lastCompletedTick = game.tick; persistPartial();
  }
  return partialReport.stages[name];
}
function gatePerformanceBudget(name: string, stage: any) {
  if (!(Number.isFinite(stage?.fullTick?.p95Ms) && stage.fullTick.p95Ms <= 16.67)) recordAcceptanceFailure(`${name} full-tick p95 exceeds 16.67 ms: ${stage?.fullTick?.p95Ms}`);
  if (!(Number.isFinite(stage?.heat?.p95Ms) && stage.heat.p95Ms <= 2)) recordAcceptanceFailure(`${name} heat p95 exceeds 2 ms: ${stage?.heat?.p95Ms}`);
}
function timedStep(game: Game, heatSamples: number[]) {
  const t0 = performance.now(), before = heatSamples.length; game.step();
  return { fullTickMs: performance.now() - t0, heatMs: heatSamples[before] };
}

const heatSamples = watchHeat(g);
const hotWorking = sampleStage(g, heatSamples, 'hot-working', 300, 1800);
gatePerformanceBudget('hot-working', hotWorking);
const hotTurbineKW = turbineKW(), hotDemandKW = [...g.powerNets.values()].reduce((s, n) => s + n.demand, 0);
assert((g.nuc.st.boom || 0) === 0 && g.nuc.zones.length === 0, 'hot-working measurement caused an accident');
const maxHotC = Math.max(...[...g.ents.values()].filter(e => e.t === 'reactor').map(heatTemp));
const hotActiveReactors = [...g.ents.values()].filter(e => e.t === 'reactor' && (e.rt || 0) > 0).length;
for (const r of [...g.ents.values()].filter(e => e.t === 'reactor')) g.enqueue({ t: 'reactor', id: r.id, op: 'stop', on: true } as any);
const stoppedPotentialBeforeCooling = g.nuc.st.stoppedPotentialJ || 0;
const cooling = sampleStage(g, heatSamples, 'cooling-after-real-emergency-stop', 300, 1800);
gatePerformanceBudget('cooling-after-real-emergency-stop', cooling);
const remainingRodsAfterStop = [...g.ents.values()].filter(e => e.t === 'reactor' && (e.rt || 0) > 0).length;
const maxCoolingC = Math.max(...[...g.ents.values()].filter(e => e.t === 'reactor').map(heatTemp));
assert(remainingRodsAfterStop === 0, `emergency-stop cooling left ${remainingRodsAfterStop} active rods`);
assert((g.nuc.st.boom || 0) === 0 && g.nuc.zones.length === 0, 'cooling measurement caused an accident');

// Rebuild the real 100×100 core graph by removing/restoring a full center
// column through Game.removeEntity/build; each timed Game.step performs the
// normal lazy heatNet rebuild, while edge counts verify a genuine split/merge.
const graphSamples = { splitFullTick: [] as number[], splitHeat: [] as number[], mergeFullTick: [] as number[], mergeHeat: [] as number[] };
const heatBeforeGraphChanges = heatNet(g).edges.length;
const heatSamplesBeforeGraphChanges = heatSamples.length;
for (let cycle = 0; cycle < 30; cycle++) {
  g.batchBuild = true;
  const centerColumn = [...g.ents.values()].filter(e => e.proto === 'heat-pipe' && e.x === 49 && e.y >= 0 && e.y < 100);
  assert(centerColumn.length === 100, `split cycle ${cycle} found ${centerColumn.length}/100 center-column pipes`);
  for (const p of centerColumn) g.removeEntity(p, false);
  g.batchBuild = false;
  const split = timedStep(g, heatSamples); graphSamples.splitFullTick.push(split.fullTickMs); graphSamples.splitHeat.push(split.heatMs);
  assert(heatNet(g).edges.length === heatBeforeGraphChanges - 299, `split cycle ${cycle} did not remove the expected 299 heat edges`);
  g.batchBuild = true;
  for (let y = 0; y < 100; y++) B('heat-pipe', 49, y);
  g.batchBuild = false;
  const merge = timedStep(g, heatSamples); graphSamples.mergeFullTick.push(merge.fullTickMs); graphSamples.mergeHeat.push(merge.heatMs);
  assert(heatNet(g).edges.length === heatBeforeGraphChanges, `merge cycle ${cycle} did not restore all ${heatBeforeGraphChanges} heat edges`);
  partialReport.graphRebuildProgress = { cyclesCompleted: cycle + 1, heatEdgesBaseline: heatBeforeGraphChanges, splitFullTick: quantiles(graphSamples.splitFullTick), splitHeat: quantiles(graphSamples.splitHeat), mergeFullTick: quantiles(graphSamples.mergeFullTick), mergeHeat: quantiles(graphSamples.mergeHeat) }; persistPartial();
}
gatePerformanceBudget('split-graph-rebuild', { fullTick: quantiles(graphSamples.splitFullTick), heat: quantiles(graphSamples.splitHeat) });
gatePerformanceBudget('merge-graph-rebuild', { fullTick: quantiles(graphSamples.mergeFullTick), heat: quantiles(graphSamples.mergeHeat) });
const graphHeat = heatSamples.slice(heatSamplesBeforeGraphChanges);
rawSamples['split-graph-rebuild'] = { fullTickMs: graphSamples.splitFullTick, heatMs: graphSamples.splitHeat };
rawSamples['merge-graph-rebuild'] = { fullTickMs: graphSamples.mergeFullTick, heatMs: graphSamples.mergeHeat }; persistRaw();

// A second, exactly-counted ambient fixture isolates every thermal entity.
const coldSetupStarted = performance.now();
const cold = new Game(20261010, true, { enemies: 'none' }); cold.freePower = false;
partialReport.coldFixture = { status: 'building', worldBounds: { minX: -10, minY: -10, maxXExclusive: 670, maxYExclusive: 660 }, plannedChunks: 484, plannedHeatPipes: 13096, plannedReactors: 100, plannedHeatExchangers: 1000, plannedTurbines: 2000 }; persistPartial();
flatten(cold, -10, -10, 680, 670); cold.batchBuild = true;
const coldBuild = (proto: string, x: number, y: number) => { const e = cold.build(proto, x, y, 0, false); if (!e) throw new Error(`cold fixture placement failed: ${proto} at ${x},${y}`); return e; };
for (let i = 0; i < 10000; i++) coldBuild('heat-pipe', 2 * (i % 100), 2 * Math.floor(i / 100));
for (let i = 0; i < 3080; i++) coldBuild('heat-pipe', 240 + 2 * (i % 56), 2 * Math.floor(i / 56));
for (let i = 0; i < 16; i++) coldBuild('heat-pipe', 360 + 2 * i, 0);
for (let i = 0; i < 100; i++) coldBuild('nuclear-reactor', 500 + 6 * (i % 20), 6 * Math.floor(i / 20));
for (let i = 0; i < 1000; i++) coldBuild('heat-exchanger', 500 + 4 * (i % 40), 200 + 3 * Math.floor(i / 40));
for (let i = 0; i < 2000; i++) coldBuild('steam-turbine', 0 + 4 * (i % 40), 350 + 6 * Math.floor(i / 40));
cold.batchBuild = false; cold.step();
const coldCounts = { reactors: [...cold.ents.values()].filter(e => e.t === 'reactor').length, heatPipes: [...cold.ents.values()].filter(e => e.t === 'hpipe').length, heatExchangers: [...cold.ents.values()].filter(e => e.t === 'hexch').length, turbines: [...cold.ents.values()].filter(e => e.proto === 'steam-turbine').length };
const coldNet = heatNet(cold), coldTemps = coldNet.ents.map(heatTemp);
const coldBuildSeconds = (performance.now() - coldSetupStarted) / 1000;
assert(coldCounts.reactors === 100 && coldCounts.heatPipes === 13096 && coldCounts.heatExchangers === 1000 && coldCounts.turbines === 2000, `cold stress counts mismatch: ${JSON.stringify(coldCounts)}`);
assert(coldNet.ents.length === 14196 && coldNet.edges.length === 0, `cold fixture is not fully isolated: ${coldNet.ents.length} thermal nodes, ${coldNet.edges.length} edges`);
assert(coldTemps.every(t => t === 15), `cold fixture is not ambient: min=${Math.min(...coldTemps)}, max=${Math.max(...coldTemps)}`);
const coldHeatSamples = watchHeat(cold);
const coldIsolated = sampleStage(cold, coldHeatSamples, 'cold-isolated', 300, 1800);
gatePerformanceBudget('cold-isolated', coldIsolated);
partialReport.coldFixture = { status: 'built', worldBounds: { minX: -10, minY: -10, maxXExclusive: 670, maxYExclusive: 660 }, chunks: cold.world.chunks.size, buildSeconds: coldBuildSeconds, counts: coldCounts, thermalNodes: coldNet.ents.length, heatEdges: coldNet.edges.length }; persistPartial();

// Initialize all surviving thermal nodes at 1100°C for the terminal mass-accident
// fixture. A cold connected neighbour must not invalidate the 600-hot-tick setup.
const stationThermal = heatNet(g).ents;
const stationReactors = stationThermal.filter(e => e.t === 'reactor');
assert(stationReactors.length === 100 && stationThermal.every(e => g.ents.has(e.id)), '100-reactor accident fixture is incomplete');
assert(stationReactors.every(r => !r.ot), 'accident fixture must start with no accumulated overheat timer');
for (const e of stationThermal) e.hE = Math.floor((1100 - 15) * PROTOS[e.proto].heatC! * 1e6);
assert(!g.settings.noBoom, 'group accident stage requires real accidents enabled (false or omitted)');
const accidentSamples: number[] = [];
const accidentHeatSamples: number[] = [];
let firstBoom = null as { step: number; fullTickMs: number; heatMs: number } | null;
for (let step = 1; step <= 650 && !(g.nuc.st.boom || 0); step++) {
  const sample = timedStep(g, heatSamples); accidentSamples.push(sample.fullTickMs); if (Number.isFinite(sample.heatMs)) accidentHeatSamples.push(sample.heatMs!);
  if ((g.nuc.st.boom || 0) > 0) firstBoom = { step, fullTickMs: sample.fullTickMs, heatMs: sample.heatMs };
}
const groupAccidentStage = { fullTick: quantiles(accidentSamples), heat: quantiles(accidentHeatSamples) };
rawSamples['group-accident'] = { fullTickMs: accidentSamples, heatMs: accidentHeatSamples }; persistRaw();
partialReport.groupAccidentProgress = { target: 'all 100 reactors and surviving thermal nodes initialized at 1100°C', firstBoom, stepsRun: accidentSamples.length, ...groupAccidentStage, booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length }; persistPartial();
assert(firstBoom && firstBoom.step === 600 && (g.nuc.st.boom || 0) >= 4 && g.nuc.zones.length >= 4, `real mass accident did not occur at 600 hot ticks: ${JSON.stringify({ firstBoom, booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length })}`);
gatePerformanceBudget('group-accident', groupAccidentStage);
const performanceReport = {
  createdAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
  instrument: 'per-step performance.now() around Game.step; per-tick heat interval captured from the existing Profiler.add call; 300 warmup + 1800 measured ticks per steady stage',
  hotFixture: { counts, initialTemperatureC: 550, worldBounds: { minX: -40, minY: -40, maxXExclusive: fixtureMaxX + 60, maxYExclusive: fixtureMaxY + 60 }, worldChunks: g.world.chunks.size, setupSeconds: fixtureBuildSeconds, coreGrid: { pipes: 10000, internalEdges: coreEdges }, thermalNodes: thermal.ents.length, hotEdges: heatBeforeGraphChanges, station: { modules: moduleIds.length, blueprint: entry.id, reactors: stationIds.filter(e => e.t === 'reactor').length, heatPipes: stationIds.filter(e => e.proto === 'heat-pipe').length, exchangers: stationHX.length, pumpFedHX: waterFedHX, steamFedHX, hxThatWorkedDuringPreflight: hxEver.size, turbines: stationIds.filter(e => e.proto === 'steam-turbine').length, steamFedTurbines, poweredTurbines, turbinesWithPositiveOutputDuringPreflight: turbinesEver.size, offshorePumps: pumpCount, waterNetworks: water.map(n => ({ amount: n!.amount, capacity: n!.cap })) }, actualLoad: { radars: radars.length, activeRadars, turbineKW: hotTurbineKW, demandKW: hotDemandKW } },
  hotState: { maxReactorC: maxHotC, activeReactors: hotActiveReactors, noBoom: g.settings.noBoom, booms: 0, zones: 0 },
  stages: { hotWorking, cooling, coldIsolated },
  coolingState: { maxReactorC: maxCoolingC, remainingRods: remainingRodsAfterStop, stoppedPotentialJ: (g.nuc.st.stoppedPotentialJ || 0) - stoppedPotentialBeforeCooling, boomsBeforeAccident: 0 },
  graphRebuild: { cycles: 30, heatEdgesBaseline: heatBeforeGraphChanges, splitExpectedEdges: heatBeforeGraphChanges - 299, splitFullTick: quantiles(graphSamples.splitFullTick), splitHeat: quantiles(graphSamples.splitHeat), mergeFullTick: quantiles(graphSamples.mergeFullTick), mergeHeat: quantiles(graphSamples.mergeHeat), combinedHeat: quantiles(graphHeat) },
  coldFixture: { worldBounds: { minX: -10, minY: -10, maxXExclusive: 670, maxYExclusive: 660 }, worldChunks: cold.world.chunks.size, buildSeconds: coldBuildSeconds, counts: coldCounts, thermalNodes: coldNet.ents.length, heatEdges: coldNet.edges.length, temperatureC: { min: Math.min(...coldTemps), max: Math.max(...coldTemps) } },
  groupAccident: { target: 'all 100 reactors and thermal nodes initialized at 1100°C; accidents enabled', firstBoom, booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length, stepsRun: accidentSamples.length, fullTick: quantiles(accidentSamples), heat: quantiles(accidentHeatSamples) },
};
partialReport.status = acceptanceFailures.length ? 'failed' : 'passed'; partialReport.acceptanceFailures = acceptanceFailures; partialReport.result = performanceReport; persistPartial();
console.log(JSON.stringify(partialReport));
if (acceptanceFailures.length) process.exitCode = 1;
