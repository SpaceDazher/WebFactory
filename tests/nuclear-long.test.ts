/** Explicit, real-tick v1.16 nuclear endurance and economy acceptance.
 * Run with `npm run test:nuclear-long`; `--smoke` is setup only and never counts as acceptance.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PROTOS } from '../src/data/entities';
import { bp116 } from '../src/data/bp116';
import { DX, DY } from '../src/core/types';
import { Game, type Entity } from '../src/sim/game';
import { heatTemp, ROD_TICKS } from '../src/sim/heat';
import { turbineKW } from '../src/sim/networks';
import { T_GRASS, T_SHALLOW } from '../src/sim/world';

const TICKS_PER_SECOND = 60;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const TICKS_PER_HOUR = 60 * TICKS_PER_MINUTE;
const TEN_HOURS = 10 * TICKS_PER_HOUR;
const WARMUP = 10 * TICKS_PER_MINUTE;
const MINIMUM_KW = 480_000 * 0.98;
// At 480MW one load-bank tick removes at most 8MJ; ≤100 hot pipes lose at
// most 0.04MJ/tick below 1200°C. A 8.1MJ tolerance covers one sampled tick.
const NORMALIZATION_TOLERANCE_J = 8_100_000;
const NORMALIZATION_MAX_TICKS = TEN_HOURS;
const SMOKE = process.argv.includes('--smoke');
const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'docs');
const LOG = path.join(DOCS, 'validation-v116-long.log');
const JSON_REPORT = path.join(DOCS, 'validation-v116-long.json');
mkdirSync(DOCS, { recursive: true });
writeFileSync(LOG, `v1.16 nuclear long acceptance ${SMOKE ? 'SETUP SMOKE' : 'FULL'}\nStarted ${new Date().toISOString()}\n`);

type Energy = { heatJ: number; steamJ: number; accumJ: number; totalJ: number };
type Metrics = {
  requestedTicks: number; actualTicks: number; elapsedSeconds: number;
  minKW: number; averageKW: number; aboveThresholdFraction: number; integratedOutputJ: number;
  generatedHeatJ: number; steamTransferredJ: number; pipeAndAccidentLossJ: number; unreleasedFuelPotentialJ: number; energyStart: Energy; energyEnd: Energy;
  storedDeltaJ: number; energyBalanceErrorJ: number; maxReactorC: number; boomDelta: number;
  zonesCreated: number; burnedCells: number; stoppedCells: number; fedCells: number;
  inputCellsRemaining: number; activeCellsRemaining: number; spentCellsCollected: number;
  fuelLedgerError: number; removedReactors: number; heatPipeCount: number; offshorePumpCount: number; emergencyStopEvents: number;
  demandSatisfaction: Record<string, { ticks: number; satisfiedTicks: number; average: number }>;
};

const metrics = (requestedTicks: number): Metrics => ({
  requestedTicks, actualTicks: 0, elapsedSeconds: 0, minKW: Infinity, averageKW: 0,
  aboveThresholdFraction: 0, integratedOutputJ: 0, generatedHeatJ: 0, steamTransferredJ: 0, pipeAndAccidentLossJ: 0, unreleasedFuelPotentialJ: 0,
  energyStart: { heatJ: 0, steamJ: 0, accumJ: 0, totalJ: 0 },
  energyEnd: { heatJ: 0, steamJ: 0, accumJ: 0, totalJ: 0 }, storedDeltaJ: 0,
  energyBalanceErrorJ: 0, maxReactorC: 0, boomDelta: 0, zonesCreated: 0, burnedCells: 0,
  stoppedCells: 0, fedCells: 0, inputCellsRemaining: 0, activeCellsRemaining: 0,
  spentCellsCollected: 0, fuelLedgerError: 0, removedReactors: 0, heatPipeCount: 0, offshorePumpCount: 0, emergencyStopEvents: 0,
  demandSatisfaction: {},
});

function note(value: unknown) {
  const line = typeof value === 'string' ? value : JSON.stringify(value);
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function energyOf(g: Game): Energy {
  let heatJ = 0;
  for (const e of g.ents.values()) if (e.hE !== undefined) heatJ += Math.max(0, e.hE || 0);
  let steamJ = 0;
  for (const n of g.fluidNets) if (n?.fluid === 'steam' && n.amount > 0) steamJ += n.amount * (n.se || 0) * 1000;
  let accumJ = 0;
  for (const e of g.ents.values()) if (PROTOS[e.proto].accum) accumJ += Math.max(0, e.charge || 0);
  return { heatJ, steamJ, accumJ, totalJ: heatJ + steamJ + accumJ };
}

function makeStation(index: 1 | 2) {
  const entry = bp116()[index];
  const g = new Game(21, true, { enemies: 'none' });
  for (const r of Object.values(awaitRecipes())) g.enabled.add(r);
  g.freePower = false;
  const ox = 300, oy = 300;
  for (let y = oy - 12; y < oy + entry.bp.h + 12; y++) for (let x = ox - 12; x < ox + entry.bp.w + 12; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) g.world.removeDecor(x, y);
  }
  const ids: Entity[] = [];
  let failedBuilds = 0;
  for (const b of entry.bp.entities) {
    const e = g.build(b.p, ox + b.x, oy + b.y, b.d, false);
    if (!e) failedBuilds++;
    ids.push(e!);
  }
  assert(failedBuilds === 0, `${entry.name}: blueprint failed to place ${failedBuilds} entities`);
  // Rebuild blueprint wires through the canonical helper.
  const wireErrors: string[] = [];
  for (const w of entry.bp.wires || []) {
    if (ids[w[0]] && ids[w[1]]) { const result = addBlueprintWire(g, ids[w[0]].id, ids[w[1]].id, w[2], w[3] || 0, w[4] || 0); if (result !== 'ok') wireErrors.push(`${w[0]}-${w[1]}:${result}`); }
  }
  assert(wireErrors.length === 0, `${entry.name}: blueprint wire failures ${wireErrors.slice(0, 8).join(',')}`);
  entry.bp.entities.forEach((b, i) => { if (b.cc && ids[i]) g.enqueue({ t: 'cset', id: ids[i].id, cc: b.cc } as any); });
  const sub = ids.find(e => e?.t === 'pole' && e.proto === 'substation');
  assert(!!sub, `${entry.name}: no substation found`);
  let radar: Entity | null = null;
  for (let dx = -6; dx <= 6 && !radar; dx++) for (let dy = -6; dy <= 6 && !radar; dy++) {
    if (g.canPlace('radar', sub!.x + dx, sub!.y + dy, 0, false).ok) radar = g.build('radar', sub!.x + dx, sub!.y + dy, 0, false);
  }
  assert(!!radar, `${entry.name}: could not place load radar near the station`);
  radar!.active = true;
  g.dirtyFluid = true;
  g.step(); // commits the blueprint circuit configuration before the timed run
  const reactors = ids.filter(e => e?.t === 'reactor');
  const heatPipes = ids.filter(e => e?.t === 'hpipe').length;
  const hexs = ids.filter(e => e?.proto === 'heat-exchanger');
  let waterNetworks = [...new Set(hexs.map(e => e._fn?.[0]).filter((n): n is number => n != null && n >= 0))];
  assert(waterNetworks.length === 4, `${entry.name}: expected four distinct HX water networks, found ${waterNetworks.length}`);
  const pumps: Entity[] = [];
  const PUMPS_PER_NETWORK = 2; // 20 water units/tick per pump; 12 HX need up to ~20.62.
  for (const netId of waterNetworks) {
    const networkPipes = [...g.ents.values()].filter(e => e.proto === 'pipe' && e._fn?.[0] === netId);
    for (let pumpIndex = 0; pumpIndex < PUMPS_PER_NETWORK; pumpIndex++) {
      let installed = false;
      for (const pipe of networkPipes) {
        for (let dir = 0; dir < 4 && !installed; dir++) {
        const px = pipe.x - DX[dir], py = pipe.y - DY[dir];
        const wx = px - DX[dir], wy = py - DY[dir];
        if (g.world.occ(px, py) >= 0 || g.world.occ(wx, wy) >= 0) continue;
        if (g.world.terrain(px, py) >= T_SHALLOW) continue;
        // This is an explicit initial water-terrain fixture. From here on, only
        // the built offshore pump and the real fluid network supply water.
        const pc = g.world.chunkAt(px, py), pi = g.world.idx(px, py);
        pc.terrain[pi] = T_GRASS;
        const wc = g.world.chunkAt(wx, wy), wi = g.world.idx(wx, wy);
        wc.terrain[wi] = T_SHALLOW;
        if (pc.decor[pi]) g.world.removeDecor(px, py);
        if (wc.decor[wi]) g.world.removeDecor(wx, wy);
        if (!g.canPlace('offshore-pump', px, py, dir as 0 | 1 | 2 | 3, false).ok) { wc.terrain[wi] = T_GRASS; continue; }
        const pump = g.build('offshore-pump', px, py, dir as 0 | 1 | 2 | 3, false);
        if (!pump) { wc.terrain[wi] = T_GRASS; continue; }
        pumps.push(pump); installed = true;
      }
        if (installed) break;
      }
      assert(installed, `${entry.name}: could not place real offshore pump ${pumpIndex + 1}/${PUMPS_PER_NETWORK} beside HX water network ${netId}`);
    }
  }
  g.dirtyFluid = true;
  g.step(); // rebuilds the connected pump/HX networks and lets pumps start filling them
  waterNetworks = [...new Set(hexs.map(e => e._fn?.[0]).filter((n): n is number => n != null && n >= 0))];
  assert(waterNetworks.length === 4, `${entry.name}: pump connection merged or split HX water networks (${waterNetworks.length})`);
  const suppliedNetworks = waterNetworks.map(id => g.fluidNets[id]);
  assert(suppliedNetworks.every(n => n && !n.conflict && n.fluid === 'water' && n.amount > 0),
    `${entry.name}: real offshore pumps did not supply every HX water network: ${JSON.stringify(suppliedNetworks.map(n => n && { fluid: n.fluid, amount: n.amount, cap: n.cap, conflict: n.conflict }))}`);
  for (const e of ids) if (e && e.hE !== undefined) e.hE = Math.floor((560 - 15) * PROTOS[e.proto].heatC! * 1e6);
  for (const r of reactors) { r.input = {}; r.output = {}; }
  assert(reactors.length === 4, `${entry.name}: expected four reactors, found ${reactors.length}`);
  assert(radar!._net != null && radar!._net >= 0, `${entry.name}: test load did not join a power network`);
  return { entry, g, ids, reactors, radar: radar!, heatPipes, pumps, waterNetworks };
}

// Imported as separate aliases so the setup helper remains easy to read.
import { RECIPES } from '../src/data/recipes';
import { addWire as addBlueprintWire } from '../src/sim/circuits';
function awaitRecipes() { return Object.values(RECIPES).map(r => r.id); }

type Station = ReturnType<typeof makeStation>;

function stat(g: Game, key: string) { return Number((g.nuc.st as any)[key] || 0); }
function captureEnergy(g: Game) { return energyOf(g); }
function spentFuelStock(g: Game) {
  const item = 'used-nuclear-fuel-cell';
  let count = g.inv.slots.reduce((sum, slot) => sum + (slot?.item === item ? slot.count : 0), 0);
  for (const e of g.ents.values()) {
    count += e.input?.[item] || 0;
    count += e.output?.[item] || 0;
    if (e.hand === item) count += e.hn || 1;
    if (e.inv) for (const slot of e.inv.slots) if (slot?.item === item) count += slot.count;
  }
  for (const drop of g.ground.values()) if (drop.item === item) count += drop.count;
  return count;
}

function warmAndMeasure(station: Station, ticks: number, loadForTick: (tick: number) => number, alwaysEnabled: boolean, label: string) {
  const { g, reactors, radar } = station;
  const originalKW = (PROTOS.radar.energy as any).kW;
  let fed = 0, outJ = 0, kwSum = 0, above = 0, minKW = Infinity, maxC = 0, emergencyStopEvents = 0;
  const setupEnergy = captureEnergy(g);
  const setupSpentFuelStock = spentFuelStock(g);
  const initial = { generated: stat(g, 'heatBase') + stat(g, 'heatBonus'), steam: stat(g, 'steamJ'), loss: stat(g, 'lost'), unreleased: stat(g, 'stoppedPotentialJ'), spentStock: setupSpentFuelStock, burned: stat(g, 'burned'), stopped: stat(g, 'stopped'), boom: stat(g, 'boom'), zones: g.nuc.zones.length };
  const stepOne = (loadKW: number) => {
    (PROTOS.radar.energy as any).kW = loadKW;
    for (const r of reactors) {
      const amount = r.input!['nuclear-fuel-cell'] || 0;
      if (amount < 2) { const add = 2 - amount; r.input!['nuclear-fuel-cell'] = 2; fed += add; }
    }
    g.step();
    const kw = turbineKW(); kwSum += kw; outJ += kw * 1000 / TICKS_PER_SECOND; minKW = Math.min(minKW, kw);
    if (kw >= MINIMUM_KW) above++;
    for (const r of reactors) maxC = Math.max(maxC, heatTemp(r));
  };
  const warmTicks = WARMUP;
  for (let i = 0; i < warmTicks; i++) stepOne(480_000);
  const warm = {
    ticks: warmTicks, generatedHeatJ: stat(g, 'heatBase') + stat(g, 'heatBonus') - initial.generated,
    steamTransferredJ: stat(g, 'steamJ') - initial.steam, lostJ: stat(g, 'lost') - initial.loss,
    unreleasedFuelPotentialJ: stat(g, 'stoppedPotentialJ') - initial.unreleased, outputJ: outJ, averageKW: kwSum / warmTicks,
    minKW, maxReactorC: maxC, energyStart: setupEnergy, energyEnd: captureEnergy(g),
    burnedCells: stat(g, 'burned') - initial.burned, stoppedCells: stat(g, 'stopped') - initial.stopped,
    fedCells: fed, spentCellsCollected: spentFuelStock(g) - initial.spentStock, boomDelta: stat(g, 'boom') - initial.boom,
    zonesCreated: g.nuc.zones.length - initial.zones, emergencyStopEvents,
  };
  const energyStart = captureEnergy(g);
  const inputAtStart = reactors.reduce((sum, r) => sum + (r.input!['nuclear-fuel-cell'] || 0), 0);
  const activeAtStart = reactors.filter(r => (r.rt || 0) > 0).length;
  const measuredBase = { generated: stat(g, 'heatBase') + stat(g, 'heatBonus'), steam: stat(g, 'steamJ'), loss: stat(g, 'lost'), unreleased: stat(g, 'stoppedPotentialJ'), spentStock: spentFuelStock(g), burned: stat(g, 'burned'), stopped: stat(g, 'stopped'), boom: stat(g, 'boom'), zones: g.nuc.zones.length };
  const warmEmergencyStopEvents = emergencyStopEvents;
  let measuredFeed = 0, measuredOutputJ = 0, measuredKW = 0, measuredAbove = 0, measuredMinKW = Infinity, measuredMaxC = 0;
  const demand: Record<string, { ticks: number; satisfiedTicks: number; average: number }> = {};
  const started = performance.now();
  for (let i = 0; i < ticks; i++) {
    const loadKW = loadForTick(i);
    (PROTOS.radar.energy as any).kW = loadKW;
    for (const r of reactors) {
      if (alwaysEnabled) {
        r.coff = false; r.rgo = true;
        if (!r.rstop && heatTemp(r) >= 900) { r.rstop = true; emergencyStopEvents++; }
        else if (r.rstop && heatTemp(r) < 800) r.rstop = false;
      }
      const amount = r.input!['nuclear-fuel-cell'] || 0;
      if (amount < 2) { const add = 2 - amount; r.input!['nuclear-fuel-cell'] = 2; fed += add; measuredFeed += add; }
    }
    g.step();
    const kw = turbineKW(); measuredKW += kw; measuredOutputJ += kw * 1000 / TICKS_PER_SECOND;
    measuredMinKW = Math.min(measuredMinKW, kw); if (kw >= MINIMUM_KW) measuredAbove++;
    const band = loadKW === 0 ? '0' : loadKW === 120_000 ? '120' : loadKW === 480_000 ? '480' : String(loadKW);
    const row = demand[band] ??= { ticks: 0, satisfiedTicks: 0, average: 0 };
    row.ticks++; const sat = Math.min(1, Math.max(0, g.powerNets.get(radar._net!)?.satisfaction ?? 0));
    row.average += sat; if (loadKW > 0 && sat >= 0.98) row.satisfiedTicks++;
    for (const r of reactors) measuredMaxC = Math.max(measuredMaxC, heatTemp(r));
    if (!SMOKE && (i + 1) % TICKS_PER_HOUR === 0) {
      note({ stage: label, actualTicks: i + 1, totalTicks: ticks, gameHour: (i + 1) / TICKS_PER_HOUR,
        elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)),
        burnedCells: stat(g, 'burned') - measuredBase.burned, booms: stat(g, 'boom') - measuredBase.boom });
    }
  }
  const elapsedSeconds = (performance.now() - started) / 1000;
  for (const row of Object.values(demand)) if (row.ticks) row.average /= row.ticks;
  const m = metrics(ticks);
  m.actualTicks = ticks; m.elapsedSeconds = elapsedSeconds; m.minKW = measuredMinKW;
  m.averageKW = measuredKW / ticks; m.aboveThresholdFraction = measuredAbove / ticks;
  m.integratedOutputJ = measuredOutputJ; m.maxReactorC = measuredMaxC; m.demandSatisfaction = demand;
  m.fedCells = measuredFeed; m.heatPipeCount = station.heatPipes;
  m.burnedCells = stat(g, 'burned') - measuredBase.burned;
  m.stoppedCells = stat(g, 'stopped') - measuredBase.stopped;
  m.boomDelta = stat(g, 'boom') - measuredBase.boom;
  m.zonesCreated = g.nuc.zones.length - measuredBase.zones;
  m.removedReactors = reactors.filter(r => !g.ents.has(r.id)).length;
  m.inputCellsRemaining = reactors.reduce((sum, r) => sum + (r.input?.['nuclear-fuel-cell'] || 0), 0);
  m.activeCellsRemaining = reactors.filter(r => (r.rt || 0) > 0).length;
  m.spentCellsCollected = spentFuelStock(g) - measuredBase.spentStock;
  m.fedCells += inputAtStart + activeAtStart;
  m.fuelLedgerError = m.fedCells - m.burnedCells - m.stoppedCells - m.inputCellsRemaining - m.activeCellsRemaining;
  m.offshorePumpCount = station.pumps.length;
  m.emergencyStopEvents = emergencyStopEvents - warmEmergencyStopEvents;
  m.energyStart = energyStart; m.energyEnd = captureEnergy(g);
  m.storedDeltaJ = m.energyEnd.totalJ - m.energyStart.totalJ;
  m.generatedHeatJ = stat(g, 'heatBase') + stat(g, 'heatBonus') - measuredBase.generated;
  m.steamTransferredJ = stat(g, 'steamJ') - measuredBase.steam;
  m.pipeAndAccidentLossJ = stat(g, 'lost') - measuredBase.loss;
  m.unreleasedFuelPotentialJ = stat(g, 'stoppedPotentialJ') - measuredBase.unreleased;
  // Heat-only conservation: turbine electricity is a downstream conversion and
  // cannot replace the measured heat-to-steam transfer in this ledger.
  m.energyBalanceErrorJ = m.generatedHeatJ - m.steamTransferredJ - m.pipeAndAccidentLossJ - (m.energyEnd.heatJ - m.energyStart.heatJ);
  (PROTOS.radar.energy as any).kW = originalKW;
  return { label, warm, measured: m, totalFedIncludingWarmup: fed, initialSpentFuelStock: setupSpentFuelStock, g, station, initialEnergy: energyStart };
}

function normalizeReserves(economy: ReturnType<typeof warmAndMeasure>, continuous: ReturnType<typeof warmAndMeasure>) {
  const originalKW = (PROTOS.radar.energy as any).kW;
  const scenarios = [
    { label: 'economy', run: economy },
    { label: 'continuously-enabled-counterfactual', run: continuous },
  ];
  const initialEnergy = scenarios.map(s => captureEnergy(s.run.g));
  const initialStats = scenarios.map(s => ({ generated: stat(s.run.g, 'heatBase') + stat(s.run.g, 'heatBonus'),
    steam: stat(s.run.g, 'steamJ'), loss: stat(s.run.g, 'lost'), potential: stat(s.run.g, 'stoppedPotentialJ'),
    burned: stat(s.run.g, 'burned'), stopped: stat(s.run.g, 'stopped'), boom: stat(s.run.g, 'boom'),
    zones: s.run.g.nuc.zones.length, spentStock: spentFuelStock(s.run.g) }));
  const ticksByScenario = [0, 0];
  const emergencyStopEvents = [0, 0];
  const maxReactorC = scenarios.map(s => Math.max(...s.run.station.reactors.map(r => heatTemp(r))));
  const started = performance.now();
  let targetStoredJ = 0;
  let terminalEnergy: Energy[] = [];
  note({ stage: 'physical-reserve-normalization', targetStoredJ: 'minimum of both post-burnout physical stores',
    sharedLoadBankKW: 480_000, maxTicks: NORMALIZATION_MAX_TICKS,
    policy: 'same economy-policy warmup and measured starting state; after measurement, each scenario receives the same 480MW load bank with rgo=false until active rods finish or trip at 900°C/rearm below 800°C; then the higher physical reserve is discharged to the lower terminal reserve; no fuel additions or direct heat/fluid writes' });
  const stepScenario = (i: number) => {
    const run = scenarios[i].run;
    (PROTOS.radar.energy as any).kW = 480_000;
    for (const r of run.station.reactors) {
      r.rgo = false;
      if (!r.rstop && (r.rt || 0) > 0 && heatTemp(r) >= 900) { r.rstop = true; emergencyStopEvents[i]++; }
      else if (r.rstop && heatTemp(r) < 800) r.rstop = false;
    }
    run.g.step();
    ticksByScenario[i]++;
    for (const r of run.station.reactors) maxReactorC[i] = Math.max(maxReactorC[i], heatTemp(r));
  };
  try {
    // Let both profiles finish or physically stop existing rods before
    // selecting the shared terminal reserve. No new rods are admitted.
    for (let i = 0; i < scenarios.length; i++) {
      while (ticksByScenario[i] < NORMALIZATION_MAX_TICKS &&
        scenarios[i].run.station.reactors.some(r => (r.rt || 0) > 0)) {
        stepScenario(i);
        if (!SMOKE && ticksByScenario[i] % TICKS_PER_HOUR === 0) {
          note({ stage: 'physical-reserve-rod-burnout', scenario: scenarios[i].label,
            actualTicks: ticksByScenario[i], activeCells: scenarios[i].run.station.reactors.filter(r => (r.rt || 0) > 0).length,
            storedJ: captureEnergy(scenarios[i].run.g).totalJ,
            elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)) });
        }
      }
    }
    terminalEnergy = scenarios.map(s => captureEnergy(s.run.g));
    targetStoredJ = Math.min(...terminalEnergy.map(e => e.totalJ));
    note({ stage: 'physical-reserve-terminal-target', targetStoredJ, terminalEnergy,
      ticksByScenario, toleranceJ: NORMALIZATION_TOLERANCE_J });
    for (let i = 0; i < scenarios.length; i++) {
      if (scenarios[i].run.station.reactors.some(r => (r.rt || 0) > 0)) continue;
      while (ticksByScenario[i] < NORMALIZATION_MAX_TICKS &&
        captureEnergy(scenarios[i].run.g).totalJ > targetStoredJ) {
        stepScenario(i);
        if (!SMOKE && ticksByScenario[i] % TICKS_PER_HOUR === 0) {
          note({ stage: 'physical-reserve-drain', scenario: scenarios[i].label,
            actualTicks: ticksByScenario[i], targetStoredJ, storedJ: captureEnergy(scenarios[i].run.g).totalJ,
            elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)) });
        }
      }
    }
  } finally { (PROTOS.radar.energy as any).kW = originalKW; }
  const result = scenarios.map((s, i) => {
    const g = s.run.g, energyEnd = captureEnergy(g), base = initialStats[i];
    const burnedCells = stat(g, 'burned') - base.burned, stoppedCells = stat(g, 'stopped') - base.stopped;
    const inputCellsRemaining = s.run.station.reactors.reduce((sum, r) => sum + (r.input?.['nuclear-fuel-cell'] || 0), 0);
    const activeCellsRemaining = s.run.station.reactors.filter(r => (r.rt || 0) > 0).length;
    const totalBurned = s.run.warm.burnedCells + s.run.measured.burnedCells + burnedCells;
    const totalStopped = s.run.warm.stoppedCells + s.run.measured.stoppedCells + stoppedCells;
    const totalSpentFuelStock = spentFuelStock(g) - s.run.initialSpentFuelStock;
    return {
      label: s.label, actualTicks: ticksByScenario[i], elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      loadBankKW: 480_000, targetStoredJ, terminalEnergy: terminalEnergy[i], initialEnergy: initialEnergy[i], energyEnd,
      storedDeltaJ: energyEnd.totalJ - initialEnergy[i].totalJ,
      generatedHeatJ: stat(g, 'heatBase') + stat(g, 'heatBonus') - base.generated,
      steamTransferredJ: stat(g, 'steamJ') - base.steam, physicalHeatLossJ: stat(g, 'lost') - base.loss,
      unreleasedFuelPotentialJ: stat(g, 'stoppedPotentialJ') - base.potential,
      thermalBalanceErrorJ: (stat(g, 'heatBase') + stat(g, 'heatBonus') - base.generated) -
        (stat(g, 'steamJ') - base.steam) - (stat(g, 'lost') - base.loss) - (energyEnd.heatJ - initialEnergy[i].heatJ),
      burnedCells, stoppedCells, consumedCells: burnedCells + stoppedCells,
      totalConsumedCellsIncludingWarmupAndMeasurement: totalBurned + totalStopped,
      totalSpentFuelStock, spentFuelLedgerError: totalSpentFuelStock - totalBurned - totalStopped,
      inputCellsRemaining, activeCellsRemaining, fuelLedgerError: s.run.totalFedIncludingWarmup - totalBurned - totalStopped - inputCellsRemaining - activeCellsRemaining,
      boomDelta: stat(g, 'boom') - base.boom, zonesCreated: g.nuc.zones.length - base.zones,
      emergencyStopEvents: emergencyStopEvents[i], maxReactorC: maxReactorC[i],
      targetReached: Math.abs(energyEnd.totalJ - targetStoredJ) <= NORMALIZATION_TOLERANCE_J && activeCellsRemaining === 0,
    };
  });
  return { targetStoredJ, toleranceJ: NORMALIZATION_TOLERANCE_J, sharedLoadBankKW: 480_000,
    actualTicks: ticksByScenario[0] + ticksByScenario[1], ticksByScenario,
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)), result };
}

function profileAt(tick: number) {
  const phase = Math.floor(tick / TICKS_PER_MINUTE) % 3;
  return phase === 0 ? 0 : phase === 1 ? 120_000 : 480_000;
}

function reportResult(label: string, result: ReturnType<typeof warmAndMeasure>) {
  const m = result.measured;
  note({ label, warmup: result.warm, metrics: m, totalFedIncludingWarmup: result.totalFedIncludingWarmup,
    energyPerBurnedCellJ: m.burnedCells ? m.generatedHeatJ / m.burnedCells : null });
}

async function main() {
  const originalRadarKW = (PROTOS.radar.energy as any).kW;
  const fullTicks = SMOKE ? 108_000 : TEN_HOURS;
  note({ mode: SMOKE ? 'setup-smoke-only' : 'full-acceptance', actualGameTicksPerMeasuredRun: fullTicks,
    hoursPerMeasuredRun: fullTicks / TICKS_PER_HOUR, warmupTicks: WARMUP,
    stages: ['2x2 continuous 480MW endurance', '2x2 economy 0/120/480MW profile', 'same-profile continuously-enabled counterfactual'] });
  try {
    const endurance = warmAndMeasure(makeStation(1), fullTicks, () => 480_000, false, 'endurance');
    reportResult('endurance', endurance);
    const eco = warmAndMeasure(makeStation(2), fullTicks, profileAt, false, 'economy');
    reportResult('economy', eco);
    const always = warmAndMeasure(makeStation(2), fullTicks, profileAt, true, 'always-enabled-counterfactual');
    reportResult('always-enabled-counterfactual', always);
    const normalization = normalizeReserves(eco, always);
    assert(Math.abs(eco.measured.energyStart.totalJ - always.measured.energyStart.totalJ) <= 1,
      'economy and continuously-enabled runs must start from the same warmup physical reserves');
    assert(normalization.result.every(r => r.targetReached) &&
      Math.abs(normalization.result[0].energyEnd.totalJ - normalization.result[1].energyEnd.totalJ) <= NORMALIZATION_TOLERANCE_J,
      `physical reserve normalization did not equalize terminal stores within ${NORMALIZATION_TOLERANCE_J}J`);
    assert(normalization.result.every(r => r.fuelLedgerError === 0 && r.spentFuelLedgerError === 0),
      `warmup + measured + normalization fuel/waste ledger mismatch: ${JSON.stringify(normalization.result.map(r => ({
        label: r.label, fuel: r.fuelLedgerError, spent: r.spentFuelLedgerError,
        consumed: r.totalConsumedCellsIncludingWarmupAndMeasurement, spentStock: r.totalSpentFuelStock,
      })))}`);
    const failures: string[] = [];
    const requireAcceptance = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
    if (!SMOKE) {
      requireAcceptance(endurance.measured.actualTicks === fullTicks, 'endurance did not execute the exact requested tick count');
      requireAcceptance(endurance.measured.heatPipeCount <= 100, `endurance station has ${endurance.measured.heatPipeCount} heatpipes (>100)`);
      requireAcceptance(endurance.measured.aboveThresholdFraction >= 0.98, `endurance only met 470.4MW for ${(100 * endurance.measured.aboveThresholdFraction).toFixed(3)}% of measured ticks`);
      requireAcceptance(endurance.measured.averageKW >= MINIMUM_KW, `endurance mean ${endurance.measured.averageKW.toFixed(1)}kW below 470.4kW`);
      requireAcceptance(endurance.measured.boomDelta === 0 && endurance.measured.zonesCreated === 0 && endurance.warm.boomDelta === 0 && endurance.warm.zonesCreated === 0, 'endurance had a reactor accident or radiation zone');
      requireAcceptance(endurance.measured.maxReactorC < 1000, `endurance reactor reached ${endurance.measured.maxReactorC.toFixed(1)}°C`);
      requireAcceptance(endurance.measured.fuelLedgerError === 0 && endurance.measured.spentCellsCollected === endurance.measured.burnedCells + endurance.measured.stoppedCells,
        `endurance fuel/waste ledger mismatch: ${JSON.stringify({ ledger: endurance.measured.fuelLedgerError, spent: endurance.measured.spentCellsCollected, burned: endurance.measured.burnedCells, stopped: endurance.measured.stoppedCells })}`);
      requireAcceptance(Math.abs(endurance.measured.energyBalanceErrorJ) <= Math.max(5e7, endurance.measured.generatedHeatJ * 0.0001), `endurance energy balance error ${endurance.measured.energyBalanceErrorJ}J`);
      requireAcceptance(eco.measured.actualTicks === fullTicks && always.measured.actualTicks === fullTicks, 'economy comparison did not execute exact tick count');
      requireAcceptance(Math.abs(eco.measured.energyStart.totalJ - always.measured.energyStart.totalJ) <= 1,
        'economy and continuously-enabled profiles did not start from identical physical reserves');
      requireAcceptance(eco.measured.boomDelta === 0 && eco.measured.zonesCreated === 0 && eco.warm.boomDelta === 0 && eco.warm.zonesCreated === 0, 'economy profile had a reactor accident or radiation zone');
      requireAcceptance(eco.measured.maxReactorC < 1000, `economy reactor reached ${eco.measured.maxReactorC.toFixed(1)}°C`);
      requireAcceptance(eco.measured.fuelLedgerError === 0 && eco.measured.spentCellsCollected === eco.measured.burnedCells + eco.measured.stoppedCells,
        `economy fuel/waste ledger mismatch: ${JSON.stringify({ ledger: eco.measured.fuelLedgerError, spent: eco.measured.spentCellsCollected, burned: eco.measured.burnedCells, stopped: eco.measured.stoppedCells })}`);
      requireAcceptance(Math.abs(eco.measured.energyBalanceErrorJ) <= Math.max(5e7, eco.measured.generatedHeatJ * 0.0001), `economy energy balance error ${eco.measured.energyBalanceErrorJ}J`);
    }
    const normalizedEconomy = normalization.result[0], normalizedAlways = normalization.result[1];
    const economyTotalConsumed = eco.warm.burnedCells + eco.warm.stoppedCells + eco.measured.burnedCells + eco.measured.stoppedCells + normalizedEconomy.consumedCells;
    const alwaysTotalConsumed = always.warm.burnedCells + always.warm.stoppedCells + always.measured.burnedCells + always.measured.stoppedCells + normalizedAlways.consumedCells;
    if (!SMOKE) {
      requireAcceptance(normalizedEconomy.targetReached && normalizedAlways.targetReached &&
        Math.abs(normalizedEconomy.energyEnd.totalJ - normalizedAlways.energyEnd.totalJ) <= NORMALIZATION_TOLERANCE_J,
        `physical reserve normalization did not reach equal final stores within ${NORMALIZATION_TOLERANCE_J}J`);
      requireAcceptance(normalizedEconomy.boomDelta === 0 && normalizedAlways.boomDelta === 0 &&
        normalizedEconomy.zonesCreated === 0 && normalizedAlways.zonesCreated === 0, 'reserve normalization had a reactor accident or radiation zone');
      requireAcceptance(normalizedEconomy.fuelLedgerError === 0 && normalizedAlways.fuelLedgerError === 0 &&
        normalizedEconomy.spentFuelLedgerError === 0 && normalizedAlways.spentFuelLedgerError === 0,
        'warmup + measured + normalization fuel/waste ledger did not conserve all cells');
      requireAcceptance(Math.abs(normalizedEconomy.thermalBalanceErrorJ) <= Math.max(5e7, normalizedEconomy.generatedHeatJ * 0.0001) &&
        Math.abs(normalizedAlways.thermalBalanceErrorJ) <= Math.max(5e7, normalizedAlways.generatedHeatJ * 0.0001),
        'physical reserve normalization thermal ledger exceeded tolerance');
      requireAcceptance(economyTotalConsumed < alwaysTotalConsumed,
        `economy consumed ${economyTotalConsumed} total cells including warmup/normalization; always-enabled consumed ${alwaysTotalConsumed}`);
    }
    const report = {
      startedAt: new Date().toISOString(), fullAcceptance: !SMOKE,
      definition: { ticksPerGameHour: TICKS_PER_HOUR, warmupTicks: WARMUP, measuredTicks: fullTicks,
        economyProfile: '0/120/480MW in 600-second blocks, repeated to exactly 10 game hours', thresholdKW: MINIMUM_KW,
        waterSupply: 'Each of four HX water networks is connected to two built offshore pumps adjacent to shallow-water initial terrain fixtures. No fluid amount is written after pump construction.',
        continuousComparison: 'same 2x2 economy blueprint, same economy-policy 480MW warmup and initial physical reserves; from the first measured tick onward the counterfactual holds fuel permission open and independently emergency-stops at 900°C/rearms below 800°C; accident logic remains active',
        normalization: 'After measured profiles, both runs first finish or physically stop active rods under the same 480MW load bank with new fuel disabled. The lower resulting physical reserve defines the shared endpoint; only the higher reserve is physically discharged with Game.step and the same load bank. Endpoints are sampled every tick; 8.1MJ covers one 8MJ full-load tick plus the ≤0.04MJ modeled loss bound. No heat/fluid values are assigned.' },
      normalizationToleranceJ: NORMALIZATION_TOLERANCE_J,
      endurance: endurance.measured, economy: eco.measured, continuouslyEnabledCounterfactual: always.measured,
      physicalReserveNormalization: normalization,
      rodComparison: { economyWarmConsumedCells: eco.warm.burnedCells + eco.warm.stoppedCells,
        counterfactualWarmConsumedCells: always.warm.burnedCells + always.warm.stoppedCells,
        economyBurnedCells: eco.measured.burnedCells, economyStoppedCells: eco.measured.stoppedCells,
        economyConsumedCells: eco.measured.burnedCells + eco.measured.stoppedCells,
        continuouslyEnabledBurnedCells: always.measured.burnedCells, continuouslyEnabledStoppedCells: always.measured.stoppedCells,
        continuouslyEnabledConsumedCells: always.measured.burnedCells + always.measured.stoppedCells,
        economyNormalizationConsumedCells: normalizedEconomy.consumedCells, counterfactualNormalizationConsumedCells: normalizedAlways.consumedCells,
        economyTotalConsumedCellsIncludingWarmupAndNormalization: economyTotalConsumed,
        counterfactualTotalConsumedCellsIncludingWarmupAndNormalization: alwaysTotalConsumed,
        economyDeltaStoredJ: eco.measured.storedDeltaJ, continuousDeltaStoredJ: always.measured.storedDeltaJ,
        equalInitialStoredEnergy: Math.abs(eco.measured.energyStart.totalJ - always.measured.energyStart.totalJ) <= 1,
        equalFinalStoredEnergy: Math.abs(eco.measured.energyEnd.totalJ - always.measured.energyEnd.totalJ) <= 1,
        equalFinalNormalizedStoredEnergy: Math.abs(normalizedEconomy.energyEnd.totalJ - normalizedAlways.energyEnd.totalJ) <= NORMALIZATION_TOLERANCE_J,
        counterfactualHadAccident: always.warm.boomDelta + always.measured.boomDelta > 0 || always.warm.zonesCreated + always.measured.zonesCreated > 0,
        quantitativeSavingComparable: always.warm.boomDelta === 0 && always.measured.boomDelta === 0 && always.warm.zonesCreated === 0 && always.measured.zonesCreated === 0 &&
          normalizedAlways.boomDelta === 0 && normalizedEconomy.boomDelta === 0 &&
          Math.abs(eco.measured.energyStart.totalJ - always.measured.energyStart.totalJ) <= 1 &&
          normalizedEconomy.targetReached && normalizedAlways.targetReached &&
          Math.abs(normalizedEconomy.energyEnd.totalJ - normalizedAlways.energyEnd.totalJ) <= NORMALIZATION_TOLERANCE_J },
      acceptanceFailures: failures,
    };
    writeFileSync(JSON_REPORT, JSON.stringify(report, null, 2) + '\n');
    note({ finalReport: JSON_REPORT, fullAcceptance: !SMOKE, acceptanceEvaluated: !SMOKE, elapsedSeconds: performance.now() / 1000,
      physicalNormalizationTicks: normalization.actualTicks,
      normalizedEndStoresJ: normalization.result.map(r => r.energyEnd.totalJ),
      totalFuelConsumedCells: [economyTotalConsumed, alwaysTotalConsumed],
      endurancePass: !SMOKE && (endurance.measured.aboveThresholdFraction >= 0.98 && endurance.measured.averageKW >= MINIMUM_KW && endurance.measured.boomDelta === 0),
      economyPass: !SMOKE && (eco.measured.boomDelta === 0 && eco.measured.fuelLedgerError === 0),
      continuousCounterfactualAccidents: always.warm.boomDelta + always.measured.boomDelta });
    if (!SMOKE) {
      requireAcceptance(report.rodComparison.quantitativeSavingComparable, 'rod saving comparison lacks equal initial/final physical reserves or the counterfactual had an accident');
      report.acceptanceFailures = failures;
      writeFileSync(JSON_REPORT, JSON.stringify(report, null, 2) + '\n');
      if (failures.length) throw new Error(`Long nuclear acceptance criteria failed (${failures.length}):\n- ${failures.join('\n- ')}`);
    }
  } finally {
    (PROTOS.radar.energy as any).kW = originalRadarKW;
  }
}

main().catch(err => {
  const detail = err instanceof Error ? `${err.stack || err.message}` : String(err);
  appendFileSync(LOG, `FAILED ${new Date().toISOString()}\n${detail}\n`);
  console.error(detail);
  process.exitCode = 1;
});
