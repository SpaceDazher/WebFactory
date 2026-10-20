// Совместимость сохранений между версиями (п. 5 плана 1.0).
// migrate() в save.ts меняет формат (v1 → v2 → v3), а здесь — всё остальное, что могло разойтись между
// версиями игры при том же формате: id построек, предметов, рецептов и технологий, размеры инвентарей и стопок,
// слоты модулей, открытые рецепты. Ничего не выбрасывается молча: предметы, которым некуда деться,
// возвращаются инженеру (или на землю рядом), а всё, что пришлось поправить, попадает в отчёт загрузки.
import { PROTOS, FLOORS, FLOOR_BY_ITEM } from '../data/entities';
import { ITEMS } from '../data/items';
import { validChestSettings } from './chest-settings';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { cleanCC, cleanWire, hasOut } from './circuits';
import { cleanSched } from './trains';
import { activeMods } from '../mods/registry';
import { bioProfile, BIO_PROFILES, BIO_SAMPLE_RANGE, BioSampling } from './bio';
import { TICKS } from '../core/types';
import { validateV117, DRONE_MODELS, validDronePriority, type DroneModel } from './v117';
import { LOCO_FUEL_SLOTS } from './trainfuel';
import { validatePoleReceipts } from './polechain';

declare const __VERSION__: string;
export const GAME_VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
export const PLAYER_SLOTS = 256;

/** Переименования между версиями: старый id → новый. Пока ни один id не менялся, таблицы пустые —
 *  при переименовании в будущих версиях достаточно добавить строку, и старые сохранения откроются. */
export const ALIASES: { proto: Record<string, string>; item: Record<string, string>; recipe: Record<string, string>; tech: Record<string, string> } = {
  proto: {}, item: { 'melee-cleaver': 'melee-combat-cleaver' }, recipe: { 'melee-cleaver': 'melee-combat-cleaver' }, tech: {},
};

export interface LoadReport {
  /** формат сохранения до миграции и оценка версии игры, которая его записала */
  fmt: number; era: string;
  fixes: string[];
  /** предметы, которые не поместились на своё место и возвращены инженеру */
  recovered: Record<string, number>;
  /** предметы неизвестного типа — их нет в этой версии игры */
  dropped: Record<string, number>;
  /** v1.10: моды сохранения, которых нет среди включённых (или другой версии) — из-за них и пропали прототипы */
  modsMissing?: string[];
}

/** Быстрая проверка до загрузки: то ли это вообще и не из более новой ли версии (бросает понятную ошибку) */
export function validateSave(s: any, maxV: number) {
  if (!s || typeof s !== 'object' || s.seed == null || !Array.isArray(s.ents) || typeof s.v !== 'number') throw new Error('Это не сохранение ЗАВОД-7');
  if (s.v > maxV) throw new Error(`Сохранение из более новой версии игры (${s.ver || 'формат v' + s.v}) — обновите игру`);
  if (Array.isArray(s.inv) && s.inv.length > PLAYER_SLOTS) throw new Error('Сохранение содержит инвентарь больше поддерживаемых 256 ячеек');
  if (Array.isArray(s.peers) && s.peers.length > 16) throw new Error('Сохранение содержит больше 16 персонажей');
  if (Array.isArray(s.peers)) for (const p of s.peers) if (p && Array.isArray(p.inv) && p.inv.length > PLAYER_SLOTS) throw new Error('Сохранение участника содержит инвентарь больше поддерживаемых 256 ячеек');
  if (s.x?.stash && typeof s.x.stash === 'object' && !Array.isArray(s.x.stash)) for (const row of Object.values<any>(s.x.stash)) if (row && Array.isArray(row.inv) && row.inv.length > PLAYER_SLOTS) throw new Error('Сохранение содержит отложенный инвентарь больше поддерживаемых 256 ячеек');
  validateVehicles(s);
  if (s.v >= 19) validateBio(s);
  if (s.v >= 20) validateBioRobots(s);
  if (s.v >= 21) {
    if (s.poleReceipts !== undefined) validatePoleReceipts(s.poleReceipts);
    validateV117(s.v117);
    validateAlliedAcid(s);
    if (s.poleReceipts && Object.keys(s.poleReceipts).some(owner => !s.v117.playerIds.includes(owner))) throw new Error('Подтверждение укладки опор принадлежит неизвестному игроку');
    const participants = Math.max(1, Array.isArray(s.peers) ? s.peers.length : 0);
    if (s.v117.playerIds.length !== participants || s.v117.inventory.expanded.length !== participants) throw new Error('Состояние игроков 1.17 не совпадает с сохранёнными персонажами');
    validateDroneStorage(s);
  }
}

/** Optional owned effects are new in 1.17. Legacy hostile records retain their original interpretation. */
export function validateAlliedAcid(s: any) {
  const fail = () => { throw new Error('Некорректная союзная кислота в сохранении'); };
  for (const [key, projectile] of [['projectiles', true], ['acids', false]] as const) {
    const rows = s[key]; if (!Array.isArray(rows)) continue;
    let owned = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'owner')) continue;
      const fields = projectile ? ['x', 'y', 'tx', 'ty', 'v', 'dmg', 'r', 'owner'] : ['x', 'y', 'r', 't', 'dmg', 'owner'];
      if (++owned > (projectile ? 1024 : 200) || Array.isArray(row) || Object.keys(row).length !== fields.length || !Object.keys(row).every(k => fields.includes(k)) || !s.v117.playerIds.includes(row.owner)) fail();
      for (const k of projectile ? ['x', 'y', 'tx', 'ty'] : ['x', 'y']) if (!Number.isFinite(row[k]) || Math.abs(row[k]) > 1_000_000) fail();
      if (!Number.isFinite(row.r) || row.r <= 0 || row.r > 64 || !Number.isFinite(row.dmg) || row.dmg <= 0 || row.dmg > 1_000_000) fail();
      if (projectile ? !Number.isFinite(row.v) || row.v <= 0 || row.v > 1 : !Number.isSafeInteger(row.t) || row.t < 1 || row.t > 300) fail();
    }
  }
}

