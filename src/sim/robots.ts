// Строительные роботы (v1.2): сети робопортов, задачи стройки / сноса / улучшения / ремонта, зарядка, личный робопорт.
// Логистические роботы (v1.3): доставка между логистическими сундуками, запросы, личные запросы и мусор инженера.
// Всё детерминировано: обход — по массивам в порядке создания или по id, без неупорядоченных коллекций.
// Роботы в робопорту — предметы в его ячейках; в полёте — объекты g.robots (сохраняются вместе с грузом и задачей).
import { dismantleBlock } from './heat';
import type { Game, Entity, Ghost } from './game';
import { Inventory, type Stack } from './inventory';
import { PROTOS, FLOOR_BY_ITEM } from '../data/entities';
import { kitStats } from './combat';
import { ITEMS } from '../data/items';
import { TECHS } from '../data/techs';
import { tkey } from '../core/types';
import { tele } from './telemetry';

export const ROBOT = 'construction-robot', LROBOT = 'logistic-robot', REPAIR = 'repair-pack';
export type RobotTask = 'build' | 'decon' | 'tree' | 'tile' | 'upgrade' | 'repair' | 'store' | 'home' | 'deliver';
export interface Robot {
  id: number; x: number; y: number;
  /** робопорт, к сети которого приписан робот; -1 — личный робопорт инженера */
  home: number;
  /** v1.12: номер игрока, чей инженер для робота «−1» (кооператив) */ pl?: number;
  /** заряд, Дж */ e: number;
  k: RobotTask; /** призрак / постройка / клетка дерева / сундук (store; -1 — инженер) */ tgt: number;
  /** 0 — летит к источнику предмета, 1 — к цели */ step: number;
  /** источник: id сундука или робопорта, -1 — инвентарь инженера */ src: number;
  cargo: Stack[];
  /** робопорт, где робот заряжается по пути (-1 — нет) */ chg: number;
  /** ремонт: сколько прочности уже потрачено из набора */ used?: number;
  /** v1.3: логистический робот */ lg?: 1;
  /** доставка: какой предмет и сколько обещано забрать у источника */ it?: string; n?: number;
}
/** предмет робота (для возврата в порт, на землю и сверки предметов) */
export const robotItem = (r: { lg?: 1 }) => r.lg ? LROBOT : ROBOT;
/** chests — логистические сундуки сети (кроме запроса — источники для стройки); stor — хранение; req — запрос и буфер; act — активное снабжение */
export interface RoboNet { id: number; ports: Entity[]; chests: Entity[]; stor: Entity[]; req: Entity[]; act: Entity[]; all: Entity[]; }
export interface RoboIndex { nets: RoboNet[]; netOf: Map<number, RoboNet>; grid: Map<number, Entity[]>; /** v1.3: сеть логистического сундука */ chestNet: Map<number, RoboNet>; }

const C = 32; const ck = (x: number, y: number) => (Math.floor(x / C) + 32768) * 65536 + (Math.floor(y / C) + 32768);
const cx = (e: { x: number; w: number }) => e.x + e.w / 2, cy = (e: { y: number; h: number }) => e.y + e.h / 2;
const RD = () => ITEMS[ROBOT].robot!;
const LD = () => ITEMS[LROBOT].robot!;
const logi = (e: Entity) => PROTOS[e.proto].logi;
/** грузоподъёмность логистического робота с исследованиями «Вместимость роботов» */
export function robotCargo(g: Game) { let b = LD().cargo || 1; for (const id of g.research.done) b += TECHS[id]?.robotCargo || 0; return b; }
export const robotMaxJ = () => RD().batteryMJ * 1e6;
/** скорость, клеток за тик, с исследованиями «Скорость роботов» */
export function robotSpeed(g: Game, lg = false) { let b = 0; for (const id of g.research.done) b += TECHS[id]?.robotSpeed || 0; return (lg ? LD() : RD()).speed * (1 + b) / 60; }
/** Дж на клетку пути: расход на клетку + расход в полёте за время пролёта клетки */
const perTile = (g: Game) => RD().tileKJ * 1000 + RD().flyKW * 1000 / 60 / robotSpeed(g);

// ---------- сети ----------
export function buildIndex(g: Game): RoboIndex {
  const ports: Entity[] = [], chests: Entity[] = [];
  for (const e of g.ents.values()) { if (e.t === 'roboport') ports.push(e); else if (e.t === 'chest' && PROTOS[e.proto].logi) chests.push(e); }
  ports.sort((a, b) => a.id - b.id); chests.sort((a, b) => a.id - b.id);
  // объединение робопортов с пересекающимися зонами логистики (union-find, как электросети)
  const par = new Map<number, number>(); for (const p of ports) par.set(p.id, p.id);
  const find = (a: number): number => { while (par.get(a) !== a) { const p = par.get(par.get(a)!)!; par.set(a, p); a = p; } return a; };
  for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
    const a = ports[i], b = ports[j]; const L = (PROTOS[a.proto].robo!.lz + PROTOS[b.proto].robo!.lz) / 2;
    if (Math.abs(cx(a) - cx(b)) < L && Math.abs(cy(a) - cy(b)) < L) { const ra = find(a.id), rb = find(b.id); if (ra !== rb) par.set(Math.max(ra, rb), Math.min(ra, rb)); }
  }
  const byRoot = new Map<number, RoboNet>(); const nets: RoboNet[] = []; const netOf = new Map<number, RoboNet>();
  for (const p of ports) { const r = find(p.id); let n = byRoot.get(r); if (!n) { n = { id: r, ports: [], chests: [], stor: [], req: [], act: [], all: [] }; byRoot.set(r, n); nets.push(n); } n.ports.push(p); netOf.set(p.id, n); }
  // пространственный индекс: робопорты по чанкам, которые задевает их зона стройки
  const grid = new Map<number, Entity[]>();
  for (const p of ports) {
    const h = PROTOS[p.proto].robo!.cz / 2; const x0 = cx(p) - h, x1 = cx(p) + h, y0 = cy(p) - h, y1 = cy(p) + h;
    for (let y = Math.floor(y0 / C); y <= Math.floor(y1 / C); y++) for (let x = Math.floor(x0 / C); x <= Math.floor(x1 / C); x++) {
      const k = ck(x * C, y * C); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(p);
    }
  }
  // логистические сундуки в зоне логистики (жёлтой). С v1.3 обычные сундуки складом сети не считаются
  const chestNet = new Map<number, RoboNet>();
  for (const c of chests) {
    const p = portAt(grid, cx(c), cy(c), 'lz'); if (!p) continue; const n = netOf.get(p.id)!; const k = logi(c)!; chestNet.set(c.id, n);
    n.all.push(c); if (k !== 'requester') n.chests.push(c); if (k === 'storage') n.stor.push(c); if (k === 'requester' || k === 'buffer') n.req.push(c); if (k === 'active') n.act.push(c);
  }
  return { nets, netOf, grid, chestNet };
}
function portAt(grid: Map<number, Entity[]>, x: number, y: number, zone: 'cz' | 'lz'): Entity | null {
  const a = grid.get(ck(x, y)); if (!a) return null;
  for (const p of a) { const h = PROTOS[p.proto].robo![zone] / 2; if (Math.abs(x - cx(p)) <= h && Math.abs(y - cy(p)) <= h) return p; }
  return null;
}
export function roboIndex(g: Game): RoboIndex { if (!g.robo || g.roboDirty) { g.robo = buildIndex(g); g.roboDirty = false; } return g.robo; }
/** сеть, в зону стройки (оранжевую) которой попадает точка */
export function netAt(g: Game, x: number, y: number): RoboNet | null { const I = roboIndex(g); const p = portAt(I.grid, x, y, 'cz'); return p ? I.netOf.get(p.id)! : null; }
/** личный робопорт надет и инженер жив */
export function personal(g: Game) {
  if (g.player.dead) return null;
  const k = g.player.kit; const kr = k?.armor ? kitStats(k).robo : null; // v1.14: робопорты в сетке модульной брони
  const d = g.equip ? ITEMS[g.equip]?.equip : undefined; const dd = d && d.kind === 'roboport' ? d : null;
  if (kr && dd) return { ...kr, zone: Math.max(kr.zone, dd.zone), robots: kr.robots + dd.robots };
  return kr || dd;
}
export function inPersonal(g: Game, x: number, y: number) { const d = personal(g); return !!d && Math.abs(x - g.player.x) <= d.zone / 2 && Math.abs(y - g.player.y) <= d.zone / 2; }
const playerIn = (g: Game, net: RoboNet) => { if (g.player.dead) return false; if (g.pl) return netAt(g, g.player.x, g.player.y) === net; const c = tc(g); if (c.pnet === undefined) c.pnet = netAt(g, g.player.x, g.player.y); return c.pnet === net; };

