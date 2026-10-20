// Загрязнение (10.1), Рой (10.2), оборона и бой (10.3), режимы (10.4).
// v1.14 «Рой 2.0»: семейства юнитов и свои логова, черви-плевуны 4 уровней, слизь вокруг гнёзд (отрастание гнёзд),
// элита и мутации после 95–100% эволюции, Королева, лужи кислоты, статистика Роя и окно угроз.
import { CHUNK, DX, DY, TICKS, ckey, tkey } from '../core/types';
import { hash2 } from '../core/rng';
import { PROTOS } from '../data/entities';
import type { DmgType } from '../data/items';
import { Chunk, T_SHALLOW, D_TREE } from './world';
import type { Entity, Game } from './game';
import { createBioCorpse } from './bio';
import { damageBioRobot } from './bioRobots';
import { damageCombatDrone, damageCombatDronesInRadius, droneGroundReachable } from './mechanical-drones';
import { BIO_V117_SOURCES } from '../data/biomaterials';

export type EnemyMode = 'none' | 'peaceful' | 'normal' | 'deathworld';
export interface UnitDef { name: string; hp: number; dmg: number; speed: number; range: number; cd: number; size: number; cost: number; evo: number; flat: number; pct: number; color: string; ranged?: boolean;
  /** v1.14: сопротивления по типу урона (доля; отрицательная — уязвимость), летает над стенами, взрывается у цели (радиус), выводок при гибели, босс, описание */
  res?: Partial<Record<DmgType, number>>; fly?: boolean; boom?: number; brood?: number; boss?: boolean; desc?: string; }
export const UNITS: Record<string, UnitDef> = {
  small: { name: 'Малый ползун', hp: 15, dmg: 7, speed: 0.1, range: 0.9, cd: 35, size: 0.6, cost: 4, evo: 0, flat: 0, pct: 0, color: '#b88a58', desc: 'Слабый, но быстрый и многочисленный' },
  medium: { name: 'Средний ползун', hp: 75, dmg: 15, speed: 0.09, range: 1, cd: 35, size: 0.85, cost: 20, evo: 0.2, flat: 4, pct: 0.1, color: '#b4503a', desc: 'Основа волн середины игры' },
  big: { name: 'Большой ползун', hp: 375, dmg: 30, speed: 0.08, range: 1.2, cd: 35, size: 1.15, cost: 80, evo: 0.5, flat: 8, pct: 0.1, color: '#6a4a9a', desc: 'Крепкий панцирь, держит пули' },
  spitter: { name: 'Плевун', hp: 50, dmg: 12, speed: 0.075, range: 9, cd: 90, size: 0.7, cost: 15, evo: 0.25, flat: 0, pct: 0, color: '#7ab040', ranged: true, res: { acid: 0.5 }, desc: 'Плюёт кислотой издалека; лужи разъедают конвейеры и трубы' },
  'spitter-big': { name: 'Большой плевун', hp: 220, dmg: 30, speed: 0.07, range: 13, cd: 100, size: 0.95, cost: 70, evo: 0.55, flat: 2, pct: 0.1, color: '#5a9a30', ranged: true, res: { acid: 0.7 }, desc: 'Дальнобойный плевун: бьёт из-за турелей' },
  armored: { name: 'Панцирник', hp: 900, dmg: 25, speed: 0.06, range: 1.2, cd: 40, size: 1.2, cost: 120, evo: 0.4, flat: 15, pct: 0.45, color: '#4a5a6a', res: { phys: 0.55, laser: 0.2, fire: -0.4 }, desc: 'Пули почти не берут — нужны огонь, взрывы и лазеры' },
  destroyer: { name: 'Ползун-разрушитель', hp: 600, dmg: 200, speed: 0.085, range: 1.1, cd: 30, size: 1.05, cost: 110, evo: 0.6, flat: 5, pct: 0.1, color: '#d07a2a', boom: 2.5, res: { fire: 0.2, expl: -0.3 }, desc: 'Бежит к стене и взрывается: 200 урона по площади' },
  flyer: { name: 'Летун', hp: 250, dmg: 40, speed: 0.13, range: 1.2, cd: 35, size: 0.9, cost: 90, evo: 0.7, flat: 2, pct: 0.15, color: '#5a8ad0', fly: true, res: { phys: 0.2, laser: -0.5, fire: 0.5 }, desc: 'Перелетает стены; слаб против лазеров; огнемёты и миномёты его не достают' },
  brood: { name: 'Матка выводка', hp: 1600, dmg: 50, speed: 0.06, range: 1.4, cd: 40, size: 1.5, cost: 300, evo: 0.8, flat: 10, pct: 0.25, color: '#8a3a7a', brood: 5, desc: 'При гибели выпускает выводок мелких ползунов' },
  giant: { name: 'Гигант', hp: 3000, dmg: 90, speed: 0.07, range: 1.6, cd: 35, size: 1.8, cost: 400, evo: 0.9, flat: 10, pct: 0.2, color: '#3f5a2f', desc: 'Медленный таран' },
  queen: { name: 'Королева Роя', hp: 60000, dmg: 260, speed: 0.065, range: 2.6, cd: 50, size: 3.2, cost: 0, evo: 2, flat: 20, pct: 0.3, color: '#c03a8a', boss: true, ranged: false, res: { acid: 1 }, desc: 'Босс мутаций после 100% эволюции: плюётся кислотой и рожает маток' },
};
export interface SlowEffect { pct: number; until: number; }
export interface Unit { id: number; k: string; x: number; y: number; hp: number; gid: number; nest: number; tgt: number; cd: number; st: 'gather' | 'attack' | 'return' | 'defend'; pi: number; ang: number; aggro: number; idle: number; slowPct?: number; slowPctUntil?: number; slowEffects?: SlowEffect[];
  /** v1.14: наибольшее здоровье, множитель урона (мутации), элита (1), горит (тиков), замедлен (тиков) */ mh?: number; dm?: number; el?: number; burn?: number; slow?: number; }
export interface Group { id: number; nest: number; units: number[]; size: number; st: 'forming' | 'attacking'; tgt: number; path: [number, number][] | null; }
export interface Projectile { x: number; y: number; tx: number; ty: number; v: number; dmg: number; /** v1.14: радиус лужи кислоты */ r?: number; /** Hostile worm responsible for retaliation. */ by?: number; /** Stable allied owner; absent means hostile legacy acid. */ owner?: string; }
export interface Fx { k: 'tracer' | 'boom' | 'acid' | 'hit' | 'laser' | 'arc' | 'rail' | 'flame' | 'blast' | 'regrow'; x: number; y: number; x2?: number; y2?: number; t: number; /** начальный срок прогрессирующей анимации; отсутствует в старых снимках */ life?: number; s?: number; /** v1.14: точки цепи молнии */ pts?: number[]; }
/** v1.14: лужа кислоты — разъедает конвейеры, трубы и инженеров */
export interface Acid { x: number; y: number; r: number; t: number; dmg: number; by?: number; owner?: string; }
/** v1.14: атака Роя для окна угроз — откуда (гнездо), куда, сколько, кто, итог */
export interface Attack { id: number; t: number; x: number; y: number; tx: number; ty: number; n: number; k: string; end?: number; killed: number; lost: number; q?: 1; el?: number; }
/** v1.14: статистика Роя — убито по видам и чем, потери построек, атаки (последний час), история эволюции (раз в минуту) */
export interface SwarmStats { kills: Record<string, number>; by: Record<string, number>; lost: Record<string, number>; att: Attack[]; evoH: number[]; nests: number; worms: number; queens: number; regrown: number; total: number; /** клеток слизи выжжено */ burned?: number; }
export const newSwarm = (): SwarmStats => ({ kills: {}, by: {}, lost: {}, att: [], evoH: [], nests: 0, worms: 0, queens: 0, regrown: 0, total: 0 });
export const PLAYER_ID = -2;
/** v1.12: цель «игрок i» — PLAYER_ID - i (−2, −3, −4, −5) */
export const isPlTgt = (t: number) => t <= PLAYER_ID;
const plOf = (g: Game, t: number) => g.peer(PLAYER_ID - t).player;
/** урон игроку i (поля игрока подставляются на время урона) */
export function hurtPl(g: Game, i: number, dmg: number, dt: DmgType | 'rad' = 'phys') { if (!g.peers.length) { g.markRadarThreatHit(g.player.x, g.player.y); g.hurtPlayer(dmg, false, false, dt); return; } if (g.peers[i]?.off) return; /* v1.13: персонаж без связи неуязвим */ const i0 = g.pl, sc = g.plScope; g.usePl(i); g.plScope = true; g.markRadarThreatHit(g.player.x, g.player.y); g.hurtPlayer(dmg, false, false, dt); g.usePl(i0); g.plScope = sc; }

