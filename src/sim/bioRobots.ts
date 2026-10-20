import { TICKS } from '../core/types';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import type { Entity, Game } from './game';
import { BIO_PROFILES, bioLivingTicksLeft, bioSampleProduct, bioTargetReservations, commitBioCorpseSample, commitBioSlimeSample, findBioCorpse, nearbyBioCorpses, type BioSampleMode, type BioTarget } from './bio';
import { creepAt } from './enemies';

export type BioMode = 'corpses' | 'all' | 'film';
export type BioRobotPhase = 'idle' | 'outbound' | 'sampling' | 'return' | 'waiting-output';
export interface BioRobot {
  id: number; homeId: number; x: number; y: number; charge: number; hp: number;
  phase: BioRobotPhase; progress: number; target: BioTarget | null; cargo: string | null;
  /** A dispatched task keeps its mode and physical preservation kit until commit or refund. */
  sampleMode?: BioSampleMode; preservation?: true;
}
interface Runtime { entVersion: number; stations: Entity[]; }
const runtime = new WeakMap<Game, Runtime>();
const SCAN_BUDGET = 128;
const modes = new Set<BioMode>(['corpses', 'all', 'film']);
const families = new Set(['crawler', 'spitter', 'armored', 'destroyer', 'flyer', 'brood', 'giant', 'queen', 'worm']);
const safeCount = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 ? n as number : 0;
const center = (e: Entity): [number, number] => [e.x + e.w / 2, e.y + e.h / 2];
const robotMax = () => (ITEMS['sanitary-robot'].robot?.batteryMJ || 1.5) * 1e6;
const robotDef = ITEMS['sanitary-robot'].robot!;

function stations(g: Game): Entity[] {
  let rt = runtime.get(g);
  if (!rt) { rt = { entVersion: -1, stations: [] }; runtime.set(g, rt); }
  if (rt.entVersion !== g.ents.ver) {
    // Mods may tune the built-in profile, but registry validation rejects bioport clones.
    rt.stations = [...g.ents.values()].filter(e => e.t === 'bioport' && e.proto === 'bio-collection-station');
    rt.entVersion = g.ents.ver;
  }
  return rt.stations;
}

function scanCreep(g: Game, station: Entity) {
  const [cx, cy] = center(station), r = PROTOS[station.proto].bio!.range;
  const x0 = Math.ceil(cx - r - .5), x1 = Math.floor(cx + r - .5), y0 = Math.ceil(cy - r - .5), y1 = Math.floor(cy + r - .5);
  const width = Math.max(1, x1 - x0 + 1), height = Math.max(1, y1 - y0 + 1), total = width * height;
  // The bounded window is derived only from saved simulation state. A restored
  // game at the same tick and station ID examines the same cells.
  const start = ((g.tick % total) * SCAN_BUDGET + (station.id % total) * SCAN_BUDGET) % total;
  const points: { x: number; y: number }[] = [];
  for (let n = 0; n < Math.min(SCAN_BUDGET, total); n++) {
    const i = (start + n) % total, x = x0 + i % width, y = y0 + Math.floor(i / width);
    if (Math.hypot(x + .5 - cx, y + .5 - cy) <= r && creepAt(g, x, y) > 0) points.push({ x, y });
  }
  return points.sort((a, b) => Math.hypot(a.x + .5 - cx, a.y + .5 - cy) - Math.hypot(b.x + .5 - cx, b.y + .5 - cy));
}

function validMode(value: unknown): value is BioMode { return typeof value === 'string' && modes.has(value as BioMode); }
function validFamily(value: unknown): value is string | null { return value === null || typeof value === 'string' && families.has(value); }
function validSampleMode(value: unknown): value is BioSampleMode { return value === 'sample' || value === 'genetic' || value === 'cells'; }
function validSpecies(value: unknown): value is string | null { return value === null || typeof value === 'string' && Object.prototype.hasOwnProperty.call(BIO_PROFILES, value); }
function modeUnlocked(g: Game, mode: BioSampleMode) { return mode === 'sample' || g.research.done.has(mode === 'genetic' ? 'swarm-genomics' : 'cellular-sampling'); }
function allowed(g: Game, station: Entity, target: BioTarget) {
  const mode = validMode(station.bioMode) ? station.bioMode : 'corpses';
  if (target.kind === 'slime') return mode === 'all' && creepAt(g, target.x, target.y) >= 64 || mode === 'film' && creepAt(g, target.x, target.y) > 0 && creepAt(g, target.x, target.y) < 64;
  if (mode === 'film') return false;
  const c = findBioCorpse(g, target.id);
  return !!c && c.remainingSamples > 0 && (!station.bioFamily || station.bioFamily === c.family) && (!station.bioSpecies || station.bioSpecies === c.kind);
}