// ---------- склад сети: предметы в сундуках и роботы в робопортах (кэш на тик) ----------
interface TickCache { tick: number; pl: number; items: Map<RoboNet, Map<string, number>>; robots: Map<RoboNet, number>; lrobots: Map<RoboNet, number>; idle: Map<RoboNet, Robot[]> | null; lidle: Map<RoboNet, Robot[]> | null; pnet: RoboNet | null | undefined;
  /** v1.3: обещания — сколько предметов у сундука уже «забронировано» летящими роботами (out) и сколько к нему летит (inc); пересчёт по роботам */
  prom: { out: Map<number, Map<string, number>>; inc: Map<number, Map<string, number>>; shadows: Map<number, Inventory | null> } | null; }
const emptyCache = (tick: number, pl = 0): TickCache => ({ tick, pl, items: new Map(), robots: new Map(), lrobots: new Map(), idle: null, lidle: null, pnet: undefined, prom: null });
let cache: TickCache = emptyCache(-1);
let cacheGame: Game | null = null;
function tc(g: Game): TickCache { if (cache.tick !== g.tick || cache.pl !== g.pl || cacheGame !== g || (cache.idle || cache.lidle) && g.robo && cacheIdx !== g.robo) { cache = emptyCache(g.tick, g.pl); cacheGame = g; cacheIdx = g.robo; } return cache; }
let cacheIdx: RoboIndex | null = null;
/** свободные роботы в полёте по сетям (кэш на тик; назначенные отфильтровываются при выборе) */
function idleOf(g: Game, n: RoboNet, lg = false): Robot[] {
  const c = tc(g);
  if (!c.idle) { c.idle = new Map(); c.lidle = new Map(); const I = g.robo!; for (const r of g.robots) { if (r.home === -1 || r.k !== 'home' || r.chg >= 0 || r.cargo.length) continue; const m = I.netOf.get(r.home); if (!m) continue; const M = r.lg ? c.lidle : c.idle; let a = M.get(m); if (!a) M.set(m, a = []); a.push(r); } }
  return (lg ? c.lidle! : c.idle).get(n) || [];
}
const isIdle = (r: Robot) => r.k === 'home' && r.chg < 0 && !r.cargo.length;
function netItems(g: Game, n: RoboNet) {
  const c = tc(g); let m = c.items.get(n);
  if (!m) { m = new Map(); for (const ch of n.chests) for (const s of ch.inv!.slots) if (s) m.set(s.item, (m.get(s.item) || 0) + s.count); c.items.set(n, m); }
  return m;
}
function netRobots(g: Game, n: RoboNet, lg = false) { const c = tc(g); const M = lg ? c.lrobots : c.robots; let k = M.get(n); if (k === undefined) { k = 0; const it = lg ? LROBOT : ROBOT; for (const p of n.ports) k += p.inv!.count(it); M.set(n, k); } return k; }
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
/** v1.6: сигналы робопорта — содержимое логистической сети, свободные (в робопортах) и все роботы сети */
export function roboSignals(g: Game, port: Entity): { items: Map<string, number>; lf: number; la: number; cf: number; ca: number } | null {
  const I = roboIndex(g); const n = I.netOf.get(port.id); if (!n) return null;
  const lf = netRobots(g, n, true), cf = netRobots(g, n, false); let lfly = 0, cfly = 0;
  for (const r of g.robots) if (r.home >= 0 && I.netOf.get(r.home) === n) { if (r.lg) lfly++; else cfly++; }
  return { items: netItems(g, n), lf, la: lf + lfly, cf, ca: cf + cfly };
}

