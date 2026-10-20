import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { bp116 } from '../src/data/bp116';
import { PROTOS } from '../src/data/entities';
import { addWire } from '../src/sim/circuits';
import { heatNet, heatTemp } from '../src/sim/heat';
import { turbineKW } from '../src/sim/networks';
import { flatten } from '../src/sim/perfworld';
import { DX, DY } from '../src/core/types';
import { T_GRASS, T_SHALLOW } from '../src/sim/world';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

function assert(ok: unknown, text: string) { if (!ok) throw new Error(text); }
const g = new Game(20261009, true, { enemies: 'none' });
g.freePower = false;
flatten(g, -40, -40, 1300, 1050);
g.batchBuild = true;
const built: Entity[] = [];
const B = (p: string, x: number, y: number, d = 0) => { const e = g.build(p, x, y, d as any, false); if (!e) throw new Error(`placement failed: ${p} at ${x},${y}`); built.push(e); return e; };
const corePipes: Entity[] = [];
for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) corePipes.push(B('heat-pipe', x, y));
const gridReactors: Entity[] = [];
for (let col = 0; col < 5; col++) for (let row = 0; row < (col === 4 ? 16 : 20); row++) gridReactors.push(B('nuclear-reactor', -5 * (col + 1), 5 * row));
const fillerHX: Entity[] = [];
for (let row = 0; row < 24; row++) {
  const n = row < 23 ? 40 : 32, y = 6 * row;
  for (let col = 0; col < n; col++) fillerHX.push(B('heat-exchanger', 110 + 3 * col, y));
  const right = 110 + 3 * (n - 1) + 2;
  for (let x = 110; x <= right; x++) B('heat-pipe', x, y + 2);
}
for (let y = 2; y <= 140; y++) B('heat-pipe', 109, y);
for (let x = 100; x <= 108; x++) B('heat-pipe', x, 2);
const fillerTurbines: Entity[] = [];
for (let row = 0; row < 43; row++) for (let col = 0; col < 44; col++) fillerTurbines.push(B('steam-turbine', 300 + 3 * col, 5 * row));
for (let col = 0; col < 24; col++) fillerTurbines.push(B('steam-turbine', 300 + 3 * col, 215));
assert(gridReactors.length === 96 && fillerHX.length === 952 && fillerTurbines.length === 1916, 'fixture arithmetic mismatch');
const entry = bp116()[1], ox = 650, oy = 400, stationIds: Entity[] = [];
for (const b of entry.bp.entities) { const e = B(b.p, ox + b.x, oy + b.y, b.d); stationIds.push(e); }
for (const w of entry.bp.wires || []) { const q = addWire(g, stationIds[w[0]].id, stationIds[w[1]].id, w[2], w[3] || 0, w[4] || 0); assert(q === 'ok', `blueprint wire ${w[0]}-${w[1]}: ${q}`); }
entry.bp.entities.forEach((b, i) => { if (b.cc) g.enqueue({ t: 'cset', id: stationIds[i].id, cc: b.cc } as any); });
const substations = stationIds.filter(e => e.proto === 'substation');
const radars: Entity[] = [], radarPlaces = new Set<string>();
for (const s of substations) {
  for (let dy = -12; dy <= 12 && radars.length < 100; dy += 3) for (let dx = -12; dx <= 12 && radars.length < 100; dx += 3) {
    const x = s.x + dx, y = s.y + dy, key = `${x},${y}`;
    if (radarPlaces.has(key) || Math.hypot(dx + 0.5, dy + 0.5) > 17) continue;
    if (g.canPlace('radar', x, y, 0, false).ok) { const e = B('radar', x, y); radars.push(e); radarPlaces.add(key); }
  }
}
assert(radars.length === 100, `only found ${radars.length}/100 radar load placements`);
g.batchBuild = false;
g.step();
// Remove only unpowered radar placements, then extend the real generator-fed
// pole network into free ground with substations and rebuild those radar loads
// there. This keeps the final load exactly 100 real, powered radar entities.
for (let i = radars.length - 1; i >= 0; i--) if (radars[i]._net == null || radars[i]._net < 0) { g.removeEntity(radars[i], false); radarPlaces.delete(`${radars[i].x},${radars[i].y}`); radars.splice(i, 1); }
const generatorNetIds = new Set(stationIds.filter(e => e.proto === 'steam-turbine').map(e => e._net).filter(n => n != null && n >= 0));
const connectedPoles = [...g.ents.values()].filter(e => e.t === 'pole' && e._net != null && generatorNetIds.has(e._net));
let feederExtensions = 0;
let wireReachPositions = 0, placeableSubstationPositions = 0, freeRadarSlots = 0;
g.batchBuild = true;
while (radars.length < 100) {
  const candidates = new Map<string, { x: number; y: number; radars: [number, number][] }>();
  for (const p of connectedPoles) {
    const reach = Math.min(PROTOS[p.proto].wire!, PROTOS.substation.wire!);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (let sy = Math.floor(cy - reach); sy <= Math.ceil(cy + reach); sy++) for (let sx = Math.floor(cx - reach); sx <= Math.ceil(cx + reach); sx++) {
      const key = `${sx},${sy}`; if (candidates.has(key) || Math.hypot(sx + 1 - cx, sy + 1 - cy) > reach) continue;
      wireReachPositions++;
      if (!g.canPlace('substation', sx, sy, 0, false).ok) continue;
      placeableSubstationPositions++;
      const slots: [number, number][] = [];
      for (let ry = sy - 8; ry <= sy + 8; ry++) for (let rx = sx - 8; rx <= sx + 8; rx++) {
        if (rx < sx - 8 || rx + 2 > sx + 9 || ry < sy - 8 || ry + 2 > sy + 9) continue;
        if (rx < sx + 2 && rx + 2 > sx && ry < sy + 2 && ry + 2 > sy) continue;
        if (g.canPlace('radar', rx, ry, 0, false).ok) slots.push([rx, ry]);
      }
      freeRadarSlots += slots.length;
      if (slots.length >= 1) candidates.set(key, { x: sx, y: sy, radars: slots });
    }
  }
  const best = [...candidates.values()].sort((a, b) => b.radars.length - a.radars.length)[0];
  if (!best) throw new Error(`unable to find a connected real substation feeder; powered radar placements=${radars.length}/100, wireReachPositions=${wireReachPositions}, placeableSubstations=${placeableSubstationPositions}, freeRadarSlots=${freeRadarSlots}`);
  const pole = B('substation', best.x, best.y); connectedPoles.push(pole); feederExtensions++;
  for (const [rx, ry] of best.radars) {
    if (radars.length >= 100) break;
    if (!g.canPlace('radar', rx, ry, 0, false).ok) continue;
    radars.push(B('radar', rx, ry));
  }
}
g.batchBuild = false;
g.dirtyPower = true; g.step();
assert(radars.length === 100 && radars.every(e => e._net != null && e._net >= 0), `powered radar load mismatch: ${radars.filter(e => e._net != null && e._net >= 0).length}/${radars.length}`);
const stationHX = stationIds.filter(e => e.proto === 'heat-exchanger');
let waterNets = [...new Set(stationHX.map(e => e._fn?.[0]).filter((n): n is number => n != null && n >= 0))];
assert(waterNets.length === 4, `expected 4 pump-fed water networks, got ${waterNets.length}`);
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
assert(waterNets.length === 4, `pump connection changed the 4 water networks to ${waterNets.length}`);
const water = waterNets.map(i => g.fluidNets[i]);
assert(water.every(n => n && !n.conflict && n.fluid === 'water' && n.amount > 0), 'real pumps did not supply every station HX water net');
const thermal = heatNet(g);
const counts = { reactors: [...g.ents.values()].filter(e => e.t === 'reactor').length, heatPipes: [...g.ents.values()].filter(e => e.t === 'hpipe').length, heatExchangers: [...g.ents.values()].filter(e => e.proto === 'heat-exchanger').length, turbines: [...g.ents.values()].filter(e => e.proto === 'steam-turbine').length };
assert(counts.reactors === 100 && counts.heatPipes === 13096 && counts.heatExchangers === 1000 && counts.turbines === 2000, `stress counts mismatch: ${JSON.stringify(counts)}`);
assert(corePipes.length === 10000 && thermal.edges.filter(([a,b]) => corePipes.includes(a) && corePipes.includes(b)).length === 19800, '100×100 core-grid topology mismatch');
const connectedHX = [...g.ents.values()].filter(e => e.proto === 'heat-exchanger' && thermal.edges.some(([a,b]) => a === e || b === e)).length;
for (const e of thermal.ents) if (e.hE !== undefined) e.hE = Math.floor((500 - 15) * PROTOS[e.proto].heatC! * 1e6);
for (const r of [...gridReactors, ...stationIds.filter(e => e.t === 'reactor')]) { r.rgo = true; r.input!['nuclear-fuel-cell'] = 1; }
for (let i = 0; i < 300; i++) g.step();
const steam = g.fluidNets.filter(n => n?.fluid === 'steam').reduce((s,n) => s + n.amount, 0);
const activeRadars = radars.filter(e => e.active).length;
const radarNetIds = new Set(radars.map(e => e._net).filter(n => n != null && n >= 0));
const powerNetworks = [...g.powerNets.values()].filter(n => radarNetIds.has(n.id)).map(n => ({ id: n.id, radars: radars.filter(e => e._net === n.id).length, activeRadars: radars.filter(e => e._net === n.id && e.active).length, demandKW: n.demand, supplyKW: n.supply, satisfaction: n.satisfaction, poles: n.poles.length, steamKW: n.steam }));
const unpoweredRadars = radars.filter(e => e._net == null || e._net < 0).map(e => ({ x: e.x, y: e.y, net: e._net }));
const report = { createdAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, ticks: g.tick, noBoom: g.settings.noBoom, counts, coreGrid: { rows: 100, columns: 100, pipes: corePipes.length, internalEdges: 19800 }, thermalNodes: thermal.ents.length, heatEdges: thermal.edges.length, heatConnectedExchangers: connectedHX, stressReactors: gridReactors.length, station: { blueprint: entry.id, reactors: stationIds.filter(e => e.t === 'reactor').length, exchangers: stationHX.length, turbines: stationIds.filter(e => e.proto === 'steam-turbine').length, offshorePumps: pumpCount, waterNetworks: water.map(n => ({ amount: n!.amount, capacity: n!.cap })) }, load: { radars: radars.length, activeRadars, turbineKW: turbineKW(), steamAmount: steam, steamJ: g.nuc.st.steamJ || 0, powerNetworks, unpoweredRadars }, maxReactorC: Math.max(...[...g.ents.values()].filter(e => e.t === 'reactor').map(heatTemp)), booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length, elapsed: 'preflight-only; no latency measurements' };
writeFileSync('docs/validation-v116-heat-preflight.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
assert(pumpCount === 8 && steam > 0 && (g.nuc.st.steamJ || 0) > 0, 'pump-fed production station did not transfer water to steam');
assert((g.nuc.st.boom || 0) === 0 && g.nuc.zones.length === 0, 'unexpected accident in 300-tick 500°C preflight');
assert(activeRadars === 100 && turbineKW() >= 30000, `actual load not powered: radars ${activeRadars}/100, output ${turbineKW()} kW`);

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
  for (let i = 0; i < warmTicks; i++) game.step();
  const tickTimes: number[] = [], heatStart = heatSamples.length, startTick = game.tick;
  for (let i = 0; i < measuredTicks; i++) { const t0 = performance.now(); game.step(); tickTimes.push(performance.now() - t0); }
  return { name, warmTicks, measuredTicks, startTick, endTick: game.tick, fullTick: quantiles(tickTimes), heat: quantiles(heatSamples.slice(heatStart)) };
}
function timedStep(game: Game, heatSamples: number[]) {
  const t0 = performance.now(), before = heatSamples.length; game.step();
  return { fullTickMs: performance.now() - t0, heatMs: heatSamples[before] };
}