const POL_TICKS = 64;
/** v1.14: постройки Роя — гнёзда и черви (тип 'nest'); червь — PROTOS[].enemy.worm */
export const isEnemy = (e: Entity | null | undefined) => !!e && e.t === 'nest';
export const isWorm = (e: Entity) => !!PROTOS[e.proto].enemy?.worm;
export const NEST_PROTOS = ['biter-spawner', 'spitter-spawner', 'armored-mound', 'destroyer-hive', 'flyer-roost', 'brood-lair'];
export const WORM_PROTOS = ['worm-small', 'worm-medium', 'worm-big', 'worm-behemoth'];
/** v1.14: мутации (уровень растёт после 100% эволюции): +12% здоровья и +8% урона за уровень */
export const MUT_HP = 0.12, MUT_DMG = 0.08, MUT_TICKS = 20 * 60 * TICKS, ELITE_EVO = 0.95, MUT_EVO = 0.995;
export const unitMax = (u: Unit) => u.mh ?? UNITS[u.k].hp;
export const LOG_TICKS = 60 * 60 * TICKS;

// ---------- кэши (не сохраняются) ----------
/** гнёзда (без червей) и черви — по версии состава построек */
export function nestList(g: Game): { ver: number; nests: Entity[]; worms: Entity[] } {
  const c = g._nl; if (c && c.ver === g.ents.ver) return c;
  const nests: Entity[] = [], worms: Entity[] = [];
  for (const e of g.ents.values()) if (e.t === 'nest') (isWorm(e) ? worms : nests).push(e);
  return g._nl = { ver: g.ents.ver, nests, worms };
}
/** корзины построек игрока по чанкам (для поиска ближайшей цели Роя) — пересборка не чаще раза в секунду */
function bIndex(g: Game): Map<number, Entity[]> {
  const c = g._bi; if (c && (c.ver === g.ents.ver || g.tick - c.tick < 60)) return c.m;
  const m = new Map<number, Entity[]>();
  for (const e of g.ents.values()) { if (e.t === 'nest') continue; const k = ckey(Math.floor((e.x + e.w / 2) / CHUNK), Math.floor((e.y + e.h / 2) / CHUNK)); let a = m.get(k); if (!a) m.set(k, a = []); a.push(e); }
  g._bi = { ver: g.ents.ver, tick: g.tick, m }; return m;
}
/** сетка юнитов 8×8 клеток — для турелей и оружия (строится после шага Роя) */
const UG = 8;
export function unitGrid(g: Game): Map<number, Unit[]> {
  const c = g._ug; if (c && c.tick === g.tick && c.n === g.units.length) return c.m;
  const m = new Map<number, Unit[]>(); const byId = new Map<number, Unit>();
  for (const u of g.units) { if (u.hp <= 0) continue; const k = tkey(Math.floor(u.x / UG), Math.floor(u.y / UG)); let a = m.get(k); if (!a) m.set(k, a = []); a.push(u); byId.set(u.id, u); }
  g._ug = { tick: g.tick, n: g.units.length, m, byId }; return m;
}
export const unitById = (g: Game, id: number): Unit | undefined => { unitGrid(g); return g._ug!.byId.get(id); };
/** юниты в круге (живые); air/ground — фильтр летунов */
export function unitsNear(g: Game, x: number, y: number, r: number, out: Unit[] = [], air = true, ground = true): Unit[] {
  const m = unitGrid(g); out.length = 0;
  const x0 = Math.floor((x - r) / UG), x1 = Math.floor((x + r) / UG), y0 = Math.floor((y - r) / UG), y1 = Math.floor((y + r) / UG), r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const a = m.get(tkey(cx, cy)); if (!a) continue;
    for (const u of a) { if (u.hp <= 0) continue; const fl = !!UNITS[u.k].fly; if (fl ? !air : !ground) continue; const dx = u.x - x, dy = u.y - y; if (dx * dx + dy * dy <= r2) out.push(u); } }
  return out;
}
/** ближайший юнит (детерминированно: при равенстве — меньший id) */
export function nearestUnit(g: Game, x: number, y: number, r: number, air = true, ground = true, min = 0): Unit | null {
  const a = unitsNear(g, x, y, r, TMP, air, ground); let best: Unit | null = null, bd = Infinity;
  const peaceful = g.settings.enemies === 'peaceful';
  for (const u of a) { if (peaceful && !(u.aggro > 0 || u.st === 'attack')) continue; const d = Math.hypot(u.x - x, u.y - y); if (d < min) continue; if (d < bd || d === bd && best && u.id < best.id) { bd = d; best = u; } }
  return best;
}
const TMP: Unit[] = [];