/** ближайший источник предмета в сети: сундук, (для ремнаборов) робопорт, инженер в зоне */
function findSource(g: Game, n: RoboNet, item: string, x: number, y: number): { id: number; x: number; y: number } | null {
  let best: Entity | null = null, bd = Infinity;
  const P = prom(g);
  const take = (e: Entity) => { if (!e.inv || e.inv.count(item) - (P.out.get(e.id)?.get(item) || 0) < 1) return; const d = dist(cx(e), cy(e), x, y); if (d < bd) { bd = d; best = e; } };
  if (item === REPAIR) for (const p of n.ports) take(p);
  // приоритет источников (v1.3): активное снабжение → буфер → пассивное снабжение и хранение
  if (!best && (netItems(g, n).get(item) || 0) > 0) for (const tier of [0, 1, 2]) { for (const c of n.chests) if (TIER[logi(c)!] === tier) take(c); if (best) break; }
  if (best) return { id: (best as Entity).id, x: cx(best), y: cy(best) };
  if (playerIn(g, n) && g.inv.count(item) > 0) return { id: -1, x: g.player.x, y: g.player.y };
  return null;
}
/** есть ли предмет в сети (без поиска ближайшего источника) */
function hasItem(g: Game, n: RoboNet, item: string) {
  if ((netItems(g, n).get(item) || 0) > 0) return true;
  if (item === REPAIR) for (const p of n.ports) if (p.inv!.count(item) > 0) return true;
  return playerIn(g, n) && g.inv.count(item) > 0;
}
const TIER: Record<string, number> = { active: 0, buffer: 1, passive: 2, storage: 2, requester: 9 };
/** сундук хранения для предмета: с фильтром на него → где он уже лежит → пустой без фильтра (ближайший в своей группе) */
function storeDest(g: Game, n: RoboNet, item: string, x: number, y: number): Entity | null {
  let best: Entity | null = null, bt = 9, bd = Infinity;
  for (const c of n.stor) {
    const f = c.lfilter; if (f && f !== item) continue;
    if (reservationRoom(g, c.id, item) < 1) continue;
    const t = f === item ? 0 : c.inv!.count(item) > 0 ? 1 : 2; const d = dist(cx(c), cy(c), x, y);
    if (t < bt || t === bt && d < bd) { bt = t; bd = d; best = c; }
  }
  return best;
}
/** куда сложить предмет: сундук хранения сети, иначе инженер в зоне сети */
function findStore(g: Game, r: Robot, item: string): number | null {
  if (r.home === -1) return -1;
  const n = netOfRobot(g, r); if (!n) return null;
  const c = storeDest(g, n, item, r.x, r.y); if (c) return c.id;
  if (playerIn(g, n) && reservationRoom(g, -1, item) > 0) return -1;
  return null;
}
// ---------- обещания (v1.3): пересчитываются по летящим роботам — после загрузки удвоения нет ----------
function prom(g: Game) {
  const c = tc(g); if (c.prom) return c.prom;
  const P = c.prom = { out: new Map<number, Map<string, number>>(), inc: new Map<number, Map<string, number>>(), shadows: new Map<number, Inventory | null>() };
  for (const r of g.robots) if (r.k === 'deliver' && r.it) {
    if (r.step === 0 && (r.src !== -1 || (r.pl || 0) === g.pl)) addP(P.out, r.src, r.it, r.n || 0);
    if (r.tgt !== -1 || (r.pl || 0) === g.pl) { const k = r.step === 0 ? r.n || 0 : r.cargo.reduce((a, s) => a + s.count, 0); addP(P.inc, r.tgt, r.it, k); }
  }
  for (const r of g.robots) if (r.k === 'store' && (r.tgt >= 0 || r.tgt === -1 && (r.pl || 0) === g.pl)) for (const s of r.cargo) addP(P.inc, r.tgt, s.item, s.count);
  return P;
}
/** Reserve real cells, so different items cannot both claim the same empty slot. */
function reservationRoom(g: Game, id: number, item: string): number {
  const P = prom(g);
  if (!P.shadows.has(id)) {
    const source = id === -1 ? g.inv : g.ents.get(id)?.inv;
    if (!source) P.shadows.set(id, null);
    else {
      const shadow = new Inventory(source.size); shadow.slotLimit = source.slotLimit; shadow.filt = source.filt?.slice(); shadow.load(source.slots);
      let fits = true;
      for (const [it, count] of P.inc.get(id) || []) {
        if (ITEMS[it]?.droneModel) {
          let left = count;
          for (let i = 0; i < shadow.slotLimit && left > 0; i++) if (!shadow.slots[i] && (!shadow.filt?.[i] || shadow.filt[i] === it)) { shadow.slots[i] = { item: it, count: 1 }; left--; }
          if (left) fits = false;
        } else if (shadow.add(it, count)) fits = false;
      }
      P.shadows.set(id, fits ? shadow : null);
    }
  }
  const shadow = P.shadows.get(id);
  return !shadow ? 0 : ITEMS[item]?.droneModel ? shadow.instanceSpace(item) : shadow.spaceFor(item);
}
function addP(M: Map<number, Map<string, number>>, id: number, it: string, k: number) { let m = M.get(id); if (!m) M.set(id, m = new Map()); m.set(it, (m.get(it) || 0) + k); }
/** для окон и тестов: сколько предмета обещано отдать из сундука / привезти в него */
export function promised(g: Game, id: number, item: string) { const P = prom(g); return { out: P.out.get(id)?.get(item) || 0, inc: P.inc.get(id)?.get(item) || 0 }; }
function netOfRobot(g: Game, r: Robot): RoboNet | null {
  const I = roboIndex(g); const n = I.netOf.get(r.home); if (n) return n;
  // свой робопорт снесён — приписываем к ближайшему
  let best: Entity | null = null, bd = Infinity;
  for (const m of I.nets) for (const p of m.ports) { const d = dist(cx(p), cy(p), r.x, r.y); if (d < bd) { bd = d; best = p; } }
  if (!best) return null; r.home = (best as Entity).id; return I.netOf.get(r.home)!;
}
function nearestPort(n: RoboNet, x: number, y: number, need?: (p: Entity) => boolean): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const p of n.ports) { if (need && !need(p)) continue; const d = dist(cx(p), cy(p), x, y); if (d < bd) { bd = d; best = p; } }
  return best;
}
/** ячейки роботов общие для строительных и логистических */
const robotRoom = (p: Entity) => PROTOS[p.proto].robo!.robotSlots * ITEMS[ROBOT].stack - p.inv!.count(ROBOT) - p.inv!.count(LROBOT);
const repairRoom = (p: Entity) => PROTOS[p.proto].robo!.repairSlots * ITEMS[REPAIR].stack - p.inv!.count(REPAIR);
/** сколько можно положить в робопорт (робот / ремнабор); остальное он не принимает */
export function roboportAccepts(e: Entity, item: string) { return item === ROBOT || item === LROBOT ? robotRoom(e) : item === REPAIR ? repairRoom(e) : 0; }