function outputCanTake(station: Entity, item: string) {
  const output = station.output || {}, have = safeCount(output[item]);
  return have < (ITEMS[item]?.stack || 0) && (output[item] != null || Object.keys(output).length < (PROTOS[station.proto].slots || 48));
}

function claimTarget(g: Game, station: Entity, points: { x: number; y: number }[]): BioTarget | null {
  const [x, y] = center(station), r = PROTOS[station.proto].bio!.range;
  const mode: BioMode = validMode(station.bioMode) ? station.bioMode : 'corpses';
  if (mode !== 'film') {
    for (const c of nearbyBioCorpses(g, x, y, r, 16, 256, station.bioFamily, c => (!station.bioSpecies || station.bioSpecies === c.kind) && (station.bioSampleMode !== 'cells' || bioLivingTicksLeft(g, c) > 3 * TICKS))) {
      const target: BioTarget = { kind: 'corpse', id: c.id };
      if (bioTargetReservations(g, target) < c.remainingSamples) return target;
    }
  }
  for (const p of points) {
    const n = creepAt(g, p.x, p.y);
    if ((mode === 'all' && n >= 64 || mode === 'film' && n > 0 && n < 64) && bioTargetReservations(g, { kind: 'slime', x: p.x, y: p.y }) === 0) return { kind: 'slime', x: p.x, y: p.y };
  }
  return null;
}

function needCapsule(g: Game, target: BioTarget) {
  if (target.kind === 'corpse') return true;
  return creepAt(g, target.x, target.y) >= 64;
}

function targetPoint(g: Game, target: BioTarget): [number, number] | null {
  if (target.kind === 'slime') return [target.x + .5, target.y + .5];
  const c = findBioCorpse(g, target.id);
  return c ? [c.x, c.y] : null;
}

function moveRobot(r: BioRobot, tx: number, ty: number) {
  const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy), step = robotDef.speed / TICKS * (r.charge > 0 ? 1 : .2);
  if (d < 1e-6) return true;
  const v = d > step ? step : d;
  if (d > step) { r.x += dx / d * v; r.y += dy / d * v; }
  else { r.x = tx; r.y = ty; }
  r.charge = Math.max(0, r.charge - robotDef.flyKW * 1000 / TICKS - robotDef.tileKJ * 1000 * v);
  return d <= step;
}

function returnCargo(g: Game, station: Entity, r: BioRobot) {
  if (r.preservation) {
    const have = safeCount(station.input?.['culture-preservation-kit']);
    if (have < ITEMS['culture-preservation-kit'].stack) station.input!['culture-preservation-kit'] = have + 1;
    else g.dropGround(r.x, r.y, 'culture-preservation-kit', 1);
    delete r.preservation;
  }
  delete r.sampleMode;
  if (!r.cargo) return;
  if (r.cargo === 'empty-bio-capsule') {
    const have = safeCount(station.input?.[r.cargo]);
    if (have < (ITEMS[r.cargo]?.stack || 100)) station.input![r.cargo] = have + 1;
    else g.dropGround(station.x + station.w / 2, station.y + station.h / 2, r.cargo, 1);
  } else if (outputCanTake(station, r.cargo)) station.output![r.cargo] = safeCount(station.output![r.cargo]) + 1;
  else { r.phase = 'waiting-output'; return; }
  r.cargo = null; r.phase = 'idle';
}

function beginReturn(r: BioRobot) { r.target = null; r.phase = 'return'; r.progress = 0; }

function sample(g: Game, station: Entity, r: BioRobot) {
  const target = r.target; if (!target) { beginReturn(r); return; }
  if (!allowed(g, station, target)) { beginReturn(r); return; }
  const sampleMode = r.sampleMode || 'sample';
  if (target.kind === 'corpse' && (!modeUnlocked(g, sampleMode) || sampleMode !== 'sample' && !r.preservation)) { beginReturn(r); return; }
  const deliver = (item: string, commit: boolean) => {
    if (!outputCanTake(station, item)) return false;
    if (commit) {
      r.cargo = item;
      const previousSource = g._src;
      try { g._src = station.grp; g.cons('empty-bio-capsule'); if (r.preservation) { g.cons('culture-preservation-kit'); delete r.preservation; } g.prod(item); }
      finally { g._src = previousSource; }
    }
    return true;
  };
  let result: string | null | undefined;
  if (target.kind === 'corpse') result = commitBioCorpseSample(g, target.id, deliver, sampleMode) ?? undefined;
  else result = commitBioSlimeSample(g, target.x, target.y, deliver);
  if (result === undefined) { beginReturn(r); return; }
  if (result === null) r.cargo = null; // film below one capsule clears without consuming a container
  beginReturn(r);
}