// ---------- загрязнение ----------
export function emit(g: Game, x: number, y: number, perMin: number) {
  const c = g.world.chunkAt(Math.floor(x), Math.floor(y));
  const k = perMin / 3600 * (g.settings.enemies === 'deathworld' ? 1.5 : 1);
  c.pollution += k; g.polProduced += k; (g.stats as any).pol = ((g.stats as any).pol || 0) + k; // v1.15: суммарно за партию (достижение «Зелёный инженер»)
}
/** v1.14: загрязнение растекается втрое быстрее (0,06 вместо 0,02 в каждую сторону за 64 тика) */
export const POL_SPREAD = 0.06;
function stepPollution(g: Game) {
  const ch = [...g.world.chunks.values()];
  const delta = new Map<Chunk, number>();
  for (const c of ch) {
    if (c.pollution < 0.05) continue;
    const out = c.pollution * POL_SPREAD;
    for (let d = 0; d < 4; d++) {
      const n = g.world.chunks.get(ckey(c.cx + DX[d], c.cy + DY[d])); if (!n) continue;
      delta.set(n, (delta.get(n) || 0) + out); delta.set(c, (delta.get(c) || 0) - out);
    }
  }
  for (const [c, d] of delta) c.pollution += d;
  for (const c of ch) c.pollution = Math.max(0, c.pollution - c.absorb * POL_TICKS);
}
// ---------- слизь Роя ----------
export function creepAt(g: Game, x: number, y: number): number { const c = g.world.chunks.get(ckey(Math.floor(x / CHUNK), Math.floor(y / CHUNK))); return c?.creep ? c.creep[g.world.idx(Math.floor(x), Math.floor(y))] : 0; }
function setCreep(g: Game, c: Chunk, i: number, v: number) {
  if (!c.creep) { if (v <= 0) return; c.creep = new Uint8Array(CHUNK * CHUNK); g.creepSet.add(ckey(c.cx, c.cy)); }
  if (c.creep[i] !== v) { c.creep[i] = v; c.cv = (c.cv || 0) + 1; }
}
/** Take exactly the available creep amount without recording it as burned. */
export function harvestCreep(g: Game, x: number, y: number, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return 0;
  const c = g.world.chunks.get(ckey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
  if (!c?.creep) return 0;
  const i = g.world.idx(x, y), have = c.creep[i], taken = Math.min(have, amount);
  if (taken) { setCreep(g, c, i, have - taken); c.cn = g.tick; }
  return taken;
}
/** Restore/assign a creep cell for atomic harvesting rollback. This is not fire cleanup. */
export function setCreepIntensity(g: Game, x: number, y: number, value: number) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isFinite(value) || value < 0 || value > 255) return false;
  const c = g.world.chunks.get(ckey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
  if (!c) return false;
  setCreep(g, c, g.world.idx(x, y), Math.round(value)); c.cn = g.tick;
  return true;
}
/** покрасить слизью круг (клетки с постройками игрока и покрытиями не покрываются) */
function paintCreep(g: Game, x: number, y: number, r: number, v: number, n: number) {
  for (let k = 0; k < n; k++) {
    const a = g.rng.float() * Math.PI * 2, d = Math.sqrt(g.rng.float()) * r;
    const tx = Math.floor(x + Math.cos(a) * d), ty = Math.floor(y + Math.sin(a) * d);
    if (!g.world.hasChunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) continue;
    const c = g.world.chunkAt(tx, ty), i = g.world.idx(tx, ty);
    if (c.terrain[i] >= T_SHALLOW) continue; const o = c.occ[i]; if (o >= 0 && g.ents.get(o)?.t !== 'nest') continue;
    if (g.floors.has(tkey(tx, ty))) continue;
    const cur = c.creep ? c.creep[i] : 0; if (cur < v) setCreep(g, c, i, Math.min(255, Math.max(cur + 60, Math.min(v, cur + 120))));
    c.cn = g.tick;
  }
}
/** выжечь слизь (огонь — полностью, взрыв — частично) */
export function burnCreep(g: Game, x: number, y: number, r: number, amt: number) {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
    if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > r) continue;
    const c = g.world.chunks.get(ckey(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))); if (!c?.creep) continue;
    const i = g.world.idx(tx, ty); const v = c.creep[i]; if (v) { setCreep(g, c, i, Math.max(0, v - amt)); if (v - amt <= 0) g.sw.burned = (g.sw.burned || 0) + 1; }
  }
}
export const CREEP_BLOCK = 120;
function stepCreep(g: Game) {
  const { nests } = nestList(g);
  const ev = g.evolution;
  // гнёзда растят слизь: радиус растёт до своего предела (больше с эволюцией)
  for (const e of nests) {
    const en = PROTOS[e.proto].enemy!; const R = (en.creep || 6) * (1 + 0.5 * ev);
    e.cr = Math.min(R, (e.cr || 2) + 0.12);
    paintCreep(g, e.x + e.w / 2, e.y + e.h / 2, e.cr, 230, 6);
  }
  // без гнезда слизь медленно сохнет; на густой слизи без гнёзд гнездо отрастает (выжгите огнём!)
  if (g.tick % (POL_TICKS * 4) !== 0) return;
  const regrow = g.settings.enemies !== 'none';
  for (const k of [...g.creepSet]) {
    const c = g.world.chunks.get(k); if (!c?.creep) { g.creepSet.delete(k); continue; }
    if (g.tick - (c.cn ?? -1e9) < POL_TICKS * 20) continue;
    let n = 0, any = false; const a = c.creep;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (!v) continue; any = true; if (v >= 150) n++; const nv = v > 4 ? v - 4 : 0; a[i] = nv; }
    c.cv = (c.cv || 0) + 1;
    if (!any) { c.creep = undefined; g.creepSet.delete(k); c.cv++; continue; }
    if (regrow && n >= 60 && g.rng.float() < 0.05) {
      for (let t = 0; t < 6; t++) {
        const i = g.rng.int(CHUNK * CHUNK); if (a[i] < 150) continue;
        const x = c.cx * CHUNK + (i % CHUNK) - 1, y = c.cy * CHUNK + Math.floor(i / CHUNK) - 1;
        if (nearestBuilding(g, x, y, 10)) break;
        const e = placeNest(g, x, y, pickNestProto(g, ev, x * 7 + y)); if (e) { g.sw.regrown++; g.fx.push({ k: 'regrow', x: x + 1.5, y: y + 1.5, t: 90, s: 3 }); if (nearestBuilding(g, x, y, 80)) g.alert(x, y, 'Гнездо отросло на слизи Роя — выжгите слизь огнём'); break; }
      }
    }
  }
}
// ---------- генерация гнёзд ----------
/** вид логова по «эволюции места» (дальше от старта — сильнее) */
function pickNestProto(g: Game, e: number, h: number): string {
  const opts = NEST_PROTOS.filter(p => PROTOS[p].enemy!.evo <= e + 1e-9);
  const w = opts.map(p => p === 'biter-spawner' ? 3 : p === 'spitter-spawner' ? 2 : 1.4);
  const tot = w.reduce((a, b) => a + b, 0); let r = hash2(h, h * 7 + 3, g.seed ^ 0x5eed) * tot;
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; } return opts[0];
}
/** уровень червя: веса по эволюции (малый → чудовищный) */
export function wormWeights(e: number): number[] {
  return [Math.max(0.1, 1 - e * 1.4), e >= 0.25 ? Math.min(1, (e - 0.25) * 3) : 0, e >= 0.5 ? Math.min(1, (e - 0.5) * 3) : 0, e >= 0.85 ? Math.min(1.5, (e - 0.85) * 6) : 0];
}
function pickWorm(e: number, r01: number): string {
  const w = wormWeights(e); const tot = w.reduce((a, b) => a + b, 0); let r = r01 * tot;
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return WORM_PROTOS[i]; } return WORM_PROTOS[0];
}
export function spawnBase(g: Game, c: Chunk) {
  const m = g.settings.enemies; if (m === 'none') return;
  const sc = g.scn;
  if (sc) { // v1.15: сценарий — заданные гнёзда этого чанка; по правилам — и обычные
    for (const n of sc.map.nests) if (Math.floor(n.x / CHUNK) === c.cx && Math.floor(n.y / CHUNK) === c.cy) { const e = placeNest(g, n.x, n.y, n.proto, true); if (e && !PROTOS[n.proto].enemy?.worm) { e.cr = (PROTOS[n.proto].enemy!.creep || 6) * 0.8; fillCreep(g, c, e); } }
    if (sc.rules.nests !== 'auto') return;
  }
  const cx = c.cx * CHUNK + 16, cy = c.cy * CHUNK + 16; const dist = Math.hypot(cx, cy);
  const nmin = sc ? sc.rules.nestMin : 260;
  if (dist < nmin) return;
  // v1.14: чем дальше, тем больше и плотнее гнёзда и тем сильнее их виды
  const far = Math.min(3, (dist - nmin) / 500);
  const dens = (m === 'deathworld' ? 0.13 : 0.06) * (1 + far * 0.35) * (sc ? sc.rules.nestDens : 1);
  if (hash2(c.cx, c.cy, g.seed ^ 0xbee5) > dens * Math.min(1.5, dist / 400)) return;
  const n = Math.round((3 + Math.floor(hash2(c.cx, c.cy, g.seed ^ 0x77) * 10)) * (1 + far * 0.5));
  const areaEvo = Math.max(g.evolution, Math.min(1, (dist - nmin) / 1400));
  let placed = 0;
  for (let k = 0; k < 60 && placed < n; k++) {
    const x = c.cx * CHUNK + 2 + Math.floor(hash2(c.cx * 31 + k, c.cy, g.seed ^ 0x99) * 26), y = c.cy * CHUNK + 2 + Math.floor(hash2(c.cx, c.cy * 31 + k, g.seed ^ 0x98) * 26);
    const worm = hash2(c.cx * 13 + k, c.cy * 17, g.seed ^ 0x3070) < 0.38;
    const proto = worm ? pickWorm(areaEvo, hash2(c.cx + k, c.cy - k, g.seed ^ 0x3071)) : pickNestProto(g, areaEvo, c.cx * 977 + c.cy * 131 + k);
    const e = placeNest(g, x, y, proto, true);
    if (e) { placed++; if (!worm) { e.cr = (PROTOS[proto].enemy!.creep || 6) * 0.8; fillCreep(g, c, e); } }
  }
}
/** слизь вокруг гнезда при генерации карты (детерминированно, без ГСЧ партии) */
function fillCreep(g: Game, c: Chunk, e: Entity) {
  const r = e.cr!, ox = e.x + e.w / 2, oy = e.y + e.h / 2;
  for (let ty = Math.floor(oy - r); ty <= Math.floor(oy + r); ty++) for (let tx = Math.floor(ox - r); tx <= Math.floor(ox + r); tx++) {
    const d = Math.hypot(tx + 0.5 - ox, ty + 0.5 - oy); if (d > r * (0.8 + 0.3 * hash2(tx, ty, 0xc4ee9))) continue;
    if (Math.floor(tx / CHUNK) !== c.cx || Math.floor(ty / CHUNK) !== c.cy) continue;
    const i = g.world.idx(tx, ty); if (c.terrain[i] >= T_SHALLOW) continue;
    setCreep(g, c, i, Math.max(c.creep?.[i] || 0, Math.round(160 + 90 * (1 - d / r))));
  }
  c.cn = g.tick;
}
export function placeNest(g: Game, x: number, y: number, proto = 'biter-spawner', gen = false): Entity | null {
  const p = PROTOS[proto]; const w = p.w, h = p.h;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    if (gen && (Math.floor(tx / CHUNK) !== Math.floor(x / CHUNK) || Math.floor(ty / CHUNK) !== Math.floor(y / CHUNK))) return null;
    if (g.world.terrain(tx, ty) >= T_SHALLOW || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) return null;
  }
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  const e = g.build(proto, x, y, 0, false);
  if (e) { e.points = 0; e.spawnCd = 0; e.gid = -1; if (!p.enemy?.worm) e.cr = 2; }
  return e;
}
// ---------- юниты ----------
/** вид юнита для гнезда: по семейству логова и эволюции (слабые со временем редеют) */
export function pickKind(g: Game, nest?: Entity): string {
  const e = g.evolution;
  const fam = nest && PROTOS[nest.proto].enemy?.units.length ? PROTOS[nest.proto].enemy!.units : ['small', 'medium', 'spitter', 'big', 'giant'];
  const w: [string, number][] = fam.map((k, i) => [k, i === 0 ? Math.max(0.08, 1 - e * 1.3) : e >= UNITS[k].evo ? Math.min(1, (e - UNITS[k].evo) * 3 + 0.12) * (UNITS[k].ranged ? 0.6 : 1) : 0]);
  const tot = w.reduce((a, b) => a + b[1], 0); let r = g.rng.float() * tot;
  for (const [k, v] of w) { r -= v; if (r <= 0) return k; } return fam[0];
}
export function makeUnit(g: Game, k: string, x: number, y: number, st: Unit['st'], nest = -1, elite = false): Unit {
  const d = UNITS[k]; const mut = g.mut || 0;
  const mh = Math.round(d.hp * (elite ? 3 : 1) * (1 + MUT_HP * mut));
  const u: Unit = { id: g.nextUnit++, k, x, y, hp: mh, gid: -1, nest, tgt: -1, cd: 0, st, pi: 0, ang: 0, aggro: 0, idle: 0, mh, dm: (elite ? 1.6 : 1) * (1 + MUT_DMG * mut) };
  if (elite) u.el = 1;
  g.units.push(u); return u;
}
function spawnUnit(g: Game, nest: Entity, k: string, st: Unit['st'], elite = false): Unit {
  const a = g.rng.float() * Math.PI * 2, R = nest.w / 2 + 1.1;
  const u = makeUnit(g, k, nest.x + nest.w / 2 + Math.cos(a) * R, nest.y + nest.h / 2 + Math.sin(a) * R, st, nest.id, elite); u.ang = a; return u;
}
export function nestAttacked(g: Game, nest: Entity, by: number) {
  if (isWorm(nest)) { // черви зовут защитников ближайших гнёзд и отвечают даже в мирном режиме
    nest.aggro = g.tick + 600;
    if (g.tick % 30 === 0) for (const u of g.units) if (u.st !== 'attack' && Math.hypot(u.x - nest.x, u.y - nest.y) < 18) { u.tgt = by; u.aggro = 600; u.st = 'defend'; }
    return;
  }
  let alive = 0; for (const u of g.units) if (u.nest === nest.id && u.st === 'defend') alive++;
  for (const u of g.units) if (u.nest === nest.id && Math.hypot(u.x - nest.x, u.y - nest.y) < 25) { u.tgt = by; u.aggro = 600; u.st = 'defend'; }
  if (alive < 8 && g.tick % 40 === 0) for (let i = 0; i < 2; i++) { const u = spawnUnit(g, nest, pickKind(g, nest), 'defend'); u.tgt = by; u.aggro = 900; }
}
/** чем убит юнит — для статистики (турель по виду, инженер) */
function srcOf(g: Game, by: number): string {
  if (isPlTgt(by)) return 'player'; if (by === -1) return 'fire';
  const e = g.ents.get(by); if (!e) return 'other';
  const t = PROTOS[e.proto].tur; return t ? t.kind : e.t;
}
/** урон с учётом сопротивления (v1.14: по типу урона) */
export function applyUnitSlow(g: Game, u: Unit, pct: number, duration: number) {
  const d = UNITS[u.k]; if (!d || d.fly || u.hp <= 0 || !(duration > 0) || !(pct > 0)) return;
  const effect = { pct: Math.min(0.95, pct), until: g.tick + Math.max(1, Math.round(duration)) };
  const active = (u.slowEffects || []).filter(x => Number.isFinite(x.pct) && x.pct > 0 && Number.isFinite(x.until) && x.until > g.tick);
  const same = active.find(x => Math.abs(x.pct - effect.pct) < 1e-6);
  if (same) same.until = Math.max(same.until, effect.until); else active.push(effect);
  // Keep separate expiry times so a short, strong effect does not erase a
  // longer weak effect that should resume after it wears off.
  active.sort((a, b) => b.pct - a.pct || b.until - a.until);
  u.slowEffects = active.slice(0, 8);
}
function activeUnitSlow(g: Game, u: Unit): number {
  let pct = (u.slow || 0) > 0 ? 0.5 : 0;
  if (u.slowPctUntil != null && u.slowPctUntil > g.tick) pct = Math.max(pct, u.slowPct || 0);
  for (const effect of u.slowEffects || []) if (effect.until > g.tick) pct = Math.max(pct, effect.pct);
  return Math.min(0.95, pct);
}
export function unitHitDamage(d: UnitDef, dmg: number, dt: DmgType = 'phys', armorScale = 1, resistanceScale = 1, minimum = 1) {
  const res = d.res?.[dt] ?? (dt === 'phys' || dt === 'expl' ? d.pct : d.pct * 0.5);
  const flat = dt === 'phys' ? d.flat : dt === 'expl' ? d.flat * 0.5 : 0;
  const rscale = res > 0 ? resistanceScale : 1;
  return Math.max(minimum, dmg - flat * armorScale) * (1 - res * rscale);
}
export function hitUnit(g: Game, u: Unit, dmg: number, by: number, dt: DmgType = 'phys', armorScale = 1, resistanceScale = 1, minimum = 1) {
  if (u.hp <= 0) return;
  const d = UNITS[u.k], real = unitHitDamage(d, dmg, dt, armorScale, resistanceScale, minimum);
  u.hp -= real; u.aggro = 900; if (u.st !== 'attack' || u.tgt < 0 || isPlTgt(by)) u.tgt = by;
  if (u.hp <= 0) {
    createBioCorpse(g, 'unit', u.id, u.k, u.x, u.y, false, dt === 'fire');
    g.fx.push({ k: 'hit', x: u.x, y: u.y, t: 30, s: d.size }); g.snd('squish', u.x, u.y); g.stats.kills = (g.stats.kills || 0) + 1;
    const sw = g.sw; sw.kills[u.k] = (sw.kills[u.k] || 0) + 1; const s = srcOf(g, by); sw.by[s] = (sw.by[s] || 0) + 1;
    if (d.brood) (g._brood ||= []).push(u);
    if (d.boss) { sw.queens++; g.alert(u.x, u.y, 'Королева Роя убита!'); }
    if (u.gid >= 0) { const a = sw.att.find(x => x.id === u.gid); if (a) a.killed++; }
  }
}
// ---------- поиск пути: A* по клеткам (14.6, упрощённо — с бюджетом узлов) ----------
export function findPath(g: Game, sx: number, sy: number, tx: number, ty: number, budget = 30000): [number, number][] | null {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  const open: [number, number, number, number][] = []; // f, g, x, y — двоичная куча
  const push = (n: [number, number, number, number]) => { open.push(n); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0]; const last = open.pop()!; if (open.length) { open[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  const h = (x: number, y: number) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const came = new Map<number, number>(); const cost = new Map<number, number>();
  const k0 = tkey(sx, sy); cost.set(k0, 0); push([h(sx, sy), 0, sx, sy]);
  let n = 0;
  while (open.length && n++ < budget) {
    const [, gc, x, y] = pop();
    if (Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1) {
      const path: [number, number][] = [[x, y]]; let k = tkey(x, y);
      while (came.has(k)) { k = came.get(k)!; const px = Math.floor(k / 131072) - 65536, py = (k % 131072) - 65536; path.push([px, py]); }
      return path.reverse();
    }
    if (gc > (cost.get(tkey(x, y)) ?? Infinity)) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!g.world.hasChunk(Math.floor(nx / CHUNK), Math.floor(ny / CHUNK))) continue;
      if (g.world.terrain(nx, ny) >= T_SHALLOW) continue;
      if (dx && dy && (g.world.terrain(x + dx, y) >= T_SHALLOW || g.world.terrain(x, y + dy) >= T_SHALLOW)) continue;
      let c = dx && dy ? 1.414 : 1;
      const e = g.entAt(nx, ny);
      if (e) { if (e.t === 'nest') c += 6; else if (PROTOS[e.proto].solid) c += 25; }
      if (g.world.decor(nx, ny) === D_TREE) c += 0.6;
      const ng = gc + c, nk = tkey(nx, ny);
      if (ng < (cost.get(nk) ?? Infinity)) { cost.set(nk, ng); came.set(nk, tkey(x, y)); push([ng + h(nx, ny), ng, nx, ny]); }
    }
  }
  return null;
}
/** v1.14: ближайшая постройка игрока — по корзинам чанков (раньше — обход всех построек) */
export function nearestBuilding(g: Game, x: number, y: number, r: number, polluterOnly = false): Entity | null {
  const m = bIndex(g); let best: Entity | null = null, bd = r;
  const c0x = Math.floor((x - r) / CHUNK), c1x = Math.floor((x + r) / CHUNK), c0y = Math.floor((y - r) / CHUNK), c1y = Math.floor((y + r) / CHUNK);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const a = m.get(ckey(cx, cy)); if (!a) continue;
    for (const e of a) {
      if (e._gone || e.t === 'signal' && polluterOnly) continue; // v1.8: Рой атакует и рельсы, и поезда
      if (polluterOnly && !(PROTOS[e.proto].pollution && e.active)) continue;
      const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
      if (d < bd || d === bd && best && e.id < best.id) { bd = d; best = e; }
    }
  }
  return best;
}
function distToEnt(e: Entity, x: number, y: number) {
  const cx = Math.max(e.x, Math.min(x, e.x + e.w)), cy = Math.max(e.y, Math.min(y, e.y + e.h)); return Math.hypot(cx - x, cy - y);
}
function enemyBlocked(g: Game, x: number, y: number): Entity | 'water' | null {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (g.world.terrain(tx, ty) >= T_SHALLOW) return 'water';
  const e = g.entAt(tx, ty); if (e && PROTOS[e.proto].solid && !(e.t === 'gate' && e.open)) return e;
  return null;
}
function damageBioRobotsInRadius(g: Game, x: number, y: number, radius: number, damage: number) {
  if (!g.bioRobots.length) return;
  for (const r of [...g.bioRobots]) if (Math.hypot(r.x - x, r.y - y) <= radius) { g.markRadarThreatHit(r.x, r.y); damageBioRobot(g, r.id, damage); }
}
type V117Bioform = Game['v117']['genetics']['forms'][number];
function damageBioform(g: Game, f: V117Bioform, damage: number, attacker?: { kind: 'unit' | 'entity'; id: number }, dt: DmgType = 'phys') {
  if (f.dead || !Number.isFinite(damage) || damage <= 0) return false;
  const def = UNITS[f.family], actual = def ? unitHitDamage(def, damage, dt) : damage;
  g.markRadarThreatHit(f.x, f.y); f.repair = 0; f.hp = Math.max(0, f.hp - actual);
  if (attacker && Number.isSafeInteger(attacker.id) && attacker.id > 0) f.retaliation = { ...attacker, until: g.tick + 10 * TICKS };
  if (f.hp <= 0) {
    f.dead = true; f.target = null;
    delete f.detonationTicks;
    const salvage = BIO_V117_SOURCES.find(s => s.kind === f.family)?.w || 0;
    if (salvage) g.dropGround(f.x, f.y, 'organic-residue', salvage);
    g.alert(f.x, f.y, 'Биоотряд погиб');
  }
  return true;
}
function damageBioformsInRadius(g: Game, x: number, y: number, radius: number, damage: number, attacker?: { kind: 'unit' | 'entity'; id: number }, dt: DmgType = 'acid') {
  for (const f of g.v117.genetics.forms) if (!f.dead && Math.hypot(f.x - x, f.y - y) <= radius) damageBioform(g, f, damage, attacker, dt);
}
/** v1.14: взрыв разрушителя — урон постройкам и инженерам вокруг, сам гибнет */
function explode(g: Game, u: Unit, d: UnitDef) {
  const r = d.boom!, dmg = d.dmg * (u.dm ?? 1);
  for (let ty = Math.floor(u.y - r); ty <= Math.floor(u.y + r); ty++) for (let tx = Math.floor(u.x - r); tx <= Math.floor(u.x + r); tx++) {
    if (Math.hypot(tx + 0.5 - u.x, ty + 0.5 - u.y) > r) continue; const e = g.entAt(tx, ty); if (e && e.t !== 'nest' && !e._hitT) { e._hitT = 1; g._lastGid = u.gid; g.damage(e, dmg, true); }
  }
  for (let ty = Math.floor(u.y - r); ty <= Math.floor(u.y + r); ty++) for (let tx = Math.floor(u.x - r); tx <= Math.floor(u.x + r); tx++) { const e = g.entAt(tx, ty); if (e) e._hitT = 0; }
  for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (!q.dead && Math.hypot(q.x - u.x, q.y - u.y) < r) hurtPl(g, i, dmg * 0.5, 'expl'); }
  damageBioRobotsInRadius(g, u.x, u.y, r, dmg); damageBioformsInRadius(g, u.x, u.y, r, dmg, { kind: 'unit', id: u.id }, 'expl');
  damageCombatDronesInRadius(g, u.x, u.y, r, dmg, true);
  g.fx.push({ k: 'blast', x: u.x, y: u.y, t: 36, life: 36, s: r }); g.snd('boom', u.x, u.y);
  createBioCorpse(g, 'unit', u.id, u.k, u.x, u.y, true);
  u.hp = 0; g.sw.kills[u.k] = (g.sw.kills[u.k] || 0) + 1; g.sw.by.self = (g.sw.by.self || 0) + 1;
}
function attackTarget(g: Game, u: Unit, d: UnitDef) {
  if (u.cd > 0) return;
  u.cd = d.cd;
  if (d.boom) { explode(g, u, d); return; }
  const dmg = d.dmg * (u.dm ?? 1);
  if (d.ranged || d.boss && g.rng.float() < 0.35) {
    let tx: number, ty: number;
    if (isPlTgt(u.tgt)) { const p = plOf(g, u.tgt); tx = p.x; ty = p.y; } else { const e = g.ents.get(u.tgt); if (!e) return; tx = e.x + e.w / 2; ty = e.y + e.h / 2; }
    g.projectiles.push({ x: u.x, y: u.y, tx, ty, v: 0.25, dmg, ...(d.boss ? { r: 2.5 } : u.k === 'spitter-big' ? { r: 1.5 } : {}) });
    if (!d.boss) return;
  }
  if (isPlTgt(u.tgt)) hurtPl(g, PLAYER_ID - u.tgt, dmg, d.boss ? 'acid' : 'phys');
  else { const e = g.ents.get(u.tgt); if (e) { g._lastGid = u.gid; g.damage(e, dmg, true); } }
}
function stepUnits(g: Game) {
  const peaceful = g.settings.enemies === 'peaceful';
  // пространственная сетка для разведения юнитов
  const grid = new Map<number, Unit[]>();
  for (const u of g.units) { if (UNITS[u.k].fly) continue; const k = tkey(Math.floor(u.x), Math.floor(u.y)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(u); }
  const groups = new Map<number, Group>(); for (const gr of g.groups) groups.set(gr.id, gr);
  const regenTick = g.tick % 30 === 0;
  for (const u of g.units) {
    if (u.hp <= 0) continue;
    const d = UNITS[u.k]; if (u.cd > 0) u.cd--; if (u.aggro > 0) u.aggro--;
    if (u.burn) { u.burn--; if (u.burn % 15 === 0) hitUnit(g, u, 4 * (1 + g.bonus('fd')), -1, 'fire'); if (u.hp <= 0) continue; }
    if (u.slow) u.slow--;
    if (u.slowPctUntil != null && g.tick >= u.slowPctUntil) { delete u.slowPct; delete u.slowPctUntil; }
    if (u.slowEffects) { u.slowEffects = u.slowEffects.filter(x => x.until > g.tick); if (!u.slowEffects.length) delete u.slowEffects; }
    if (g.bioRobots.length && u.cd <= 0 && u.st !== 'gather' && u.st !== 'return' && (!peaceful || u.aggro > 0) && !d.boom) {
      let target: (typeof g.bioRobots)[number] | null = null, bd = d.range + 0.4;
      for (const r of g.bioRobots) { const dist = Math.hypot(r.x - u.x, r.y - u.y); if (dist < bd || dist === bd && target && r.id < target.id) { bd = dist; target = r; } }
      if (target) { u.cd = d.cd; u.ang = Math.atan2(target.y - u.y, target.x - u.x); g.markRadarThreatHit(target.x, target.y); damageBioRobot(g, target.id, d.dmg * (u.dm ?? 1)); continue; }
    }
    if (g.v117.genetics.forms.length && u.cd <= 0 && u.st !== 'gather' && u.st !== 'return' && (!peaceful || u.aggro > 0) && !d.boom) {
      let target: V117Bioform | null = null, bd = d.range + 0.4;
      for (const f of g.v117.genetics.forms) { if (f.dead || UNITS[f.family]?.fly && !d.fly && !d.ranged) continue; const dist = Math.hypot(f.x - u.x, f.y - u.y); if (dist < bd || dist === bd && target && f.id < target.id) { bd = dist; target = f; } }
      if (target) { u.cd = d.cd; u.ang = Math.atan2(target.y - u.y, target.x - u.x); damageBioform(g, target, d.dmg * (u.dm ?? 1), { kind: 'unit', id: u.id }, d.ranged ? 'acid' : 'phys'); continue; }
    }
    if (g.v117.drones.instances.length && u.cd <= 0 && u.st !== 'gather' && u.st !== 'return' && (!peaceful || u.aggro > 0) && !d.boom) {
      let target: Game['v117']['drones']['instances'][number] | null = null, best = d.range + .4;
      for (const drone of g.v117.drones.instances) {
        if (drone.hp <= 0) continue;
        const distance = Math.hypot(drone.x - u.x, drone.y - u.y);
        if (distance > best || !d.fly && !d.ranged && !d.boss && !droneGroundReachable(g, drone, u.x, u.y)) continue;
        if (distance < best || distance === best && (!target || drone.id < target.id)) { best = distance; target = drone; }
      }
      if (target) {
        u.cd = d.cd; u.ang = Math.atan2(target.y - u.y, target.x - u.x);
        if (d.ranged || d.boss) g.projectiles.push({ x: u.x, y: u.y, tx: target.x, ty: target.y, v: .25, dmg: d.dmg * (u.dm ?? 1), ...(d.boss ? { r: 2.5 } : u.k === 'spitter-big' ? { r: 1.5 } : {}) });
        else damageCombatDrone(g, target, d.dmg * (u.dm ?? 1));
        continue;
      }
    }
    if (regenTick && u.hp < unitMax(u)) { const cr = creepAt(g, u.x, u.y); if (cr) u.hp = Math.min(unitMax(u), u.hp + unitMax(u) * 0.01); }
    // Королева рожает маток
    if (d.boss && (u.id + g.tick) % (20 * TICKS) === 0 && g.units.length < 900) for (let i = 0; i < 2; i++) { const b = makeUnit(g, 'brood', u.x + (i ? 2 : -2), u.y + 1.5, u.st, -1); b.gid = u.gid; b.tgt = u.tgt; b.aggro = 600; }
    // отвлечение на игрока
    if ((u.id + g.tick) % 20 === 0) {
      // ближайший живой игрок (в кооперативе — любой из них; при равенстве — меньший номер)
      let bi = -1, dp = Infinity; for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (q.dead || g.peers[i]?.off) continue; const d2 = Math.hypot(q.x - u.x, q.y - u.y); if (d2 < dp) { dp = d2; bi = i; } }
      if (isPlTgt(u.tgt)) { const q = plOf(g, u.tgt); const dq = q.dead || g.peers[PLAYER_ID - u.tgt]?.off ? Infinity : Math.hypot(q.x - u.x, q.y - u.y); if (dq <= dp + 2) { dp = dq; bi = PLAYER_ID - u.tgt; } }
      if (bi >= 0 && dp < (u.aggro > 0 ? 18 : 10) && (!peaceful || u.aggro > 0) && u.st !== 'gather' && !d.boom) u.tgt = PLAYER_ID - bi;
      else if (isPlTgt(u.tgt) && dp > 24) u.tgt = -1;
    }
    let goalX = u.x, goalY = u.y, haveGoal = false, inRange = false;
    if (isPlTgt(u.tgt)) { const pl = plOf(g, u.tgt);
      if (pl.dead) u.tgt = -1;
      else { goalX = pl.x; goalY = pl.y; haveGoal = true; inRange = Math.hypot(pl.x - u.x, pl.y - u.y) <= d.range + 0.4; }
    } else if (u.tgt >= 0) {
      const e = g.ents.get(u.tgt);
      if (!e) u.tgt = -1;
      else { goalX = e.x + e.w / 2; goalY = e.y + e.h / 2; haveGoal = true; inRange = distToEnt(e, u.x, u.y) <= d.range + d.size * 0.3; }
    }
    if (u.tgt === -1 && (u.st === 'attack' || u.st === 'defend')) {
      if ((u.id + g.tick) % 30 === 0) {
        const e = (!peaceful || u.aggro > 0) ? nearestBuilding(g, u.x, u.y, u.st === 'attack' ? 30 : 12) : null;
        if (e) u.tgt = e.id; else if (++u.idle > 4) u.st = 'return';
      }
    }
    if (inRange) { attackTarget(g, u, d); u.ang = Math.atan2(goalY - u.y, goalX - u.x); continue; }
    // точка движения
    if (u.st === 'attack' && u.gid >= 0 && u.tgt >= 0 && !d.fly) {
      const gr = groups.get(u.gid);
      if (gr && gr.path && u.pi < gr.path.length && gr.tgt === u.tgt) {
        const [px, py] = gr.path[u.pi];
        if (Math.hypot(px + 0.5 - u.x, py + 0.5 - u.y) < 1.6) u.pi++;
        if (u.pi < gr.path.length) { goalX = gr.path[u.pi][0] + 0.5; goalY = gr.path[u.pi][1] + 0.5; haveGoal = true; }
      }
    } else if (u.st === 'return' || u.st === 'gather') {
      const n = g.ents.get(u.nest);
      if (!n) { if (u.st === 'return') u.hp = 0; }
      else {
        const nx0 = n.x + n.w / 2, ny0 = n.y + n.h / 2; const dn = Math.hypot(nx0 - u.x, ny0 - u.y);
        if (u.st === 'return' && dn < n.w) { u.hp = 0; n.points = (n.points || 0) + UNITS[u.k].cost * 0.5; continue; }
        if (dn > 6 || u.st === 'return') { goalX = nx0; goalY = ny0; haveGoal = true; }
        else if ((u.id + g.tick) % 90 === 0) u.ang += (g.rng.float() - 0.5) * 2;
      }
    }
    let vx = 0, vy = 0;
    if (haveGoal) { const dx = goalX - u.x, dy = goalY - u.y, l = Math.hypot(dx, dy); if (l > 0.05) { vx = dx / l; vy = dy / l; } }
    else if (u.st === 'gather' && (u.id + g.tick) % 4 === 0) { vx = Math.cos(u.ang) * 0.2; vy = Math.sin(u.ang) * 0.2; }
    // разведение (летуны не толкаются)
    let sx = 0, sy = 0;
    if (!d.fly) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const a = grid.get(tkey(Math.floor(u.x) + ox, Math.floor(u.y) + oy)); if (!a) continue;
      for (const o of a) { if (o === u) continue; const dx = u.x - o.x, dy = u.y - o.y, l = Math.hypot(dx, dy), m = (d.size + UNITS[o.k].size) * 0.45; if (l > 0.001 && l < m) { sx += dx / l * (m - l); sy += dy / l * (m - l); } }
    }
    const slow = activeUnitSlow(g, u);
    const spd = d.speed * (1 - slow);
    const mx = vx * spd + sx * 0.15, my = vy * spd + sy * 0.15;
    if (!mx && !my) continue;
    u.ang = Math.atan2(vy || my, vx || mx);
    const nx = u.x + mx, ny = u.y + my;
    if (d.fly) { u.x = nx; u.y = ny; continue; } // летуны — над стенами и водой
    const b = enemyBlocked(g, nx, ny);
    if (!b || (b !== 'water' && b.t === 'nest')) { u.x = nx; u.y = ny; }
    else if (b === 'water') { if (!enemyBlocked(g, u.x + mx, u.y)) u.x += mx; else if (!enemyBlocked(g, u.x, u.y + my)) u.y += my; }
    else if (u.st !== 'gather' && u.st !== 'return' && (!peaceful || u.aggro > 0)) { u.tgt = b.id; if (d.boom && (b.t === 'wall' || b.t === 'gate')) explode(g, u, d); } // путь перегорожен — грызём (разрушитель взрывается у стены)
    else { if (!enemyBlocked(g, u.x + mx, u.y)) u.x += mx; else if (!enemyBlocked(g, u.x, u.y + my)) u.y += my; }
  }
  // выводок маток
  if (g._brood?.length) for (const u of g._brood.splice(0)) {
    const kind = g.evolution > 0.6 ? 'medium' : 'small';
    for (let i = 0; i < UNITS[u.k].brood!; i++) { const a = i / UNITS[u.k].brood! * Math.PI * 2; const b = makeUnit(g, kind, u.x + Math.cos(a), u.y + Math.sin(a), u.st === 'gather' ? 'defend' : u.st, u.nest); b.gid = u.gid; b.aggro = 600; }
  }
  g.units = g.units.filter(u => u.hp > 0);
}
const compass = (dx: number, dy: number) => ['с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада', 'с севера', 'с северо-востока'][((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
/** v1.14: сторона света, откуда пришла атака (от цели к гнезду) */
export const attackDir = (a: Attack) => compass(a.x - a.tx, a.y - a.ty);
function launch(g: Game, gr: Group, nest: Entity, tgt: Entity, queen = false) {
  const cx = nest.x + nest.w / 2, cy = nest.y + nest.h / 2;
  gr.tgt = tgt.id; gr.st = 'attacking';
  gr.path = findPath(g, cx, cy + nest.h / 2 + 0.5, tgt.x + tgt.w / 2, tgt.y + tgt.h / 2);
  const cnt: Record<string, number> = {}; let el = 0;
  for (const u of g.units) if (u.gid === gr.id) { u.st = 'attack'; u.tgt = tgt.id; u.pi = 0; cnt[u.k] = (cnt[u.k] || 0) + 1; if (u.el) el++; }
  const k = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || (a < b ? -1 : 1))[0] || 'small';
  const a: Attack = { id: gr.id, t: g.tick, x: cx, y: cy, tx: tgt.x + tgt.w / 2, ty: tgt.y + tgt.h / 2, n: gr.units.length, k, killed: 0, lost: 0, ...(queen ? { q: 1 as const } : {}), ...(el ? { el } : {}) };
  g.sw.att.push(a); g.sw.total++;
  g.alert(tgt.x, tgt.y, queen ? 'Нашествие: Королева Роя идёт на базу!' : `Рой выдвинулся к базе (${attackDir(a)})!`);
}
function stepNests(g: Game) {
  const attacks = g.settings.enemies === 'normal' || g.settings.enemies === 'deathworld';
  const groups = new Map<number, Group>(); for (const gr of g.groups) groups.set(gr.id, gr);
  for (const e of nestList(g).nests) {
    if (e.spawnCd! > 0) { e.spawnCd!--; continue; }
    if (!attacks) continue;
    let gr = e.gid! >= 0 ? groups.get(e.gid!) : undefined;
    if (!gr) {
      if ((e.points || 0) < 4) continue;
      const big = g.settings.enemies === 'deathworld' ? 1.6 : 1;
      gr = { id: g.nextUnit++, nest: e.id, units: [], size: Math.floor((5 + g.rng.int(6) + g.evolution * 30) * big), st: 'forming', tgt: -1, path: null };
      g.groups.push(gr); groups.set(gr.id, gr); e.gid = gr.id;
    }
    const k = pickKind(g, e); const cost = UNITS[k].cost;
    if ((e.points || 0) >= cost && gr.units.length < gr.size) {
      // v1.14: после 95% эволюции в каждой волне — пара элитных (мини-боссов)
      const elite = g.evolution >= ELITE_EVO && gr.units.length >= gr.size - 2;
      e.points! -= cost; const u = spawnUnit(g, e, k, 'gather', elite); u.gid = gr.id; gr.units.push(u.id); e.spawnCd = 30;
    }
    if (gr.units.length >= gr.size) {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const tgt = nearestBuilding(g, cx, cy, 220, true) || nearestBuilding(g, cx, cy, 120);
      if (tgt) launch(g, gr, e, tgt);
      e.gid = -1; e.spawnCd = 600;
    }
  }
  g.groups = g.groups.filter(gr => gr.st === 'forming' ? g.ents.has(gr.nest) : g.units.some(u => u.gid === gr.id));
  // окончание атак, журнал за последний час
  if (g.tick % 60 === 0) {
    const live = new Set(g.groups.map(gr => gr.id));
    for (const a of g.sw.att) if (a.end == null && !live.has(a.id)) a.end = g.tick;
    while (g.sw.att.length && g.sw.att[0].end != null && g.tick - g.sw.att[0].t > LOG_TICKS) g.sw.att.shift();
    if (g.sw.att.length > 200) g.sw.att.splice(0, g.sw.att.length - 200);
  }
}
/** v1.14: черви-плевуны — стоят у гнёзд и плюют кислотой по постройкам и инженерам в радиусе */
function stepWorms(g: Game) {
  if (g.settings.enemies === 'none') return;
  const peaceful = g.settings.enemies === 'peaceful';
  for (const e of nestList(g).worms) {
    if ((e.fireCd || 0) > 0) { e.fireCd!--; continue; }
    if ((g.tick + e.id) % 10) continue;
    const en = PROTOS[e.proto].enemy!; const cx = e.x + e.w / 2, cy = e.y + e.h / 2, R = en.range!;
    let tx = 0, ty = 0, found = false, bd = R + 1;
    for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (q.dead || g.peers[i]?.off) continue; const d = Math.hypot(q.x - cx, q.y - cy); if (d <= R && d < bd && (!peaceful || (e.aggro || 0) > g.tick)) { bd = d; tx = q.x; ty = q.y; found = true; } }
    if (!peaceful || (e.aggro || 0) > g.tick) for (const f of g.v117.genetics.forms) {
      if (f.dead) continue; const d = Math.hypot(f.x - cx, f.y - cy);
      if (d <= R && d < bd) { bd = d; tx = f.x; ty = f.y; found = true; }
    }
    if (!peaceful || (e.aggro || 0) > g.tick) for (const drone of g.v117.drones.instances) {
      if (drone.hp <= 0) continue; const distance = Math.hypot(drone.x - cx, drone.y - cy);
      if (distance <= R && distance < bd) { bd = distance; tx = drone.x; ty = drone.y; found = true; }
    }
    if (!found && !peaceful) { const b = nearestBuilding(g, cx, cy, R); if (b) { tx = b.x + b.w / 2; ty = b.y + b.h / 2; found = true; } }
    if (!found) continue;
    e.aim = Math.atan2(ty - cy, tx - cx); e.fireCd = en.cd!;
    g.projectiles.push({ x: cx, y: cy, tx, ty, v: 0.35, dmg: en.dmg! * (1 + MUT_DMG * (g.mut || 0)), r: 1 + en.worm! * 0.4, by: e.id });
  }
}
/** Allied area attacks retain their faction even after the source body dies or its owner disconnects. */
export function damageSwarmInRadius(g: Game, x: number, y: number, radius: number, damage: number, owner: string, dt: DmgType, groundOnly = false) {
  const index = g.v117.playerIds.indexOf(owner);
  if (index < 0) return;
  const by = PLAYER_ID - index;
  // Copy: kills may append a brood to the live unit array. New offspring are not hit recursively by the same blast.
  for (const u of [...g.units]) if (u.hp > 0 && (!groundOnly || !UNITS[u.k]?.fly) && Math.hypot(u.x - x, u.y - y) <= radius + (UNITS[u.k]?.size || .5) / 2) hitUnit(g, u, damage, by, dt);
  const hostile = nestList(g);
  for (const e of [...hostile.nests, ...hostile.worms]) if ((e.hp === undefined || e.hp > 0) && distToEnt(e, x, y) <= radius) g.damage(e, damage, false, by, dt);
}
function stepProjectiles(g: Game, alliedOnly = false) {
  for (const p of g.projectiles) {
    if (alliedOnly && p.owner === undefined) continue;
    const dx = p.tx - p.x, dy = p.ty - p.y, l = Math.hypot(dx, dy);
    if (l <= p.v) {
      p.v = 0; const r = p.r || 1; g.fx.push({ k: 'acid', x: p.tx, y: p.ty, t: 40, s: r }); g.snd('acid', p.tx, p.ty);
      if (p.owner !== undefined) damageSwarmInRadius(g, p.tx, p.ty, r, p.dmg, p.owner, 'acid');
      else {
        for (let y = Math.floor(p.ty - r); y <= Math.floor(p.ty + r); y++) for (let x = Math.floor(p.tx - r); x <= Math.floor(p.tx + r); x++) { const e = g.entAt(x, y); if (e && e.t !== 'nest') g.damage(e, p.dmg / 3, true); }
        damageBioRobotsInRadius(g, p.tx, p.ty, r, p.dmg / 3); damageBioformsInRadius(g, p.tx, p.ty, r, p.dmg / 3, p.by === undefined ? undefined : { kind: 'entity', id: p.by });
        damageCombatDronesInRadius(g, p.tx, p.ty, r, p.dmg / 3);
        for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (Math.hypot(q.x - p.tx, q.y - p.ty) < r + 0.3) hurtPl(g, i, p.dmg, 'acid'); }
      }
      if (g.acids.length < 200) g.acids.push({ x: p.tx, y: p.ty, r: Math.max(1, r * 0.9), t: 5 * TICKS, dmg: Math.max(2, p.dmg * 0.08), ...(p.by === undefined ? {} : { by: p.by }), ...(p.owner === undefined ? {} : { owner: p.owner }) });
    } else { p.x += dx / l * p.v; p.y += dy / l * p.v; }
  }
  g.projectiles = g.projectiles.filter(p => p.v > 0);
}
/** v1.14: лужи кислоты разъедают конвейеры, трубы и инженеров (раз в полсекунды) */
function stepAcids(g: Game, alliedOnly = false) {
  if (!g.acids.length) return;
  const hit = g.tick % 30 === 0;
  for (const a of g.acids) {
    if (alliedOnly && a.owner === undefined) continue;
    a.t--; if (!hit) continue;
    if (a.owner !== undefined) { damageSwarmInRadius(g, a.x, a.y, a.r, a.dmg, a.owner, 'acid', true); continue; }
    for (let y = Math.floor(a.y - a.r); y <= Math.floor(a.y + a.r); y++) for (let x = Math.floor(a.x - a.r); x <= Math.floor(a.x + a.r); x++) {
      if (Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) > a.r) continue; const e = g.entAt(x, y);
      if (e && (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter' || e.t === 'pipe' || e.t === 'pump')) g.damage(e, a.dmg, true);
    }
    damageBioRobotsInRadius(g, a.x, a.y, a.r, a.dmg); damageBioformsInRadius(g, a.x, a.y, a.r, a.dmg, a.by === undefined ? undefined : { kind: 'entity', id: a.by });
    damageCombatDronesInRadius(g, a.x, a.y, a.r, a.dmg, true);
    for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (!q.dead && Math.hypot(q.x - a.x, q.y - a.y) < a.r) hurtPl(g, i, a.dmg * 0.5, 'acid'); }
  }
  g.acids = g.acids.filter(a => a.t > 0);
}
/** v1.14: мутации после 100% эволюции; каждый уровень — нашествие Королевы */
function stepMutation(g: Game) {
  if (g.evolution < MUT_EVO || g.settings.enemies === 'none') return;
  if (!g.mutT) { g.mutT = g.tick + MUT_TICKS; return; }
  if (g.tick < g.mutT) return;
  g.mut = (g.mut || 0) + 1; g.mutT = g.tick + MUT_TICKS;
  g.msg(`☣ Мутация Роя: уровень ${g.mut} (+${Math.round(MUT_HP * 100 * g.mut)}% здоровья, +${Math.round(MUT_DMG * 100 * g.mut)}% урона)`);
  if (g.settings.enemies === 'peaceful') return;
  queenRaid(g);
}
export function queenRaid(g: Game): Unit | null {
  // гнездо, ближайшее к базе игрока (по расстоянию до ближайшей постройки)
  let best: Entity | null = null, tgt: Entity | null = null, bd = Infinity;
  for (const e of nestList(g).nests) { const b = nearestBuilding(g, e.x + 1, e.y + 1, 300); if (!b) continue; const d = Math.hypot(b.x - e.x, b.y - e.y); if (d < bd) { bd = d; best = e; tgt = b; } }
  if (!best || !tgt) return null;
  const gr: Group = { id: g.nextUnit++, nest: best.id, units: [], size: 0, st: 'forming', tgt: -1, path: null }; g.groups.push(gr);
  const q = spawnUnit(g, best, 'queen', 'gather'); q.gid = gr.id; gr.units.push(q.id);
  for (let i = 0; i < 6 + (g.mut || 0) * 2; i++) { const u = spawnUnit(g, best, pickKind(g, best), 'gather', i < 2); u.gid = gr.id; gr.units.push(u.id); }
  gr.size = gr.units.length; launch(g, gr, best, tgt, true); return q;
}
// ---------- главный шаг ----------
/** v1.14: время растит эволюцию впятеро медленнее (0,0000008/с), загрязнение — 0,0000009 за единицу */
export const EVO_TIME = 0.0000008, EVO_POL = 0.0000009;
export function stepEnemies(g: Game) {
  if (g.tick % POL_TICKS === 0) {
    stepPollution(g);
    // гнёзда поглощают загрязнение и растят юнитов
    for (const e of nestList(g).nests) {
      const c = g.world.chunkAt(e.x + 1, e.y + 1); const k = Math.min(c.pollution, 1.5);
      c.pollution -= k; e.points = Math.min(2000, (e.points || 0) + k);
    }
    // эволюция: время + загрязнение
    const mul = g.settings.enemies === 'deathworld' ? 2 : 1;
    const dEvo = (EVO_TIME * POL_TICKS / TICKS + EVO_POL * g.polProduced) * mul;
    g.polProduced = 0;
    if (g.settings.enemies !== 'none') g.evolution = 1 - (1 - g.evolution) * (1 - dEvo);
    if (g.tick % (60 * TICKS) < POL_TICKS) { g.sw.evoH.push(Math.round(g.evolution * 1e4) / 1e4); if (g.sw.evoH.length > 600) g.sw.evoH.shift(); }
    if (g.settings.enemies !== 'none') stepCreep(g);
    // захват земли (v1.14: новое логово — по текущей эволюции, рядом черви)
    if (g.evolution > 0.3 && (g.settings.enemies === 'normal' || g.settings.enemies === 'deathworld') && g.tick % (POL_TICKS * 220) === 0) {
      const nests = nestList(g).nests;
      if (nests.length) {
        const n = nests[g.rng.int(nests.length)]; const a = g.rng.float() * Math.PI * 2, r = 12 + g.rng.int(18);
        const x = Math.floor(n.x + Math.cos(a) * r), y = Math.floor(n.y + Math.sin(a) * r);
        if (Math.hypot(x, y) > 160 && !nearestBuilding(g, x, y, 30)) { if (placeNest(g, x, y, pickNestProto(g, g.evolution, g.tick))) placeNest(g, x + 4, y + 1, pickWorm(g.evolution, g.rng.float())); }
      }
    }
  }
  if (g.settings.enemies === 'none') { stepProjectiles(g, true); stepAcids(g, true); return; }
  stepMutation(g);
  stepNests(g); stepUnits(g); stepWorms(g); stepProjectiles(g); stepAcids(g);
}
