// v1.15: сценарии и испытания. Сценарий = карта (правки поверх генерации или чистая карта) + правила + цели (+ скрипт на API v1.11).
// Формат — обычный JSON (файл .z7scn); при запуске сценарий кладётся в партию (Game.scn) и сохраняется вместе с ней,
// поэтому загруженная партия и совместная игра всегда играются по тем же правилам.
import { CHUNK } from '../core/types';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { TECHS } from '../data/techs';
import { RECIPES } from '../data/recipes';
import type { Game } from './game';
import { turbineKW } from './networks';
import { cleanGen, GEN_LEGACY_VER, GEN_VER } from './world';
import type { GenSet } from './world';
import { hasScenarioBiology, readScenarioBiology, scenarioNeeds117, type ScenarioBiology } from './scenario117';

export const SCN_FMT = 3;
export const SCN_FMT_GENERATION = 2;
/** fmt 1 — 1.15, fmt 2 — generation/uranium, fmt 3 — explicit initial biology. */
export const SCN_FMT_OLD = 1;
export type ScnEnemies = 'none' | 'peaceful' | 'normal' | 'deathworld';
export type GoalKind = 'produce' | 'build' | 'research' | 'survive' | 'rocket' | 'kills' | 'power' | 'consume';
export interface ScnGoal { k: GoalKind; item?: string; proto?: string; tech?: string; n?: number; min?: number }
export interface ScnEnt { proto: string; x: number; y: number; dir: number; recipe?: string | null }
export interface ScnNest { x: number; y: number; proto: string }
/** Правки карты построчно: terrain — [y, x0, x1, вид]; res — [y, x0, x1, ресурс, запас]; decor — [y, x0, x1, 0 нет / 1 дерево / 2 скала] */
export interface ScnEdits { terrain: number[][]; res: number[][]; decor: number[][] }
export interface Scenario {
  fmt: number; id: string; name: string; desc: string; author: string; ver: number;
  seed: number;
  map: {
    base: 'gen' | 'blank';
    bounds: { w: number; h: number } | null;
    edits: ScnEdits; nests: ScnNest[]; ents: ScnEnt[];
    start: { x: number; y: number; w: number; h: number };
  };
  rules: {
    enemies: ScnEnemies;
    /** гнёзда: auto — как в обычной игре (с nestMin/nestDens), custom — только заданные, none — без гнёзд */
    nests: 'auto' | 'custom' | 'none'; nestMin: number; nestDens: number;
    /** стартовый инвентарь; null — обычный набор «обломки корабля» */
    startItems: Record<string, number> | null;
    /** разрешённые технологии (null — все); preTech — уже изучены */
    techs: string[] | null; preTech: string[];
    /** запреты: id постройки/предмета или «type:belt» (тип построек) */
    ban: string[];
    /** лимит времени, минут (0 — без лимита) */
    timeLimit: number;
  };
  goals: ScnGoal[];
  script: string;
  /** fmt 2: настройки генерации воды и ресурсов и версия генератора (null — как в 1.15) */
  gen?: GenSet | null; genv?: number;
  biology?: ScenarioBiology;
  builtin?: boolean;
}
export const SCN_LIMITS = { name: 60, desc: 800, author: 40, runs: 60000, ents: 3000, nests: 600, goals: 30, script: 60000, ban: 80, techs: 400, items: 60, bound: [24, 512] as [number, number], file: 4 * 1048576 };
export const GOAL_KINDS: GoalKind[] = ['produce', 'build', 'research', 'survive', 'rocket', 'kills', 'power', 'consume'];
export const NEST_PROTOS = ['biter-spawner', 'spitter-spawner', 'worm-small', 'worm-medium', 'worm-big', 'worm-behemoth'];