// ---------- задачи ----------
function targetPos(g: Game, r: Robot): [number, number] | null {
  if (r.chg >= 0) { const p = g.ents.get(r.chg); if (p) return [cx(p), cy(p) - 0.6]; r.chg = -1; }
  const pl: [number, number] = [g.player.x, g.player.y - 0.4];
  if ((r.k === 'build' || r.k === 'upgrade' || r.k === 'repair' || r.k === 'tile') && r.step === 0) {
    if (r.src === -1) return pl; const s = g.ents.get(r.src); if (s) return [cx(s), cy(s)]; r.step = 1;
  }
  switch (r.k) {
    case 'build': { const gh = g.ghosts.get(r.tgt); return gh ? [gh.x + gh.w / 2, gh.y + gh.h / 2] : null; }
    case 'decon': case 'upgrade': case 'repair': { const e = g.ents.get(r.tgt); return e ? [cx(e), cy(e)] : null; }
    case 'tree': case 'tile': { const x = Math.floor(r.tgt / 131072) - 65536, y = (r.tgt % 131072) - 65536; return [x + 0.5, y + 0.5]; }
    case 'store': { if (r.tgt === -1) return pl; const c = g.ents.get(r.tgt); return c ? [cx(c), cy(c)] : null; }
    case 'home': { if (r.home === -1) return pl; const p = g.ents.get(r.home); return p ? [cx(p), cy(p) - 0.6] : null; }
    case 'deliver': { const id = r.step === 0 ? r.src : r.tgt; if (id === -1) return g.player.dead ? null : pl; const e = g.ents.get(id); return e ? [cx(e), cy(e)] : null; }
  }
  return null;
}
function give(r: Robot, item: string, n: number, stack?: Stack) {
  if (stack?.instance) { r.cargo.push({ item: stack.item, count: 1, instance: { ...stack.instance } }); return; }
  if (n <= 0 || ITEMS[item]?.droneModel) return;
  const s = r.cargo.find(c => c.item === item && !c.instance); if (s) s.count += n; else r.cargo.push({ item, count: n });
}
function dropCargo(g: Game, r: Robot, x: number, y: number) {
  const left: Stack[] = [];
  for (const s of r.cargo) {
    if (s.instance) { if (!g.dropGroundStack(x, y, s)) left.push(s); }
    else g.dropGround(x, y, s.item, s.count);
  }
  r.cargo = left;
  return left.length === 0;
}
/** задача отменилась или выполнена: груз — на склад, иначе домой */
function finish(g: Game, r: Robot) {
  r.step = 0; r.src = -2; r.used = undefined; r.it = undefined; r.n = undefined; tc(g).prom = null;
  if (r.cargo.length) { const t = findStore(g, r, r.cargo[0].item); r.k = 'store'; r.tgt = t ?? -2; } else { r.k = 'home'; r.tgt = -2; }
  tc(g).prom = null; // The new store destination is itself an incoming reservation.
}
/** положить груз робота в сундук / инженеру; вернуть, сколько стопок осталось */
function unload(g: Game, r: Robot, dst: number) {
  for (const s of r.cargo) {
    if (s.instance) {
      if (dst === -1) { if (g.inv.addStack(s)) s.count = 0; }
      else { const c = g.ents.get(dst); if (c && g.insertItemStack(c, s, false, false, undefined, r)) s.count = 0; }
    } else if (dst === -1) s.count = g.inv.add(s.item, s.count);
    else { const c = g.ents.get(dst); if (c) s.count -= g.insertItem(c, s.item, s.count, false); }
  }
  r.cargo = r.cargo.filter(s => s.count > 0);
}
function arrive(g: Game, r: Robot) {
  if ((r.k === 'build' || r.k === 'upgrade' || r.k === 'repair' || r.k === 'tile') && r.step === 0) { r.step = 1; return; }
  switch (r.k) {
    case 'build': {
      const gh = g.ghosts.get(r.tgt); const it = r.cargo[0];
      if (!gh || !it || it.item !== gh.proto) { finish(g, r); return; }
      const p = PROTOS[gh.proto];
      if (p.solid && !g.player.dead) { const px = g.player.x, py = g.player.y, rr = 0.2; if (px + rr > gh.x && px - rr < gh.x + gh.w && py + rr > gh.y && py - rr < gh.y + gh.h) return; } // ждём, пока инженер отойдёт
      if (!g.canPlace(gh.proto, gh.x, gh.y, gh.dir, false).ok) { finish(g, r); return; }
      const recipe = gh.recipe, rb = gh.rb;
      const e = g.build(gh.proto, gh.x, gh.y, gh.dir, false);
      if (!e) { finish(g, r); return; }
      if (recipe) g.applyRecipe(e, recipe);
      it.count--; if (!it.count) r.cargo.shift();
      g.stats.built[gh.proto] = (g.stats.built[gh.proto] || 0) + 1; g.stats.robotBuilt = (g.stats.robotBuilt || 0) + 1; g.snd('build', gh.x + gh.w / 2, gh.y + gh.h / 2);
      tele.robot(g, rb ? 'rebuild' : 'build');
      finish(g, r); return;
    }
    case 'decon': {
      const e = g.ents.get(r.tgt);
      if (e && e.decon && !dismantleBlock(e)) { g.removeEntity(e, false, (it, n, stack) => give(r, it, n, stack)); tele.robot(g, 'decon'); g.snd('pickup', cx(e), cy(e)); }
      finish(g, r); return;
    }
    case 'tile': { // v1.4: покрытие по призраку
      const x = Math.floor(r.tgt / 131072) - 65536, y = (r.tgt % 131072) - 65536; const it = r.cargo[0]; const want = g.tileMarks.get(r.tgt);
      if (it && want === it.item) {
        const f = FLOOR_BY_ITEM[want]; g.tileMarks.delete(r.tgt); g.floorVer++;
        if (f && g.canFloor(x, y, f) && g.floorAt(x, y) !== f) { it.count--; if (!it.count) r.cargo.shift(); g.setFloor(x, y, f, (i2, n2) => give(r, i2, n2)); g.stats.floors = (g.stats.floors || 0) + 1; tele.robot(g, 'tile'); }
      }
      finish(g, r); return;
    }
    case 'tree': {
      const x = Math.floor(r.tgt / 131072) - 65536, y = (r.tgt % 131072) - 65536; const d = g.world.decor(x, y);
      if (d && g.treeMarks.has(r.tgt)) { g.world.removeDecor(x, y); g.treeMarks.delete(r.tgt); g.harvestDecor(d, (it, n) => give(r, it, n)); g.snd('chop', x, y); }
      finish(g, r); return;
    }
    case 'upgrade': {
      const e = g.ents.get(r.tgt); const it = r.cargo[0];
      if (e && it && e.upgrade === it.item && g.replaceTarget(it.item, e.x, e.y, e.dir)) {
        it.count--; if (!it.count) r.cargo.shift();
        g.fastReplace(e, it.item, e.dir, false, (x, n, stack) => give(r, x, n, stack)); tele.robot(g, 'upgrade');
      }
      finish(g, r); return;
    }
    case 'repair': {
      const e = g.ents.get(r.tgt); const max = e ? PROTOS[e.proto].hp : 0;
      if (e && (e.hp ?? max) < max && r.cargo[0]?.item === REPAIR) {
        e.hp = Math.min(max, (e.hp ?? max) + 1); r.used = (r.used || 0) + 1; // 60 прочности в секунду
        if (r.used >= 300) { r.used = 0; r.cargo[0].count--; if (!r.cargo[0].count) r.cargo.shift(); g.cons(REPAIR); }
        if (e.hp < max && r.cargo.length) return; // продолжаем чинить
        tele.robot(g, 'repair');
      }
      if ((r.used || 0) >= 150 && r.cargo[0]?.item === REPAIR) { r.cargo[0].count--; if (!r.cargo[0].count) r.cargo.shift(); g.cons(REPAIR); }
      finish(g, r); return;
    }
    case 'deliver': {
      if (r.step === 0) { // у источника: забрать обещанное (сколько осталось — инженер или манипулятор могли взять раньше)
        const it = r.it!; let k = 0;
        if (ITEMS[it]?.droneModel) {
          const inv = r.src === -1 ? g.inv : g.ents.get(r.src)?.inv;
          if (inv) for (let i = 0; i < inv.size; i++) { const s = inv.slots[i]; if (s?.item !== it || !s.instance) continue; const moved = inv.takeSlot(i); if (moved) { give(r, it, 1, moved); k = 1; } break; }
        } else if (r.src === -1) { k = Math.min(r.n || 0, g.inv.count(it)); if (k) g.inv.remove(it, k); }
        else { const s = g.ents.get(r.src); if (s && s.inv) { k = Math.min(r.n || 0, s.inv.count(it)); if (k) s.inv.remove(it, k); } }
        tc(g).prom = null;
        if (!k) { finish(g, r); return; }
        if (!ITEMS[it]?.droneModel) give(r, it, k); r.step = 1; r.n = k; return;
      }
      const s0 = r.cargo[0]; if (!s0) { finish(g, r); return; }
      if (s0.instance) { if (r.tgt === -1) { if (g.inv.addStack(s0)) s0.count = 0; } else { const c = g.ents.get(r.tgt); if (c && g.insertItemStack(c, s0, false, false, undefined, r)) s0.count = 0; } }
      else if (r.tgt === -1) s0.count = g.inv.add(s0.item, s0.count);
      else { const c = g.ents.get(r.tgt); if (c) s0.count -= g.insertItem(c, s0.item, s0.count, false); }
      r.cargo = r.cargo.filter(x => x.count > 0); tele.robot(g, 'deliver');
      finish(g, r); return;
    }
    case 'store': {
      if (r.tgt === -2) { if ((g.tick + r.id) % 60 === 0) finish(g, r); return; } // некуда сложить — ждём, пока появится место
      unload(g, r, r.tgt);
      if (r.cargo.length) { if (r.home === -1) { if (!dropCargo(g, r, g.player.x, g.player.y)) return; } else { finish(g, r); return; } }
      r.k = 'home'; r.tgt = -2; return;
    }
    case 'home': {
      if (r.home === -1) { const left = g.inv.add(ROBOT, 1); if (left) g.dropGround(g.player.x, g.player.y, ROBOT, 1); dock(g, r); return; }
      if (r.lg && r.cargo.length) { finish(g, r); return; } // логистический с грузом — сначала на склад
      const p = g.ents.get(r.home); if (!p) return;
      if (r.cargo.length) { if (r.cargo[0].item === REPAIR) { const k = Math.min(r.cargo[0].count, repairRoom(p)); if (k) { p.inv!.add(REPAIR, k); r.cargo[0].count -= k; } r.cargo = r.cargo.filter(s => s.count > 0); } if (r.cargo.length) { finish(g, r); return; } }
      const need = robotMaxJ() - r.e;
      if (need > 1 && (p.charge || 0) < need) { r.chg = p.id; return; } // буфер пуст — заряжаемся на месте
      if (robotRoom(p) < 1) { const n = netOfRobot(g, r); const q = n && nearestPort(n, r.x, r.y, o => robotRoom(o) > 0); if (q && q !== p) { r.home = q.id; return; } if (!q) return; }
      p.charge = (p.charge || 0) - Math.max(0, need); p.inv!.add(robotItem(r), 1); dock(g, r); return;
    }
  }
}
function dock(g: Game, r: Robot) { const i = g.robots.indexOf(r); if (i >= 0) g.robots.splice(i, 1); }

