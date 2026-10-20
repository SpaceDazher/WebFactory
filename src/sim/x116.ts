// v1.16: общее состояние мира «управления заводом» — очередь исследований и банк оплаченного прогресса, режим /creative,
// группы, правила оповещений, приоритеты питания. Один JSON-объект: сохраняется (поле x), входит в хеши, идёт в снимки Worker.
import { TECHS, techCount } from '../data/techs';
import { RECIPES, RECIPE_FOR } from '../data/recipes';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { TICKS } from '../core/types';
import type { Game } from './game';
import type { Stack } from './inventory';
import { DRONE_MODELS, type DroneModel } from './v117';
import { stepNuc, nucCmd } from './nucguide';
import { RadarState, newRadar, loadRadar, radarCmd } from './radar';
import { MgmtState, newMgmt, loadMgmt, groupOp, stepAlerts, sampleDiag } from './mgmt';

export const RQ_MAX = 10;
function stashStack(raw: any): Stack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.item !== 'string') return null;
  if (!Object.hasOwn(ITEMS, raw.item)) return null;
  const def = ITEMS[raw.item]; const count = Math.floor(+raw.count);
  if (!def || def.virtual || def.fluid || !Number.isSafeInteger(count) || count <= 0) return null;
  if (def.droneModel) {
    const d = raw.instance, model = def.droneModel as DroneModel, spec = DRONE_MODELS[model];
    const cat = model === 'gunner' ? 'bullet' : model === 'rocket' ? 'rocket' : model === 'flame' ? 'flame' : null;
    if (!spec || raw.count !== 1 || !d || Object.keys(d).sort().join(',') !== 'ammo,ammoType,charge,hp,id,maxHp,model,owner,repair' ||
        d.model !== model || !Number.isSafeInteger(d.id) || d.id < 1 || typeof d.owner !== 'string' || !/^player-[1-9][0-9]{0,12}$/.test(d.owner) ||
        d.maxHp !== spec.hp || !Number.isFinite(d.hp) || d.hp < 0 || d.hp > spec.hp || !Number.isFinite(d.charge) || d.charge < 0 || d.charge > 2_000_000 ||
        !Number.isSafeInteger(d.ammo) || d.ammo < 0 || d.ammo > spec.ammoLimit || !Number.isFinite(d.repair) || d.repair < 0 || d.repair > 400 ||
        model !== 'repair' && d.repair !== 0 || d.ammoType !== null && (!cat || ITEMS[d.ammoType]?.am?.cat !== cat) ||
        d.ammoType === null && d.ammo !== 0) throw new Error('Некорректный боевой дрон в отложенном инвентаре');
    return { item: raw.item, count: 1, instance: { ...d } };
  }
  if (raw.instance !== undefined) throw new Error('Экземпляр дрона указан у другого предмета');
  return { item: raw.item, count: Math.min(count, def.stack ?? 50) };
}
function stashInventory(raw: any): any[] {
  if (!Array.isArray(raw) || raw.length > 256) throw new Error('Отложенный инвентарь должен содержать не более 256 ячеек');
  const slots: any[] = new Array(Math.max(32, raw.length)).fill(null); const overflow: { item: string; count: number }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const st = stashStack(raw[i]); if (!st) continue;
    const count = Math.floor(+raw[i].count);
    slots[i] = st; const rest = count - st.count; if (rest > 0) overflow.push({ item: st.item, count: rest });
  }
  for (const extra of overflow) {
    let left = extra.count; const max = ITEMS[extra.item].stack ?? 50;
    for (const st of slots) if (left > 0 && st?.item === extra.item && st.count < max) { const n = Math.min(left, max - st.count); st.count += n; left -= n; }
    for (let i = 0; i < slots.length && left > 0; i++) if (!slots[i]) { const n = Math.min(left, max); slots[i] = { item: extra.item, count: n }; left -= n; }
    if (left > 0) throw new Error('Отложенный инвентарь переполнен; сохранение оставлено без изменений');
  }
  return slots;
}
/** Верхняя оценка содержимого резерва для одного заказа, выведенная из графа ручных рецептов. */
function reservationPoolBounds(recipeId: string, count: number): Record<string, number> {
  const bounds: Record<string, number> = Object.create(null); let valid = true;
  const add = (item: string, amount: number) => {
    if (!Object.hasOwn(ITEMS, item) || ITEMS[item].virtual || ITEMS[item].fluid || !Number.isSafeInteger(amount) || amount < 0) { valid = false; return; }
    const total = (bounds[item] || 0) + amount;
    if (!Number.isSafeInteger(total) || total > 1_000_000_000) { valid = false; return; }
    bounds[item] = total;
  };
  const expand = (id: string, batches: number, depth: number, path: Set<string>, includeOutput: boolean) => {
    const recipe = Object.hasOwn(RECIPES, id) ? RECIPES[id] : null;
    if (!recipe || !Number.isSafeInteger(batches) || batches <= 0 || depth > 8 || path.has(id)) { valid = false; return; }
    const currentPath = new Set(path); currentPath.add(id);
    if (includeOutput) for (const [item, amount] of recipe.out) add(item, amount * batches);
    for (const [item, amount] of recipe.in) {
      const need = amount * batches; add(item, need);
      const subId = Object.hasOwn(RECIPE_FOR, item) ? RECIPE_FOR[item] : undefined;
      const sub = subId && Object.hasOwn(RECIPES, subId) ? RECIPES[subId] : null;
      const yieldPerBatch = sub?.out.find(([output]) => output === item)?.[1];
      if (!sub?.hand || !Number.isSafeInteger(yieldPerBatch) || !yieldPerBatch || depth >= 8 || currentPath.has(subId!)) continue;
      const subBatches = Math.ceil(need / yieldPerBatch);
      expand(subId!, subBatches, depth + 1, currentPath, true);
    }
  };
  expand(recipeId, count, 0, new Set(), false);
  return valid ? bounds : Object.create(null);
}
function stashQueue(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  const out: any[] = [];
  for (const [index, job] of raw.slice(0, 60).entries()) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || typeof job.recipe !== 'string' || !Object.hasOwn(RECIPES, job.recipe)) continue;
    const count = Math.floor(+job.count), left = +job.left;
    if (!Number.isSafeInteger(count) || count <= 0 || count > 1_000_000 || typeof job.started !== 'boolean' || !Number.isFinite(left) || left < 0) continue;
    if (job.oid !== undefined && (!Number.isSafeInteger(job.oid) || job.oid < 1)) continue;
    const r = RECIPES[job.recipe];
    const started = job.started && index === 0 && left > 0;
    const cleanJob: any = { recipe: job.recipe, count, started, left: started ? Math.min(left, r.time * TICKS) : 0 };
    if (job.auto === true) cleanJob.auto = true;
    if (job.oid !== undefined) cleanJob.oid = job.oid;
    if (job.pool !== undefined) {
      if (!job.pool || typeof job.pool !== 'object' || Array.isArray(job.pool)) continue;
      const pool: Record<string, number> = {};
      const bounds = job.auto === true || job.oid === undefined ? Object.create(null) : reservationPoolBounds(job.recipe, count);
      for (const [item, n] of Object.entries(job.pool).slice(0, 256)) {
        const amount = Math.floor(+(n as any));
        if (!Object.hasOwn(ITEMS, item) || ITEMS[item].virtual || ITEMS[item].fluid || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) continue;
        if (amount && amount <= (bounds[item] || 0)) pool[item] = amount;
      }
      cleanJob.pool = pool;
    }
    out.push(cleanJob);
  }
  const poolJobs = new Map<number, any[]>();
  for (const job of out) if (job.pool && job.oid !== undefined) { const list = poolJobs.get(job.oid) || []; list.push(job); poolJobs.set(job.oid, list); }
  for (const jobs of poolJobs.values()) if (jobs.length > 1) for (const job of jobs) job.pool = {};
  return out;
}
export interface X116 extends MgmtState {
  /** очередь исследований, ожидающих после активного (вместе с активным — не больше RQ_MAX) */ rq: string[];
  /** оплаченный прогресс исследований: «id» или «id@уровень» → единиц */ bank: Record<string, number>;
  /** режим мира: 0 — выживание, 1 — творческий; cheats — необратимая отметка */ mode: 0 | 1; cheats: boolean;
  /** отложенные личные состояния игроков на время творческого режима: номер игрока → инвентарь, очередь крафта (с резервом), рука */
  stash: Record<number, { inv: any[]; queue: any[]; held: any }>; /** рецепты, открытые только на время творческого режима */ cEn: string[];
  /** v1.16 rc.7: атомный курс ОСКАРа: шаг (−1 скрыт), запомненный шаг при скрытии, «начало показано», «про обогащение рассказано» */ ng?: number; ngh?: number; ngs?: number; ne?: number;
  /** v1.16: радары — время скана секторов, находки, счётчики, фильтр уведомлений */ rs: RadarState;
}
export const newX = (): X116 => ({ rq: [], bank: {}, mode: 0, cheats: false, stash: {}, cEn: [], rs: newRadar(), ng: undefined, ngh: undefined, ngs: undefined, ne: undefined, ...newMgmt() });
export function loadX(raw: any): X116 {
  const x = newX(); if (!raw || typeof raw !== 'object') return x;
  loadMgmt(raw, x); x.rs = loadRadar(raw.rs);
  if (Array.isArray(raw.rq)) x.rq = raw.rq.filter((t: any) => typeof t === 'string' && Object.hasOwn(TECHS, t)).slice(0, RQ_MAX - 1);
  if (raw.bank && typeof raw.bank === 'object' && !Array.isArray(raw.bank)) for (const [k, v] of Object.entries(raw.bank)) {
    const [id, levelText, extra] = k.split('@'), tech = Object.hasOwn(TECHS, id) ? TECHS[id] : null;
    const level = levelText === undefined ? 0 : Number(levelText), n = Math.floor(+(v as any));
    if (!tech || extra !== undefined || !Number.isSafeInteger(level) || level < 0 || level > 1_000_000 || (tech.infinite ? levelText === undefined : levelText !== undefined)) continue;
    const max = techCount(tech, level);
    if (Number.isSafeInteger(n) && n > 0 && n <= max) x.bank[k] = n;
  }
  for (const k of ['ng', 'ngh', 'ngs', 'ne'] as const) { const v = Math.floor(+raw[k]); if (Number.isFinite(v) && v >= (k === 'ng' ? -1 : 0) && v <= 7) x[k] = v; }
  x.mode = raw.mode === 1 ? 1 : 0; x.cheats = !!raw.cheats || x.mode === 1;
  if (raw.stash && typeof raw.stash === 'object' && !Array.isArray(raw.stash)) for (const [k, v] of Object.entries<any>(raw.stash)) {
    const pl = +k;
    if (!Number.isInteger(pl) || pl < 0 || pl >= 16 || !v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.inv)) continue;
    x.stash[pl] = { inv: stashInventory(v.inv), queue: stashQueue(v.queue), held: stashStack(v.held) };
  }
  if (Array.isArray(raw.cEn)) x.cEn = raw.cEn.filter((r: any) => typeof r === 'string' && Object.hasOwn(RECIPES, r));
  return x;
}

