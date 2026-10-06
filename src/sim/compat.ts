// Совместимость сохранений между версиями (п. 5 плана 1.0).
// migrate() в save.ts меняет формат (v1 → v2 → v3), а здесь — всё остальное, что могло разойтись между
// версиями игры при том же формате: id построек, предметов, рецептов и технологий, размеры инвентарей и стопок,
// слоты модулей, открытые рецепты. Ничего не выбрасывается молча: предметы, которым некуда деться,
// возвращаются инженеру (или на землю рядом), а всё, что пришлось поправить, попадает в отчёт загрузки.
import { PROTOS, FLOORS, FLOOR_BY_ITEM } from '../data/entities';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { cleanCC, cleanWire, hasOut } from './circuits';
import { cleanSched } from './trains';
import { activeMods } from '../mods/registry';

declare const __VERSION__: string;
export const GAME_VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
export const PLAYER_SLOTS = 80;

/** Переименования между версиями: старый id → новый. Пока ни один id не менялся, таблицы пустые —
 *  при переименовании в будущих версиях достаточно добавить строку, и старые сохранения откроются. */
export const ALIASES: { proto: Record<string, string>; item: Record<string, string>; recipe: Record<string, string>; tech: Record<string, string> } = {
  proto: {}, item: {}, recipe: {}, tech: {},
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
const alias = (kind: keyof typeof ALIASES, id: any) => (typeof id === 'string' && ALIASES[kind][id]) || id;

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
    if (Array.isArray(o.inv)) o.inv = slots(o.inv, p.slots ?? o.inv.length, p.name || o.proto);
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
    if (s.inv.length > PLAYER_SLOTS) fix('инвентарь инженера: ячеек стало меньше');
    s.inv = slots(s.inv, PLAYER_SLOTS, 'инвентарь инженера');
  }
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
  // v1.12: игроки кооператива — не больше 4, имя (до 20 символов), цвет, инвентарь и очередь — как у инженера
  s.peers = Array.isArray(s.peers) && s.peers.length > 1 ? s.peers.slice(0, 4).map((p: any, i: number) => {
    const o: any = { name: String(p?.name ?? '').slice(0, 20) || 'Игрок ' + (i + 1), color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#d2782e' };
    if (i === 0) return o;
    o.player = p?.player && typeof p.player === 'object' && Number.isFinite(p.player.x) && Number.isFinite(p.player.y) ? p.player : { x: 0.5, y: 0.5 };
    o.inv = slots(Array.isArray(p?.inv) ? p.inv : [], PLAYER_SLOTS, 'инвентарь игрока ' + (i + 1));
    o.queue = (Array.isArray(p?.queue) ? p.queue : []).filter((j: any) => j && RECIPES[alias('recipe', j.recipe)]).map((j: any) => ({ ...j, recipe: alias('recipe', j.recipe) }));
    o.held = p?.held ? stack(p.held) : null; o.equip = p?.equip && ITEMS[p.equip] ? p.equip : null;
    o.preq = Array.isArray(p?.preq) ? p.preq.map((q: any) => q && ITEMS[q.item] ? q : null) : []; o.preqOff = !!p?.preqOff;
    const ip = p?.input; const inR = (v: any) => typeof v === 'number' && v >= -1 && v <= 1; o.input = ip && typeof ip === 'object' && inR(ip.mx) && inR(ip.my) ? ip : { mx: 0, my: 0, mine: null };
    return o;
  }) : [];
  s.ghosts = (s.ghosts || []).filter((gh: any) => { gh.proto = alias('proto', gh.proto); if (gh.recipe && !RECIPES[gh.recipe]) gh.recipe = null; return !!PROTOS[gh.proto]; });
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
  for (const p of s.peers || []) for (const x of p.inv || []) if (x) add(items, x.item, x.count);
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