/** запуск робота: из робопорта сети или из инвентаря инженера (личный робопорт) */
function launch(g: Game, from: Entity | null, lg = false): Robot {
  const r: Robot = { id: g.nextRobot++, x: from ? cx(from) : g.player.x, y: from ? cy(from) - 0.6 : g.player.y - 0.4, home: from ? from.id : -1, e: robotMaxJ(), k: 'home', tgt: -2, step: 0, src: -2, cargo: [], chg: -1 };
  if (lg) r.lg = 1;
  if (g.peers.length) r.pl = g.pl; // v1.12: чей инженер для этого робота «−1» (личный робопорт, взять у инженера / отдать ему)
  if (from) from.inv!.remove(lg ? LROBOT : ROBOT, 1); else g.inv.remove(ROBOT, 1);
  if (from) { const c = tc(g); c.robots.clear(); c.lrobots.clear(); }
  g.robots.push(r); return r;
}
/** свободный робот сети, ближайший к точке: возвращающийся домой (с запасом заряда) или в робопорту */
function pickRobot(g: Game, n: RoboNet, x: number, y: number, pathTiles: number, lg = false): Robot | Entity | null {
  let best: Robot | Entity | null = null, bd = Infinity; const pt = perTile(g), max = robotMaxJ();
  for (const r of idleOf(g, n, lg)) {
    if (!isIdle(r)) continue;
    const d = dist(r.x, r.y, x, y); if (r.e - (d + pathTiles) * pt < 0.2 * max) continue;
    if (d < bd) { bd = d; best = r; }
  }
  const it = lg ? LROBOT : ROBOT;
  if (netRobots(g, n, lg) > 0) { const p = nearestPort(n, x, y, q => q.inv!.count(it) > 0); if (p) { const d = dist(cx(p), cy(p), x, y); if (d < bd) { bd = d; best = p; } } }
  return best;
}
function personalRobot(g: Game): Robot | 'inv' | null {
  const d = personal(g); if (!d) return null;
  let flying = 0, best: Robot | null = null, bd = Infinity;
  for (const r of g.robots) if (r.home === -1 && !r.lg && (r.pl || 0) === g.pl) { flying++; if (r.k === 'home' && !r.cargo.length && r.e > 0.3 * robotMaxJ()) { const dd = dist(r.x, r.y, g.player.x, g.player.y); if (dd < bd) { bd = dd; best = r; } } }
  if (best) return best;
  return flying < d.robots && g.inv.count(ROBOT) > 0 ? 'inv' : null;
}
function setSt(g: Game, gh: Ghost, st: Ghost['st']) { if (gh.st !== st) { gh.st = st; g.ghostVer++; } }

interface Cand { k: 'build' | 'decon' | 'tree' | 'tile' | 'upgrade' | 'repair'; id: number; x: number; y: number; item: string | null; gh?: Ghost; }
/** попытка назначить задачу: сеть, затем личный робопорт. Возвращает причину неудачи */
function tryAssign(g: Game, c: Cand): 'ok' | 'out' | 'noitem' | 'norobot' {
  const n = netAt(g, c.x, c.y); let pers = inPersonal(g, c.x, c.y);
  // v1.12: в кооперативе — личный робопорт любого игрока, в зоне которого задача (по номеру игрока)
  if (!pers && g.peers.length) for (let i = 1; i < g.peers.length; i++) { g.usePl(i); const k = inPersonal(g, c.x, c.y); g.usePl(0); if (k) { pers = true; break; } }
  if (!n && !pers) return 'out';
  let why: 'noitem' | 'norobot' = 'norobot';
  if (n) {
    const free = netRobots(g, n) > 0 || idleOf(g, n).some(isIdle);
    const src = c.item && free ? findSource(g, n, c.item, c.x, c.y) : null;
    if (c.item && !free && !hasItem(g, n, c.item)) why = 'noitem';
    else if (!free) why = 'norobot';
    else if (c.item && !src) why = 'noitem';
    else {
      const sx = src ? src.x : c.x, sy = src ? src.y : c.y;
      const back = nearestPort(n, c.x, c.y); const path = dist(sx, sy, c.x, c.y) + (back ? dist(c.x, c.y, cx(back), cy(back)) : 0);
      const who = pickRobot(g, n, sx, sy, path);
      if (who) { start(g, 'id' in who && 'k' in who ? who as Robot : launch(g, who as Entity), c, src, n); return 'ok'; }
    }
  }
  if (pers) {
    let res: 'ok' | 'noitem' | 'norobot' = 'noitem';
    for (let i = 0; i < g.nPlayers; i++) {
      g.usePl(i); if (!inPersonal(g, c.x, c.y)) continue;
      const has = !c.item || g.inv.count(c.item) > 0;
      if (!has) continue;
      const who = personalRobot(g);
      if (who) { start(g, who === 'inv' ? launch(g, null) : who, c, c.item ? { id: -1, x: g.player.x, y: g.player.y } : null, null); res = 'ok'; break; }
      res = 'norobot';
    }
    g.usePl(0);
    if (res === 'noitem') return n && why === 'norobot' ? 'norobot' : 'noitem';
    return res;
  }
  return why;
}
function start(g: Game, r: Robot, c: Cand, src: { id: number; x?: number; y?: number } | null, n: RoboNet | null) {
  if (g.peers.length) r.pl = g.pl;
  r.k = c.k; r.tgt = c.id; r.step = src ? 0 : 1; r.src = src ? src.id : -2; r.used = undefined;
  if (c.item && src) { // предмет забирается из источника сразу (резерв), робот летит за ним «забрать»
    if (src.id === -1) g.inv.remove(c.item, 1);
    else { const s = g.ents.get(src.id)!; s.inv!.remove(c.item, 1); }
    give(r, c.item, 1);
    if (n) { const m = netItems(g, n); if (src.id !== -1 && m.has(c.item)) m.set(c.item, m.get(c.item)! - 1); }
  }
  if (n) tc(g).robots.delete(n);
  if (c.gh) setSt(g, c.gh, 'wait');
}