/** Deterministic station state machine; old construction robots remain on their existing path. */
export function stepBioRobots(g: Game) {
  const list = stations(g);
  if (!list.length && !g.bioRobots.length) return;

  for (const station of list) {
    station.input ||= {}; station.output ||= {};
    const portBefore = JSON.stringify([station.bioMode, station.bioFamily, station.bioSpecies, station.bioSampleMode, station.bioStatus, station.input, station.output]);
    const syncPortView = () => { if (portBefore !== JSON.stringify([station.bioMode, station.bioFamily, station.bioSpecies, station.bioSampleMode, station.bioStatus, station.input, station.output])) g.fxVer++; };
    station.bioMode = validMode(station.bioMode) ? station.bioMode : 'corpses';
    station.bioFamily = validFamily(station.bioFamily) ? station.bioFamily : null;
    station.bioSpecies = validSpecies(station.bioSpecies) ? station.bioSpecies : null;
    station.bioSampleMode = validSampleMode(station.bioSampleMode) ? station.bioSampleMode : 'sample';
    const bioDef = PROTOS[station.proto].bio!;
    const home = g.bioRobots.filter(r => r.homeId === station.id);
    const present = home.length + safeCount(station.input['sanitary-robot']);
    const points = present ? scanCreep(g, station) : [];
    const actualKW = Math.max(0, station._bioKW || 0);
    const powered = actualKW > 0;
    // One station demand of 120 kW feeds four 30 kW charge spots. The demand
    // enters the ordinary power network; charge is credited from its measured
    // satisfaction below instead of treating the port as free power.
    station.active = safeCount(station.input['sanitary-robot']) > 0 || home.length > 0;
    station.bioStatus = !powered ? 'no-power' : home.length === 0 && !safeCount(station.input['sanitary-robot']) ? 'no-robot' : 'no-target';
    while (powered && home.length < bioDef.robots && safeCount(station.input['sanitary-robot']) > 0) {
      station.input['sanitary-robot']--;
      if (!station.input['sanitary-robot']) delete station.input['sanitary-robot'];
      const [x, y] = center(station);
      const r: BioRobot = { id: g.nextBioRobot++, homeId: station.id, x, y, charge: 0, hp: 20, phase: 'idle', progress: 0, target: null, cargo: null };
      g.bioRobots.push(r); home.push(r);
    }
    const [hx, hy] = center(station);
    const atStation = home.filter(r => r.phase === 'idle' && Math.hypot(r.x - hx, r.y - hy) <= 0.75);
    const spotKW = bioDef.spotKW;
    let remainingKW = actualKW;
    for (const r of atStation.slice(0, bioDef.spots)) {
      const allocatedKW = Math.min(spotKW, remainingKW);
      if (allocatedKW <= 0) break;
      r.charge = Math.min(robotMax(), r.charge + allocatedKW * 1000 / TICKS);
      remainingKW -= allocatedKW;
    }
    for (const r of home) {
      if (r.phase === 'waiting-output') { returnCargo(g, station, r); if (r.phase === 'waiting-output') { station.bioStatus = 'output-full'; continue; } }
      if (r.phase === 'idle') {
        if (!powered) { station.bioStatus = 'no-power'; continue; }
        if (r.charge < robotMax() - 1) { station.bioStatus = 'working'; continue; }
        const target = claimTarget(g, station, points);
        if (!target) {
          if (station.bioSampleMode === 'cells' && station.bioMode !== 'film' && nearbyBioCorpses(g, hx, hy, bioDef.range, 1, 256, station.bioFamily, c => (!station.bioSpecies || station.bioSpecies === c.kind) && bioLivingTicksLeft(g, c) <= 3 * TICKS).length) station.bioStatus = 'cells-expired';
          continue;
        }
        const sampleMode = target.kind === 'corpse' ? station.bioSampleMode : 'sample';
        if (!modeUnlocked(g, sampleMode)) { station.bioStatus = 'no-research'; continue; }
        if (sampleMode !== 'sample' && !safeCount(station.input['culture-preservation-kit'])) { station.bioStatus = 'no-preservation'; continue; }
        if (needCapsule(g, target)) {
          const have = safeCount(station.input['empty-bio-capsule']);
          if (!have) { station.bioStatus = 'no-capsule'; continue; }
          const outputItem = target.kind === 'corpse' ? bioSampleProduct(findBioCorpse(g, target.id)!, sampleMode) : 'raw-slime-capsule';
          if (!outputItem || !outputCanTake(station, outputItem)) { station.bioStatus = 'output-full'; continue; }
          station.input['empty-bio-capsule'] = have - 1; if (!station.input['empty-bio-capsule']) delete station.input['empty-bio-capsule'];
          r.cargo = 'empty-bio-capsule';
          r.sampleMode = sampleMode;
          if (sampleMode !== 'sample') { if (--station.input['culture-preservation-kit'] === 0) delete station.input['culture-preservation-kit']; r.preservation = true; }
        }
        r.target = target; r.phase = 'outbound'; r.progress = 0; station.bioStatus = 'working';
      }
      if (r.phase === 'outbound') {
        const tp = r.target && targetPoint(g, r.target);
        if (!tp || !r.target || !allowed(g, station, r.target) || r.sampleMode === 'cells' && r.target.kind === 'corpse' && !bioLivingTicksLeft(g, findBioCorpse(g, r.target.id)!)) { beginReturn(r); continue; }
        if (moveRobot(r, tp[0], tp[1])) {
          if (!allowed(g, station, r.target)) { beginReturn(r); continue; }
          r.phase = 'sampling'; r.progress = r.target.kind === 'corpse' ? 3 * TICKS : 2 * TICKS;
        }
      } else if (r.phase === 'sampling') {
        if (!r.target || !allowed(g, station, r.target)) { beginReturn(r); continue; }
        if (--r.progress <= 0) sample(g, station, r);
      } else if (r.phase === 'return') {
        const [hx, hy] = center(station);
        if (moveRobot(r, hx, hy)) { r.target = null; r.progress = 0; returnCargo(g, station, r); const phase = r.phase as BioRobotPhase; if (phase !== 'waiting-output') r.phase = 'idle'; }
      }
    }
    if (station.bioStatus !== 'output-full' && home.some(r => r.phase === 'outbound' || r.phase === 'sampling' || r.phase === 'return')) station.bioStatus = 'working';
    if (station.bioStatus === 'no-target' && safeCount(station.input['empty-bio-capsule']) === 0 && station.bioMode !== 'film') station.bioStatus = 'no-capsule';
    station.active = safeCount(station.input['sanitary-robot']) > 0 || home.length > 0;
    syncPortView();
  }

  // Robots whose station disappeared through a non-standard mutation are destroyed without creating an item.
  for (let i = g.bioRobots.length - 1; i >= 0; i--) if (!g.ents.has(g.bioRobots[i].homeId)) {
    const r = g.bioRobots[i]; if (r.cargo) g.dropGround(r.x, r.y, r.cargo, 1); if (r.preservation) g.dropGround(r.x, r.y, 'culture-preservation-kit', 1); g.bioRobots.splice(i, 1);
  }
}

