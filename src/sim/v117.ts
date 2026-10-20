import { ITEMS } from '../data/items';
import { BIO_V117_SOURCES } from '../data/biomaterials';
import { TICKS } from '../core/types';

/** Versioned state owned by the 1.17 simulation. Keep it in one root so saves,
 * deterministic hashes, late joins and native multiplayer share the same schema. */
export const V117_SCHEMA = 1;

export interface V117Command {
  t: 'v117';
  section: 'genetics' | 'speaker' | 'melee' | 'drones' | 'chest' | 'inventory' | 'alerts' | 'training';
  op: string;
  opId: string;
  [key: string]: unknown;
}

export interface GenomeEntry { family: string; sample: number; genetic: number; analyzed: boolean; }
export interface CultureBank { entityId: number; labId: number; family: string; species: string; cells: number; nutrient: number; unpoweredTicks: number; }
export interface GeneticLab { entityId: number; progress: number; family: string | null; input: Record<string, number>; output: Record<string, number>; activity?: { kind: 'found' | 'divide'; bankId: number; species: string }; }
export type FabricatorStage = 'queued' | 'cell-prep' | 'growth' | 'controller' | 'ready' | 'blocked' | 'culturing' | 'assembling';
export interface FabricatorJob {
  id: number; family: string; stage: FabricatorStage; progress: number; paid: Record<string, number>; owner: string; fabId: number; body?: Bioform;
  /** Unprocessed dry ingredients held aside from the fabricator input buffer. */
  reserved?: Record<string, number>;
  /** Resource inputs already paid at the beginning of each live production phase. */
  startedStages?: ('cell-prep' | 'growth' | 'controller')[];
  /** Byproducts are committed once when the body enters ready, even if release is blocked. */
  outputsDone?: boolean;
}
export interface BioformOrder { mode: 'follow' | 'move' | 'patrol' | 'hold' | 'return'; waypoints: { x: number; y: number }[]; combat: boolean; followPlayer?: string; patrolMode?: 'loop' | 'pingpong'; cursor?: number; direction?: 1 | -1; offset?: { x: number; y: number }; origin?: { x: number; y: number }; }
export interface Bioform {
  id: number; family: string; owner: string; x: number; y: number; hp: number; maxHp: number;
  sterile: boolean; food: number; foodTimer: number; foodCapsule: number; emptyCapsuleDue: boolean; starvedTicks: number; repair: number; disconnected: number; attackCooldown: number;
  order: BioformOrder; target: number | null; dead: boolean; squad?: string;
  wormStage?: 'folding' | 'travelling' | 'unfolding' | 'deployed'; wormTicks?: number;
  /** Individual destroyer order; absent means self-detonation disabled. */
  detonationTicks?: number;
  /** Deterministic size-aware route cache. The order and live coordinates remain authoritative. */
  path?: { x: number; y: number }[]; pathTarget?: { x: number; y: number }; pathAt?: number;
  retaliation?: { kind: 'unit' | 'entity'; id: number; until: number };
  autoReturn?: boolean;
  lastContact?: number;
}
/** Nutrition is 2 W units per game minute; the saved partial minute is already spent. */
export function bioFoodSeconds(f: Pick<Bioform, 'family' | 'food' | 'foodCapsule' | 'foodTimer'>): number {
  const weight = BIO_V117_SOURCES.find(s => s.kind === f.family)?.w || 0;
  return weight > 0 ? Math.max(0, Math.min(600, f.food * 30 / weight) - f.foodTimer / TICKS) : 0;
}
/** One opened physical feeding capsule, retained at its source until completely drained. */
export interface NutritionFeeder { remaining: number; emptyDue: boolean; }
export type V117SpeakerSound = 'attack-siren' | 'short-alert' | 'bell' | 'warning-horn' | 'completion';
export type V117SpeakerPlayback = 'once' | 'repeat' | 'continuous';
export interface V117SpeakerEvent { id: number; emitter: number; listener: string | null; group: string; sound: V117SpeakerSound; x: number; y: number; tick: number; radius: number; volume: number; range: 'local' | 'global'; playback: V117SpeakerPlayback; loop: boolean; }
export interface V117SpeakerConfig {
  entityId: number; mode: 'off' | 'manual' | 'circuit'; sound: V117SpeakerSound; group: string; label: string;
  range: 'local' | 'global'; radius: number; volume: number; playback: V117SpeakerPlayback; intervalTicks: number; pauseTicks: number; visual: boolean;
  manualOn: boolean; requested: boolean; active: boolean; nextStart: number; nextRepeat: number; playingUntil: number;
}
export interface MeleePlayerState { weapon: string | null; charges: number; cooldown: number; windup: number; facing: number; attackId: number; hit: boolean; }
export type DroneModel = 'gunner' | 'interceptor' | 'rocket' | 'tesla' | 'flame' | 'repair';
export const DRONE_MODELS: Record<DroneModel, { hp: number; speed: number; units: number; damage: number; damageType: 'phys' | 'laser' | 'expl' | 'elec' | 'fire'; cooldown: number; range: number; ammoItem: string | null; ammoLimit: number; energyPerUse: number; area: number; air: boolean }> = {
  gunner: { hp: 100, speed: 6, units: 1, damage: 5, damageType: 'phys', cooldown: 12, range: 12, ammoItem: 'firearm-magazine', ammoLimit: 50, energyPerUse: 5_000, area: 0, air: true },
  interceptor: { hp: 80, speed: 9, units: 1, damage: 18, damageType: 'laser', cooldown: 24, range: 14, ammoItem: null, ammoLimit: 0, energyPerUse: 40_000, area: 0, air: true },
  rocket: { hp: 160, speed: 5, units: 2, damage: 60, damageType: 'expl', cooldown: 72, range: 16, ammoItem: 'rocket', ammoLimit: 8, energyPerUse: 80_000, area: 1.4, air: false },
  tesla: { hp: 120, speed: 6, units: 2, damage: 36, damageType: 'elec', cooldown: 54, range: 10, ammoItem: null, ammoLimit: 0, energyPerUse: 90_000, area: 0, air: false },
  flame: { hp: 90, speed: 5, units: 2, damage: 30, damageType: 'fire', cooldown: 30, range: 8, ammoItem: 'flamethrower-ammo', ammoLimit: 100, energyPerUse: 20_000, area: 0, air: false },
  repair: { hp: 120, speed: 5, units: 1, damage: 0, damageType: 'phys', cooldown: 60, range: 4, ammoItem: null, ammoLimit: 0, energyPerUse: 20_000, area: 0, air: false },
};
export interface DroneInstance { id: number; model: DroneModel; owner: string; source: 'port' | 'personal'; hp: number; maxHp: number; charge: number; ammo: number; ammoType: string | null; x: number; y: number; mode: 'flying' | 'returning' | 'combat' | 'repair' | 'landed' | 'disabled'; home: number | null; target: number | null; repairTargetKind?: 'drone'; repair: number; cooldown: number; }
export interface DronePortState { entityId: number; owner: string; module: string | null; buffer: number; hangar: number[]; targetZone: 'near' | 'area' | 'global'; radius: number; enabled: boolean; centerX?: number; centerY?: number; autoLaunch?: boolean; priority?: DroneModel | null; }
export const validDronePriority = (value: unknown): value is DroneModel | null => value === null || typeof value === 'string' && Object.hasOwn(DRONE_MODELS, value);
export interface CombatEffect { key: string; kind: 'acid-coating' | 'slow'; owner: number; item: string; expiresTick: number; amount: number; }