const MAX_ASSIGN = 50, MAX_CHECKS = 800;
const KI: Record<string, number> = { build: 0, decon: 1, tree: 2, upgrade: 3, repair: 4, tile: 5 };
let lastMs = 0;
/** время подсистемы роботов в последнем тике, мс (для F3; на симуляцию не влияет) */
export const robotsMs = () => lastMs;

export function stepRobots(g: Game) {
  const I = roboIndex(g); let pers = personal(g);
  if (!pers && g.peers.length) for (let i = 1; i < g.peers.length && !pers; i++) { g.usePl(i); pers = personal(g); g.usePl(0); }
  if (!I.nets.length && !g.robots.length && !pers) return;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // 1. буферы робопортов пополняются из электросети (запрос — в stepPower)
  for (const n of I.nets) for (const p of n.ports) { const B = PROTOS[p.proto].buffer!; p.charge = Math.min(B.MJ * 1e6, (p.charge || 0) + (p._rq || 0) * 1000 / 60 * g.sat(p)); p.status = g.sat(p) > 0 ? 'working' : 'no-power'; }
  // 2. полёт
  const sp0 = robotSpeed(g), lsp = robotSpeed(g, true), max = robotMaxJ(), D = RD();
  const charging = new Map<number, number>();
  const mp = g.peers.length > 0;
  for (const r of [...g.robots]) {
    if (mp) g.usePl(r.pl || 0); // «инженер» для этого робота — его игрок
    // разряжается — к ближайшему робопорту сети по пути (личные — к инженеру)
    if (r.chg < 0 && r.e < 0.2 * max && r.home !== -1 && r.k !== 'home') { const n = netOfRobot(g, r); const p = n && nearestPort(n, r.x, r.y); if (p) r.chg = p.id; }
    if (r.home === -1 && r.e < 0.2 * max && r.k !== 'home' && r.k !== 'store') { // личный: возвращает предмет и летит к инженеру
      r.k = r.cargo.length ? 'store' : 'home'; r.tgt = -1; r.step = 0;
    }
    if (r.k === 'home' && r.home !== -1 && !g.ents.has(r.home)) { if (!netOfRobot(g, r)) { // робопортов не осталось — робот садится на землю
      g.dropGround(r.x, r.y, robotItem(r), 1); if (!dropCargo(g, r, r.x, r.y)) continue; dock(g, r); continue; } }
    const tp = targetPos(g, r);
    if (!tp) { if (r.k !== 'home' && r.k !== 'store') finish(g, r); else if (r.k === 'store' && r.tgt !== -2) finish(g, r); continue; }
    const sp = r.lg ? lsp : sp0; const v = r.e > 0 ? sp : sp * 0.2; // без заряда — 20% скорости, но не зависает
    const dx = tp[0] - r.x, dy = tp[1] - r.y, d = Math.hypot(dx, dy);
    if (d > v) { r.x += dx / d * v; r.y += dy / d * v; r.e = Math.max(0, r.e - D.flyKW * 1000 / 60 - D.tileKJ * 1000 * v); continue; }
    r.x = tp[0]; r.y = tp[1];
    if (r.chg >= 0) { // зарядка: первые `spots` роботов у робопорта (в порядке массива)
      const p = g.ents.get(r.chg)!; const R = PROTOS[p.proto].robo!; const k = charging.get(p.id) || 0;
      if (k < R.spots) { charging.set(p.id, k + 1); const q = Math.min(R.spotKW * 1000 / 60, max - r.e, p.charge || 0); r.e += q; p.charge = (p.charge || 0) - q; }
      if (r.e >= max - 1) { r.e = max; r.chg = -1; }
      continue;
    }
    if (r.home === -1 && r.k !== 'store' && r.k !== 'home') r.e = Math.min(max, r.e + (pers ? pers.chargeKW * 1000 / 60 : 0) * 0); // личный: заряжается только дома
    arrive(g, r);
  }
  if (mp) g.usePl(0);
  // 3. новые задачи: не больше 50 за тик; каждый объект проверяется раз в 8 тиков (по id), приоритетные — каждый тик
  let assigned = 0, checks = 0;
  const taken = new Set<number>(); for (const r of g.robots) if (r.k !== 'home' && r.k !== 'store' && r.k !== 'deliver') taken.add(r.tgt * 8 + KI[r.k]);
  const probe = (c: Cand) => {
    const key = c.id * 8 + KI[c.k]; if (taken.has(key)) { if (c.gh) setSt(g, c.gh, 'wait'); return; }
    checks++; const res = tryAssign(g, c);
    if (res === 'ok') { assigned++; taken.add(key); return; }
    if (c.gh) setSt(g, c.gh, res);
  };
  g.robotPrio = g.robotPrio.filter(id => g.ghosts.has(id));
  for (const id of g.robotPrio) { if (assigned >= MAX_ASSIGN) break; const gh = g.ghosts.get(id)!; probe({ k: 'build', id, x: gh.x + gh.w / 2, y: gh.y + gh.h / 2, item: gh.proto, gh }); }
  if (g.ghosts.size) for (const gh of g.ghosts.values()) {
    if (assigned >= MAX_ASSIGN || checks >= MAX_CHECKS) break;
    if ((gh.id + g.tick) % 8) continue;
    probe({ k: 'build', id: gh.id, x: gh.x + gh.w / 2, y: gh.y + gh.h / 2, item: gh.proto, gh });
  }
  if (g.marked.size && assigned < MAX_ASSIGN) {
    const list: Entity[] = []; for (const id of g.marked) if ((id + g.tick) % 8 === 0) { const e = g.ents.get(id); if (e) list.push(e); }
    list.sort((a, b) => a.id - b.id);
    for (const e of list) { if (assigned >= MAX_ASSIGN || checks >= MAX_CHECKS) break; if (e.decon && !dismantleBlock(e)) probe({ k: 'decon', id: e.id, x: cx(e), y: cy(e), item: null }); else if (e.upgrade && g.replaceTarget(e.upgrade, e.x, e.y, e.dir)) probe({ k: 'upgrade', id: e.id, x: cx(e), y: cy(e), item: e.upgrade }); }
  }
  if (g.treeMarks.size && assigned < MAX_ASSIGN) {
    const list: number[] = []; for (const k of g.treeMarks) if ((k + g.tick) % 8 === 0) list.push(k); list.sort((a, b) => a - b);
    for (const k of list) { if (assigned >= MAX_ASSIGN || checks >= MAX_CHECKS) break; const x = Math.floor(k / 131072) - 65536, y = (k % 131072) - 65536; probe({ k: 'tree', id: k, x: x + 0.5, y: y + 0.5, item: null }); }
  }
  if (g.tileMarks.size && assigned < MAX_ASSIGN) { // v1.4: призраки покрытий — после построек и сноса
    const list: number[] = []; for (const k of g.tileMarks.keys()) if ((k + g.tick) % 8 === 0) list.push(k); list.sort((a, b) => a - b);
    for (const k of list) { if (assigned >= MAX_ASSIGN || checks >= MAX_CHECKS) break; const x = Math.floor(k / 131072) - 65536, y = (k % 131072) - 65536; probe({ k: 'tile', id: k, x: x + 0.5, y: y + 0.5, item: g.tileMarks.get(k)! }); }
  }
  if (g.tick % 60 === 0 && assigned < MAX_ASSIGN) {
    const list: Entity[] = []; for (const e of g.ents.values()) if (e.hp != null && e.t !== 'nest' && e.hp < PROTOS[e.proto].hp) list.push(e);
    list.sort((a, b) => a.id - b.id);
    for (const e of list) { if (assigned >= MAX_ASSIGN) break; probe({ k: 'repair', id: e.id, x: cx(e), y: cy(e), item: REPAIR }); }
  }
  // 4. логистика (v1.3)
  if (I.nets.length) stepLogistics(g, I);
  lastMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
}

