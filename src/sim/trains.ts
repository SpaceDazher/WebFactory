// v1.7 «Железная дорога I»: граф путей, поезда (одномерное движение по рёбрам в целых числах), станции, расписания,
// ручное управление, поиск пути A*, планировщик «тянуть путь».
// Ребро — проход рельса в одну сторону: eid = id рельса · 2 + d (d = 0 — от якоря, 1 — к якорю).
// Узел пути — (x, y, направление движения): ключ nk(). Позиция поезда — ребро головы trail[0] и пройденное по нему
// расстояние pos (единицы, 1 клетка = 1000); хвост — следующие рёбра trail[1..]. Скорость — в 1/1000 единицы за тик.
import type { Game, Entity } from './game';
import { shapeOf, U, UX, UY, pointOn, isRailProto, RailShape, SHAPES, rot8 } from './railgeo';
import { tkey } from '../core/types';
import { ITEMS } from '../data/items';
import { Inventory } from './inventory';
import { hurtPl, hitUnit } from './enemies';
import { condOk, sigValue } from './circuits';
import type { Cond as CCond, CondOp } from './circuits';

export const CAR_LEN: Record<string, number> = { locomotive: 7000, 'cargo-wagon': 6000, 'fluid-wagon': 6000 };
export const CAR_GAP = 500;
export const CAR_MASS: Record<string, number> = { locomotive: 2000, 'cargo-wagon': 1000, 'fluid-wagon': 1000 };
/** v1.8: вместимость вагона-цистерны */
export const FWAGON_CAP = 25000;
/** 72 клетки/с = 1,2 клетки/тик в 1/1000 единицы */
export const VMAX = 1_200_000;
export const LOCO_KW = 600;
const ACC_K = 6667, DEC0 = 4000, FRICTION = 3000;
export const WAGON_SLOTS = 40;
/** условия ожидания: вагоны полны / пусты, время, бездействие; v1.8: содержимое (предмет или жидкость) и сигнал станции */
export type Cond = 'full' | 'empty' | 'time' | 'idle' | 'item' | 'circuit';
export const CONDS: Cond[] = ['full', 'empty', 'time', 'idle', 'item', 'circuit'];
export interface WCond { c: Cond; n: number; /** item: предмет/жидкость и сравнение */ it?: string | null; op?: CondOp; /** circuit: условие по сети станции */ cs?: CCond | null; }
/** запись расписания: станция и условия; первое — в самой записи, остальные — в x (j: 0 — «и», 1 — «или»; «и» связывает сильнее) */
export interface SchedRec extends WCond { st: string; x?: (WCond & { j: 0 | 1 })[]; }
/** v1.8: signal — ждёт светофор, full — станция назначения выключена или лимит поездов исчерпан */
export type TState = 'manual' | 'go' | 'wait' | 'nopath' | 'nofuel' | 'blocked' | 'nosched' | 'busy' | 'signal' | 'full';
export interface Train {
  id: number; cars: number[]; trail: number[]; pos: number; v: number; fr: number;
  manual: boolean; sched: SchedRec[]; si: number; st: TState;
  /** рёбра впереди до цели (после trail[0]); цель — id станции; осталось единиц до остановки */
  path: number[] | null; tgt: number | null; rem: number;
  /** тиков на станции, тиков без изменения груза, подпись груза, когда снова искать путь */
  wt: number; idle: number; sig: number; retry: number;
  /** ручное управление: игрок за рулём, газ (−1, 0, 1) и стрелка на развилке (−1 влево, 0 прямо, 1 вправо) — от команды ввода */
  drv: number; thr: number; steer: number;
  name: string; laps?: number; /** версия путей, по которой построен маршрут */ pv?: number;
  /** v1.8: зарезервированные блоки (ещё не въехал); светофор, у которого стоит */ res?: number[]; sw?: number;
}
// ---------- рёбра и граф ----------
export const nk = (x: number, y: number, h: number) => tkey(x, y) * 8 + h;
interface RInfo { e: Entity; s: RailShape; ax: number; ay: number; }
export class RailGraph {
  ver = -1; sv = -1; out = new Map<number, number[]>(); info = new Map<number, RInfo>(); stops = new Map<string, Entity[]>(); stopVer = -1;
  /** v1.8: узлы путей (ключи nk с направлением), светофоры по узлу, блок рельса (id наименьшего рельса блока), пересекающиеся рельсы,
   *  блоки с развилками/пересечениями, блок за светофором; занятость блоков поездами (пересчитывается каждый тик) */
  nodes = new Set<number>(); sig = new Map<number, Entity>(); blk = new Map<number, number>(); conf = new Map<number, number[]>();
  jblk = new Set<number>(); sigB = new Map<number, number>(); bocc = new Map<number, number>(); nblk = 0;
}
/** v1.8: клетка светофора относительно узла по направлению хода h (справа от пути, перед узлом) */
export const SIG_OX = [1, 0, -1, -2, -2, -1, 0, 1], SIG_OY = [0, 1, 1, 0, -1, -2, -2, -1];
export function sigNode(e: { x: number; y: number; dir: number }): [number, number, number] { const h = e.dir & 7; return [e.x - SIG_OX[h], e.y - SIG_OY[h], h]; }
export const isChain = (e: Entity | undefined) => !!e && e.proto === 'rail-chain-signal';
const oppKey = (k: number) => { const h = k % 8; return k - h + (h + 4) % 8; };
/** «ядро» рельса — клетки оси без концов (для пересечений и развилок) */
const coreCache = new Map<string, [number, number][]>();
function coreOf(s: RailShape): [number, number][] {
  const ck = s.proto + s.v; let r = coreCache.get(ck); if (r) return r;
  const set = new Set<string>(); r = [];
  for (let d = 600; d <= s.len - 600; d += 200) { const p = pointOn(s, d); const nx = -Math.sin(p[2]) * .45, ny = Math.cos(p[2]) * .45;
    for (const q of [[p[0] + nx, p[1] + ny], [p[0] - nx, p[1] - ny]]) { const cx = Math.floor(q[0]), cy = Math.floor(q[1]), k = cx + ',' + cy; if (!set.has(k)) { set.add(k); r.push([cx, cy]); } } }
  coreCache.set(ck, r); return r;
}
/** v1.8: узлы куска рельса (для светофора у призрака рельса) */
export function railNodesOf(proto: string, x: number, y: number, dir: number): number[] {
  const s = shapeOf(proto, dir), ax = x + s.ox, ay = y + s.oy, bx = ax + s.b[0], by = ay + s.b[1];
  return [nk(ax, ay, s.h0), nk(bx, by, s.h1), nk(bx, by, (s.h1 + 4) % 8), nk(ax, ay, (s.h0 + 4) % 8)];
}
export function graph(g: Game): RailGraph {
  const G = g.rg;
  if (G.ver !== g.railVer) {
    G.ver = g.railVer; G.out.clear(); G.info.clear(); G.nodes.clear();
    for (const e of g.ents.values()) if (e.t === 'rail') {
      const s = shapeOf(e.proto, e.dir), ax = e.x + s.ox, ay = e.y + s.oy; G.info.set(e.id, { e, s, ax, ay });
      for (let d = 0; d < 2; d++) { const k = startKey(G, e.id * 2 + d); let a = G.out.get(k); if (!a) G.out.set(k, a = []); a.push(e.id * 2 + d); G.nodes.add(k); G.nodes.add(endKey(G, e.id * 2 + d)); }
    }
    G.stopVer = -1; G.sv = -1;
  }
  if (G.sv !== g.sigVer) { G.sv = g.sigVer; buildBlocks(g, G); }
  if (G.stopVer !== g.stopVer) {
    G.stopVer = g.stopVer; G.stops.clear();
    for (const e of g.ents.values()) if (e.t === 'stop') { const n = e.sname || ''; let a = G.stops.get(n); if (!a) G.stops.set(n, a = []); a.push(e); }
  }
  return G;
}
/** v1.8: блоки — рельсы, связанные узлами без светофора, плюс пересекающиеся (общие клетки ядра или общий узел с другой осью) */
function buildBlocks(g: Game, G: RailGraph) {
  G.sig.clear(); G.blk.clear(); G.conf.clear(); G.jblk.clear(); G.sigB.clear();
  const cut = new Set<number>();
  for (const e of g.ents.values()) if (e.t === 'signal') { const [x, y, h] = sigNode(e); const k = nk(x, y, h); if (G.nodes.has(k)) { G.sig.set(k, e); cut.add(tkey(x, y) * 4 + (h & 3)); } else e.ss = 3; }
  const par = new Map<number, number>(); const find = (a: number): number => { let r = a; while (par.get(r) !== r) r = par.get(r)!; while (par.get(a) !== r) { const n = par.get(a)!; par.set(a, r); a = n; } return r; };
  const uni = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) { if (ra < rb) par.set(rb, ra); else par.set(ra, rb); } };
  for (const id of G.info.keys()) par.set(id, id);
  const cross = new Set<number>();
  // узлы: продолжения без светофора; разные оси в одной точке — пересечение
  const atPos = new Map<number, [number, number][]>();
  for (const [id, r] of G.info) {
    for (let d = 0; d < 2; d++) { const eid = id * 2 + d; const k = endKey(G, eid); const pos = Math.floor(k / 8), h = k % 8;
      if (!cut.has(pos * 4 + (h & 3))) for (const nx of G.out.get(k) || []) uni(id, nx >> 1);
      let a = atPos.get(pos); if (!a) atPos.set(pos, a = []); a.push([id, h & 3]); }
    void r;
  }
  for (const a of atPos.values()) for (let i = 1; i < a.length; i++) for (let j = 0; j < i; j++) if (a[i][1] !== a[j][1] && a[i][0] !== a[j][0]) { uni(a[i][0], a[j][0]); cross.add(a[i][0]); cross.add(a[j][0]); }
  // общие клетки ядра: пересечения и развилки (рельсы одного узла — тоже, но это и так одна стрелка)
  const cell = new Map<number, number[]>();
  for (const [id, r] of G.info) for (const [cx, cy] of coreOf(r.s)) { const k = tkey(r.ax + cx, r.ay + cy); const a = cell.get(k); if (a) { for (const o of a) if (o !== id) { const c1 = G.conf.get(id) || []; if (!c1.includes(o)) { c1.push(o); G.conf.set(id, c1); const c2 = G.conf.get(o) || []; c2.push(id); G.conf.set(o, c2); } } a.push(id); } else cell.set(k, [id]); }
  for (const [id, cs] of G.conf) for (const o of cs) { uni(id, o); if (!sharesNode(G, id, o)) { cross.add(id); cross.add(o); } }
  const roots = new Set<number>();
  for (const id of G.info.keys()) { const b = find(id); G.blk.set(id, b); roots.add(b); }
  G.nblk = roots.size;
  for (const id of cross) G.jblk.add(G.blk.get(id)!);
  for (const [k, a] of G.out) if (a.length >= 2) G.jblk.add(G.blk.get(a[0] >> 1)!);
  for (const [k, e] of G.sig) { const a = G.out.get(k); if (a && a.length) G.sigB.set(e.id, G.blk.get(a[0] >> 1)!); }
}
function sharesNode(G: RailGraph, a: number, b: number) {
  const ka = [startKey(G, a * 2), endKey(G, a * 2)].map(k => Math.floor(k / 8)), kb = [startKey(G, b * 2), endKey(G, b * 2)].map(k => Math.floor(k / 8));
  return ka.some(x => kb.includes(x));
}
const inf = (G: RailGraph, eid: number) => G.info.get(eid >> 1);
export const eLen = (G: RailGraph, eid: number) => { const r = inf(G, eid); return r ? r.s.len : 0; };
export function startKey(G: RailGraph, eid: number) { const r = inf(G, eid)!; return (eid & 1) === 0 ? nk(r.ax, r.ay, r.s.h0) : nk(r.ax + r.s.b[0], r.ay + r.s.b[1], (r.s.h1 + 4) % 8); }
export function endKey(G: RailGraph, eid: number) { const r = inf(G, eid)!; return (eid & 1) === 0 ? nk(r.ax + r.s.b[0], r.ay + r.s.b[1], r.s.h1) : nk(r.ax, r.ay, (r.s.h0 + 4) % 8); }
export function endNode(G: RailGraph, eid: number): [number, number, number] { const r = inf(G, eid)!; return (eid & 1) === 0 ? [r.ax + r.s.b[0], r.ay + r.s.b[1], r.s.h1] : [r.ax, r.ay, (r.s.h0 + 4) % 8]; }
/** точка на ребре в d единицах от его начала: [x, y, угол] */
export function edgePoint(G: RailGraph, eid: number, d: number): [number, number, number] {
  const r = inf(G, eid); if (!r) return [0, 0, 0];
  if ((eid & 1) === 0) { const p = pointOn(r.s, d); return [r.ax + p[0], r.ay + p[1], p[2]]; }
  const p = pointOn(r.s, r.s.len - d); return [r.ax + p[0], r.ay + p[1], p[2] + Math.PI];
}
/** поворот ребра: 0 — прямо, 1 — вправо, −1 — влево */
function turnOf(G: RailGraph, eid: number) { const r = inf(G, eid)!; if (!r.s.curve) return 0; const right = (r.s.h1 - r.s.h0 + 8) % 8 === 1; return ((eid & 1) === 0) === right ? 1 : -1; }
// ---------- клетки рельсов ----------
export function railCellsAdd(g: Game, e: Entity) { const s = shapeOf(e.proto, e.dir), ax = e.x + s.ox, ay = e.y + s.oy; for (const [cx, cy] of s.cells) { const k = tkey(ax + cx, ay + cy); const a = g.railCells.get(k); if (a) a.push(e.id); else g.railCells.set(k, [e.id]); } }
export function railCellsDel(g: Game, e: Entity) { const s = shapeOf(e.proto, e.dir), ax = e.x + s.ox, ay = e.y + s.oy; for (const [cx, cy] of s.cells) { const k = tkey(ax + cx, ay + cy); const a = g.railCells.get(k); if (!a) continue; const i = a.indexOf(e.id); if (i >= 0) a.splice(i, 1); if (!a.length) g.railCells.delete(k); } }
/** рельс в клетке: ближайший осью к точке (px, py) */
export function railAt(g: Game, x: number, y: number, px = x + .5, py = y + .5): Entity | null {
  const a = g.railCells.get(tkey(x, y)); if (!a) return null; let best: Entity | null = null, bd = Infinity;
  for (const id of a) { const e = g.ents.get(id); if (!e) continue; const s = shapeOf(e.proto, e.dir), ax = e.x + s.ox, ay = e.y + s.oy; let d = Infinity;
    for (let i = 0; i + 2 < s.pts.length; i += 2) d = Math.min(d, segDist(px, py, ax + s.pts[i], ay + s.pts[i + 1], ax + s.pts[i + 2], ay + s.pts[i + 3]));
    if (d < bd - 1e-9) { bd = d; best = e; } }
  return best;
}
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(ax + dx * t - px, ay + dy * t - py); }
// ---------- станции ----------
/** узел остановки станции: [x, y, направление движения (0..7)]. Станция стоит справа от пути, рядом с головой поезда */
export function stopNode(e: { x: number; y: number; dir: number }): [number, number, number] {
  switch (e.dir) { case 0: return [e.x - 1, e.y, 0]; case 1: return [e.x + 2, e.y - 1, 2]; case 2: return [e.x + 3, e.y + 2, 4]; default: return [e.x, e.y + 3, 6]; }
}
/** рамка станции по узлу и направлению (0..3) */
export function stopBox(x: number, y: number, dir: number): [number, number] {
  switch (dir) { case 0: return [x + 1, y]; case 1: return [x - 2, y + 1]; case 2: return [x - 3, y - 2]; default: return [x, y - 3]; }
}
/** путь у станции есть: ребро приходит в её узел с её направлением */
export function stopLinked(g: Game, e: Entity) { const G = graph(g); const [x, y, h] = stopNode(e); const k = nk(x, y, h); for (const a of G.out.values()) for (const eid of a) if (endKey(G, eid) === k) return true; return false; }
// ---------- поезда: состав ----------
export const trainOf = (g: Game, e: Entity) => e.tr != null ? g.trains.find(t => t.id === e.tr) || null : null;
const carE = (g: Game, id: number) => g.ents.get(id)!;
export function trainLen(g: Game, t: Train) { let L = 0; for (let i = 0; i < t.cars.length; i++) L += CAR_LEN[carE(g, t.cars[i]).proto] + (i ? CAR_GAP : 0); return L; }
function trainMass(g: Game, t: Train) { let m = 0; for (const id of t.cars) m += CAR_MASS[carE(g, id).proto]; return m; }
function occupy(g: Game, t: Train) { for (const eid of t.trail) g.rocc.set(eid >> 1, t.id); }
function unoccupy(g: Game, t: Train) { for (const eid of t.trail) if (g.rocc.get(eid >> 1) === t.id) g.rocc.delete(eid >> 1); }
/** обрезать хвост: рёбра, целиком лежащие за последним вагоном */
function trim(g: Game, G: RailGraph, t: Train) {
  const L = trainLen(g, t); let cov = t.pos; for (let i = 1; i < t.trail.length; i++) cov += eLen(G, t.trail[i]);
  while (t.trail.length > 1 && cov - eLen(G, t.trail[t.trail.length - 1]) >= L) { const eid = t.trail.pop()!; cov -= eLen(G, eid); if (g.rocc.get(eid >> 1) === t.id && !t.trail.some(x => x >> 1 === eid >> 1)) g.rocc.delete(eid >> 1); }
}
/** точка на расстоянии d за головой (по хвосту): [x, y, угол движения] */
export function trailPoint(G: RailGraph, t: Train, d: number): [number, number, number] {
  let p = t.pos, i = 0;
  while (d > p && i < t.trail.length - 1) { d -= p; i++; p = eLen(G, t.trail[i]); }
  return edgePoint(G, t.trail[i], Math.max(0, p - d));
}
/** позы вагонов: [id, x, y, dx, dy] — центр вагона и единичный вектор на голову поезда (без тригонометрии: детерминизм) */
export function carPoses(g: Game, t: Train): [number, number, number, number, number][] {
  const G = graph(g); const r: [number, number, number, number, number][] = []; let s = 0;
  for (const id of t.cars) { const L = CAR_LEN[carE(g, id).proto]; const a = trailPoint(G, t, s), b = trailPoint(G, t, s + L); const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.sqrt(dx * dx + dy * dy) || 1; r.push([id, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dx / l, dy / l]); s += L + CAR_GAP; }
  return r;
}
/** обновить рамки вагонов (для окон, подсказок и манипуляторов на станции) */
export function syncCars(g: Game, t: Train) {
  const P = carPoses(g, t);
  for (const [id, x, y, dx, dy] of P) { const e = carE(g, id); e._cx = x; e._cy = y; e._dx = dx; e._dy = dy; const nx = Math.floor(x - 1), ny = Math.floor(y - 1); if (e.x !== nx || e.y !== ny) { e.x = nx; e.y = ny; } }
}
/** клетки стоящих вагонов → id вагона (манипуляторы грузят и разгружают) */
function setCells(g: Game, t: Train, on: boolean) {
  const G = graph(g); let s = 0;
  for (const id of t.cars) { const L = CAR_LEN[carE(g, id).proto];
    for (let d = 250; d < L; d += 500) { const p = trailPoint(G, t, s + d), q = trailPoint(G, t, s + d + 100); let nx = q[1] - p[1], ny = p[0] - q[0]; const l = Math.sqrt(nx * nx + ny * ny) || 1; nx = nx / l * .5; ny = ny / l * .5;
      const k = tkey(Math.floor(p[0] + nx), Math.floor(p[1] + ny)), k2 = tkey(Math.floor(p[0] - nx), Math.floor(p[1] - ny));
      for (const kk of [k, k2]) { if (on) g.carCells.set(kk, id); else if (g.carCells.get(kk) === id) g.carCells.delete(kk); } }
    s += L + CAR_GAP; }
}
export const carAt = (g: Game, x: number, y: number): Entity | null => { if (!g.carCells.size) return null; const id = g.carCells.get(tkey(x, y)); return id != null ? g.ents.get(id) || null : null; };
/** вагон под точкой (добыча, окна): ближе 1,1 клетки к оси вагона */
export function carNear(g: Game, px: number, py: number): Entity | null {
  if (!g.trains.length) return null; const G = graph(g);
  for (const t of g.trains) { let s = 0;
    for (const id of t.cars) { const L = CAR_LEN[carE(g, id).proto]; const a = trailPoint(G, t, s + 300), b = trailPoint(G, t, s + L - 300);
      if (segDist(px, py, a[0], a[1], b[0], b[1]) < 1.1) return carE(g, id); s += L + CAR_GAP; } }
  return null;
}
// ---------- постановка и снятие вагонов ----------
/** продолжение пути за ребром: прямо, иначе первое */
function nextDefault(G: RailGraph, eid: number, steer = 0): number | null {
  const a = G.out.get(endKey(G, eid)); if (!a || !a.length) return null; if (a.length === 1) return a[0];
  for (const want of [steer, 0, -steer, 1, -1]) for (const x of a) if (turnOf(G, x) === want) return x;
  return a[0];
}
const flip = (eid: number) => eid ^ 1;
/** поставить локомотив/вагон: рельс rid, точка (px, py) — центр вагона, back — «смотрит назад» по рельсу (локомотив) */
export function placeCar(g: Game, proto: string, rid: number, px: number, py: number, back: boolean): Entity | string {
  const G = graph(g); const r = G.info.get(rid); if (!r) return 'Ставится на рельсы';
  const L = CAR_LEN[proto];
  // ближайшая точка оси рельса
  let bd = Infinity, bs = 0; for (let d = 0; d <= r.s.len; d += 100) { const p = pointOn(r.s, d); const q = Math.hypot(r.ax + p[0] - px, r.ay + p[1] - py); if (q < bd) { bd = q; bs = d; } }
  // голова вагона — L/2 вперёд по ребру eid (вперёд — проход 0, если не back)
  let eid = rid * 2 + (back ? 1 : 0); let pos = back ? r.s.len - bs : bs;
  // сцепка: стоящий поезд, конец которого рядом с точкой
  for (const t of g.trains) { if (t.v !== 0) continue; const hd = trailPoint(G, t, 0), tl = trailPoint(G, t, trainLen(g, t));
    if (Math.min(Math.hypot(hd[0] - px, hd[1] - py), Math.hypot(tl[0] - px, tl[1] - py)) < L / U / 2 + 3) return attach(g, t, proto, back, rid, px, py); }
  // построить хвост длиной L от головы назад
  const build = (e0: number, p0: number, len: number): number[] | null => { const tr = [e0]; let cov = p0; let e = e0; while (cov < len) { const pr = nextDefault(G, flip(e)); if (pr == null) return null; e = flip(pr); tr.push(e); cov += eLen(G, e); } return tr; };
  // голова на L/2 впереди центра
  let he = eid, hp = pos + L / 2; while (hp > eLen(G, he)) { hp -= eLen(G, he); const n = nextDefault(G, he); if (n == null) return 'Не хватает рельсов'; he = n; }
  const trail = build(he, hp, L); if (!trail) return 'Не хватает рельсов';
  for (const x of trail) if (g.rocc.has(x >> 1)) return 'Мешает поезд';
  const e = newCar(g, proto, false); // v1.8: направление уже задано ребром (back — проход 1), локомотив смотрит по ходу
  const t: Train = { id: g.nextTrain++, cars: [e.id], trail, pos: hp, v: 0, fr: 0, manual: true, sched: [], si: 0, st: 'manual', path: null, tgt: null, rem: 0, wt: 0, idle: 0, sig: 0, retry: 0, drv: -1, thr: 0, steer: 0, name: '' };
  e.tr = t.id; g.trains.push(t); occupy(g, t); trim(g, G, t); syncCars(g, t); g.trainVer++;
  return e;
}
function newCar(g: Game, proto: string, back: boolean): Entity {
  const e: Entity = { id: g.nextId++, proto, t: proto === 'locomotive' ? 'loco' : 'wagon', x: 0, y: 0, w: 2, h: 2, dir: 0, status: 'idle', active: false, hp: 1000 } as Entity;
  if (proto === 'locomotive') { e.fuel = null; e.fuelJ = 0; e.fl = back || undefined; }
  else if (proto === 'fluid-wagon') { e.tf = null; e.tn = 0; }
  else { e.inv = new Inventory(WAGON_SLOTS); e.filt = new Array(WAGON_SLOTS).fill(null); e.inv.filt = e.filt; }
  g.ents.set(e.id, e); return e;
}
/** прицепить вагон к ближайшему концу стоящего поезда */
function attach(g: Game, t: Train, proto: string, back0: boolean, rid: number, px: number, py: number): Entity | string {
  const G = graph(g); const L = CAR_LEN[proto] + CAR_GAP; const hd = trailPoint(G, t, 0), tl = trailPoint(G, t, trainLen(g, t));
  // «смотрит назад» — относительно головы поезда: сравнить направление рельса у точки с направлением поезда
  const hx = hd[0] - tl[0], hy = hd[1] - tl[1]; const r = G.info.get(rid)!; const a = pointOn(r.s, 0), b = pointOn(r.s, r.s.len); let rx = b[0] - a[0], ry = b[1] - a[1]; if (back0) { rx = -rx; ry = -ry; }
  const back = rx * hx + ry * hy < 0;
  const atHead = Math.hypot(hd[0] - px, hd[1] - py) < Math.hypot(tl[0] - px, tl[1] - py);
  if (atHead) {
    // сдвинуть голову вперёд на L
    let he = t.trail[0], hp = t.pos + L; const add: number[] = [];
    while (hp > eLen(G, he)) { hp -= eLen(G, he); const n = nextDefault(G, he); if (n == null) return 'Не хватает рельсов'; if (g.rocc.has(n >> 1) && g.rocc.get(n >> 1) !== t.id) return 'Мешает поезд'; he = n; add.unshift(n); }
    t.trail = [...add, ...t.trail]; t.pos = hp;
    const e = newCar(g, proto, back); e.tr = t.id; t.cars.unshift(e.id);
  } else {
    const need = trainLen(g, t) + L; let cov = t.pos; for (let i = 1; i < t.trail.length; i++) cov += eLen(G, t.trail[i]);
    while (cov < need) { const last = t.trail[t.trail.length - 1]; const pr = nextDefault(G, flip(last)); if (pr == null) return 'Не хватает рельсов'; const e2 = flip(pr); if (g.rocc.has(e2 >> 1) && g.rocc.get(e2 >> 1) !== t.id) return 'Мешает поезд'; t.trail.push(e2); cov += eLen(G, e2); }
    const e = newCar(g, proto, back); e.tr = t.id; t.cars.push(e.id);
  }
  occupy(g, t); trim(g, G, t); syncCars(g, t); g.trainVer++;
  return carE(g, atHead ? t.cars[0] : t.cars[t.cars.length - 1]);
}
/** снять вагон: поезд делится на части (каждая остаётся на своём месте) */
export function removeCar(g: Game, e: Entity) {
  const t = trainOf(g, e); if (!t) return; const G = graph(g);
  for (const pl of plList(g)) if (pl.veh === e.id) exitVehicle(g, pl);
  const i = t.cars.indexOf(e.id); if (t.v === 0 && t.st === 'wait') setCells(g, t, false);
  unoccupy(g, t); releaseRes(g, t);
  const before = t.cars.slice(0, i), after = t.cars.slice(i + 1);
  let off = 0; for (let k = 0; k <= i; k++) off += CAR_LEN[carE(g, t.cars[k]).proto] + CAR_GAP;
  g.trains = g.trains.filter(x => x !== t);
  if (before.length) { const a: Train = { ...t, cars: before, trail: t.trail.slice(), path: null, tgt: null }; a.manual = true; a.st = 'manual'; a.v = 0; g.trains.push(a); occupy(g, a); trim(g, G, a); }
  if (after.length) {
    // голова второй части — на off за головой
    let d = off, p = t.pos, k = 0; while (d > p && k < t.trail.length - 1) { d -= p; k++; p = eLen(G, t.trail[k]); }
    const b: Train = { ...t, id: before.length ? g.nextTrain++ : t.id, cars: after, trail: t.trail.slice(k), pos: p - d, path: null, tgt: null, drv: -1 }; b.manual = true; b.st = 'manual'; b.v = 0;
    for (const id of after) carE(g, id).tr = b.id; g.trains.push(b); occupy(g, b); trim(g, G, b);
  }
  e.tr = undefined; g.trainVer++;
}
// ---------- игрок в локомотиве ----------
function plList(g: Game) { return g.peers.length ? g.peers.map((_, i) => g.peer(i).player) : [g.player]; }
export function enterVehicle(g: Game, pl: Game['player'], pi: number): boolean {
  if (pl.veh != null) { exitVehicle(g, pl); return true; }
  let best: Entity | null = null, bd = 4;
  for (const t of g.trains) for (const id of t.cars) { const e = carE(g, id); if (e.t !== 'loco' || e._cx == null) continue; const d = Math.hypot(e._cx - pl.x, e._cy! - pl.y); if (d < bd) { bd = d; best = e; } }
  if (!best) return false;
  for (const o of plList(g)) if (o !== pl && o.veh === best.id) return false;
  pl.veh = best.id; const t = trainOf(g, best)!; t.drv = pi; return true;
}
export function exitVehicle(g: Game, pl: Game['player']) {
  const e = pl.veh != null ? g.ents.get(pl.veh) : null; pl.veh = undefined; if (!e) return;
  const t = trainOf(g, e); if (t) { t.drv = -1; t.thr = 0; t.steer = 0; }
  // выйти сбоку от вагона
  const nx = -(e._dy || 0), ny = e._dx || 1; for (const s of [1.8, -1.8, 2.8, -2.8]) { const x = (e._cx ?? pl.x) + nx * s, y = (e._cy ?? pl.y) + ny * s; if (g.world.walkable(Math.floor(x), Math.floor(y)) && !g.entAt(Math.floor(x), Math.floor(y))) { pl.x = x; pl.y = y; return; } }
}
// ---------- поиск пути ----------
interface Goal { k: number; x: number; y: number; st: Entity; /** v1.8: штраф — станция занята/к ней уже едут */ pen?: number; }
class Heap { a: [number, number, number][] = []; push(x: [number, number, number]) { const a = this.a; a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] < x[0] || (a[p][0] === x[0] && a[p][2] <= x[2])) break; a[i] = a[p]; i = p; } a[i] = x; }
  pop() { const a = this.a, top = a[0], last = a.pop()!; if (a.length) { let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; const lt = (u: number, v: [number, number, number]) => a[u][0] < v[0] || (a[u][0] === v[0] && a[u][2] < v[2]); let mv = last; if (l < a.length && lt(l, mv)) { m = l; mv = a[l]; } if (r < a.length && lt(r, mv)) { m = r; mv = a[r]; } if (m === i) break; a[i] = a[m]; i = m; } a[i] = last; } return top; }
  get size() { return this.a.length; } }