export interface V117State {
  schema: 1;
  nextForm: number; nextJob: number; nextDrone: number; nextSpeakerEvent: number; nextPlayer: number; playerIds: string[];
  /** Operation IDs make retries safe at the worker/native authority boundary. */
  operations: { owner: string; opId: string; tick: number }[];
  genetics: {
    library: Record<string, GenomeEntry>;
    banks: Record<string, CultureBank>;
    labs: Record<string, GeneticLab>;
    jobs: FabricatorJob[];
    forms: Bioform[];
    alerts: { key: string; tick: number }[];
    feeders?: Record<string, NutritionFeeder>;
  };
  speakers: { configs: Record<string, V117SpeakerConfig>; events: V117SpeakerEvent[]; radar: Record<string, { radius: number; count: number; attacking: boolean; attackedUntil: number; enabled: boolean }> };
  melee: Record<string, MeleePlayerState>;
  drones: { instances: DroneInstance[]; ports: Record<string, DronePortState>; alerts: { key: string; tick: number }[] };
  combatEffects: Record<string, CombatEffect>;
  inventory: { expanded: number[]; cheatsUsed: boolean };
  tutorial: Record<string, { step: number; done: boolean }>;
}

export function newV117State(): V117State {
  return {
    schema: V117_SCHEMA, nextForm: 1, nextJob: 1, nextDrone: 1, nextSpeakerEvent: 1, nextPlayer: 2, playerIds: ['player-1'],
    operations: [],
    genetics: { library: {}, banks: {}, labs: {}, jobs: [], forms: [], alerts: [] },
    speakers: { configs: {}, events: [], radar: {} }, melee: {},
    drones: { instances: [], ports: {}, alerts: [] }, combatEffects: {},
    inventory: { expanded: [], cheatsUsed: false }, tutorial: {},
  };
}

const plain = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
/** Bound both object depth and total work before walking data from saves/network snapshots. */
const finiteTree = (root: any): boolean => {
  const stack: { value: any; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value: v, depth } = stack.pop()!;
    if (++visited > 250_000 || depth > 64) return false;
    if (v == null || typeof v === 'string' || typeof v === 'boolean') { if (typeof v === 'string' && v.length > 262_144) return false; continue; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) return false; continue; }
    if (Array.isArray(v)) { if (v.length > 100_000) return false; for (let i = v.length - 1; i >= 0; i--) stack.push({ value: v[i], depth: depth + 1 }); continue; }
    if (!plain(v)) return false;
    const keys = Object.keys(v); if (keys.length > 20_000) return false;
    for (const key of keys) { if (key.length > 1024) return false; stack.push({ value: v[key], depth: depth + 1 }); }
  }
  return true;
};

/** Validate saved 1.17 state before it reaches the world. No functions, prototype
 * objects, NaN/Infinity, or incompatible schema versions may enter deterministic state. */