// ---------- логистика (v1.3) ----------
export interface LReq { item: string; n: number; }
/** личный запрос инженера: держать не меньше min; больше max (null — без предела) — вывозить в хранение */
export interface PReq { item: string; min: number; max: number | null; }
const MAX_LOGI = 50;
/** запросы сундука (запрос / буфер): массив из 12 ячеек */
export const REQ_SLOTS = 12;
const personalOn = (g: Game) => g.research.done.has('personal-logistics') && !g.preqOff && !g.player.dead && g.preq.length > 0;
function startDeliver(g: Game, who: Robot | Entity, n: RoboNet, src: number, tgt: number, it: string, k: number) {
  const P = prom(g); // Capture promises before the new robot becomes a delivery.
  const r = 'k' in who ? who as Robot : launch(g, who as Entity, true);
  if (g.peers.length) r.pl = g.pl;
  r.k = 'deliver'; r.src = src; r.tgt = tgt; r.step = 0; r.it = it; r.n = k; r.used = undefined;
  addP(P.out, src, it, k); addP(P.inc, tgt, it, k); P.shadows.delete(tgt);
  void n;
}
/** источник для запроса по приоритету: активное снабжение → буфер (если можно) → пассивное снабжение / хранение; внутри — ближайший */
function logiSource(g: Game, n: RoboNet, item: string, x: number, y: number, self: number, useBuf: boolean): { e: Entity; avail: number } | null {
  const P = prom(g); let best: Entity | null = null, bt = 9, bd = Infinity, ba = 0;
  for (const c of n.chests) {
    if (c.id === self) continue; const t = TIER[logi(c)!]; if (t === 1 && !useBuf) continue; if (t > bt) continue;
    const a = c.inv!.count(item) - (P.out.get(c.id)?.get(item) || 0); if (a < 1) continue;
    const d = dist(cx(c), cy(c), x, y); if (t < bt || d < bd) { bt = t; bd = d; best = c; ba = a; }
  }
  return best ? { e: best, avail: ba } : null;
}
/** обойти запросы сети по кругу (до 50 ячеек за тик), затем активное снабжение и мусор инженера */
function stepLogistics(g: Game, I: RoboIndex) {
  const cap = robotCargo(g); const P = prom(g);
  // 1. запросы: сундуки запроса и буферы всех сетей по id, инженер — id 0 (первым)
  const reqs: Entity[] = []; for (const n of I.nets) for (const c of n.req) reqs.push(c); reqs.sort((a, b) => a.id - b.id);
  const pnet = personalOn(g) ? netAt(g, g.player.x, g.player.y) : null;
  const order: number[] = []; if (pnet) order.push(0); for (const c of reqs) order.push(c.id);
  if (order.length) {
    let i0 = order.findIndex(id => id > g.lrr); if (i0 < 0) i0 = 0;
    // курсор — последний обслуженный (или проверенный, если исчерпан лимит): следующий тик начинает со следующего
    let checks = 0, last = -1;
    const assign = (who: Robot | Entity, n: RoboNet, src: number, tgt: number, it: string, k: number) => { startDeliver(g, who, n, src, tgt, it, k); last = tgt === -1 ? 0 : tgt; };
    for (let j = 0; j < order.length && checks < MAX_LOGI; j++) {
      const id = order[(i0 + j) % order.length]; if (checks >= MAX_LOGI - 1) last = id;
      if (id === 0) { // личные запросы: держать не меньше min
        for (let i = 0; i < g.preq.length && checks < MAX_LOGI; i++) {
          const q = g.preq[i]; if (!q || q.min <= 0) continue;
          const need = q.min - g.inv.count(q.item) - (P.inc.get(-1)?.get(q.item) || 0); if (need <= 0) continue;
          checks++; const room = reservationRoom(g, -1, q.item); if (room < 1) continue;
          const src = logiSource(g, pnet!, q.item, g.player.x, g.player.y, -1, true); if (!src) continue;
          const who = pickRobot(g, pnet!, cx(src.e), cy(src.e), dist(cx(src.e), cy(src.e), g.player.x, g.player.y), true); if (!who) continue;
          assign(who, pnet!, src.e.id, -1, q.item, Math.min(cap, need, src.avail, room, ITEMS[q.item]?.droneModel ? 1 : cap));
        }
        continue;
      }
      const c = g.ents.get(id)!; const n = I.chestNet.get(id)!; const R = c.req; if (!R) continue;
      const isBuf = logi(c) === 'buffer'; let st: Entity['lst'] = undefined;
      if (!c.lw) c.lw = new Array(REQ_SLOTS).fill(0);
      for (let i = 0; i < R.length; i++) {
        const q = R[i]; if (!q) { c.lw[i] = 0; continue; }
        const need = q.n - c.inv!.count(q.item) - (P.inc.get(c.id)?.get(q.item) || 0);
        if (need <= 0) { c.lw[i] = 0; continue; }
        if (!c.lw[i]) c.lw[i] = g.tick || 1;
        if (checks >= MAX_LOGI) continue; checks++;
        const room = reservationRoom(g, c.id, q.item); if (room < 1) continue;
        const src = logiSource(g, n, q.item, cx(c), cy(c), c.id, !isBuf && !!c.rbuf);
        if (!src) { st = 'noitem'; continue; }
        const who = pickRobot(g, n, cx(src.e), cy(src.e), dist(cx(src.e), cy(src.e), cx(c), cy(c)), true);
        if (!who) { st = st || 'norobot'; continue; }
        assign(who, n, src.e.id, c.id, q.item, Math.min(cap, need, src.avail, room, ITEMS[q.item]?.droneModel ? 1 : cap));
      }
      if (c.lst !== st) { c.lst = st; g.fxVer++; }
    }
    if (last >= 0) g.lrr = last;
  }
  // 2. активное снабжение — всё в хранение (каждый сундук раз в 8 тиков)
  let jobs = 0;
  for (const n of I.nets) for (const c of n.act) {
    if ((c.id + g.tick) % 8 || jobs >= MAX_LOGI) continue;
    const seen = new Set<string>();
    for (const sl of c.inv!.slots) {
      if (!sl || seen.has(sl.item)) continue; seen.add(sl.item);
      const a = c.inv!.count(sl.item) - (P.out.get(c.id)?.get(sl.item) || 0); if (a < 1) continue;
      const d = storeDest(g, n, sl.item, cx(c), cy(c)); if (!d) continue;
      const who = pickRobot(g, n, cx(c), cy(c), dist(cx(c), cy(c), cx(d), cy(d)), true); if (!who) break;
      startDeliver(g, who, n, c.id, d.id, sl.item, Math.min(cap, a, reservationRoom(g, d.id, sl.item), ITEMS[sl.item]?.droneModel ? 1 : cap)); jobs++; break;
    }
  }
  // 3. мусор инженера: всё сверх max — в хранение
  if (pnet && g.tick % 8 === 0) for (const q of g.preq) {
    if (!q || q.max == null || jobs >= MAX_LOGI) continue;
    const a = g.inv.count(q.item) - q.max - (P.out.get(-1)?.get(q.item) || 0); if (a < 1) continue;
    const d = storeDest(g, pnet, q.item, g.player.x, g.player.y); if (!d) continue;
    const who = pickRobot(g, pnet, g.player.x, g.player.y, dist(g.player.x, g.player.y, cx(d), cy(d)), true); if (!who) continue;
    startDeliver(g, who, pnet, -1, d.id, q.item, Math.min(cap, a, reservationRoom(g, d.id, q.item), ITEMS[q.item]?.droneModel ? 1 : cap)); jobs++;
  }
}