export function removeBioStation(g: Game, station: Entity, toPlayer: boolean, give: (item: string, n: number) => void) {
  for (let i = g.bioRobots.length - 1; i >= 0; i--) {
    const r = g.bioRobots[i]; if (r.homeId !== station.id) continue;
    if (toPlayer) { give('sanitary-robot', 1); if (r.cargo) give(r.cargo, 1); if (r.preservation) give('culture-preservation-kit', 1); }
    else { if (r.cargo) g.dropGround(r.x, r.y, r.cargo, 1); if (r.preservation) g.dropGround(r.x, r.y, 'culture-preservation-kit', 1); }
    g.bioRobots.splice(i, 1);
  }
}

export function damageBioRobot(g: Game, id: number, damage: number) {
  const r = g.bioRobots.find(v => v.id === id); if (!r || !Number.isFinite(damage) || damage <= 0) return false;
  r.hp -= damage;
  if (r.hp > 0) return true;
  if (r.cargo) g.dropGround(r.x, r.y, r.cargo, 1);
  if (r.preservation) g.dropGround(r.x, r.y, 'culture-preservation-kit', 1);
  g.fx.push({ k: 'hit', x: r.x, y: r.y, t: 18, s: .5 });
  g.bioRobots.splice(g.bioRobots.indexOf(r), 1);
  return true;
}

/** Normalize expired persistent targets after the simulation tick advances, before save/snapshot can observe them. */
export function expireBioRobotTargets(g: Game) {
  for (const r of g.bioRobots) {
    if (r.target?.kind !== 'corpse' || findBioCorpse(g, r.target.id)) continue;
    r.target = null;
    if (r.phase === 'outbound' || r.phase === 'sampling') { r.phase = 'return'; r.progress = 0; }
  }
}

export function validateBioRobotMode(mode: unknown, family: unknown, sampleMode: unknown = 'sample', species: unknown = null) { return validMode(mode) && validFamily(family) && validSampleMode(sampleMode) && validSpecies(species); }