/** A* по рёбрам: от конца ребра e0 (до него осталось base) к любому из goals. Вес — длина + штраф за занятые другими поездами рельсы */
export function findRoute(g: Game, G: RailGraph, tid: number, e0: number, base: number, goals: Goal[], budget = 100000): { path: number[]; cost: number; dist: number; goal: Goal } | null {
  if (!goals.length) return null;
  const gk = new Map<number, Goal>(); for (const q of goals) { const o = gk.get(q.k); if (!o || (q.pen || 0) < (o.pen || 0)) gk.set(q.k, q); }
  const k0 = endKey(G, e0); if (gk.has(k0) && !(gk.get(k0)!.pen)) return { path: [], cost: base, dist: base, goal: gk.get(k0)! };
  const hz = (eid: number) => { const [x, y] = endNode(G, eid); let m = Infinity; for (const q of goals) m = Math.min(m, Math.hypot(q.x - x, q.y - y)); return Math.floor(m * U); };
  const gs = new Map<number, number>(), ds = new Map<number, number>(), prev = new Map<number, number>(); const H = new Heap();
  const PEN = 200 * U;
  // v1.8: против одностороннего светофора (стоит только навстречу) автоматический поезд не едет
  const oneWay = (k: number) => G.sig.size > 0 && G.sig.has(oppKey(k)) && !G.sig.has(k);
  // цель с штрафом: «финиш» кладётся в кучу отдельной записью (−1 − eid) и принимается, когда дойдёт очередь
  const fin = new Map<number, number>();
  const reach = (eid: number, c: number) => { const q = gk.get(endKey(G, eid)); if (!q) return false; if (!q.pen) return true; const cf = c + q.pen; if (cf < (fin.get(eid) ?? Infinity)) { fin.set(eid, cf); H.push([cf, cf, -1 - eid]); } return false; };
  const result = (eid: number, c: number) => { const path: number[] = []; let x = eid; while (x !== -1) { path.push(x); x = prev.get(x)!; } path.reverse(); return { path, cost: c, dist: ds.get(eid)!, goal: gk.get(endKey(G, eid))! }; };
  // уже у станции со штрафом (занята) — запомнить; другой путь принимается, только если он дешевле
  const here = gk.has(k0) ? base + gk.get(k0)!.pen! : Infinity; const atHere = () => ({ path: [] as number[], cost: here, dist: base, goal: gk.get(k0)! });
  if (!oneWay(k0)) for (const eid of G.out.get(k0) || []) { const c = base + eLen(G, eid) + (occBy(g, eid, tid) ? PEN : 0); gs.set(eid, c); ds.set(eid, base + eLen(G, eid)); prev.set(eid, -1); H.push([c + hz(eid), c, eid]); }
  let n = 0;
  while (H.size && n++ < budget) {
    const [f, c, eid] = H.pop(); if (f >= here) return atHere();
    if (eid < 0) { const e = -1 - eid; if (c > (fin.get(e) ?? Infinity)) continue; return result(e, c); }
    if (c > gs.get(eid)!) continue;
    if (reach(eid, c)) return result(eid, c);
    const ke = endKey(G, eid); if (oneWay(ke)) continue;
    for (const nx of G.out.get(ke) || []) {
      const c2 = c + eLen(G, nx) + (occBy(g, nx, tid) ? PEN : 0);
      if (c2 < (gs.get(nx) ?? Infinity)) { gs.set(nx, c2); ds.set(nx, ds.get(eid)! + eLen(G, nx)); prev.set(nx, eid); H.push([c2 + hz(nx), c2, nx]); }
    }
  }
  return here < Infinity ? atHere() : null;
}
const occBy = (g: Game, eid: number, tid: number) => {
  const id = eid >> 1; let o = g.rocc.get(id); if (o != null && o !== tid) return true;
  const cs = g.rg.conf.get(id); if (cs) for (const c of cs) { o = g.rocc.get(c); if (o != null && o !== tid) return true; } // v1.8: пересечения и стрелки
  return false;
};
/** v1.8: поездов, которые едут к станции или стоят на ней (автоматических) */
export function trainsTo(g: Game, st: Entity, except?: Train) { let n = 0; for (const o of g.trains) if (o !== except && !o.manual && o.tgt === st.id) n++; return n; }
/** v1.8: лимит поездов станции: число из окна или сигнал L (если включено «лимит по сигналу»); undefined — без лимита */
export function stopLimit(g: Game, st: Entity): number | undefined { if (st.cc?.lim && st._cn) return Math.max(0, sigValue(g, st, 'signal-L')); return st.tlim ?? undefined; }
/** станция принимает поезда: включена (условие по сети) и не исчерпан лимит */
export function stopOpen(g: Game, st: Entity, t?: Train) { if (st.coff) return false; const L = stopLimit(g, st); return L == null || trainsTo(g, st, t) < L; }
/** цели расписания: станции с именем, включённые и с местом по лимиту; занятые другими поездами — со штрафом (поезд встанет в очередь) */
function goalsFor(g: Game, G: RailGraph, t: Train, name: string): Goal[] {
  const all = G.stops.get(name) || [];
  const mk = (st: Entity): Goal => { const [x, y, h] = stopNode(st); const busy = trainsTo(g, st, t); return { k: nk(x, y, h), x, y, st, pen: busy ? busy * 500 * U : 0 }; };
  return all.filter(s => stopOpen(g, s, t)).map(mk);
}
const hasLoco = (g: Game, t: Train, back: boolean) => t.cars.some(id => { const e = carE(g, id); return e.t === 'loco' && !!e.fl === back; });
/** развернуть поезд (голова ↔ хвост) */
export function reverseTrain(g: Game, t: Train) {
  const G = graph(g); const L = trainLen(g, t);
  let d = L, p = t.pos, k = 0; while (d > p && k < t.trail.length - 1) { d -= p; k++; p = eLen(G, t.trail[k]); }
  const q = p - d; const nt: number[] = []; for (let i = k; i >= 0; i--) nt.push(flip(t.trail[i]));
  unoccupy(g, t); t.trail = nt; t.pos = eLen(G, t.trail[0]) - q; t.cars.reverse(); for (const id of t.cars) { const e = carE(g, id); if (e.t === 'loco') e.fl = !e.fl || undefined; }
  t.fr = 0; occupy(g, t); trim(g, G, t);
}
function plan(g: Game, t: Train): boolean {
  const G = graph(g); const rec = t.sched[t.si]; if (!rec) { t.st = 'nosched'; return false; }
  const goals = goalsFor(g, G, t, rec.st);
  if (!goals.length) { t.st = (G.stops.get(rec.st) || []).length ? 'full' : 'nopath'; t.retry = g.tick + 120; return false; }
  let best: ReturnType<typeof findRoute> = null, rev = false;
  if (hasLoco(g, t, false)) best = findRoute(g, G, t.id, t.trail[0], eLen(G, t.trail[0]) - t.pos, goals);
  if (t.v === 0 && hasLoco(g, t, true)) {
    // путь задним ходом: голова — у последнего вагона
    const L = trainLen(g, t); let d = L, p = t.pos, k = 0; while (d > p && k < t.trail.length - 1) { d -= p; k++; p = eLen(G, t.trail[k]); }
    const r = findRoute(g, G, t.id, flip(t.trail[k]), p - d, goals); if (r && (!best || r.cost < best.cost)) { best = r; rev = true; }
  }
  if (!best) { t.st = 'nopath'; t.retry = g.tick + 120; return false; }
  if (rev) reverseTrain(g, t);
  t.path = best.path; t.tgt = best.goal.st.id; t.rem = best.dist; t.pv = g.railVer; if (t.st !== 'nofuel') t.st = 'go'; return true;
}
// ---------- движение ----------
function brakeDec(g: Game) { let k = 0; for (const id of ['braking-force-1', 'braking-force-2', 'braking-force-3']) if (g.research.done.has(id)) k++; return Math.floor(DEC0 * (10 + k) / 10); }
/** продвинуть поезд на step единиц; вернуть, сколько прошёл */
function advance(g: Game, G: RailGraph, t: Train, step: number): number {
  let moved = 0;
  while (step > 0) {
    const L0 = eLen(G, t.trail[0]); const room = L0 - t.pos;
    if (step <= room) { t.pos += step; moved += step; break; }
    t.pos = L0; moved += room; step -= room;
    let nx: number | null;
    if (t.manual) nx = nextDefault(G, t.trail[0], t.steer); else nx = t.path && t.path.length ? t.path[0] : null;
    if (nx == null || !G.info.has(nx >> 1) || startKey(G, nx) !== endKey(G, t.trail[0]) || occBy(g, nx, t.id)) { t.v = 0; t.fr = 0; break; }
    if (!t.manual) t.path!.shift();
    t.trail.unshift(nx); t.pos = 0; g.rocc.set(nx >> 1, t.id);
    if (G.sig.size && G.blk.size) { const b = G.blk.get(nx >> 1); if (b != null) { G.bocc.set(b, t.id); if (t.res && t.res.includes(b)) { t.res = t.res.filter(x => x !== b); if (g.bres.get(b) === t.id) g.bres.delete(b); if (!t.res.length) t.res = undefined; } } }
  }
  trim(g, G, t);
  return moved;
}
/** сколько можно проехать до занятого рельса впереди (по маршруту или по стрелкам) */
function freeAhead(g: Game, G: RailGraph, t: Train, need: number): number {
  let d = eLen(G, t.trail[0]) - t.pos, e = t.trail[0];
  for (let i = 0; d < need; i++) {
    const nx = t.manual ? nextDefault(G, e, t.steer) : (t.path && i < t.path.length ? t.path[i] : null);
    if (nx == null) return t.manual ? d : Infinity;
    if (occBy(g, nx, t.id)) return Math.max(0, d - 1500);
    d += eLen(G, nx); e = nx;
  }
  return Infinity;
}
function burnLocos(g: Game, t: Train): number {
  let n = 0; for (const id of t.cars) { const e = carE(g, id); if (e.t === 'loco' && !e.fl && g.burn(e, LOCO_KW)) n++; } return n;
}
function drive(g: Game, G: RailGraph, t: Train, A: number, want: number) {
  const dec = brakeDec(g), mass = trainMass(g, t);
  let v = t.v;
  // сопротивление движению — всегда; v1.8: топливо тратится, пока локомотив тянет (разгон и поддержание скорости), а не только при разгоне
  const drag = v > 0 ? Math.floor(v / FRICTION) + 20 : 0;
  if (want > 0) {
    const vt = Math.min(VMAX, Math.floor(Math.sqrt(2 * dec * Math.max(0, A) * 1000)));
    if (v <= vt) { const pw = v < vt || drag > 0 ? burnLocos(g, t) : 0; v = Math.max(0, v - drag); if (pw) v = Math.min(vt, v + Math.max(1, Math.floor(pw * LOCO_KW * ACC_K / mass))); else if (!t.manual && v === 0 && vt > 0) t.st = 'nofuel'; }
    else v = Math.max(vt, v - dec);
  } else if (want < 0) v = Math.max(0, v - dec);
  else v = Math.max(0, v - drag);
  t.v = v;
  if (!v) { t.fr = 0; return 0; }
  const tot = v + t.fr; let step = Math.floor(tot / 1000); t.fr = tot % 1000;
  if (step >= A) { step = Math.max(0, A); t.v = 0; t.fr = 0; }
  if (step <= 0) return 0;
  return advance(g, G, t, step);
}
// ---------- v1.8: светофоры и блоки ----------
/** тормозной путь (единицы) со скорости v */
function brakeDist(g: Game, v: number) { const dec = brakeDec(g); return Math.floor(v * v / (2 * dec * 1000)); }
/** блок свободен для поезда t: в нём нет чужих вагонов и чужого резерва */
function blockFree(g: Game, G: RailGraph, b: number, t: Train) { const o = G.bocc.get(b); if (o != null && o !== t.id) return false; const r = g.bres.get(b); return r == null || r === t.id; }
/** блок уже «свой»: зарезервирован или поезд в нём */
function blockHeld(G: RailGraph, b: number, t: Train) { return G.bocc.get(b) === t.id || !!(t.res && t.res.includes(b)); }
/** снять резервы поезда (смена маршрута, ручной режим, снятие вагона) */
export function releaseRes(g: Game, t: Train) { if (t.res) for (const b of t.res) if (g.bres.get(b) === t.id) g.bres.delete(b); t.res = undefined; }
/** блоки, которые нужно занять, чтобы проехать светофор s (индекс ребра за ним в маршруте — i): блочный — блок за ним;
 *  цепной — ещё и блоки до следующего блочного светофора по маршруту (выезд из перекрёстка). null — нельзя */