function validateDroneStorage(s: any) {
  const fail = () => { throw new Error('Некорректный физический экземпляр боевого дрона в сохранении'); };
  const players = new Set<string>(s.v117.playerIds), ids = new Set<number>(); let maxId = 0;
  const claim = (raw: any, item: string) => {
    const model = ITEMS[item]?.droneModel as DroneModel | undefined, d = raw?.instance;
    if (!model) { if (d !== undefined) fail(); return; }
    const spec = DRONE_MODELS[model];
    if (!spec || !d || Object.keys(d).sort().join(',') !== 'ammo,ammoType,charge,hp,id,maxHp,model,owner,repair' || raw.count !== 1 || d.model !== model || !Number.isSafeInteger(d.id) || d.id < 1 || ids.has(d.id) || typeof d.owner !== 'string' || !players.has(d.owner) || d.maxHp !== spec.hp || !Number.isFinite(d.hp) || d.hp < 0 || d.hp > d.maxHp || !Number.isFinite(d.charge) || d.charge < 0 || d.charge > 2_000_000 || !Number.isSafeInteger(d.ammo) || d.ammo < 0 || d.ammo > spec.ammoLimit || !Number.isFinite(d.repair) || d.repair < 0 || d.repair > 400) fail();
    if (spec.ammoLimit === 0) { if (d.ammo !== 0 || d.ammoType !== null) fail(); }
    else if (d.ammoType !== null) {
      const ammo = ITEMS[d.ammoType]?.am, expected = model === 'gunner' ? 'bullet' : model === 'rocket' ? 'rocket' : model === 'flame' ? 'flame' : '';
      if (!ammo || ammo.cat !== expected) fail();
    } else if (d.ammo !== 0) fail();
    if (model !== 'repair' && d.repair !== 0) fail();
    ids.add(d.id); maxId = Math.max(maxId, d.id);
  };
  const inventory = (rows: any) => { if (!Array.isArray(rows)) return; for (const row of rows) if (row) claim(row, row.item); };
  inventory(s.inv); inventory(s.trash); if (s.held) claim(s.held, s.held.item);
  if (Array.isArray(s.peers)) for (const p of s.peers) { inventory(p?.inv); inventory(p?.trash); if (p?.held) claim(p.held, p.held.item); }
  const personal = (pl: any) => {
    const grid = pl?.kit?.grid; if (!Array.isArray(grid)) return;
    for (const m of grid) {
      const port = ITEMS[m?.id]?.equip?.kind === 'drone-port';
      if (!port && m?.drones !== undefined || m?.drones !== undefined && (!Array.isArray(m.drones) || m.drones.length > 4)) fail();
      if (!port && (m?.droneAuto !== undefined || m?.dronePriority !== undefined) || m?.droneAuto !== undefined && typeof m.droneAuto !== 'boolean' || m?.dronePriority !== undefined && !validDronePriority(m.dronePriority)) fail();
      for (const d of m?.drones || []) claim({ count: 1, instance: d }, `combat-drone-${d.model}`);
    }
  };
  personal(s.player); if (Array.isArray(s.peers)) for (const p of s.peers) personal(p?.player);
  for (const e of s.ents || []) {
    inventory(e?.inv);
    if (e?.handStack) { if (!ITEMS[e.handStack.item]?.droneModel) fail(); claim(e.handStack, e.handStack.item); }
    else if (ITEMS[e?.hand]?.droneModel) fail();
    if (e?.outInstances !== undefined && !Array.isArray(e.outInstances)) fail();
    for (const row of e?.outInstances || []) { if (!ITEMS[row?.item]?.droneModel) fail(); claim(row, row?.item); }
    for (const seg of e?.lanes || []) for (const lane of seg || []) for (const row of lane || []) if (row?.instance || ITEMS[row?.item]?.droneModel) claim({ count: row.n || 1, instance: row.instance }, row.item);
    for (const [item, count] of Object.entries<any>(e?.output || {})) if (ITEMS[item]?.droneModel && (!Number.isSafeInteger(count) || count < 0 || count > 256)) fail();
  }
  for (const row of s.ground || []) if (row?.instance || ITEMS[row?.item]?.droneModel) claim(row, row.item);
  for (const c of s.corpses || []) inventory(c?.slots);
  for (const r of s.robots || []) inventory(r?.cargo);
  if (s.x?.stash && typeof s.x.stash === 'object' && !Array.isArray(s.x.stash)) for (const row of Object.values<any>(s.x.stash)) inventory(row?.inv);
  for (const d of s.v117.drones.instances) {
    if (!Number.isSafeInteger(d.id) || ids.has(d.id)) fail();
    ids.add(d.id); maxId = Math.max(maxId, d.id);
  }
  if (s.v117.nextDrone <= maxId) fail();
}