// ---------- исследования ----------
const bankKey = (g: Game, id: string) => { const t = TECHS[id]; return t?.infinite ? id + '@' + (g.research.levels[id] || 0) : id; };
/** переключить активное исследование: прогресс прежнего сохраняется в банке, прогресс нового — подхватывается */
export function setCurrent(g: Game, tech: string | null) {
  const r = g.research; if (r.current === tech) return;
  if (r.current && r.progress > 0) g.x.bank[bankKey(g, r.current)] = r.progress;
  r.current = tech; r.progress = 0;
  if (tech) { const k = bankKey(g, tech); r.progress = g.x.bank[k] || 0; delete g.x.bank[k]; }
  g.xv++;
}
/** следующая доступная запись очереди (предшественники изучены); недоступные ждут */
export function nextFromQueue(g: Game) {
  if (g.research.current) return;
  const i = g.x.rq.findIndex(t => g.canResearch(t));
  if (i < 0) return;
  const [t] = g.x.rq.splice(i, 1); setCurrent(g, t); g.msg('Следующее исследование: ' + TECHS[t].name);
}
export const queueFull = (g: Game) => (g.research.current ? 1 : 0) + g.x.rq.length >= RQ_MAX;
/** предшественники, которых не хватает для постановки tech (не изучены и не стоят раньше в очереди) */
export function missingPrereqs(g: Game, tech: string, before = g.x.rq.length): string[] {
  const have = new Set<string>(g.research.done); if (g.research.current) have.add(g.research.current); for (const t of g.x.rq.slice(0, before)) have.add(t);
  return TECHS[tech].prereq.filter(p => !have.has(p));
}
/** цепочка предшественников, которых нет ни в изученных, ни в очереди (в порядке постановки) */
export function depsToAdd(g: Game, tech: string): string[] {
  const out: string[] = []; const have = new Set<string>(g.research.done); if (g.research.current) have.add(g.research.current); for (const t of g.x.rq) have.add(t);
  const visit = (id: string) => { if (have.has(id) || out.includes(id)) return; for (const p of TECHS[id].prereq) visit(p); out.push(id); };
  visit(tech); return out;
}
export function rqAdd(g: Game, tech: string, deps: boolean) {
  const t = TECHS[tech];
  if (!t || !g.techOk(tech)) { g.msg('Эту технологию нельзя исследовать'); return; }
  if (!t.infinite && g.research.done.has(tech)) { g.msg('«' + t.name + '» уже изучена'); return; }
  if (g.research.current === tech || g.x.rq.includes(tech)) { g.msg('«' + t.name + '» уже в очереди'); return; }
  let list = [tech];
  if (missingPrereqs(g, tech).length) {
    if (!deps) { g.msg('Сначала нужны: ' + missingPrereqs(g, tech).map(p => TECHS[p].name).join(', ')); return; }
    list = depsToAdd(g, tech);
    if (list.some(id => !g.techOk(id))) { g.msg('Цепочка содержит запрещённую технологию'); return; }
  }
  if ((g.research.current ? 1 : 0) + g.x.rq.length + list.length > RQ_MAX) { g.msg(`Очередь исследований заполнена (не больше ${RQ_MAX} вместе с текущим)`); return; }
  for (const id of list) g.x.rq.push(id);
  g.xv++; nextFromQueue(g);
}
export function rqRemove(g: Game, tech: string) { const i = g.x.rq.indexOf(tech); if (i >= 0) { g.x.rq.splice(i, 1); g.xv++; } }
export function rqMove(g: Game, tech: string, d: number) {
  const i = g.x.rq.indexOf(tech), j = i + (d < 0 ? -1 : 1); if (i < 0 || j < 0 || j >= g.x.rq.length) return;
  [g.x.rq[i], g.x.rq[j]] = [g.x.rq[j], g.x.rq[i]]; g.xv++;
}