function needBlocks(g: Game, G: RailGraph, t: Train, s: Entity, i: number): number[] | null {
  const path = t.path!; const out: number[] = []; let cur: Entity = s;
  for (let guard = 0; guard < 16; guard++) {
    const b = G.blk.get(path[i] >> 1); if (b == null) return out; if (!blockFree(g, G, b, t)) return null; out.push(b);
    if (!isChain(cur)) return out;
    // выход из блока по маршруту: следующий светофор, за которым другой блок
    let j = i, next: Entity | null = null;
    for (; j < path.length - 1; j++) { const s2 = G.sig.get(endKey(G, path[j])); if (s2 && G.blk.get(path[j + 1] >> 1) !== b) { next = s2; break; } }
    if (!next) return out; // маршрут кончается в блоке (станция)
    cur = next; i = j + 1;
  }
  return out;
}
/** расстояние до красного светофора впереди (Infinity — путь открыт); попутно резервирует блоки за зелёными */
function sigLimit(g: Game, G: RailGraph, t: Train): number {
  t.sw = undefined; if (!G.sig.size || !t.path) return Infinity;
  const look = brakeDist(g, t.v) + 8000; let d = eLen(G, t.trail[0]) - t.pos, e = t.trail[0];
  for (let i = 0; d <= look; i++) {
    const nx = i < t.path.length ? t.path[i] : null; if (nx == null) break;
    const s = G.sig.get(endKey(G, e));
    if (s) { const b = G.blk.get(nx >> 1);
      if (b != null && !blockHeld(G, b, t)) {
        const need = needBlocks(g, G, t, s, i);
        if (!need) { t.sw = s.id; return Math.max(0, d - 500); }
        for (const x of need) if (!blockHeld(G, x, t)) { (t.res || (t.res = [])).push(x); g.bres.set(x, t.id); }
      } }
    d += eLen(G, nx); e = nx;
  }
  return Infinity;
}
/** состояния светофоров для рендера: 0 — свободно, 1 — зарезервировано, 2 — занято, 3 — нет пути у светофора */
function signalStates(g: Game, G: RailGraph) {
  for (const e of G.sig.values()) {
    const b = G.sigB.get(e.id); let ss = 3;
    if (b != null) ss = G.bocc.has(b) ? 2 : g.bres.has(b) ? 1 : 0;
    if (ss !== (e.ss ?? 0)) { e.ss = ss || undefined; }
  }
}
function cargoSig(g: Game, t: Train) { let h = 0; for (const id of t.cars) { const e = carE(g, id); if (e.proto === 'fluid-wagon') h = (h * 31 + Math.floor((e.tn || 0) * 10)) | 0; if (e.inv) for (let i = 0; i < e.inv.size; i++) { const s = e.inv.slots[i]; if (s) h = (h * 31 + s.count * 7 + s.item.length + i) | 0; } } return h; }
/** v1.8: сколько предмета или жидкости в вагонах поезда */
export function cargoCount(g: Game, t: Train, it: string) { let n = 0; for (const id of t.cars) { const e = carE(g, id); if (e.inv) n += e.inv.count(it); else if (e.tf === it) n += Math.floor(e.tn || 0); } return n; }
const cmpN = (op: CondOp | undefined, a: number, b: number) => op === '<' ? a < b : op === '=' ? a === b : op === '≠' ? a !== b : a > b;
function oneCond(g: Game, t: Train, r: WCond): boolean {
  const cars = t.cars.map(id => carE(g, id)); const wag = cars.filter(e => e.inv), fw = cars.filter(e => e.proto === 'fluid-wagon');
  switch (r.c) {
    case 'full': return wag.length + fw.length > 0 && wag.every(e => e.inv!.slots.every(s => s ? s.count >= ITEMS[s.item].stack : false)) && fw.every(e => (e.tn || 0) >= FWAGON_CAP - 1e-6);
    case 'empty': return wag.every(e => e.inv!.isEmpty()) && fw.every(e => !(e.tn! > 1e-6));
    case 'time': return t.wt >= r.n * 60;
    case 'idle': return t.idle >= r.n * 60;
    case 'item': return !r.it || cmpN(r.op, cargoCount(g, t, r.it), r.n);
    case 'circuit': { const st = t.tgt != null ? g.ents.get(t.tgt) : null; return !r.cs || !r.cs.a || (!!st && condOk(g, st, r.cs)); }
  }
  return true;
}
/** условия записи: группы «и», разделённые «или» */
export function condMet(g: Game, t: Train, r: SchedRec): boolean {
  let grp = oneCond(g, t, r);
  for (const x of r.x || []) { if (x.j === 1) { if (grp) return true; grp = oneCond(g, t, x); } else grp = grp && oneCond(g, t, x); }
  return grp;
}
/** нормализовать запись расписания (команда, загрузка) */
export function cleanSched(r: any): SchedRec | null {
  if (!r || typeof r !== 'object') return null;
  const ops: CondOp[] = ['<', '>', '=', '≠'];
  const one = (o: any): WCond => {
    const c: Cond = CONDS.includes(o?.c) ? o.c : 'time'; const w: WCond = { c, n: Math.max(c === 'item' ? -2147483648 : 0, Math.min(c === 'item' ? 2147483647 : 36000, Math.floor(+o?.n || 0))) };
    if (c === 'item') { w.it = typeof o.it === 'string' && ITEMS[o.it] && !ITEMS[o.it].virtual ? o.it : null; w.op = ops.includes(o.op) ? o.op : '>'; }
    if (c === 'circuit') { const a = o.cs?.a, b = o.cs?.b; const ok = (x: any) => typeof x === 'string' && !!ITEMS[x] && !ITEMS[x].meta; w.cs = { a: ok(a) ? a : null, op: ops.includes(o.cs?.op) ? o.cs.op : '>', n: Math.max(-2147483648, Math.min(2147483647, Math.floor(+o.cs?.n || 0))), ...(ok(b) ? { b } : {}) }; }
    return w;
  };
  const rec: SchedRec = { st: String(r.st ?? '').slice(0, 60), ...one(r) };
  if (Array.isArray(r.x) && r.x.length) rec.x = r.x.slice(0, 8).map((o: any) => ({ ...one(o), j: o?.j === 1 ? 1 : 0 }));
  return rec;
}
/** доля заполнения вагонов (для окна) */
export function fillPct(g: Game, t: Train) { let have = 0, cap = 0; for (const id of t.cars) { const e = carE(g, id); if (e.proto === 'fluid-wagon') { cap += WAGON_SLOTS; have += (e.tn || 0) / FWAGON_CAP * WAGON_SLOTS; continue; } if (!e.inv) continue; for (const s of e.inv.slots) { cap += 1; if (s) have += s.count / ITEMS[s.item].stack; } } return cap ? Math.round(have / cap * 100) : 0; }
export let trainMs = 0;
export function stepTrains(g: Game) {
  if (!g.trains.length) { trainMs = 0; if (g.sigVer && g.tick % 60 === 0) { const G = graph(g); if (G.sig.size) { G.bocc.clear(); signalStates(g, G); } } return; }
  const t0 = performance.now(); const G = graph(g);
  G.bocc.clear(); if (G.sig.size && G.blk.size) for (const [rid, tid] of g.rocc) { const b = G.blk.get(rid); if (b != null) G.bocc.set(b, tid); }
  for (const t of g.trains) stepTrain(g, G, t);
  hits(g, G);
  if (G.sig.size && (g.tick & 3) === 0) signalStates(g, G);
  trainMs = performance.now() - t0;
}
function stepTrain(g: Game, G: RailGraph, t: Train) {
  if (!G.info.has(t.trail[0] >> 1)) return; // рельс снят из-под поезда (не должно случаться)
  const wasStill = t.v === 0;
  if (t.manual) {
    t.st = 'manual';
    let want = 0;
    if (t.drv >= 0) {
      // газ — относительно кабины игрока; назад от стоянки — поезд разворачивается (голова ↔ хвост)
      const cab = g.ents.get(g.peer(t.drv).player.veh ?? -1); const w = t.thr * (cab && cab.fl ? -1 : 1);
      if (w > 0) want = 1; else if (w < 0) { if (t.v > 0) want = -1; else { reverseTrain(g, t); want = 1; } }
    }
    const A = freeAhead(g, G, t, 400 * U);
    drive(g, G, t, Math.min(A, 1e12), want);
  } else {
    if (t.st === 'wait') {
      t.wt++; t.idle++;
      if ((g.tick + t.id) % 30 === 0) { const sg = cargoSig(g, t); if (sg !== t.sig) { t.sig = sg; t.idle = 0; } }
      const r = t.sched[t.si];
      if (r && (g.tick + t.id) % 10 === 0 && condMet(g, t, r)) { setCells(g, t, false); t.si = (t.si + 1) % t.sched.length; if (t.si === 0) t.laps = (t.laps || 0) + 1; t.tgt = null; t.path = null; t.st = 'go'; t.retry = 0; }
    }
    if (t.st !== 'wait') {
      if (t.path && t.pv !== g.railVer) { t.path = null; releaseRes(g, t); }
      // v1.8: станцию назначения выключили — искать другую
      if (t.path && t.tgt != null && (g.tick + t.id) % 30 === 0) { const st = g.ents.get(t.tgt); if (!st || st.coff) { t.path = null; t.tgt = null; releaseRes(g, t); } }
      if (!t.path && g.tick >= t.retry) plan(g, t);
      if (!t.path) drive(g, G, t, 0, -1);
      else {
        const fa = freeAhead(g, G, t, Math.min(t.rem, 400 * U)); const sl = sigLimit(g, G, t); const A = Math.min(t.rem, fa, sl);
        const moved = drive(g, G, t, A, 1); t.rem -= moved;
        if (t.v > 0) t.st = 'go'; else if (t.rem > 0 && A <= 0 && t.st !== 'nofuel') t.st = sl <= fa ? 'signal' : 'blocked';
        if ((t.st === 'blocked' && (g.tick + t.id) % 300 === 0) || (t.st === 'signal' && (g.tick + t.id) % 1800 === 0)) { t.path = null; releaseRes(g, t); }
        if (t.rem <= 0 && t.v === 0) { t.st = 'wait'; t.wt = 0; t.idle = 0; t.sig = cargoSig(g, t); syncCars(g, t); setCells(g, t, true); releaseRes(g, t); }
      }
    }
  }
  if (t.v > 0 || (g.tick + t.id) % 30 === 0 || wasStill !== (t.v === 0)) syncCars(g, t);
  for (const pl of plList(g)) if (pl.veh != null && t.cars.includes(pl.veh)) { const e = carE(g, pl.veh); if (e._cx != null) { pl.x = e._cx; pl.y = e._cy!; } }
}
/** поезд сбивает игроков и Рой: урон от массы и скорости */
function hits(g: Game, G: RailGraph) {
  for (const t of g.trains) {
    if (t.v < 20000) continue; const p = trailPoint(G, t, 0), b = trailPoint(G, t, 1500);
    const tps = t.v / 1000 / U * 60, dmg = Math.floor(tps * trainMass(g, t) / 200); if (dmg <= 0) continue;
    const pls = plList(g);
    for (let i = 0; i < pls.length; i++) { const pl = pls[i]; if (pl.dead || pl.veh != null) continue;
      if (segDist(pl.x, pl.y, p[0], p[1], b[0], b[1]) < 1.2) { hurtPl(g, i, dmg); let sx = b[1] - p[1], sy = p[0] - b[0]; const l = Math.sqrt(sx * sx + sy * sy) || 1; sx /= l; sy /= l; const side = (pl.x - p[0]) * sx + (pl.y - p[1]) * sy >= 0 ? 1 : -1; pl.x += sx * side * 1.5; pl.y += sy * side * 1.5; g.snd('hit', pl.x, pl.y); } }
    if (g.units.length) for (const u of g.units) if (u.hp > 0 && Math.abs(u.x - p[0]) < 3 && Math.abs(u.y - p[1]) < 3 && segDist(u.x, u.y, p[0], p[1], b[0], b[1]) < 1.3) { hitUnit(g, u, dmg, -1); if (u.hp <= 0) (g.stats as any).trainKills = ((g.stats as any).trainKills || 0) + 1; }
  }
}
// ---------- после загрузки ----------
export function restoreTrains(g: Game) {
  g.rocc.clear(); g.carCells.clear();
  for (const t of g.trains) { occupy(g, t); for (const id of t.cars) { const e = g.ents.get(id); if (e && e.inv && e.filt) e.inv.filt = e.filt; } }
  for (const t of g.trains) { syncCars(g, t); if (!t.manual && t.st === 'wait') setCells(g, t, true); }
  // v1.8: резерв блоков восстанавливается из поездов (блок резервирует первый по порядку поезд)
  g.bres.clear(); for (const t of g.trains) if (t.res) { t.res = t.res.filter(b => !g.bres.has(b)); for (const b of t.res) g.bres.set(b, t.id); if (!t.res.length) t.res = undefined; }
}
// ---------- планировщик пути («тянуть путь») ----------
export interface PlanPiece { proto: string; x: number; y: number; dir: number; }
interface Move { proto: string; v: number; d: number; dx: number; dy: number; h2: number; ax: number; ay: number; len: number; }
/** ходы из состояния с направлением h: [кусок, проход, смещение конца, новое направление, якорь от старта] */
const MOVES: Move[][] = [0, 1, 2, 3, 4, 5, 6, 7].map(h => {
  const r: Move[] = [];
  for (const proto in SHAPES) for (const s of SHAPES[proto]) for (let d = 0; d < 2; d++) {
    const hs = d === 0 ? s.h0 : (s.h1 + 4) % 8; if (hs !== h) continue;
    const st = d === 0 ? [0, 0] : s.b, en = d === 0 ? s.b : [0, 0];
    r.push({ proto, v: s.v, d, dx: en[0] - st[0], dy: en[1] - st[1], h2: d === 0 ? s.h1 : (s.h0 + 4) % 8, ax: -st[0], ay: -st[1], len: s.len });
  }
  return r;
});
/** A* по решётке узлов: от (sx, sy) с направлением sh (или любым, если sh < 0) к узлу (tx, ty) (направление th или любое).
 *  free(клетка) — можно ли класть рельс; уже лежащие куски (has) стоят 0. Возвращает куски (с якорем → рамкой) и признак точного попадания. */