const heatSamples = watchHeat(g);
const hotWorking = sampleStage(g, heatSamples, 'hot-working', 300, 1800);
const hotTurbineKW = turbineKW(), hotDemandKW = [...g.powerNets.values()].reduce((s, n) => s + n.demand, 0);
assert((g.nuc.st.boom || 0) === 0 && g.nuc.zones.length === 0, 'hot-working measurement caused an accident');
const maxHotC = Math.max(...[...g.ents.values()].filter(e => e.t === 'reactor').map(heatTemp));
const hotActiveReactors = [...g.ents.values()].filter(e => e.t === 'reactor' && (e.rt || 0) > 0).length;
for (const r of [...g.ents.values()].filter(e => e.t === 'reactor')) g.enqueue({ t: 'reactor', id: r.id, op: 'stop', on: true } as any);
const stoppedPotentialBeforeCooling = g.nuc.st.stoppedPotentialJ || 0;
const cooling = sampleStage(g, heatSamples, 'cooling-after-real-emergency-stop', 300, 1800);
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
}
const graphHeat = heatSamples.slice(heatSamplesBeforeGraphChanges);

// A second, exactly-counted ambient fixture isolates every thermal entity.
const cold = new Game(20261010, true, { enemies: 'none' }); cold.freePower = false;
flatten(cold, -40, -40, 850, 800); cold.batchBuild = true;
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
assert(coldCounts.reactors === 100 && coldCounts.heatPipes === 13096 && coldCounts.heatExchangers === 1000 && coldCounts.turbines === 2000, `cold stress counts mismatch: ${JSON.stringify(coldCounts)}`);
assert(coldNet.ents.length === 14196 && coldNet.edges.length === 0, `cold fixture is not fully isolated: ${coldNet.ents.length} thermal nodes, ${coldNet.edges.length} edges`);
assert(coldTemps.every(t => t === 15), `cold fixture is not ambient: min=${Math.min(...coldTemps)}, max=${Math.max(...coldTemps)}`);
const coldHeatSamples = watchHeat(cold);
const coldIsolated = sampleStage(cold, coldHeatSamples, 'cold-isolated', 300, 1800);