export const newScenario = (id = 'my-map', name = 'Моя карта'): Scenario => ({
  fmt: SCN_FMT, id, name, desc: '', author: '', ver: 1, seed: 1, genv: GEN_VER,
  map: { base: 'gen', bounds: null, edits: { terrain: [], res: [], decor: [] }, nests: [], ents: [], start: { x: 0, y: 0, w: 8, h: 8 } },
  rules: { enemies: 'normal', nests: 'auto', nestMin: 260, nestDens: 1, startItems: null, techs: null, preTech: [], ban: [], timeLimit: 0 },
  goals: [{ k: 'rocket', n: 1 }], script: '',
});

// ---------- проверка и очистка (импортированный файл — недоверенные данные) ----------
const num = (v: any, lo: number, hi: number, d: number) => { const x = Math.trunc(+v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const str = (v: any, n: number) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '';
export interface ScnCheck { ok: boolean; scn: Scenario | null; errors: string[]; warns: string[] }
export function banMatches(ban: string[], id: string): boolean {
  if (!ban.length) return false;
  if (ban.includes(id)) return true;
  const t = PROTOS[id]?.type; return !!t && ban.includes('type:' + t);
}
export function checkScenario(raw: any): ScnCheck {
  const errors: string[] = [], warns: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, scn: null, errors: ['Файл не похож на сценарий'], warns };
  if (![SCN_FMT_OLD, SCN_FMT_GENERATION, SCN_FMT].includes(raw.fmt)) { if (Number.isInteger(raw.fmt) && raw.fmt > SCN_FMT) return { ok: false, scn: null, errors: ['Сценарий сделан в более новой версии игры'], warns }; return { ok: false, scn: null, errors: ['Файл не похож на сценарий'], warns }; }
  const s = newScenario(); s.goals = [];
  s.id = str(raw.id, 40).replace(/[^\w.-]/g, '-') || 'scenario'; s.name = str(raw.name, SCN_LIMITS.name) || 'Сценарий'; s.desc = str(raw.desc, SCN_LIMITS.desc); s.author = str(raw.author, SCN_LIMITS.author);
  s.ver = num(raw.ver, 1, 9999, 1); s.seed = num(raw.seed, 1, 0x7fffffff, 1);
  const m = raw.map && typeof raw.map === 'object' ? raw.map : {};
  s.map.base = m.base === 'blank' ? 'blank' : 'gen';
  if (m.bounds && typeof m.bounds === 'object') { const [lo, hi] = SCN_LIMITS.bound; s.map.bounds = { w: num(m.bounds.w, lo, hi, 100), h: num(m.bounds.h, lo, hi, 100) }; }
  let runs = 0;
  const runList = (a: any, w: number, vmax: number[], out: number[][], what: string) => {
    if (!Array.isArray(a)) return;
    for (const r of a) {
      if (!Array.isArray(r) || r.length !== w) continue;
      if (++runs > SCN_LIMITS.runs) { errors.push('Слишком много правок карты'); return; }
      const y = num(r[0], -4096, 4096, NaN), x0 = num(r[1], -4096, 4096, NaN), x1 = num(r[2], -4096, 4096, NaN); if (isNaN(y) || isNaN(x0) || isNaN(x1)) continue;
      const rest: number[] = []; let bad = false; for (let i = 3; i < w; i++) { const v = Math.trunc(+r[i]); if (!(v >= 0 && v <= vmax[i - 3])) bad = true; rest.push(v); } if (bad) continue; // значение вне допустимого — строка отбрасывается целиком
      out.push([y, Math.min(x0, x1), Math.max(x0, x1), ...rest]);
    }
    void what;
  };
  const ed = m.edits && typeof m.edits === 'object' ? m.edits : {};
  runList(ed.terrain, 4, [4], s.map.edits.terrain, 'terrain'); runList(ed.res, 5, [6, 1e7], s.map.edits.res, 'res'); runList(ed.decor, 4, [2], s.map.edits.decor, 'decor');
  if (Array.isArray(m.nests)) for (const n of m.nests.slice(0, SCN_LIMITS.nests)) { if (!n || typeof n !== 'object') continue; const proto = NEST_PROTOS.includes(n.proto) || PROTOS[n.proto]?.type === 'nest' ? n.proto : 'biter-spawner'; s.map.nests.push({ x: num(n.x, -4096, 4096, 0), y: num(n.y, -4096, 4096, 0), proto }); }
  if (Array.isArray(m.ents)) for (const e of m.ents.slice(0, SCN_LIMITS.ents)) {
    if (!e || typeof e !== 'object') continue; const p = PROTOS[e.proto];
    if (!p) { warns.push('Нет постройки «' + str(e.proto, 40) + '» — пропущена'); continue; }
    if (p.type === 'nest' || p.type === 'loco' || p.type === 'wagon' || p.type === 'rail') { warns.push('«' + p.name + '» нельзя поставить сценарием — пропущена'); continue; }
    s.map.ents.push({ proto: e.proto, x: num(e.x, -4096, 4096, 0), y: num(e.y, -4096, 4096, 0), dir: num(e.dir, 0, 3, 0), recipe: typeof e.recipe === 'string' ? str(e.recipe, 60) : null });
  }
  const st = m.start && typeof m.start === 'object' ? m.start : {}; s.map.start = { x: num(st.x, -4096, 4096, 0), y: num(st.y, -4096, 4096, 0), w: num(st.w, 2, 64, 8), h: num(st.h, 2, 64, 8) };
  const r = raw.rules && typeof raw.rules === 'object' ? raw.rules : {};
  s.rules.enemies = (['none', 'peaceful', 'normal', 'deathworld'] as const).includes(r.enemies) ? r.enemies : 'normal';
  s.rules.nests = r.nests === 'custom' || r.nests === 'none' ? r.nests : 'auto'; s.rules.nestMin = num(r.nestMin, 40, 2000, 260); s.rules.nestDens = Math.max(0.2, Math.min(4, +r.nestDens || 1));
  if (r.startItems && typeof r.startItems === 'object') {
    s.rules.startItems = {};
    for (const [k, v] of Object.entries(r.startItems).slice(0, SCN_LIMITS.items)) {
      if (ITEMS[k]?.virtual) { errors.push('Виртуальный сигнал «' + str(k, 40) + '» нельзя положить в стартовый инвентарь'); continue; }
      if (!ITEMS[k]) { warns.push('Нет предмета «' + str(k, 40) + '» — пропущен'); continue; }
      const n = num(v, 0, 100000, 0); if (n > 0) s.rules.startItems[k] = n;
    }
  }
  if (Array.isArray(r.techs)) { s.rules.techs = r.techs.filter((t: any) => typeof t === 'string' && TECHS[t]).slice(0, SCN_LIMITS.techs); if (s.rules.techs!.length < r.techs.length) warns.push('Часть технологий неизвестна — пропущена'); }
  if (Array.isArray(r.preTech)) s.rules.preTech = r.preTech.filter((t: any) => typeof t === 'string' && TECHS[t]).slice(0, SCN_LIMITS.techs);
  if (Array.isArray(r.ban)) s.rules.ban = r.ban.filter((b: any) => typeof b === 'string' && (PROTOS[b] || ITEMS[b] || (b.startsWith('type:') && Object.values(PROTOS).some(p => 'type:' + p.type === b)))).slice(0, SCN_LIMITS.ban);
  s.rules.timeLimit = num(r.timeLimit, 0, 100000, 0);
  if (Array.isArray(raw.goals)) for (const g of raw.goals.slice(0, SCN_LIMITS.goals)) {
    if (!g || !GOAL_KINDS.includes(g.k)) continue;
    const o: ScnGoal = { k: g.k };
    if (g.k === 'produce') { if (!ITEMS[g.item] || ITEMS[g.item].virtual) { warns.push('Цель: нет предмета «' + str(g.item, 40) + '»'); continue; } o.item = g.item; o.n = num(g.n, 1, 1e9, 1); }
    else if (g.k === 'build') { if (!PROTOS[g.proto] && !(typeof g.proto === 'string' && g.proto.startsWith('type:'))) { warns.push('Цель: нет постройки «' + str(g.proto, 40) + '»'); continue; } o.proto = g.proto; o.n = num(g.n, 1, 1e6, 1); }
    else if (g.k === 'research') { if (!TECHS[g.tech]) { warns.push('Цель: нет технологии «' + str(g.tech, 40) + '»'); continue; } o.tech = g.tech; }
    else if (g.k === 'survive') o.min = num(g.min, 1, 100000, 10);
    else if (g.k === 'power') o.min = num(g.min, 1, 100000, 40);
    else if (g.k === 'consume') { if (!ITEMS[g.item] || ITEMS[g.item].virtual) { warns.push('Цель: нет предмета «' + str(g.item, 40) + '»'); continue; } o.item = g.item; o.n = num(g.n, 1, 1e9, 1); }
    else o.n = num(g.n, 1, 1e6, 1);
    s.goals.push(o);
  }
  if (raw.fmt >= SCN_FMT_GENERATION) {
    const rawGenv = raw.genv;
    if (rawGenv != null && (!Number.isInteger(rawGenv) || rawGenv < GEN_LEGACY_VER || rawGenv > GEN_VER)) errors.push('Сценарий использует неизвестную версию генератора мира');
    const gn = cleanGen(raw.gen);
    if (!errors.length) { if (gn) s.gen = gn; else delete s.gen; s.genv = rawGenv ?? GEN_LEGACY_VER; }
  } else s.genv = GEN_LEGACY_VER;
  if (raw.biology !== undefined) {
    if (raw.fmt < SCN_FMT) errors.push('Начальная биология требует формата сценария 3');
    else s.biology = readScenarioBiology(raw.biology, s, errors);
  }
  if (typeof raw.script === 'string') s.script = raw.script.slice(0, SCN_LIMITS.script);
  if (!s.goals.length) warns.push('У сценария нет целей — это свободная игра');
  return { ok: errors.length === 0, scn: errors.length ? null : s, errors, warns };
}
/** JSON-текст файла сценария */
/** Совместимость хранится на определениях данных; реестр модов помечает изменённое и новое содержимое. */
const legacy = (d: { compat15?: boolean } | undefined) => !!d && d.compat15 !== false;
const legacyItem = (id: string) => legacy(ITEMS[id]);
const legacyProto = (id: string) => legacy(PROTOS[id]);
const legacyTech = (id: string) => legacy(TECHS[id]);
const legacyType = (type: string) => Object.values(PROTOS).some(p => p.type === type && legacy(p));
export function scnIncompat(s: Scenario): string[] {
  const o: string[] = [];
  if (hasScenarioBiology(s.biology)) o.push('начальные геномы, культуры и союзники');
  else if (scenarioNeeds117(s)) o.push('предметы, постройки или технологии 1.17');
  if (s.gen || (s.map.base === 'gen' && s.genv !== GEN_LEGACY_VER)) o.push('настройки генерации воды и ресурсов');
  if (s.map.edits.res.some(r => r[3] === 6)) o.push('ресурс «Уран»');
  if (s.map.ents.some(e => !legacyProto(e.proto)) || s.map.nests.some(e => !legacyProto(e.proto)) || s.goals.some(g => g.k === 'build' && g.proto?.startsWith('type:') && !legacyType(g.proto.slice(5))) || s.rules.ban.some(b => !!PROTOS[b] && !legacyProto(b))) o.push('новые постройки');
  if (s.map.ents.some(e => !!e.recipe && !legacy(RECIPES[e.recipe])) || s.rules.ban.some(b => !!ITEMS[b] && !legacyItem(b))) o.push('новые предметы и рецепты');
  if (Object.keys(s.rules.startItems || {}).some(i => !legacyItem(i))) o.push('новые стартовые предметы');
  if ([...(s.rules.techs || []), ...s.rules.preTech].some(t => !legacyTech(t))) o.push('новые технологии');
  if (s.goals.some(g => (g.k === 'produce' || g.k === 'consume') && !legacyItem(g.item || ''))) o.push('новые предметы в целях');
  if (s.goals.some(g => g.k === 'build' && g.proto && !g.proto.startsWith('type:') && !legacyProto(g.proto))) o.push('новые постройки в целях');
  if (s.goals.some(g => g.k === 'research' && !legacyTech(g.tech || ''))) o.push('новые технологии в целях');
  if (s.rules.ban.some(b => b.startsWith('type:') && !legacyType(b.slice(5)))) o.push('новый тип построек');
  if (s.goals.some(g => g.k === 'power' || g.k === 'consume')) o.push('цели «Станция, МВт» и «Переработать»');
  return o;
}
export const scnToText = (s: Scenario) => JSON.stringify({ ...s, fmt: scenarioNeeds117(s) ? SCN_FMT : scnIncompat(s).length ? SCN_FMT_GENERATION : SCN_FMT_OLD, biology: hasScenarioBiology(s.biology) ? s.biology : undefined, gen: s.gen || undefined, genv: s.map.base === 'gen' ? (s.genv ?? GEN_LEGACY_VER) : undefined, builtin: undefined });
export function parseScnText(text: string): ScnCheck {
  if (text.length > SCN_LIMITS.file) return { ok: false, scn: null, errors: ['Файл слишком большой'], warns: [] };
  let raw: any; try { raw = JSON.parse(text); } catch { return { ok: false, scn: null, errors: ['Файл не читается (не JSON)'], warns: [] }; }
  // «z7-» — id встроенных испытаний: чужой файл под этим id не получит достижения и места в таблице
  if (raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id.startsWith('z7-')) raw.id = 'u-' + raw.id;
  return checkScenario(raw);
}

// ---------- правки карты ----------
export class Overlay {
  /** границы карты в клетках [x0, x1) × [y0, y1); null — без границ */ b: { x0: number; y0: number; x1: number; y1: number } | null = null;
  blank: boolean; private by = new Map<number, { t: number[][]; r: number[][]; d: number[][] }>();
  constructor(s: Scenario) {
    this.blank = s.map.base === 'blank';
    if (s.map.bounds) { const x0 = -Math.floor(s.map.bounds.w / 2), y0 = -Math.floor(s.map.bounds.h / 2); this.b = { x0, y0, x1: x0 + s.map.bounds.w, y1: y0 + s.map.bounds.h }; }
    const put = (a: number[][], key: 't' | 'r' | 'd') => { for (const r of a) { const cy = Math.floor(r[0] / CHUNK); for (let cx = Math.floor(r[1] / CHUNK); cx <= Math.floor(r[2] / CHUNK); cx++) { const k = (cx + 32768) * 65536 + (cy + 32768); let e = this.by.get(k); if (!e) this.by.set(k, e = { t: [], r: [], d: [] }); e[key].push(r); } } };
    put(s.map.edits.terrain, 't'); put(s.map.edits.res, 'r'); put(s.map.edits.decor, 'd');
  }
  /** вся клетка чанка вне границ */
  outside(cx: number, cy: number) { const b = this.b; if (!b) return false; return cx * CHUNK >= b.x1 || (cx + 1) * CHUNK <= b.x0 || cy * CHUNK >= b.y1 || (cy + 1) * CHUNK <= b.y0; }
  inside(x: number, y: number) { const b = this.b; return !b || (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1); }
  /** наложить правки на готовый чанк (terrain/res/amt/decor — массивы чанка) */
  apply(cx: number, cy: number, terrain: Uint8Array, res: Uint8Array, amt: Uint32Array, decor: Uint8Array) {
    const x0c = cx * CHUNK, y0c = cy * CHUNK, e = this.by.get((cx + 32768) * 65536 + (cy + 32768));
    if (e) {
      for (const r of e.t) { const ly = r[0] - y0c; for (let x = Math.max(r[1], x0c); x <= Math.min(r[2], x0c + CHUNK - 1); x++) { const i = ly * CHUNK + x - x0c; terrain[i] = r[3]; if (r[3] >= 3) { res[i] = 0; amt[i] = 0; decor[i] = 0; } } }
      for (const r of e.r) { const ly = r[0] - y0c; for (let x = Math.max(r[1], x0c); x <= Math.min(r[2], x0c + CHUNK - 1); x++) { const i = ly * CHUNK + x - x0c; if (terrain[i] >= 3) continue; res[i] = r[3]; amt[i] = r[3] ? r[4] : 0; if (r[3]) decor[i] = 0; } }
      for (const r of e.d) { const ly = r[0] - y0c; for (let x = Math.max(r[1], x0c); x <= Math.min(r[2], x0c + CHUNK - 1); x++) { const i = ly * CHUNK + x - x0c; if (terrain[i] >= 3 || res[i]) continue; decor[i] = r[3]; } }
    }
    if (this.b) for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) { if (this.inside(x0c + lx, y0c + ly)) continue; const i = ly * CHUNK + lx; terrain[i] = 4; res[i] = 0; amt[i] = 0; decor[i] = 0; }
  }
}
const canon = new WeakSet<Scenario>();
/** сценарий в единственном «каноническом» виде (порядок полей, пределы) — у всех игроков партии одинаковый, иначе контрольные суммы разойдутся */
export function canonScn(raw: any): Scenario | null {
  if (!raw || typeof raw !== 'object') return null; if (canon.has(raw)) return raw;
  const c = checkScenario(raw); if (!c.scn) return null; canon.add(c.scn); return c.scn;
}
const ovCache = new WeakMap<Scenario, Overlay>();
export function overlayOf(s: Scenario): Overlay { let o = ovCache.get(s); if (!o) ovCache.set(s, o = new Overlay(s)); return o; }