export function validateV117(value: unknown): asserts value is V117State {
  const s: any = value;
  const fail = () => { throw new Error('Некорректное состояние 1.17 в сохранении'); };
  if (!plain(s) || s.schema !== V117_SCHEMA || !finiteTree(s)) fail();
  const keys = ['schema', 'nextForm', 'nextJob', 'nextDrone', 'nextSpeakerEvent', 'nextPlayer', 'playerIds', 'operations', 'genetics', 'speakers', 'melee', 'drones', 'combatEffects', 'inventory', 'tutorial'];
  if (Object.keys(s).sort().join(',') !== keys.sort().join(',')) fail();
  for (const k of ['nextForm', 'nextJob', 'nextDrone', 'nextSpeakerEvent', 'nextPlayer']) if (!Number.isSafeInteger(s[k]) || s[k] < 1) fail();
  if (!Array.isArray(s.playerIds) || s.playerIds.length < 1 || s.playerIds.length > 16 || s.playerIds.some((id: any) => typeof id !== 'string' || !/^player-[1-9][0-9]{0,12}$/.test(id)) || new Set(s.playerIds).size !== s.playerIds.length) fail();
  if (!Array.isArray(s.operations) || s.operations.length > 4096 || !plain(s.genetics) || !plain(s.genetics.library) || !plain(s.genetics.banks) || !plain(s.genetics.labs) || !Array.isArray(s.genetics.jobs) || !Array.isArray(s.genetics.forms) || !Array.isArray(s.genetics.alerts)) fail();
  if (!plain(s.speakers) || !plain(s.speakers.configs) || !Array.isArray(s.speakers.events) || !plain(s.speakers.radar) || !plain(s.melee)) fail();
  if (!plain(s.drones) || !Array.isArray(s.drones.instances) || !plain(s.drones.ports) || !Array.isArray(s.drones.alerts) || !plain(s.combatEffects)) fail();
  if (s.genetics.feeders !== undefined) {
    if (!plain(s.genetics.feeders) || Object.keys(s.genetics.feeders).length > 4096) fail();
    for (const [key, row] of Object.entries<any>(s.genetics.feeders) as [string, any][]) {
      if (!/^e:[1-9][0-9]{0,12}$/.test(key) && !(key.startsWith('p:') && s.playerIds.includes(key.slice(2)))) fail();
      if (!plain(row) || Object.keys(row).sort().join(',') !== 'emptyDue,remaining' || !Number.isFinite(row.remaining) || row.remaining < 0 || row.remaining > 20 || typeof row.emptyDue !== 'boolean' || (row.emptyDue ? row.remaining !== 0 : row.remaining <= 0)) fail();
    }
  }
  if (!plain(s.inventory) || !Array.isArray(s.inventory.expanded) || s.inventory.expanded.length > 16 || s.inventory.expanded.some((n: any) => !Number.isSafeInteger(n) || n < 32 || n > 256 || n % 32 !== 0) || typeof s.inventory.cheatsUsed !== 'boolean' || !plain(s.tutorial)) fail();
  const seen = new Set<string>();
  for (const op of s.operations) {
    if (!plain(op) || typeof op.owner !== 'string' || !s.playerIds.includes(op.owner) || typeof op.opId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(op.opId) || !Number.isSafeInteger(op.tick) || op.tick < 0) fail();
    const key = `${op.owner}:${op.opId}`; if (seen.has(key)) fail(); seen.add(key);
  }
  const ids = (rows: any[], key: string, next: number) => {
    const found = new Set<number>(); let max = 0;
    for (const row of rows) { if (!plain(row) || !Number.isSafeInteger(row[key]) || row[key] < 1 || found.has(row[key])) fail(); found.add(row[key]); max = Math.max(max, row[key]); }
    if (next <= max) fail();
  };
  ids([...s.genetics.forms, ...s.genetics.jobs.flatMap((j: any) => j?.body ? [j.body] : [])], 'id', s.nextForm); ids(s.genetics.jobs, 'id', s.nextJob); ids(s.drones.instances, 'id', s.nextDrone); ids(s.speakers.events, 'id', s.nextSpeakerEvent);
  const keysAre = (row: any, keys: string[]) => plain(row) && Object.keys(row).sort().join(',') === keys.slice().sort().join(',');
  const species = new Map(BIO_V117_SOURCES.map(x => [x.kind, x.family]));
  const counts = (row: any, max = 1_000_000) => plain(row) && Object.keys(row).length <= 128 && Object.entries(row).every(([id, n]) => !!ITEMS[id] && Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max);
  for (const [id, row] of Object.entries<any>(s.tutorial)) if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || !keysAre(row, ['step', 'done']) || !Number.isSafeInteger(row.step) || row.step < 0 || row.step > 100 || typeof row.done !== 'boolean') fail();
  for (const [owner, row] of Object.entries<any>(s.melee)) if (!s.playerIds.includes(owner) || !keysAre(row, ['weapon', 'charges', 'cooldown', 'windup', 'facing', 'attackId', 'hit']) || row.weapon !== null && !ITEMS[row.weapon]?.melee || !Number.isSafeInteger(row.charges) || row.charges < 0 || row.charges > 20 || !Number.isSafeInteger(row.cooldown) || row.cooldown < 0 || !Number.isSafeInteger(row.windup) || row.windup < 0 || !Number.isFinite(row.facing) || Math.abs(row.facing) > Math.PI * 2 || !Number.isSafeInteger(row.attackId) || row.attackId < 0 || typeof row.hit !== 'boolean') fail();
  for (const [key, row] of Object.entries<any>(s.genetics.banks)) if (!keysAre(row, ['entityId', 'labId', 'family', 'species', 'cells', 'nutrient', 'unpoweredTicks']) || key !== `${row.entityId}:${row.species}` || !Number.isSafeInteger(row.entityId) || row.entityId < 1 || !Number.isSafeInteger(row.labId) || row.labId < 1 || species.get(row.species) !== row.family || !Number.isSafeInteger(row.cells) || row.cells < 0 || row.cells > 100 || !Number.isFinite(row.nutrient) || row.nutrient < 0 || row.nutrient > 100_000 || !Number.isSafeInteger(row.unpoweredTicks) || row.unpoweredTicks < 0) fail();
  for (const [key, row] of Object.entries<any>(s.genetics.labs)) if (!keysAre(row, ['entityId', 'progress', 'family', 'input', 'output', 'activity']) && !keysAre(row, ['entityId', 'progress', 'family', 'input', 'output']) || !Number.isSafeInteger(row.entityId) || row.entityId !== Number(key) || row.entityId < 1 || !Number.isSafeInteger(row.progress) || row.progress < 0 || row.progress > 3600 || row.family !== null && !species.has(row.family) || !counts(row.input) || !counts(row.output) || row.activity !== undefined && (!keysAre(row.activity, ['kind', 'bankId', 'species']) || !['found', 'divide'].includes(row.activity.kind) || !Number.isSafeInteger(row.activity.bankId) || row.activity.bankId < 1 || !species.has(row.activity.species) || row.family !== row.activity.species)) fail();
  const formKeys = ['id', 'family', 'owner', 'x', 'y', 'hp', 'maxHp', 'sterile', 'food', 'foodTimer', 'foodCapsule', 'emptyCapsuleDue', 'starvedTicks', 'repair', 'disconnected', 'attackCooldown', 'order', 'target', 'dead'];
  const keysAllowed = (row: any, required: string[], optional: string[]) => plain(row) && required.every(k => Object.prototype.hasOwnProperty.call(row, k)) && Object.keys(row).every(k => required.includes(k) || optional.includes(k));
  const validBioform = (row: any) => {
    const worm = String(row?.family).startsWith('worm-');
    const foodCap = 20 * (BIO_V117_SOURCES.find(source => source.kind === row?.family)?.w || 0);
    return keysAllowed(row, formKeys, ['wormStage', 'wormTicks', 'detonationTicks', 'squad', 'path', 'pathTarget', 'pathAt', 'retaliation', 'autoReturn', 'lastContact']) &&
      (row.detonationTicks === undefined || row.family === 'destroyer' && !row.dead && row.hp > 0 && Number.isSafeInteger(row.detonationTicks) && row.detonationTicks >= 1 && row.detonationTicks <= 120) &&
      (row.autoReturn === undefined || typeof row.autoReturn === 'boolean') &&
      (row.lastContact === undefined || Number.isSafeInteger(row.lastContact) && row.lastContact >= 0) &&
      (row.retaliation === undefined || keysAre(row.retaliation, ['kind', 'id', 'until']) && ['unit', 'entity'].includes(row.retaliation.kind) && Number.isSafeInteger(row.retaliation.id) && row.retaliation.id > 0 && Number.isSafeInteger(row.retaliation.until) && row.retaliation.until >= 0) &&
      (row.wormStage === undefined || worm && ['folding', 'travelling', 'unfolding', 'deployed'].includes(row.wormStage) && Number.isSafeInteger(row.wormTicks) && row.wormTicks >= 0 && row.wormTicks <= 5 * 60 * 60) &&
      (row.wormStage !== undefined || row.wormTicks === undefined) && species.has(row.family) && s.playerIds.includes(row.owner) &&
      Number.isFinite(row.x) && Math.abs(row.x) <= 1_000_000 && Number.isFinite(row.y) && Math.abs(row.y) <= 1_000_000 &&
      Number.isFinite(row.hp) && Number.isFinite(row.maxHp) && row.hp >= 0 && row.maxHp >= 1 && row.hp <= row.maxHp &&
      typeof row.dead === 'boolean' && typeof row.sterile === 'boolean' && Number.isFinite(row.food) && row.food >= 0 && row.food <= foodCap &&
      Number.isSafeInteger(row.foodTimer) && row.foodTimer >= 0 && row.foodTimer < 3600 && Number.isFinite(row.foodCapsule) && row.foodCapsule >= 0 && row.foodCapsule <= 20 &&
      typeof row.emptyCapsuleDue === 'boolean' && Number.isSafeInteger(row.starvedTicks) && row.starvedTicks >= 0 && Number.isFinite(row.repair) && row.repair >= 0 &&
      Number.isSafeInteger(row.disconnected) && row.disconnected >= 0 && Number.isSafeInteger(row.attackCooldown) && row.attackCooldown >= 0 &&
      (row.squad === undefined || typeof row.squad === 'string' && row.squad.length > 0 && row.squad.length <= 32 && !/[\u0000-\u001f\u007f]/.test(row.squad)) &&
      (row.path === undefined ? row.pathTarget === undefined && row.pathAt === undefined : Array.isArray(row.path) && row.path.length <= 128 && row.path.every((p: any) => keysAre(p, ['x', 'y']) && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && Math.abs(p.x) <= 65536 && Math.abs(p.y) <= 65536) && keysAre(row.pathTarget, ['x', 'y']) && Number.isSafeInteger(row.pathTarget.x) && Number.isSafeInteger(row.pathTarget.y) && Math.abs(row.pathTarget.x) <= 65536 && Math.abs(row.pathTarget.y) <= 65536 && Number.isSafeInteger(row.pathAt) && row.pathAt >= 0) &&
      (row.target === null || Number.isSafeInteger(row.target)) && keysAllowed(row.order, ['mode', 'waypoints', 'combat'], ['followPlayer', 'patrolMode', 'cursor', 'direction', 'offset', 'origin']) &&
      (row.order.origin === undefined || ['move', 'patrol'].includes(row.order.mode) && keysAre(row.order.origin, ['x', 'y']) && Number.isSafeInteger(row.order.origin.x) && Math.abs(row.order.origin.x) <= 65536 && Number.isSafeInteger(row.order.origin.y) && Math.abs(row.order.origin.y) <= 65536) &&
      (row.order.offset === undefined || ['move', 'patrol'].includes(row.order.mode) && keysAllowed(row.order.offset, ['x', 'y'], []) && Number.isSafeInteger(row.order.offset.x) && Math.abs(row.order.offset.x) <= 128 && Number.isSafeInteger(row.order.offset.y) && Math.abs(row.order.offset.y) <= 128) &&
      (row.order.followPlayer === undefined || typeof row.order.followPlayer === 'string' && s.playerIds.includes(row.order.followPlayer)) &&
      ['follow', 'move', 'patrol', 'hold', 'return'].includes(row.order.mode) && typeof row.order.combat === 'boolean' && Array.isArray(row.order.waypoints) &&
      row.order.waypoints.length <= 16 && (row.order.mode === 'patrol' ? row.order.waypoints.length >= 2 : row.order.mode === 'move' ? row.order.waypoints.length === 1 : row.order.mode === 'hold' ? row.order.waypoints.length <= 1 : row.order.waypoints.length === 0) &&
      (row.order.patrolMode === undefined || row.order.mode === 'patrol' && ['loop', 'pingpong'].includes(row.order.patrolMode)) &&
      (row.order.cursor === undefined || row.order.mode === 'patrol' && Number.isSafeInteger(row.order.cursor) && row.order.cursor >= 0 && row.order.cursor < row.order.waypoints.length) &&
      (row.order.direction === undefined || row.order.mode === 'patrol' && (row.order.direction === 1 || row.order.direction === -1)) &&
      row.order.waypoints.every((p: any) => keysAre(p, ['x', 'y']) && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && Math.abs(p.x) <= 65536 && Math.abs(p.y) <= 65536);
  };
  const jobKeys = ['id', 'family', 'stage', 'progress', 'paid', 'owner', 'fabId'];
  for (const row of s.genetics.jobs) if (!keysAllowed(row, jobKeys, ['body', 'reserved', 'startedStages', 'outputsDone']) || !species.has(row.family) || !Number.isSafeInteger(row.fabId) || row.fabId < 1 || !s.playerIds.includes(row.owner) || !['queued', 'cell-prep', 'growth', 'controller', 'ready', 'blocked', 'culturing', 'assembling'].includes(row.stage) || !Number.isSafeInteger(row.progress) || row.progress < 0 || row.progress > 1_000_000 || !counts(row.paid, 1_000_000) || row.reserved !== undefined && !counts(row.reserved, 1_000_000) || row.startedStages !== undefined && (!Array.isArray(row.startedStages) || row.startedStages.length > 3 || new Set(row.startedStages).size !== row.startedStages.length || row.startedStages.some((x: any) => !['cell-prep', 'growth', 'controller'].includes(x))) || row.outputsDone !== undefined && typeof row.outputsDone !== 'boolean' || row.body !== undefined && (!validBioform(row.body) || row.body.family !== row.family || row.body.owner !== row.owner)) fail();
  for (const row of s.genetics.forms) if (!validBioform(row)) fail();
  const squads = new Map<string, Map<string, number>>();
  for (const row of s.genetics.forms) if (!row.dead && row.squad) {
    let owned = squads.get(row.owner); if (!owned) squads.set(row.owner, owned = new Map());
    const size = (owned.get(row.squad) || 0) + 1; owned.set(row.squad, size);
    if (size > 16 || owned.size > 4) fail();
  }
  const sounds = new Set(['attack-siren', 'short-alert', 'bell', 'warning-horn', 'completion']);
  const oldSounds = new Set(['alert', 'ping', 'research', 'craft', 'build', 'error', 'boom', 'squish', 'acid', 'laser', 'ui', 'pickup', 'death', 'goal']);
  for (const [key, row] of Object.entries<any>(s.speakers.configs)) {
    const modern = keysAre(row, ['entityId', 'mode', 'sound', 'group', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual', 'manualOn', 'requested', 'active', 'nextStart', 'nextRepeat', 'playingUntil']);
    const current = keysAre(row, ['entityId', 'mode', 'sound', 'group', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual', 'manualOn', 'requested', 'active', 'nextStart', 'nextRepeat']);
    const legacy = keysAre(row, ['entityId', 'mode', 'sound', 'group', 'range', 'repeat', 'continuous', 'lastTick']);
    if ((!modern && !current && !legacy) || key !== String(row.entityId) || !Number.isSafeInteger(row.entityId) || row.entityId < 1 || !['off', 'manual', 'circuit'].includes(row.mode) || !(modern || current ? sounds : oldSounds).has(row.sound) || typeof row.group !== 'string' || row.group.length > (modern || current ? 32 : 24) || !/^[A-Za-z0-9_-]*$/.test(row.group) || !['local', 'global'].includes(row.range)) fail();
    if ((modern || current) && (typeof row.label !== 'string' || row.label.length > 64 || !Number.isSafeInteger(row.radius) || row.radius < 8 || row.radius > 64 || !Number.isSafeInteger(row.volume) || row.volume < 0 || row.volume > 100 || !['once', 'repeat', 'continuous'].includes(row.playback) || !Number.isSafeInteger(row.intervalTicks) || row.intervalTicks < 60 || row.intervalTicks > 3600 || !Number.isSafeInteger(row.pauseTicks) || row.pauseTicks < 60 || row.pauseTicks > 3600 || typeof row.visual !== 'boolean' || typeof row.manualOn !== 'boolean' || typeof row.requested !== 'boolean' || typeof row.active !== 'boolean' || !Number.isSafeInteger(row.nextStart) || row.nextStart < 0 || !Number.isSafeInteger(row.nextRepeat) || row.nextRepeat < 0) || modern && (!Number.isSafeInteger(row.playingUntil) || row.playingUntil < 0)) fail();
    if (legacy && (!Number.isSafeInteger(row.repeat) || row.repeat < 0 || row.repeat > 36000 || typeof row.continuous !== 'boolean' || !Number.isSafeInteger(row.lastTick))) fail();
  }
  for (const row of s.speakers.events) {
    const modern = keysAre(row, ['id', 'emitter', 'listener', 'group', 'sound', 'x', 'y', 'tick', 'radius', 'volume', 'range', 'playback', 'loop']);
    const current = keysAre(row, ['id', 'emitter', 'listener', 'group', 'sound', 'x', 'y', 'tick', 'radius', 'volume', 'range', 'loop']);
    const legacy = keysAre(row, ['id', 'emitter', 'group', 'sound', 'x', 'y', 'tick', 'loop']);
    if ((!modern && !current && !legacy) || !Number.isSafeInteger(row.emitter) || row.emitter < 1 || (modern || current) && row.listener !== null && !s.playerIds.includes(row.listener) || typeof row.group !== 'string' || row.group.length > 32 || !(modern || current ? sounds : oldSounds).has(row.sound) || !Number.isFinite(row.x) || !Number.isFinite(row.y) || !Number.isSafeInteger(row.tick) || row.tick < 0 || typeof row.loop !== 'boolean' || modern && !['once', 'repeat', 'continuous'].includes(row.playback) || (modern || current) && (!Number.isSafeInteger(row.radius) || row.radius < 8 || row.radius > 64 || !Number.isSafeInteger(row.volume) || row.volume < 0 || row.volume > 100 || !['local', 'global'].includes(row.range))) fail();
  }
  for (const [key, row] of Object.entries<any>(s.speakers.radar)) if (!(keysAre(row, ['radius', 'count', 'attacking', 'attackedUntil', 'enabled']) || keysAre(row, ['radius', 'count', 'attackedUntil', 'enabled'])) || !/^\d+$/.test(key) || !Number.isSafeInteger(row.radius) || row.radius < 2 || row.radius > 64 || !Number.isSafeInteger(row.count) || row.count < 0 || typeof row.attacking !== 'undefined' && typeof row.attacking !== 'boolean' || !Number.isSafeInteger(row.attackedUntil) || row.attackedUntil < 0 || typeof row.enabled !== 'boolean') fail();
  const droneModels = new Set(Object.keys(DRONE_MODELS));
  for (const row of s.drones.instances) {
    if (!plain(row)) fail();
    const { repairTargetKind, ...base } = row;
    if (repairTargetKind !== undefined && (repairTargetKind !== 'drone' || row.model !== 'repair' || row.target !== null && (!Number.isSafeInteger(row.target) || row.target < 1))) fail();
    const spec = DRONE_MODELS[row?.model as DroneModel];
    if (!(keysAre(base, ['id', 'model', 'owner', 'source', 'hp', 'maxHp', 'charge', 'ammo', 'ammoType', 'x', 'y', 'mode', 'home', 'target', 'repair', 'cooldown']) || keysAre(base, ['id', 'model', 'owner', 'hp', 'maxHp', 'charge', 'ammo', 'ammoType', 'x', 'y', 'mode', 'home', 'target', 'repair', 'cooldown'])) || !spec || !s.playerIds.includes(row.owner) || row.source !== undefined && !['port', 'personal'].includes(row.source) || !Number.isFinite(row.hp) || row.hp < 0 || row.hp > spec.hp || row.maxHp !== spec.hp || !Number.isFinite(row.charge) || row.charge < 0 || row.charge > 2_000_000 || !Number.isSafeInteger(row.ammo) || row.ammo < 0 || row.ammo > Math.max(spec.ammoLimit, spec.ammoLimit * 10) || row.ammoType !== null && !ITEMS[row.ammoType]?.am || !Number.isFinite(row.x) || Math.abs(row.x) > 1_000_000 || !Number.isFinite(row.y) || Math.abs(row.y) > 1_000_000 || !['flying', 'returning', 'combat', 'repair', 'landed', 'disabled'].includes(row.mode) || row.home !== null && !Number.isSafeInteger(row.home) || row.source === 'personal' && row.home !== null || row.target !== null && !Number.isSafeInteger(row.target) || !Number.isFinite(row.repair) || row.repair < 0 || row.repair > 400 || !Number.isSafeInteger(row.cooldown) || row.cooldown < 0 || row.cooldown > 3600) fail();
  }
  for (const [key, row] of Object.entries<any>(s.drones.ports)) { if (!plain(row)) fail(); const { priority, ...base } = row; if (priority !== undefined && !validDronePriority(priority)) fail(); if (!(keysAre(base, ['entityId', 'owner', 'module', 'buffer', 'hangar', 'targetZone', 'radius', 'enabled']) || keysAre(base, ['entityId', 'owner', 'module', 'buffer', 'hangar', 'targetZone', 'enabled']) || keysAre(base, ['entityId', 'owner', 'module', 'buffer', 'hangar', 'targetZone', 'radius', 'enabled', 'centerX', 'centerY', 'autoLaunch'])) || key !== String(row.entityId) || !Number.isSafeInteger(row.entityId) || row.entityId < 1 || !s.playerIds.includes(row.owner) || row.module !== null && row.module !== 'combat-drone-module' || !Number.isFinite(row.buffer) || row.buffer < 0 || row.buffer > 1_000_000 || !Array.isArray(row.hangar) || row.hangar.length > 12 || row.hangar.some((id: any) => !Number.isSafeInteger(id) || id < 1) || new Set(row.hangar).size !== row.hangar.length || !['near', 'area', 'global'].includes(row.targetZone) || row.radius !== undefined && (!Number.isSafeInteger(row.radius) || row.radius < 16 || row.radius > 64) || typeof row.enabled !== 'boolean' || (row.centerX === undefined) !== (row.centerY === undefined) || row.centerX !== undefined && (!Number.isFinite(row.centerX) || Math.abs(row.centerX) > 65536) || row.centerY !== undefined && (!Number.isFinite(row.centerY) || Math.abs(row.centerY) > 65536) || row.autoLaunch !== undefined && typeof row.autoLaunch !== 'boolean') fail(); }
  for (const [key, e] of Object.entries<any>(s.combatEffects)) if (!plain(e) || e.key !== key || (e.kind !== 'slow' && e.kind !== 'acid-coating') || !Number.isSafeInteger(e.expiresTick) || !Number.isFinite(e.amount)) fail();
}

export function normalizeV117(value: unknown): V117State {
  if (value == null) return newV117State();
  validateV117(value);
  return value;
}

/** Same-save-format migration for the in-progress 1.17 runtime models. */
export function migrateV117SpeakerState(state: V117State): V117State {
  for (const d of state.drones.instances as any[]) if (d.source == null) d.source = 'port';
  const sound = (id: string): V117SpeakerSound => id === 'alert' || id === 'boom' ? 'attack-siren' : id === 'ping' || id === 'build' || id === 'craft' ? 'short-alert' : id === 'error' ? 'warning-horn' : id === 'goal' || id === 'research' ? 'completion' : 'bell';
  const configs: Record<string, V117SpeakerConfig> = {};
  for (const [key, raw] of Object.entries(state.speakers.configs as any)) {
    if ('playback' in (raw as any)) { configs[key] = { ...(raw as V117SpeakerConfig), playingUntil: Number.isSafeInteger((raw as any).playingUntil) ? (raw as any).playingUntil : 0 }; continue; }
    const old = raw as any;
    configs[key] = { entityId: old.entityId, mode: old.mode, sound: sound(old.sound), group: old.group, label: '', range: old.range, radius: 32, volume: 60, playback: old.continuous ? 'continuous' : old.repeat > 0 ? 'repeat' : 'once', intervalTicks: Math.max(60, Math.min(3600, old.repeat || 300)), pauseTicks: 300, visual: true, manualOn: false, requested: false, active: false, nextStart: 0, nextRepeat: 0, playingUntil: 0 };
  }
  const events = state.speakers.events.map((raw: any) => ({ ...raw, ...(raw.listener === undefined ? { listener: null, sound: sound(raw.sound), radius: 32, volume: 60, range: 'local' } : {}), playback: raw.playback || (raw.loop ? 'continuous' : 'once') }));
  for (const row of Object.values(state.speakers.radar) as any[]) { row.radius = Math.max(8, Math.min(64, row.radius)); row.attacking = row.attacking === true; }
  state.speakers.configs = configs; state.speakers.events = events;
  return state;
}

const SECTIONS: Record<V117Command['section'], Set<string>> = {
  genetics: new Set(['analyze', 'queue', 'cancel', 'deploy', 'order', 'combat', 'auto-return', 'detonate', 'squad', 'transfer', 'feed', 'repair', 'preserve', 'divide', 'export-culture']),
  speaker: new Set(['configure', 'trigger', 'manual', 'radar']),
  melee: new Set(['equip', 'attack', 'recharge']),
  drones: new Set(['build', 'configure', 'launch', 'return', 'return-all', 'personal-load', 'personal-launch', 'personal-configure', 'transfer', 'target', 'repair', 'recover']),
  chest: new Set(['preset', 'limit']),
  inventory: new Set(['expand', 'creative-return']),
  alerts: new Set(['ack']),
  training: new Set(['hide', 'show', 'compare']),
};
export const V117_COMMAND_FIELDS = new Set(['t', 'section', 'op', 'opId', 'id', 'entityId', 'labId', 'family', 'count', 'jobId', 'formId', 'droneId', 'player', 'x', 'y', 'points', 'combat', 'patrolMode', 'weapon', 'charges', 'mode', 'sound', 'group', 'squad', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual', 'repeat', 'continuous', 'enabled', 'autoLaunch', 'priority', 'target', 'targetKind', 'module', 'item', 'limit', 'preset', 'tech', 'step']);
const OP_FIELDS: Record<string, string[]> = {
  'genetics:detonate': ['formId', 'enabled'],
  'genetics:combat': ['formId', 'squad', 'enabled'], 'genetics:auto-return': ['formId', 'squad', 'enabled'],
  'genetics:analyze': ['family'], 'genetics:queue': ['item', 'entityId'], 'genetics:cancel': ['jobId'], 'genetics:deploy': ['item'],
  'genetics:order': ['formId', 'mode', 'points', 'combat', 'player', 'squad', 'patrolMode'], 'genetics:squad': ['formId', 'squad'], 'genetics:transfer': ['formId', 'player'], 'genetics:feed': ['formId'], 'genetics:repair': ['formId'],
  'genetics:preserve': ['entityId', 'family', 'labId'], 'genetics:divide': ['entityId', 'family'], 'genetics:export-culture': ['entityId', 'family'],
  'speaker:configure': ['entityId', 'mode', 'sound', 'group', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual'],
  'speaker:manual': ['entityId', 'enabled'], 'speaker:trigger': ['entityId'], 'speaker:radar': ['entityId', 'radius', 'enabled'],
  'melee:equip': ['weapon'], 'melee:attack': [], 'melee:recharge': [],
  'drones:build': ['item'], 'drones:configure': ['entityId', 'module', 'target', 'radius', 'enabled', 'autoLaunch', 'priority'], 'drones:launch': ['entityId', 'droneId'],
  'drones:personal-configure': ['autoLaunch', 'priority'],
  'drones:transfer': ['droneId', 'player'],
  'drones:return': ['droneId'], 'drones:return-all': ['entityId'], 'drones:personal-load': ['item'], 'drones:personal-launch': ['droneId'],
  'drones:target': ['droneId', 'target'], 'drones:repair': ['droneId', 'target', 'targetKind'], 'drones:recover': ['droneId'],
  'chest:preset': ['entityId', 'preset'], 'chest:limit': ['entityId', 'limit'], 'inventory:expand': ['tech'],
  'inventory:creative-return': ['item', 'count'], 'alerts:ack': ['id'], 'training:hide': [], 'training:show': [], 'training:compare': ['item'],
};
const OP_REQUIRED: Record<string, string[]> = {
  'genetics:detonate': ['formId', 'enabled'],
  'genetics:combat': ['formId', 'enabled'], 'genetics:auto-return': ['formId', 'enabled'],
  'genetics:analyze': ['family'], 'genetics:queue': ['item'], 'genetics:cancel': ['jobId'], 'genetics:deploy': ['item'],
  'genetics:order': ['formId', 'mode', 'points'], 'genetics:squad': ['formId', 'squad'], 'genetics:transfer': ['formId', 'player'], 'genetics:feed': ['formId'], 'genetics:repair': ['formId'],
  'genetics:preserve': ['entityId', 'family'], 'genetics:divide': ['entityId', 'family'], 'genetics:export-culture': ['entityId', 'family'],
  'speaker:configure': ['entityId', 'mode', 'sound', 'group', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual'],
  'speaker:manual': ['entityId', 'enabled'], 'speaker:trigger': ['entityId'], 'speaker:radar': ['entityId', 'radius', 'enabled'],
  'melee:equip': [], 'melee:attack': [], 'melee:recharge': [], 'drones:build': ['item'], 'drones:configure': ['entityId'],
  'drones:launch': ['entityId', 'droneId'], 'drones:return': ['droneId'], 'drones:return-all': [], 'drones:personal-load': ['item'],
  'drones:personal-launch': ['droneId'], 'drones:personal-configure': [], 'drones:target': ['droneId', 'target'], 'drones:repair': ['droneId', 'target'], 'drones:recover': ['droneId'],
  'drones:transfer': ['droneId', 'player'],
  'chest:preset': ['entityId', 'preset'], 'chest:limit': ['entityId', 'limit'], 'inventory:expand': ['tech'],
  'inventory:creative-return': ['item', 'count'], 'alerts:ack': ['id'], 'training:hide': [], 'training:show': [], 'training:compare': ['item'],
};

/** Every modern command is a closed, validated enum surface. */
export function validateV117Command(v: any): v is V117Command {
  if (!plain(v) || v.t !== 'v117' || !Object.keys(v).every(k => V117_COMMAND_FIELDS.has(k))) return false;
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, v.section) || typeof v.op !== 'string' || !SECTIONS[v.section as V117Command['section']].has(v.op)) return false;
  if (typeof v.opId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(v.opId)) return false;
  const key = `${v.section}:${v.op}`, fields = OP_FIELDS[key]; if (!fields || Object.keys(v).some(k => !['t', 'section', 'op', 'opId', ...fields].includes(k)) || OP_REQUIRED[key].some(k => !Object.prototype.hasOwnProperty.call(v, k))) return false;
  if (v.targetKind !== undefined && (v.section !== 'drones' || v.op !== 'repair' || !['entity', 'drone'].includes(v.targetKind))) return false;
  const str = (k: string, max: number) => v[k] === undefined || (k === 'weapon' || k === 'module') && v[k] === null || typeof v[k] === 'string' && v[k].length <= max;
  const int = (k: string, lo: number, hi: number) => v[k] === undefined || Number.isSafeInteger(v[k]) && v[k] >= lo && v[k] <= hi;
  const bool = (k: string) => v[k] === undefined || typeof v[k] === 'boolean';
  if (!str('id', 64) || !str('family', 64) || !str('item', 96) || !str('weapon', 96) || !str('tech', 96) || !str('module', 64) || !str('preset', 16) || !str('group', 32) || !str('squad', 32) || !str('label', 64) || !str('sound', 32) || !str('range', 16) || !str('playback', 16) || !str('mode', 16)) return false;
  if (v.squad !== undefined && /[\u0000-\u001f\u007f]/.test(v.squad)) return false;
  if (v.patrolMode !== undefined && (v.section !== 'genetics' || v.op !== 'order' || v.mode !== 'patrol' || !['loop', 'pingpong'].includes(v.patrolMode))) return false;
  if (v.id !== undefined && (!/^[A-Za-z0-9._:-]{1,64}$/.test(v.id) || ['__proto__', 'prototype', 'constructor'].includes(v.id))) return false;
  for (const k of ['entityId', 'jobId', 'formId', 'droneId', 'labId']) if (!int(k, 1, Number.MAX_SAFE_INTEGER)) return false;
  if (!int('player', 0, 15) || !int('count', 1, 100_000) || !int('limit', 1, 1_000_000) || !int('charges', 0, 100_000) || !int('radius', 2, 64) || !int('volume', 0, 100) || !int('intervalTicks', 60, 3600) || !int('pauseTicks', 60, 3600) || !int('repeat', 0, 36000) || !int('step', 0, 100)) return false;
  for (const k of ['combat', 'visual', 'enabled', 'continuous', 'autoLaunch']) if (!bool(k)) return false;
  if (v.priority !== undefined && !validDronePriority(v.priority)) return false;
  if (v.x !== undefined && (typeof v.x !== 'number' || !Number.isFinite(v.x) || Math.abs(v.x) > 65536) || v.y !== undefined && (typeof v.y !== 'number' || !Number.isFinite(v.y) || Math.abs(v.y) > 65536)) return false;
  if (v.points !== undefined && (!Array.isArray(v.points) || v.points.length > 16 || v.points.some((p: any) => !plain(p) || Object.keys(p).sort().join(',') !== 'x,y' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 65536 || Math.abs(p.y) > 65536))) return false;
  if (v.section === 'speaker' && v.op === 'configure' && (!['off', 'manual', 'circuit'].includes(v.mode) || !['attack-siren', 'short-alert', 'bell', 'warning-horn', 'completion'].includes(v.sound) || !/^[A-Za-z0-9_-]*$/.test(v.group) || !['local', 'global'].includes(v.range) || v.radius < 8 || !['once', 'repeat', 'continuous'].includes(v.playback))) return false;
  if (v.section === 'drones' && v.op === 'configure' && (v.module !== undefined && v.module !== 'combat-drone-module' || v.target !== undefined && !['near', 'area', 'global'].includes(v.target) || (v.x === undefined) !== (v.y === undefined))) return false;
  if (v.section === 'drones' && ['target', 'repair'].includes(v.op) && !int('target', 1, Number.MAX_SAFE_INTEGER)) return false;
  if (v.section === 'chest' && v.op === 'preset' && !['1', '2', '3', '4', 'all'].includes(v.preset)) return false;
  return finiteTree(v);
}