// Last, initialize only the production 2×2 station's thermal component hot;
// the normal noBoom=false 600-tick reactor protection path must produce a real
// group accident. This is the terminal stage, after all non-destructive timing.
const stationThermal = stationIds.filter(e => e.t === 'reactor' || e.t === 'hpipe' || e.t === 'hexch');
assert(stationThermal.length > 0 && stationThermal.every(e => g.ents.has(e.id)), 'production station thermal component is incomplete before accident stage');
for (const e of stationThermal) e.hE = Math.floor((1100 - 15) * PROTOS[e.proto].heatC! * 1e6);
const stationReactors = stationIds.filter(e => e.t === 'reactor');
for (const r of stationReactors) { r.ot = 0; r.rstop = true; }
assert(g.settings.noBoom === false, 'group accident stage requires real accidents enabled');
const accidentSamples: number[] = [];
let firstBoom = null as { step: number; fullTickMs: number; heatMs: number } | null;
for (let step = 1; step <= 650 && !(g.nuc.st.boom || 0); step++) {
  const sample = timedStep(g, heatSamples); accidentSamples.push(sample.fullTickMs);
  if ((g.nuc.st.boom || 0) > 0) firstBoom = { step, fullTickMs: sample.fullTickMs, heatMs: sample.heatMs };
}
assert(firstBoom && firstBoom.step >= 600 && (g.nuc.st.boom || 0) > 0 && g.nuc.zones.length > 0, `real 2×2 station group accident did not occur after 600 hot ticks: ${JSON.stringify({ firstBoom, booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length })}`);
const performanceReport = {
  createdAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
  instrument: 'per-step performance.now() around Game.step; per-tick heat interval captured from the existing Profiler.add call; 300 warmup + 1800 measured ticks per steady stage',
  hotFixture: { counts, coreGrid: { pipes: 10000, internalEdges: 19800 }, thermalNodes: thermal.ents.length, hotEdges: heatBeforeGraphChanges, stressReactors: gridReactors.length, station: { blueprint: entry.id, reactors: stationIds.filter(e => e.t === 'reactor').length, heatPipes: stationIds.filter(e => e.t === 'hpipe').length, exchangers: stationHX.length, turbines: stationIds.filter(e => e.proto === 'steam-turbine').length, offshorePumps: pumpCount, waterNetworks: water.map(n => ({ amount: n!.amount, capacity: n!.cap })) }, actualLoad: { radars: radars.length, turbineKW: hotTurbineKW, demandKW: hotDemandKW } },
  hotState: { maxReactorC: maxHotC, activeReactors: hotActiveReactors, noBoom: g.settings.noBoom, booms: 0, zones: 0 },
  stages: { hotWorking, cooling, coldIsolated },
  coolingState: { maxReactorC: maxCoolingC, remainingRods: remainingRodsAfterStop, stoppedPotentialJ: (g.nuc.st.stoppedPotentialJ || 0) - stoppedPotentialBeforeCooling, boomsBeforeAccident: 0 },
  graphRebuild: { cycles: 30, heatEdgesBaseline: heatBeforeGraphChanges, splitExpectedEdges: heatBeforeGraphChanges - 299, splitFullTick: quantiles(graphSamples.splitFullTick), splitHeat: quantiles(graphSamples.splitHeat), mergeFullTick: quantiles(graphSamples.mergeFullTick), mergeHeat: quantiles(graphSamples.mergeHeat), combinedHeat: quantiles(graphHeat) },
  coldFixture: { counts: coldCounts, thermalNodes: coldNet.ents.length, heatEdges: coldNet.edges.length, temperatureC: { min: Math.min(...coldTemps), max: Math.max(...coldTemps) } },
  groupAccident: { target: 'production station-2x2; initialized at 1100°C, noBoom=false, 4 reactors', firstBoom, booms: g.nuc.st.boom || 0, zones: g.nuc.zones.length, stepsRun: accidentSamples.length, accidentStepP95: quantiles(accidentSamples) },
};
writeFileSync('docs/validation-v116-heat-performance.json', JSON.stringify(performanceReport, null, 2) + '\n');
console.log(JSON.stringify(performanceReport));