/** сводка по сетям для окна робопорта и F3 (не влияет на симуляцию) */
export interface NetSummary { id: number; ports: number[]; idle: number; working: number; charging: number; repair: number; tasks: Record<string, number>; missing: [string, number][]; noRobot: number; out: number;
  /** v1.3: логистические роботы (в портах / в полёте), содержимое сети (логистические сундуки), ждущие запросы, нехватка, число сундуков */
  lidle: number; lwork: number; contents: [string, number][]; waits: { id: number; item: string; need: number; since: number }[]; lmissing: [string, number][]; chests: number; }
export function roboSummary(g: Game): NetSummary[] {
  const I = roboIndex(g); const out: NetSummary[] = [];
  for (const n of I.nets) {
    const s: NetSummary = { id: n.id, ports: n.ports.map(p => p.id), idle: 0, working: 0, charging: 0, repair: 0, tasks: {}, missing: [], noRobot: 0, out: 0, lidle: 0, lwork: 0, contents: [], waits: [], lmissing: [], chests: n.all.length };
    for (const p of n.ports) { s.idle += p.inv!.count(ROBOT); s.lidle += p.inv!.count(LROBOT); s.repair += p.inv!.count(REPAIR); }
    for (const r of g.robots) if (r.home !== -1 && I.netOf.get(r.home) === n) { if (r.lg) { s.lwork++; if (r.k === 'deliver') s.tasks.deliver = (s.tasks.deliver || 0) + 1; continue; } if (r.chg >= 0) s.charging++; else s.working++; if (r.k !== 'home' && r.k !== 'store') s.tasks[r.k] = (s.tasks[r.k] || 0) + 1; }
    const m = new Map<string, number>(); for (const c of n.chests) for (const x of c.inv!.slots) if (x) m.set(x.item, (m.get(x.item) || 0) + x.count);
    s.contents = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 80);
    const lm = new Map<string, number>();
    for (const c of n.req) if (c.req && c.lw) c.req.forEach((q, i) => { if (!q || !c.lw![i]) return; const need = q.n - c.inv!.count(q.item); if (need <= 0) return; s.waits.push({ id: c.id, item: q.item, need, since: c.lw![i] }); if (c.lst === 'noitem' && !m.get(q.item)) lm.set(q.item, (lm.get(q.item) || 0) + need); });
    s.waits.sort((a, b) => a.since - b.since || a.id - b.id); s.waits = s.waits.slice(0, 10);
    s.lmissing = [...lm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    out.push(s);
  }
  const miss = new Map<RoboNet | null, Map<string, number>>();
  for (const gh of g.ghosts.values()) {
    if (gh.st !== 'noitem' && gh.st !== 'norobot') continue;
    const n = netAt(g, gh.x + gh.w / 2, gh.y + gh.h / 2); const s = out.find(o => n && o.id === n.id); if (!s) continue;
    if (gh.st === 'norobot') s.noRobot++; else { let m = miss.get(n); if (!m) miss.set(n, m = new Map()); m.set(gh.proto, (m.get(gh.proto) || 0) + 1); }
  }
  for (const s of out) { const n = I.nets.find(x => x.id === s.id)!; const m = miss.get(n); if (m) s.missing = [...m.entries()].sort((a, b) => b[1] - a[1]); }
  return out;
}
/** роботы для рендера: x, y, предмет груза (индекс), флаги (1 личный, 2 заряжается, 4 мало заряда, 8 логистический) */
export const ROBOT_STRIDE = 4;
export function robotBuffer(g: Game, idx: Record<string, number>): Float32Array {
  const a = new Float32Array(g.robots.length * ROBOT_STRIDE); const max = robotMaxJ(); let i = 0;
  for (const r of g.robots) { a[i++] = r.x; a[i++] = r.y; a[i++] = r.cargo.length ? idx[r.cargo[0].item] ?? -1 : -1; a[i++] = (r.home === -1 ? 1 : 0) | (r.chg >= 0 ? 2 : 0) | (r.e < 0.2 * max ? 4 : 0) | (r.lg ? 8 : 0); }
  return a;
}
export const treeKey = (x: number, y: number) => tkey(x, y);
/** для рендера и окон: из снимка Worker (зеркало) или посчитать на месте (nets — только если нужны) */
export function robotView(g: Game, idx: Record<string, number>, nets = false): { buf: Float32Array; nets: NetSummary[]; ms: number } {
  if (g.rview) return g.rview;
  return { buf: robotBuffer(g, idx), nets: nets && (g.robots.length || [...g.ents.values()].some(e => e.t === 'roboport')) ? roboSummary(g) : [], ms: lastMs };
}