export function planRail(sx: number, sy: number, sh: number, tx: number, ty: number, th: number, free: (x: number, y: number) => boolean, has?: (p: PlanPiece) => boolean, budget = 40000): { pieces: PlanPiece[]; exact: boolean; ex: number; ey: number; eh: number } {
  const key = (x: number, y: number, h: number) => nk(x, y, h);
  const H = new Heap(); const gs = new Map<number, number>(); const prev = new Map<number, [number, Move | null, number, number, number]>();
  const hz = (x: number, y: number) => Math.floor(Math.hypot(tx - x, ty - y) * U);
  const starts = sh >= 0 ? [sh] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const h of starts) { const k = key(sx, sy, h); gs.set(k, 0); prev.set(k, [-1, null, sx, sy, h]); H.push([hz(sx, sy), 0, k]); }
  const okCache = new Map<number, boolean>();
  const pieceOk = (m: Move, x: number, y: number): boolean => {
    const ax = x + m.ax, ay = y + m.ay; const ck = nk(ax, ay, 0) * 16 + (m.proto === 'curved-rail' ? 8 : 0) + m.v; const c = okCache.get(ck); if (c != null) return c;
    const s = SHAPES[m.proto][m.v]; let ok = true; for (const [cx, cy] of s.cells) if (!free(ax + cx, ay + cy)) { ok = false; break; }
    okCache.set(ck, ok); return ok;
  };
  let best = -1, bh = Infinity, n = 0;
  while (H.size && n++ < budget) {
    const [, c, k] = H.pop(); if (c > gs.get(k)!) continue;
    const pr = prev.get(k)!; const x = pr[2], y = pr[3], h = pr[4];
    const dz = hz(x, y); if (dz < bh || (dz === bh && c < (gs.get(best) ?? Infinity))) { bh = dz; best = k; }
    if (x === tx && y === ty && (th < 0 || h === th)) { best = k; bh = 0; break; }
    for (const m of MOVES[h]) {
      const nx = x + m.dx, ny = y + m.dy; if (!pieceOk(m, x, y)) continue;
      const pc: PlanPiece = { proto: m.proto, x: 0, y: 0, dir: m.v }; const [bx, by] = boxAt(m, x, y); pc.x = bx; pc.y = by;
      const cost = (has && has(pc) ? 0 : m.len) + (m.proto === 'curved-rail' ? 2000 : 0);
      const k2 = key(nx, ny, m.h2), c2 = c + cost;
      if (c2 < (gs.get(k2) ?? Infinity)) { gs.set(k2, c2); prev.set(k2, [k, m, nx, ny, m.h2]); H.push([c2 + hz(nx, ny), c2, k2]); }
    }
  }
  const pieces: PlanPiece[] = []; let k = best; const end = prev.get(best)!;
  while (k !== -1) { const p = prev.get(k)!; if (!p[1]) break; const pk = p[0]; const pp = prev.get(pk)!; const [bx, by] = boxAt(p[1], pp[2], pp[3]); pieces.push({ proto: p[1].proto, x: bx, y: by, dir: p[1].v }); k = pk; }
  pieces.reverse();
  return { pieces, exact: bh === 0, ex: end[2], ey: end[3], eh: end[4] };
}
function boxAt(m: Move, x: number, y: number): [number, number] { const s = SHAPES[m.proto][m.v]; return [x + m.ax - s.ox, y + m.ay - s.oy]; }
/** концы рельса как состояния для продолжения пути: [x, y, направление наружу] */
export function railEnds(e: { proto: string; x: number; y: number; dir: number }): [number, number, number][] {
  const s = shapeOf(e.proto, e.dir), ax = e.x + s.ox, ay = e.y + s.oy; return [[ax + s.b[0], ay + s.b[1], s.h1], [ax, ay, (s.h0 + 4) % 8]];
}
export { rot8, isRailProto, UX, UY };