function validateBio(s: any) {
  const check = (ok: unknown) => { if (!ok) throw new Error('Некорректное состояние биосбора в сохранении'); };
  const integer = (v: any, lo: number, hi: number) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const number = (v: any, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const object = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: any, allowed: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
  check(integer(s.tick, 0, Number.MAX_SAFE_INTEGER) && object(s.player) && Array.isArray(s.inv) && object(s.research) && Array.isArray(s.research.done));
  // The save loader has historically repaired malformed and excess peer rows. Keep
  // that compatibility behavior while validating any biological job they contain.
  if (s.peers !== undefined) check(Array.isArray(s.peers));
  check(Array.isArray(s.bioCorpses) && integer(s.nextBioCorpseId, 1, Number.MAX_SAFE_INTEGER) && integer(s.nextUnit, 1, Number.MAX_SAFE_INTEGER) && integer(s.nextId, 1, Number.MAX_SAFE_INTEGER));
  const ids = new Set<number>(), sources = new Set<string>(); let maxId = 0;
  const byId = new Map<number, any>();
  for (const c of s.bioCorpses) {
    check(keys(c, ['id', 'sourceId', 'sourceType', 'kind', 'family', 'x', 'y', 'deathTick', 'expiresTick', 'totalSamples', 'remainingSamples', 'selfDetonated', 'burned']));
    const profile = typeof c.kind === 'string' ? bioProfile(c.kind) : undefined;
    if (!profile) throw new Error('Некорректное состояние биосбора в сохранении');
    check(c.sourceType === 'unit' && !c.kind.startsWith('worm-') || c.sourceType === 'worm' && c.kind.startsWith('worm-'));
    check(integer(c.id, 1, Number.MAX_SAFE_INTEGER) && !ids.has(c.id)); ids.add(c.id); byId.set(c.id, c); maxId = Math.max(maxId, c.id);
    const source = `${c.sourceType}:${c.sourceId}`;
    check(integer(c.sourceId, 1, Number.MAX_SAFE_INTEGER) && !sources.has(source)); sources.add(source);
    check(c.sourceType === 'unit' ? c.sourceId < s.nextUnit : c.sourceId < s.nextId);
    check(c.family === profile.family && number(c.x, -65536, 65536) && number(c.y, -65536, 65536));
    check(integer(c.deathTick, 0, s.tick) && integer(c.expiresTick, c.deathTick + 1, Number.MAX_SAFE_INTEGER));
    check(c.expiresTick === c.deathTick + profile.minutes * 60 * TICKS && c.expiresTick > s.tick);
    const expected = c.kind === 'destroyer' && c.selfDetonated === true ? 2 : profile.yield;
    check(c.totalSamples === expected && integer(c.remainingSamples, 0, c.totalSamples));
    check(c.selfDetonated === undefined || c.selfDetonated === true && c.kind === 'destroyer');
    check(c.burned === undefined || c.burned === true);
  }
  check(s.nextBioCorpseId > maxId);
  const sampling = (p: any, inventory: any) => {
    const task = p?.bioSampling;
    if (task == null) return true;
    if (!object(p) || !Array.isArray(inventory) || p.dead !== false || !number(p.x, -65536, 65536) || !number(p.y, -65536, 65536) || !s.research.done.includes('bio-sampling')) return false;
    if (!inventory.some((slot: any) => object(slot) && slot.item === 'bio-sampler' && integer(slot.count, 1, ITEMS['bio-sampler']?.stack || 1))) return false;
    if (!keys(task, ['target', 'id', 'x', 'y', 'left', 'mode'])) return false;
    if (task.mode !== undefined && !['sample', 'genetic', 'cells'].includes(task.mode)) return false;
    if (task.mode === 'genetic' && !s.research.done.includes('swarm-genomics') || task.mode === 'cells' && !s.research.done.includes('cellular-sampling')) return false;
    if (task.mode !== undefined && task.mode !== 'sample' && !inventory.some((slot: any) => object(slot) && slot.item === 'culture-preservation-kit' && integer(slot.count, 1, ITEMS['culture-preservation-kit']?.stack || 1))) return false;
    if (task.mode !== undefined && task.mode !== 'sample' && !inventory.some((slot: any) => object(slot) && slot.item === 'empty-bio-capsule' && integer(slot.count, 1, ITEMS['empty-bio-capsule']?.stack || 1))) return false;
    if (!integer(task.left, 1, 3 * TICKS)) return false;
    if (task.target === 'corpse') {
      if (Object.keys(task).filter((k: string) => k !== 'mode').sort().join(',') !== 'id,left,target' || !integer(task.id, 1, Number.MAX_SAFE_INTEGER)) return false;
      const c = byId.get(task.id);
      return !!c && c.remainingSamples > 0 && (task.mode !== 'cells' || !c.burned && !c.selfDetonated && s.tick - c.deathTick < 600 * TICKS) && Math.hypot(c.x - p.x, c.y - p.y) <= BIO_SAMPLE_RANGE;
    }
    return task.target === 'slime' && (task.mode === undefined || task.mode === 'sample') && Object.keys(task).filter((k: string) => k !== 'mode').sort().join(',') === 'left,target,x,y' && integer(task.x, -65536, 65536) && integer(task.y, -65536, 65536) && task.left <= 2 * TICKS && Math.hypot(Math.floor(task.x) + 0.5 - p.x, Math.floor(task.y) + 0.5 - p.y) <= BIO_SAMPLE_RANGE;
  };
  check(sampling(s.player, s.inv));
  if (Array.isArray(s.peers)) for (let i = 1; i < s.peers.length; i++) check(object(s.peers[i]) && sampling(s.peers[i].player, s.peers[i].inv));
}

function validateBioRobots(s: any) {
  const fail = () => { throw new Error('Некорректное состояние биосбора в сохранении'); };
  const check = (ok: unknown) => { if (!ok) fail(); };
  const integer = (v: any, lo: number, hi: number) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const number = (v: any, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const object = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const exactKeys = (v: any, keys: string[]) => object(v) && Object.keys(v).sort().join(',') === keys.slice().sort().join(',');
  const families = new Set(['crawler', 'spitter', 'armored', 'destroyer', 'flyer', 'brood', 'giant', 'queen', 'worm']);
  const modes = new Set(['corpses', 'all', 'film']);
  const phases = new Set(['idle', 'outbound', 'sampling', 'return', 'waiting-output']);
  const stations = new Map<number, any>();
  for (const e of s.ents) if (e?.proto === 'bio-collection-station') {
    check(e.t === 'bioport' && integer(e.id, 1, Number.MAX_SAFE_INTEGER));
    check(modes.has(e.bioMode) && (e.bioFamily === null || families.has(e.bioFamily)));
    check(e.bioSpecies === undefined || e.bioSpecies === null || typeof e.bioSpecies === 'string' && !!bioProfile(e.bioSpecies));
    check(e.bioSampleMode === undefined || ['sample', 'genetic', 'cells'].includes(e.bioSampleMode));
    check(['no-power', 'no-robot', 'no-target', 'no-capsule', 'no-preservation', 'no-research', 'cells-expired', 'working', 'output-full'].includes(e.bioStatus));
    check(object(e.input) && object(e.output));
    for (const [items, input] of [[e.input, true], [e.output, false]] as const) {
      let unique = 0;
      for (const [id, count] of Object.entries(items)) {
        const item = ITEMS[id];
        check(!!item && integer(count, 1, item.stack || 50)); unique++;
        if (input) check(id === 'empty-bio-capsule' || id === 'sanitary-robot' || id === 'culture-preservation-kit');
        else check(id === 'raw-slime-capsule' || Object.entries(BIO_PROFILES).some(([kind, p]) => p.sampleItem === id || id === 'genetic-probe-' + kind || id === 'viable-cell-' + kind));
      }
      if (!input) check(unique <= (PROTOS[e.proto].slots || 48));
    }
    stations.set(e.id, e);
  }
  check(Array.isArray(s.bioRobots) && integer(s.nextBioRobot, 1, Number.MAX_SAFE_INTEGER));
  const ids = new Set<number>(), perStation = new Map<number, number>(), corpseClaims = new Map<number, number>(), slimeClaims = new Set<string>();
  let maxId = 0;
  for (const r of s.bioRobots) {
    check(exactKeys(r, ['id', 'homeId', 'x', 'y', 'charge', 'hp', 'phase', 'progress', 'target', 'cargo', ...('sampleMode' in r ? ['sampleMode'] : []), ...('preservation' in r ? ['preservation'] : [])]));
    check(r.sampleMode === undefined || ['sample', 'genetic', 'cells'].includes(r.sampleMode));
    check(r.preservation === undefined || r.preservation === true && (r.sampleMode === 'genetic' || r.sampleMode === 'cells') && r.cargo === 'empty-bio-capsule');
    check(integer(r.id, 1, Number.MAX_SAFE_INTEGER) && !ids.has(r.id)); ids.add(r.id); maxId = Math.max(maxId, r.id);
    const home = stations.get(r.homeId); check(!!home && integer(r.homeId, 1, Number.MAX_SAFE_INTEGER));
    perStation.set(r.homeId, (perStation.get(r.homeId) || 0) + 1);
    check(number(r.x, -65536, 65536) && number(r.y, -65536, 65536));
    check(number(r.charge, 0, (ITEMS['sanitary-robot'].robot?.batteryMJ || 1.5) * 1e6) && number(r.hp, 0.001, 20));
    check(phases.has(r.phase) && integer(r.progress, 0, 3 * TICKS));
    check(r.cargo === null || r.cargo === 'empty-bio-capsule' || r.cargo === 'raw-slime-capsule' || Object.entries(BIO_PROFILES).some(([kind, p]) => p.sampleItem === r.cargo || r.cargo === 'genetic-probe-' + kind || r.cargo === 'viable-cell-' + kind));
    if (r.cargo === 'empty-bio-capsule' && r.sampleMode && r.sampleMode !== 'sample') check(r.preservation === true);
    if (r.target == null) check(r.phase === 'idle' || r.phase === 'return' || r.phase === 'waiting-output');
    else if (r.target.kind === 'corpse') {
      check(exactKeys(r.target, ['kind', 'id']) && integer(r.target.id, 1, Number.MAX_SAFE_INTEGER));
      const corpse = s.bioCorpses.find((c: any) => c.id === r.target.id);
      check(!!corpse && corpse.remainingSamples > 0 && corpse.expiresTick > s.tick && r.phase !== 'idle' && r.phase !== 'waiting-output');
      corpseClaims.set(corpse.id, (corpseClaims.get(corpse.id) || 0) + 1);
    } else {
      check(r.target.kind === 'slime' && exactKeys(r.target, ['kind', 'x', 'y']) && integer(r.target.x, -65536, 65536) && integer(r.target.y, -65536, 65536));
      check((r.sampleMode === undefined || r.sampleMode === 'sample') && r.preservation === undefined);
      check(r.phase === 'outbound' || r.phase === 'sampling');
      const key = `${r.target.x},${r.target.y}`; check(!slimeClaims.has(key)); slimeClaims.add(key);
    }
    if (r.phase === 'idle') check(r.target === null && r.cargo === null && r.progress === 0 && r.sampleMode === undefined && r.preservation === undefined);
    if (r.phase === 'outbound') check(r.target !== null && r.progress === 0);
    if (r.phase === 'sampling') check(r.target !== null && integer(r.progress, 1, 3 * TICKS));
    if (r.phase === 'waiting-output') check(r.target === null && r.cargo !== null && r.progress === 0);
    if (r.cargo === 'empty-bio-capsule') check(r.phase === 'outbound' || r.phase === 'sampling' || r.phase === 'return');
  }
  check(s.nextBioRobot > maxId);
  for (const [id, station] of stations) check((perStation.get(id) || 0) + (station.input['sanitary-robot'] || 0) <= (PROTOS[station.proto].bio?.robots || 4));
  for (const [id, count] of corpseClaims) check(count <= s.bioCorpses.find((c: any) => c.id === id).remainingSamples);
}

/** Проверяется до JSON-копирования: Infinity/NaN иначе превращаются в null. */
function validateVehicles(s: any) {
  const object = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x);
  const number = (x: any, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  const integer = (x: any, lo: number, hi: number) => Number.isSafeInteger(x) && x >= lo && x <= hi;
  const check = (ok: unknown) => { if (!ok) throw new Error('Некорректное состояние автомобиля в сохранении'); };
  const drivers = new Set<number>();
  for (const e of s.ents) {
    const p = PROTOS[e?.proto];
    if (p?.type !== 'car') { check(e?.vehicleState === undefined); continue; }
    const v = e.vehicleState;
    check(object(v) && e.t === 'car');
    check(integer(e.x, -65536, 65535) && integer(e.y, -65536, 65535) && integer(e.dir, 0, 3));
    const w = e.dir % 2 ? p.h : p.w, h = e.dir % 2 ? p.w : p.h;
    check(e.w === w && e.h === h && number(v.x, -65536, 65536) && number(v.y, -65536, 65536));
    check(Math.round(v.x - w / 2) === e.x && Math.round(v.y - h / 2) === e.y);
    check(number(v.angle, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) && number(v.speed, -7, 22));
    check(number(v.throttle, -1, 1) && number(v.steer, -1, 1));
    check(Array.isArray(v.mounts) && v.mounts.length === 2 && Array.isArray(v.grid) && v.grid.length <= 16);
    const cells = new Set<number>(); let chargeMax = 0;
    for (const m of v.grid) {
      check(object(m));
      const q = ITEMS[m.id]?.equip;
      check(q && p.vehicle?.equipmentKinds.includes(q.kind as any));
      const mw = q!.w || 1, mh = q!.h || 1;
      check(integer(m.x, 0, 4 - mw) && integer(m.y, 0, 4 - mh));
      for (let y = m.y; y < m.y + mh; y++) for (let x = m.x; x < m.x + mw; x++) { const k = y * 4 + x; check(!cells.has(k)); cells.add(k); }
      if (q!.kind === 'battery') chargeMax += (q!.MJ || 0) * 1e6;
      else chargeMax += (q!.kW || 0) * 1000;
      for (const k of ['r', 'n', 'w']) if (m[k] !== undefined) check(q!.kind === 'nreactor' && integer(m[k], 0, k === 'r' ? 12000 : 10));
    }
    check(number(v.gridCharge, 0, chargeMax));
    for (const m of v.mounts) {
      if (m === null) continue;
      check(object(m));
      const turret = PROTOS[m.proto]?.tur;
      check(turret && p.vehicle?.turretKinds.includes(turret.kind as any));
      check(number(m.aim, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) && integer(m.fireCd, 0, 600) && integer(m.tgtU, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
      const fits = (id: any) => typeof id === 'string' && !!ITEMS[id]?.am && ITEMS[id].am!.cat === (turret!.kind === 'flame' ? 'flame' : turret!.cat);
      if (m.ammo !== null) check(object(m.ammo) && fits(m.ammo.item) && integer(m.ammo.count, 1, ITEMS[m.ammo.item]?.stack || 0));
      if (m.ammoType !== undefined) check(fits(m.ammoType));
      check(integer(m.rounds, 0, m.ammoType ? ITEMS[m.ammoType]?.am?.rounds || 0 : 0));
      if (m.fluidItem !== undefined) check(turret!.kind === 'flame' && (m.fluidItem === 'crude-oil' || m.fluidItem === 'isotope-flamethrower-ammo'));
      if (m.fluidAmount !== undefined) check(turret!.kind === 'flame' && number(m.fluidAmount, 0, 100));
    }
    if (v.driver !== null) {
      const count = Math.max(1, Array.isArray(s.peers) ? s.peers.length : 0);
      check(integer(v.driver, 0, count - 1) && !drivers.has(v.driver));
      check((v.driver === 0 ? s.player : s.peers[v.driver]?.player)?.veh === e.id);
      drivers.add(v.driver);
    }
  }
}
/** Сообщение для игрока после загрузки; null — ничего особенного */
export function reportText(r: LoadReport | null | undefined, curV: number): string | null {
  if (!r) return null;
  const items = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${ITEMS[k]?.name || PROTOS[k]?.name || k} ×${n}`).join(', ');
  const parts: string[] = [];
  if (r.fixes.length) parts.push(r.fixes.join('; '));
  if (Object.keys(r.recovered).length) parts.push('возвращено инженеру: ' + items(r.recovered));
  if (r.modsMissing?.length) parts.push('загружено без модов: ' + r.modsMissing.join(', '));
  if (Object.keys(r.dropped).length) parts.push((r.modsMissing?.length ? 'убрано вместе с модами: ' : 'нет в этой версии: ') + items(r.dropped));
  if (!parts.length && r.fmt >= curV) return null;
  return `Сохранение ${r.era} загружено${parts.length ? ': ' + parts.join('. ') : ' без потерь'}`;
}
/** Какая версия игры записала сохранение (по формату и набору полей) */
export function saveEra(s: any): string {
  if (s.ver) return String(s.ver);
  if (s.v === 1) return 'v0.1';
  if (s.v === 2) return 'v0.2';
  if (!s.tele) return 'v0.3 – v1.0-rc2';
  return 'v1.0-rc3 – rc4';
}

const add = (m: Record<string, number>, k: string, n: number) => { if (n > 0) m[k] = (m[k] || 0) + n; };
const alias = (kind: keyof typeof ALIASES, id: any) => {
  // A retained compatible definition is still a valid identity. Rewriting it
  // would change current save hashes and merge distinct enabled recipe entries.
  const definitions = kind === 'proto' ? PROTOS : kind === 'item' ? ITEMS : kind === 'recipe' ? RECIPES : TECHS;
  return typeof id === 'string' && !Object.hasOwn(definitions, id) ? ALIASES[kind][id] || id : id;
};

/** Все предметы, которые лежат в постройке (как при разборе, см. Game.removeEntity) */
export function entityItems(o: any): [string, number][] {
  const r: [string, number][] = [];
  const st = (x: any) => { if (x && x.item && x.count > 0) r.push([x.item, x.count]); };
  st(o.fuel); st(o.ammo);
  if (Array.isArray(o.inv)) for (const x of o.inv) st(x);
  if (o.lanes) for (const seg of o.lanes) for (const lane of seg) for (const it of lane) r.push([it.item, it.n || 1]);
  if (o.hand) r.push([o.hand, o.hn || 1]);
  if (o.outBuf) r.push([o.outBuf, 1]);
  for (const k of ['input', 'output']) if (o[k]) for (const it in o[k]) if (o[k][it] > 0) r.push([it, o[k][it]]);
  if (o.modules) for (const m of o.modules) if (m) r.push([m, 1]);
  if (o.satellite) r.push(['satellite', o.satellite]);
  return r;
}

/** Приводит сохранение (уже в формате SAVE_VERSION) к данным этой версии игры. Меняет s на месте. */
export function sanitize(s: any, fmt: number, era: string): LoadReport {
  const rep: LoadReport = { fmt, era, fixes: [], recovered: {}, dropped: {} };
  const act = activeMods(); const miss = (Array.isArray(s.mods) ? s.mods : []).filter((m: any) => !act.some(a => a.name === m.name && a.hash === m.hash)).map((m: any) => `${m.title || m.name} ${m.version || ''}`.trim());
  if (miss.length) rep.modsMissing = miss;
  const fix = (m: string) => { if (!rep.fixes.includes(m)) rep.fixes.push(m); };
  const known = (it: any) => typeof it === 'string' && !!ITEMS[it];
  const back = (it: string, n: number) => { if (n <= 0) return; if (known(it)) add(rep.recovered, it, n); else add(rep.dropped, it, n); };
  const stack = (x: any): any => {
    if (!x || !x.item || !(x.count > 0)) return null;
    x.item = alias('item', x.item); if (!known(x.item)) { add(rep.dropped, x.item, x.count); return null; }
    x.count = Math.floor(x.count); return x;
  };
  /** ячейки инвентаря: неизвестные предметы, лишние ячейки и переполненные стопки */
  const slots = (a: any[], size: number, what: string): any[] => {
    const out: any[] = new Array(size).fill(null);
    a.forEach((x, i) => {
      x = stack(x); if (!x) return;
      const max = ITEMS[x.item].stack ?? 50;
      if (x.count > max) { back(x.item, x.count - max); x.count = max; fix(`${what}: стопки больше предела`); }
      if (i < size) out[i] = x; else { back(x.item, x.count); fix(`${what}: ячеек стало меньше`); }
    });
    return out;
  };

  // постройки
  const ents: any[] = [];
  for (const o of s.ents || []) {
    o.proto = alias('proto', o.proto);
    const p = PROTOS[o.proto];
    if (!p) { for (const [it, n] of entityItems(o)) back(alias('item', it), n); add(rep.dropped, o.proto, 1); fix(`неизвестная постройка «${o.proto}» убрана, содержимое возвращено`); continue; }
    if (o.fuel) o.fuel = stack(o.fuel);
    if (o.ammo) o.ammo = stack(o.ammo);
    if (Array.isArray(o.inv)) o.inv = slots(o.inv, o.t === 'loco' ? LOCO_FUEL_SLOTS : p.slots ?? o.inv.length, p.name || o.proto);
    if (o.t === 'chest' && Array.isArray(o.inv) && Number.isInteger(o.slotLimit) && o.slotLimit >= 1 && o.slotLimit <= o.inv.length) { /* Numeric S stays distinct from All. */ }
    else if (o.t === 'loco' && Number.isInteger(o.slotLimit) && o.slotLimit >= 1 && o.slotLimit <= LOCO_FUEL_SLOTS) { if (o.slotLimit === LOCO_FUEL_SLOTS) delete o.slotLimit; }
    else delete o.slotLimit;
    if (o.t === 'chest') { const filters = Array.isArray(o.filt) ? o.filt.slice(0, p.slots).map((it: any) => typeof it === 'string' && known(alias('item', it)) && !ITEMS[alias('item', it)].fluid && !ITEMS[alias('item', it)].virtual ? alias('item', it) : null) : []; if (filters.some(Boolean)) o.filt = Array.from({ length: p.slots! }, (_, i) => filters[i] || null); else delete o.filt; }
    if (o.t === 'stop') { if (typeof o.stopLeft !== 'boolean') delete o.stopLeft; }
    else delete o.stopLeft;
    if (o.lanes) for (const seg of o.lanes) for (let li = 0; li < seg.length; li++) seg[li] = seg[li].filter((it: any) => { it.item = alias('item', it.item); it.n = Number.isInteger(it.n) && it.n >= 1 && it.n <= 4 ? it.n : 1; if (known(it.item)) return true; add(rep.dropped, it.item, it.n); return false; });
    for (const k of ['hand', 'outBuf']) if (o[k]) { o[k] = alias('item', o[k]); if (!known(o[k])) { add(rep.dropped, o[k], 1); o[k] = null; } }
    for (const k of ['input', 'output']) if (o[k]) for (const it of Object.keys(o[k])) { const a = alias('item', it); if (a !== it) { o[k][a] = (o[k][a] || 0) + o[k][it]; delete o[k][it]; } if (!known(a)) { add(rep.dropped, a, o[k][a]); delete o[k][a]; } }
    if (o.recipe != null && o.t === 'lab') { // у лаборатории в recipe — id технологии, которую она изучает
      o.recipe = alias('tech', o.recipe);
      if (!TECHS[o.recipe]) { fix(`лаборатория изучала неизвестную технологию «${o.recipe}»`); o.recipe = null; o.crafting = false; o.progress = 0; }
    } else if (o.recipe != null) {
      o.recipe = alias('recipe', o.recipe);
      if (!RECIPES[o.recipe]) {
        for (const k of ['input', 'output']) if (o[k]) { for (const it in o[k]) back(it, o[k][it]); o[k] = {}; }
        fix(`рецепт «${o.recipe}» больше не существует — машина без рецепта, ингредиенты возвращены`);
        o.recipe = null; o.crafting = false; o.progress = 0;
      }
    }
    if (o.modules || p.modules) {
      const want = p.modules || 0; const m = (o.modules || []).map((x: any) => x ? alias('item', x) : null);
      for (let i = 0; i < m.length; i++) if (m[i] && !known(m[i])) { add(rep.dropped, m[i], 1); m[i] = null; }
      while (m.length > want) { const x = m.pop(); if (x) { back(x, 1); fix('слотов модулей стало меньше — модули возвращены'); } }
      while (m.length < want) m.push(null);
      if (want) o.modules = m; else delete o.modules;
    }
    if (o.hp == null || !isFinite(o.hp)) o.hp = p.hp ?? 100;
    // v1.16: тепловая энергия — целые Дж в безопасном диапазоне, остатки, стержни, удельная энергия пара
    if (p.heatC) { const hmax = Math.floor(Number.MAX_SAFE_INTEGER / 4); o.hE = Number.isSafeInteger(o.hE) ? Math.max(0, Math.min(hmax, o.hE)) : 0; o.hL = Number.isSafeInteger(o.hL) && o.hL >= 0 ? o.hL : 0; }
    if (o.t === 'reactor') { o.rt = Number.isInteger(o.rt) ? Math.max(0, Math.min(12000, o.rt)) : 0; o.rrem = Number.isInteger(o.rrem) ? Math.max(0, Math.min(59, o.rrem)) : 0; o.ot = Number.isInteger(o.ot) ? Math.max(0, Math.min(100000, o.ot)) : 0; o.rgo = o.rgo !== false; o.rstop = o.rstop === true; o.rhold = o.rhold === true; if (!o.input || typeof o.input !== 'object') o.input = {}; if (!o.output || typeof o.output !== 'object') o.output = {}; }
    if (Array.isArray(o.fse)) o.fse = o.fse.map((v: any) => Number.isFinite(+v) && +v > 0 && +v < 1000 ? +v : 30); else delete o.fse;
    if (o.te !== undefined && !(Number.isFinite(+o.te) && +o.te > 0 && +o.te < 1000)) o.te = 30;
    if (o.pick != null && !ITEMS[o.pick]) o.pick = null;
    if (o.rnx != null && o.rnx !== '' && !RECIPES[o.rnx]) o.rnx = null;
    // v1.5: настройки схемотехники — только известные сигналы и подходящие постройке поля
    if (o.cc !== undefined) { const c = cleanCC({ t: p.type }, o.cc); if (c) o.cc = c; else delete o.cc; }
    if (o.coff !== undefined && o.coff !== true) delete o.coff;
    if (o.ccol !== undefined && typeof o.ccol !== 'string') delete o.ccol;
    // v1.6: выход комбинатора — известные сигналы, 32-битные целые
    if (o.co !== undefined) { const c: Record<string, number> = {}; if (hasOut({ t: p.type }) && o.co && typeof o.co === 'object') for (const k in o.co) { const v = +o.co[k] | 0; if (ITEMS[k] && !ITEMS[k].meta && v) c[k] = v; } if (Object.keys(c).length) o.co = c; else delete o.co; }
    ents.push(o);
  }
  s.ents = ents;

  // инженер, земля, тела, очередь крафта
  if (Array.isArray(s.inv)) {
    const cap = Math.max(32, Math.min(PLAYER_SLOTS, s.inv.length));
    if (s.inv.length < 32) fix('инвентарь инженера: добавлены недостающие ячейки');
    s.inv = slots(s.inv, cap, 'инвентарь инженера');
  }
  if (Array.isArray(s.trash)) s.trash = slots(s.trash, 8, 'ячейки для удаления'); else delete s.trash;
  s.ground = (s.ground || []).filter((it: any) => { it.item = alias('item', it.item); if (known(it.item)) return true; add(rep.dropped, it.item, it.count || 1); return false; });
  for (const c of s.corpses || []) c.slots = (c.slots || []).map(stack);
  s.queue = (s.queue || []).filter((j: any) => {
    j.recipe = alias('recipe', j.recipe); if (RECIPES[j.recipe]) return true;
    fix(`в очереди крафта был рецепт «${j.recipe}», которого нет — убран`); return false;
  });

  // исследования и открытые рецепты: технология могла открывать в новой версии больше рецептов
  const r = s.research;
  r.done = (r.done || []).map((t: string) => alias('tech', t)).filter((t: string) => { if (TECHS[t]) return true; fix(`неизвестная технология «${t}» пропущена`); return false; });
  if (r.current != null) { r.current = alias('tech', r.current); if (!TECHS[r.current]) { fix(`текущее исследование «${r.current}» больше не существует`); r.current = null; r.progress = 0; } }
  if (r.levels) for (const k of Object.keys(r.levels)) if (!TECHS[alias('tech', k)]) delete r.levels[k];
  const en = new Set<string>((s.enabled || []).map((x: string) => alias('recipe', x)).filter((x: string) => RECIPES[x]));
  const before = en.size;
  for (const rr of Object.values(RECIPES)) if (rr.enabled) en.add(rr.id);
  for (const t of r.done) for (const u of TECHS[t].unlocks) if (RECIPES[u]) en.add(u);
  if (en.size > before) fix(`открыто рецептов по изученным технологиям: +${en.size - before}`);
  s.enabled = [...en];
  // v1.2: роботы в полёте, стопка в руке, модуль брони
  s.robots = (s.robots || []).filter((r: any) => r && isFinite(r.x) && isFinite(r.y)).map((r: any) => ({ ...r, cargo: (r.cargo || []).map(stack).filter(Boolean) }));
  if (s.held) s.held = stack(s.held);
  // v1.3: личные запросы — только существующие предметы
  // v1.4: покрытия — известного вида; призраки покрытий — из известных предметов
  s.floors = Array.isArray(s.floors) ? s.floors.filter((t: any) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1]) && Number.isInteger(t[2]) && t[2] >= 1 && t[2] <= FLOORS.length) : [];
  s.tileMarks = Array.isArray(s.tileMarks) ? s.tileMarks.filter((t: any) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1]) && FLOOR_BY_ITEM[t[2]]) : [];
  s.preq = Array.isArray(s.preq) ? s.preq.map((q: any) => q && ITEMS[alias('item', q.item)] ? { item: alias('item', q.item), min: Math.max(0, +q.min || 0), max: q.max == null ? null : Math.max(0, +q.max || 0) } : null) : [];
  if (s.equip && !ITEMS[alias('item', s.equip)]?.equip) { back(alias('item', s.equip), 1); s.equip = null; }
  // v1.14: снаряжение инженера — броня, модули в её сетке, оружие и патроны; чужие предметы — в инвентарь
  const cleanKit = (pl: any) => { if (!pl || typeof pl !== 'object') return; const k = pl.kit; if (!k || typeof k !== 'object') { pl.kit = undefined; return; }
    const it = (x: any) => typeof x === 'string' ? ITEMS[alias('item', x)] : undefined;
    const armor = it(k.armor)?.armor ? alias('item', k.armor) : null; if (k.armor && !armor) back(k.armor, 1);
    const grid: any[] = []; const G = armor ? ITEMS[armor].armor!.grid : null;
    for (const m of Array.isArray(k.grid) ? k.grid : []) { const d = it(m?.id)?.equip; const w = d?.w || 1, h = d?.h || 1;
      if (d && G && Number.isInteger(m.x) && Number.isInteger(m.y) && m.x >= 0 && m.y >= 0 && m.x + w <= G[0] && m.y + h <= G[1] && grid.every(o => { const e2 = ITEMS[o.id].equip!; return m.x >= o.x + (e2.w || 1) || o.x >= m.x + w || m.y >= o.y + (e2.h || 1) || o.y >= m.y + h; })) grid.push({ id: alias('item', m.id), x: m.x, y: m.y, ...(d.kind === 'nreactor' ? { r: Math.max(0, Math.min(12000, m.r | 0)), n: Math.max(0, Math.min(10, m.n | 0)), w: Math.max(0, Math.min(10, m.w | 0)) } : {}), ...(d.kind === 'drone-port' ? { ...(Array.isArray(m.drones) ? { drones: m.drones.map((dr: any) => ({ ...dr })) } : {}), ...(m.droneAuto === undefined ? {} : { droneAuto: m.droneAuto }), ...(m.dronePriority === undefined ? {} : { dronePriority: m.dronePriority }) } : {}) });
      else if (m?.id && it(m.id)) { back(alias('item', m.id), 1); fix('модуль брони вне сетки возвращён в инвентарь'); } }
    const arr = (a: any) => [0, 1, 2].map(i => Array.isArray(a) ? a[i] : undefined);
    const guns = arr(k.guns).map(g => it(g)?.gun ? alias('item', g) : (g && it(g) ? (back(alias('item', g), 1), null) : null));
    const ammo = arr(k.ammo).map(a => a && it(a.item)?.am ? stack(a) : (a && it(a.item) ? (back(alias('item', a.item), a.count | 0), null) : null));
    const rt = arr(k.rt).map(x => it(x)?.am ? alias('item', x) : null); const rnd = arr(k.rnd).map((x, i) => rt[i] ? Math.max(0, x | 0) : 0);
    const num = (v: any) => Number.isFinite(+v) ? Math.max(0, +v) : 0;
    pl.kit = { armor, grid, guns, ammo, rnd, rt, sel: [0, 1, 2].includes(k.sel) ? k.sel : 0, en: num(k.en), sh: num(k.sh), cd: [], ...(k.hid === true ? { hid: true } : {}) }; };
  cleanKit(s.player); if (Array.isArray(s.peers)) for (const p of s.peers) cleanKit(p?.player);
  // v1.5: провода — между существующими постройками; отложенные настройки чертежей — известных построек
  const ids = new Set(ents.map((o: any) => o.id));
  // v1.6: клемма 1 (выход) — только у арифметического и логического комбинаторов
  const outIds = new Set(ents.filter((o: any) => hasOut({ t: PROTOS[o.proto]?.type })).map((o: any) => o.id));
  s.cw = Array.isArray(s.cw) ? s.cw.map(cleanWire).filter((w: any) => w && ids.has(w[0]) && ids.has(w[1]) && (!w[3] || outIds.has(w[0])) && (!w[4] || outIds.has(w[1]))) : [];
  // v1.7: поезда — из существующих вагонов, расписание — из строк; рёбра пути проверяются после загрузки (restoreTrains)
  { const cars = new Set(ents.filter((o: any) => o.t === 'loco' || o.t === 'wagon').map((o: any) => o.id)); const used = new Set<number>();
    s.trains = (Array.isArray(s.trains) ? s.trains : []).filter((t: any) => t && Array.isArray(t.cars) && t.cars.length && t.cars.every((id: any) => cars.has(id) && !used.has(id)) && Array.isArray(t.trail) && t.trail.length && t.trail.every(Number.isInteger) && Number.isFinite(t.pos) && (t.cars.forEach((id: number) => used.add(id)), true));
    for (const t of s.trains) { t.sched = Array.isArray(t.sched) ? t.sched.filter((r: any) => r && typeof r.st === 'string').map(cleanSched).filter((r: any) => r) : [];
      t.res = Array.isArray(t.res) ? t.res.filter(Number.isInteger) : undefined; t.v = Math.max(0, +t.v || 0); }
    // вагоны без поезда — в инвентарь
    s.ents = s.ents.filter((o: any) => { if ((o.t === 'loco' || o.t === 'wagon') && !used.has(o.id)) { back(o.proto, 1); for (const [it, n] of entityItems(o)) back(it, n); fix('вагон без поезда возвращён в инвентарь'); return false; } return true; }); }
  // v1.8: лимит станции, жидкость цистерны, режим насоса
  for (const o of s.ents) {
    if (o.tlim != null) o.tlim = Number.isFinite(+o.tlim) ? Math.max(0, Math.min(99, Math.floor(+o.tlim))) : undefined;
    if (o.proto === 'fluid-wagon') { const ok = typeof o.tf === 'string' && ITEMS[o.tf]?.fluid; o.tn = ok ? Math.max(0, Math.min(25000, +o.tn || 0)) : 0; o.tf = ok && o.tn > 0 ? o.tf : null; }
    else if (o.tf != null || o.tn != null) { o.tf = undefined; o.tn = undefined; }
    if (o.pm != null) o.pm = o.pm === 1 ? 1 : undefined;
  }
  { const seen = new Set<string>(); s.cw = s.cw.filter((w: any) => { const k = w.join(','); if (seen.has(k)) return false; seen.add(k); return true; }); }
  s.cpend = Array.isArray(s.cpend) ? s.cpend.filter((q: any) => Array.isArray(q) && Number.isInteger(q[0]) && Number.isInteger(q[1]) && q[2] && PROTOS[q[2].p]) : [];
  for (const q of s.cpend) if (q[2].chest !== undefined && (PROTOS[q[2].p].type !== 'chest' || !validChestSettings(q[2].chest, PROTOS[q[2].p].slots))) delete q[2].chest;
  // v1.12: игроки кооператива — до 16 персонажей; имя (до 20 символов), цвет, инвентарь и очередь — как у инженера;
  // v1.13: роль, связь, тик потери связи, ключ — проверяются при загрузке
  s.peers = Array.isArray(s.peers) && s.peers.length > 1 ? s.peers.slice(0, 16 /* MAX_PEERS */).map((p: any, i: number) => {
    const o: any = { name: String(p?.name ?? '').slice(0, 20) || 'Игрок ' + (i + 1), color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#d2782e' };
    for (const k of ['role', 'off', 'offAt', 'key']) if (p && p[k] !== undefined) o[k] = p[k];
    if (i === 0) return o;
    o.player = p?.player && typeof p.player === 'object' && Number.isFinite(p.player.x) && Number.isFinite(p.player.y) ? p.player : { x: 0.5, y: 0.5 };
    const invSlots = Array.isArray(p?.inv) ? p.inv : [];
    o.inv = slots(invSlots, Math.max(32, Math.min(PLAYER_SLOTS, invSlots.length)), 'инвентарь игрока ' + (i + 1));
    if (Array.isArray(p?.trash)) o.trash = slots(p.trash, 8, 'ячейки для удаления игрока ' + (i + 1));
    o.queue = (Array.isArray(p?.queue) ? p.queue : []).filter((j: any) => j && RECIPES[alias('recipe', j.recipe)]).map((j: any) => ({ ...j, recipe: alias('recipe', j.recipe) }));
    o.held = p?.held ? stack(p.held) : null; o.equip = p?.equip && ITEMS[p.equip] ? p.equip : null;
    o.preq = Array.isArray(p?.preq) ? p.preq.map((q: any) => q && ITEMS[q.item] ? q : null) : []; o.preqOff = !!p?.preqOff;
    const ip = p?.input; const inR = (v: any) => typeof v === 'number' && v >= -1 && v <= 1; o.input = ip && typeof ip === 'object' && inR(ip.mx) && inR(ip.my) ? ip : { mx: 0, my: 0, mine: null };
    return o;
  }) : [];
  s.ghosts = (s.ghosts || []).filter((gh: any) => { gh.proto = alias('proto', gh.proto); if (gh.recipe && !RECIPES[gh.recipe]) gh.recipe = null; if (gh.chest !== undefined && (PROTOS[gh.proto]?.type !== 'chest' || !validChestSettings(gh.chest, PROTOS[gh.proto]?.slots))) delete gh.chest; return !!PROTOS[gh.proto]; });
  return rep;
}

/** Сводка сохранения для проверки «без потерь»: предметы, постройки, исследования, жидкости, мир */
export interface Ledger {
  items: Record<string, number>; ents: Record<string, number>; layout: string; fluids: Record<string, number>;
  research: string; tick: number; seed: number; rockets: number; goalIdx: number; ghosts: number; chunks: number; mods: number;
  decor: number; pollution: number; units: number; crafting: number; produced: number; tele: number;
}
export function ledger(s: any): Ledger {
  const items: Record<string, number> = {}, ents: Record<string, number> = {}, fluids: Record<string, number> = {};
  for (const x of s.inv || []) if (x) add(items, x.item, x.count);
  for (const x of s.trash || []) if (x) add(items, x.item, x.count);
  for (const p of s.peers || []) { for (const x of p.inv || []) if (x) add(items, x.item, x.count); for (const x of p.trash || []) if (x) add(items, x.item, x.count); }
  const lay: string[] = []; let crafting = 0;
  for (const o of s.ents || []) {
    add(ents, o.proto, 1); for (const [it, n] of entityItems(o)) add(items, it, n);
    lay.push(`${o.proto}@${o.x},${o.y},${o.dir},${o.recipe || ''}`); if (o.crafting) crafting++;
    if (o.famt) o.famt.forEach((a: number, i: number) => { const f = o.ffluid?.[i]; if (f && a > 0) fluids[f] = (fluids[f] || 0) + a; });
  }
  for (const it of s.ground || []) add(items, it.item, it.count || 1);
  for (const c of s.corpses || []) for (const x of c.slots || []) if (x) add(items, x.item, x.count);
  for (const r of s.robots || []) { add(items, r.lg ? 'logistic-robot' : 'construction-robot', 1); for (const x of r.cargo || []) add(items, x.item, x.count); }
  if (s.held) add(items, s.held.item, s.held.count);
  if (s.equip) add(items, s.equip, 1);
  for (const pl of [s.player, ...(Array.isArray(s.peers) ? s.peers.map((p: any) => p?.player) : [])]) { const k = pl?.kit; if (!k) continue; if (k.armor) add(items, k.armor, 1); for (const m of k.grid || []) add(items, m.id, 1); for (const g of k.guns || []) if (g) add(items, g, 1); for (const a of k.ammo || []) if (a) add(items, a.item, a.count); }
  lay.sort();
  let h = 0x811c9dc5; const str = lay.join(';'); for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  const r = s.research || {};
  let mods = 0, decor = 0; for (const c of s.chunks || []) { mods += c[2]?.length || 0; decor += c[3]?.length || 0; }
  return {
    items, ents, layout: (h >>> 0).toString(16) + ':' + lay.length, fluids,
    research: JSON.stringify([[...(r.done || [])].sort(), r.current ?? null, r.progress || 0, Object.entries(r.levels || {}).sort()]),
    tick: s.tick, seed: s.seed, rockets: s.rockets || 0, goalIdx: s.goalIdx, ghosts: (s.ghosts || []).length, chunks: (s.chunks || []).length, mods, decor,
    pollution: Math.round((s.pol || []).reduce((a: number, p: any) => a + p[2], 0) * 1000) / 1000, units: (s.units || []).length, crafting,
    produced: Object.values(s.stats?.produced || {}).reduce((a: number, b: any) => a + (+b || 0), 0), tele: s.tele?.goals?.length ?? -1,
  };
}
/** Различия двух сводок; fluidTol — допуск по жидкостям (их объём пересчитывается при пересборке сетей) */
export function diffLedger(a: Ledger, b: Ledger, o: { fluidTol?: number; skip?: (keyof Ledger)[] } = {}): string[] {
  const d: string[] = []; const tol = o.fluidTol ?? 1e-6; const skip = new Set(o.skip || []);
  const map = (name: string, x: Record<string, number>, y: Record<string, number>, t = 0) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const p = x[k] || 0, q = y[k] || 0; if (Math.abs(p - q) > t * Math.max(1, Math.abs(p))) d.push(`${name} ${k}: ${p} → ${q}`); }
  };
  if (!skip.has('items')) map('предмет', a.items, b.items);
  if (!skip.has('ents')) map('постройка', a.ents, b.ents);
  if (!skip.has('fluids')) map('жидкость', a.fluids, b.fluids, tol);
  for (const k of Object.keys(a) as (keyof Ledger)[]) {
    if (k === 'items' || k === 'ents' || k === 'fluids' || skip.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) d.push(`${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  }
  return d;
}