// ---------- общий диспетчер команд { t: 'x', op, ... } ----------
export interface XCmd { t: 'x'; op: string; tech?: string; deps?: boolean; d?: number; [k: string]: any }
export function xCmd(g: Game, c: XCmd) {
  const s = (v: any, n = 64) => typeof v === 'string' ? v.slice(0, n) : '';
  switch (c.op) {
    case 'rqadd': rqAdd(g, s(c.tech), !!c.deps); break;
    case 'rqdel': rqRemove(g, s(c.tech)); break;
    case 'rqmove': rqMove(g, s(c.tech), c.d || 0); break;
    case 'rqclear': if (g.x.rq.length) { g.x.rq = []; g.xv++; } break;
    case 'con': consoleCmd(g, c.line); break;
    case 'give': giveTest(g, s(c.item), +c.n || 0); break;
    default: if (!radarCmd(g, c) && !nucCmd(g, c) && !groupOp(g, c) && g.xExt) g.xExt(c);
  }
}
/** раз в 30 тиков: свободное место → следующая запись очереди */
export function stepX(g: Game) { if (!g.research.current && g.x.rq.length) nextFromQueue(g); stepAlerts(g); sampleDiag(g); stepNuc(g); }

// ---------- консоль: /creative и /survival ----------
export const CONSOLE_HELP = '/creative — творческий режим (отметка «тестовая партия» необратима), /survival — вернуть выживание';
/** тестовый набор: по стопке каждой постройки, что поместится */
function testSet(g: Game) {
  const ids = Object.keys(PROTOS).filter(id => ITEMS[id] && !ITEMS[id].virtual && !PROTOS[id].type.startsWith('nest') && !g.banned(id)).slice(0, 80);
  return ids.map(id => ({ item: id, count: ITEMS[id].stack || 50 }));
}
export function setMode(g: Game, m: 0 | 1) {
  const x = g.x;
  if (m === 1) {
    x.cheats = true; x.mode = 1; x.cEn = [];
    g.v117.inventory.cheatsUsed = true;
    for (const id of Object.keys(RECIPES)) if (!g.enabled.has(id) && !g.recipeBanned(id)) { g.enabled.add(id); x.cEn.push(id); }
    g.eachPl(() => {
      const copy = (s: Stack | null): Stack | null => s ? { ...s, ...(s.instance ? { instance: { ...s.instance } } : {}) } : null;
      x.stash[g.pl] = { inv: g.inv.slots.map(copy), queue: JSON.parse(JSON.stringify(g.queue)), held: copy(g.held) };
      g.inv.slots.fill(null); g.held = null; g.queue = [];
      const t = testSet(g); t.forEach((s, i) => { if (i < g.inv.slots.length) g.inv.slots[i] = s; });
    });
    g.msg('Творческий режим: тестовая партия (достижения и рекорды отключены). Вернуться: /survival');
  } else {
    x.mode = 0;
    g.eachPl(() => { const st = x.stash[g.pl]; if (!st) return; for (let i = 0; i < g.inv.slots.length; i++) g.inv.slots[i] = st.inv[i] || null; g.queue = st.queue; g.held = st.held; delete x.stash[g.pl]; });
    for (const id of x.cEn) g.enabled.delete(id); x.cEn = [];
    g.msg('Выживание: личные вещи и очереди возвращены, постройки мира остались');
  }
  g.xv++;
}
export function consoleCmd(g: Game, raw: unknown) {
  if (typeof raw !== 'string') { g.msg('Команда должна быть строкой'); return; }
  if (raw.length > 256) { g.msg('Команда длиннее 256 символов'); return; }
  const t = raw.trim().replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
  if (!g.isAdmin()) { g.msg('Недостаточно прав: режим меняют хост и админы'); return; }
  if (t === '/creative') { if (g.x.mode === 1) g.msg('Режим уже активен'); else setMode(g, 1); }
  else if (t === '/survival') { if (g.x.mode === 0) g.msg('Режим уже активен'); else setMode(g, 0); }
  else g.msg('Неизвестная команда. ' + CONSOLE_HELP);
}
/** палитра: выдать тестовый стек (только в творческом режиме) */
function giveTest(g: Game, item: string, n: number) {
  if (g.x.mode !== 1 || !g.isAdmin() || !ITEMS[item] || ITEMS[item].virtual || ITEMS[item].fluid || g.banned(item) || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) return;
  const k = Math.max(1, Math.min(n || ITEMS[item].stack || 50, ITEMS[item].stack || 50));
  const left = ITEMS[item].droneModel ? g.inv.addDrone(item, k) : g.inv.add(item, k);
  if (left) g.msg('Нет места в тестовом инвентаре');
}