// ---------- состояние партии ----------
export interface ScnState { /** тик начала */ t0: number; /** тик выполнения каждой цели (0 — не выполнена) */ done: number[]; /** итог: победа/поражение и тик */ res: { ok: boolean; tick: number } | null; /** подписи прогресса целей (для интерфейса; пересчитываются раз в 30 тиков) */ pr?: string[] }
export const newScnState = (s: Scenario, tick: number): ScnState => ({ t0: tick, done: s.goals.map(() => 0), res: null });

function consumeGoalCount(g: Game, o: ScnGoal): number {
  // Цель по отходам требует завершить физическую переработку, а не просто принять их на вход.
  if (o.item === 'used-nuclear-fuel-cell') return g.nuc.st.reprocCells || 0;
  return g.stats.consumed[o.item!] || 0;
}

export function goalDone(g: Game, o: ScnGoal): boolean {
  const st = g.stats;
  switch (o.k) {
    case 'produce': return (st.produced[o.item!] || 0) + (st.crafted[o.item!] || 0) >= o.n!;
    case 'build': { let n = 0; const ty = o.proto!.startsWith('type:') ? o.proto!.slice(5) : null; for (const e of g.ents.values()) if (ty ? e.t === ty : e.proto === o.proto) { if (++n >= o.n!) return true; } return false; }
    case 'research': return g.research.done.has(o.tech!);
    case 'survive': return g.tick - (g.scnSt?.t0 || 0) >= o.min! * 3600;
    case 'rocket': return g.rockets >= o.n!;
    case 'kills': return (st.kills || 0) >= o.n!;
    case 'consume': return consumeGoalCount(g, o) >= o.n!;
    case 'power': return (g._scnPw[o.min!] || 0) >= 3600;
  }
}
/** текст цели — из статичных фрагментов, чтобы переводился словарём */
export function goalText(o: ScnGoal): string {
  switch (o.k) {
    case 'produce': return `Произвести ${o.n} × ${ITEMS[o.item!]?.name || o.item}`;
    case 'build': return `Построить ${o.n} × ${o.proto!.startsWith('type:') ? 'тип «' + o.proto!.slice(5) + '»' : PROTOS[o.proto!]?.name || o.proto}`;
    case 'research': return `Изучить «${TECHS[o.tech!]?.name || o.tech}»`;
    case 'survive': return `Выжить ${o.min} мин`;
    case 'rocket': return o.n! > 1 ? `Запустить ракет: ${o.n}` : 'Запустить ракету';
    case 'kills': return `Убить существ: ${o.n}`;
    case 'consume': return `Переработать ${o.n} × ${ITEMS[o.item!]?.name || o.item}`;
    case 'power': return `Станция ${o.min} МВт: держать нагрузку 60 с`;
  }
}
export function goalProgress(g: Game, o: ScnGoal): string {
  const st = g.stats;
  switch (o.k) {
    case 'produce': return `${Math.min(o.n!, Math.floor((st.produced[o.item!] || 0) + (st.crafted[o.item!] || 0)))}/${o.n}`;
    case 'build': { let n = 0; const ty = o.proto!.startsWith('type:') ? o.proto!.slice(5) : null; for (const e of g.ents.values()) if (ty ? e.t === ty : e.proto === o.proto) n++; return `${Math.min(n, o.n!)}/${o.n}`; }
    case 'survive': return `${Math.min(o.min!, Math.floor((g.tick - (g.scnSt?.t0 || 0)) / 3600))}/${o.min}`;
    case 'rocket': return `${Math.min(o.n!, g.rockets)}/${o.n}`;
    case 'kills': return `${Math.min(o.n!, st.kills || 0)}/${o.n}`;
    case 'consume': return `${Math.min(o.n!, Math.floor(consumeGoalCount(g, o)))}/${o.n}`;
    case 'power': return `${Math.min(o.min!, Math.floor(turbineKW() / 1000))}/${o.min} · ${Math.floor((g._scnPw[o.min!] || 0) / 60)}/60`;
    default: return '';
  }
}
export const fmtClock = (ticks: number) => { const s = Math.floor(ticks / 60), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** раз в 30 тиков: цели, победа, лимит времени */
export function stepScenario(g: Game) {
  const s = g.scn, st = g.scnSt; if (!s || !st || st.res) return;
  // Несколько одинаковых целей одного порога делят один замер, а не каждая добавляет 30 тиков.
  const sampledPower = new Set<number>();
  for (const o of s.goals) if (o.k === 'power' && !sampledPower.has(o.min!)) {
    sampledPower.add(o.min!);
    const k = o.min!; g._scnPw[k] = turbineKW() >= k * 1000 ? (g._scnPw[k] || 0) + 30 : 0;
  }
  let all = true;
  s.goals.forEach((o, i) => {
    if (!st.done[i] && goalDone(g, o)) { st.done[i] = g.tick; g.snd('goal'); g.msg('ОСКАР: цель выполнена — ' + goalText(o)); }
    if (!st.done[i]) all = false;
  });
  st.pr = s.goals.map(o => goalProgress(g, o));
  if (s.goals.length && all) { st.res = { ok: true, tick: g.tick }; g.snd('goal'); g.msg('ОСКАР: испытание пройдено за ' + fmtClock(g.tick - st.t0)); return; }
  if (s.rules.timeLimit && g.tick - st.t0 >= s.rules.timeLimit * 3600) { st.res = { ok: false, tick: g.tick }; g.msg('ОСКАР: время вышло — испытание не пройдено. Можно играть дальше'); }
}
