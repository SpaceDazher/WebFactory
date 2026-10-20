// v1.5 «Схемотехника I»: красные и зелёные провода, сети сигналов, условия включения, постоянный комбинатор, лампы.
// Сигнал — набор «предмет/жидкость/виртуальный сигнал → число». Сеть пересчитывается раз в тик, в конце тика:
// выходы всех построек суммируются, затем вычисляются условия. Постройка применяет результат в следующем тике
// (значение, выставленное в тике N, видно потребителям в тике N+1). Порядок обхода — по порядку постройки (детерминированно).
import type { Game, Entity } from './game';
import { ITEMS, SIGNAL_COLORS } from '../data/items';
import { PROTOS } from '../data/entities';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { roboSignals } from './robots';
import { heatTemp } from './heat';

export const WIRE_REACH = 30;
/** цвет провода по предмету: 0 — красный, 1 — зелёный */
export const WIRE_OF: Record<string, 0 | 1> = { 'red-wire': 0, 'green-wire': 1 };
export const WIRE_ITEM = ['red-wire', 'green-wire'] as const;
export const CC_SLOTS = 20;
export type CondOp = '<' | '>' | '=' | '≠';
export const OPS: CondOp[] = ['<', '>', '=', '≠'];
/** условие «A op число» или «A op B» (b задан) */
export interface Cond { a: string | null; op: CondOp; n: number; b?: string | null; }
export interface CSig { s: string; n: number; }
// v1.6: арифметический и логический комбинаторы
export type AOp = '+' | '−' | '×' | '÷' | '%' | '^' | '<<' | '>>' | 'AND' | 'OR' | 'XOR';
export const AOPS: AOp[] = ['+', '−', '×', '÷', '%', '^', '<<', '>>', 'AND', 'OR', 'XOR'];
export type DOp = '<' | '>' | '=' | '≠' | '≤' | '≥';
export const DOPS: DOp[] = ['<', '>', '=', '≠', '≤', '≥'];
export const EACH = 'signal-each', ANY = 'signal-any', EVERY = 'signal-every';
/** арифметика: A op (B или число) → выход; A и выход могут быть «каждый» */
export interface Arith { a: string | null; op: AOp; b?: string | null; n: number; o: string | null; }
/** логика: если A op (B или число) — выход (1 или входное значение); A: сигнал/каждый/любой/все; выход: сигнал/каждый/все */
export interface Decider { a: string | null; op: DOp; b?: string | null; n: number; o: string | null; one?: boolean; }
/** настройки схемотехники постройки (сохраняются, копируются в чертежи) */
export interface CC {
  en?: Cond | null;       // условие включения: конвейер, манипулятор, насос, бур, качалка, лампа
  rd?: 0 | 1 | 2 | 3;         // конвейер: 1 — «прочитать» (импульс при входе предмета), 2 — «держать» (всё на клетке); манипулятор: 1 — «читать руку»
  col?: boolean;          // лампа: цвет по сигналу
  sig?: (CSig | null)[];  // постоянный комбинатор: до 20 сигналов
  on?: boolean;           // постоянный комбинатор: вкл/выкл (по умолчанию вкл)
  // v1.6: rd также у опоры (1 — электросеть), робопорта (битовая маска: 1 — содержимое сети, 2 — роботы), лаборатории и сборщика (1)
  ar?: Arith;             // арифметический комбинатор
  de?: Decider;           // логический комбинатор
  inp?: 0 | 1 | 2;        // вход комбинатора: 0 — обе сети, 1 — только красная, 2 — только зелёная
  setr?: boolean;         // сборщик: рецепт по сигналу
  /** v1.8: станция — лимит поездов по сигналу L (rd у станции: 1 — содержимое поезда, 2 — сигнал C = поездов едет сюда) */
  lim?: boolean;
}
/** сеть: ents — подключённые входом (или обычной клеммой), outs — выходы комбинаторов */
export interface CNet { id: number; c: 0 | 1; ents: Entity[]; outs: Entity[]; sig: Map<string, number>; /** v1.6: сигналы прошлого тика (буфер) и «изменилась за тик» */ alt?: Map<string, number>; chg?: boolean; /** постройки сети, которые что-то выдают (без входов комбинаторов) */ src?: Entity[];
  /** сеть только из постоянных комбинаторов и выходов комбинаторов: пересчёт — только если сменились их настройки/выходы (refs — прошлые ссылки) */ stat?: boolean; refs?: unknown[]; }
/** провод: [постройка A, постройка B, цвет, клемма A, клемма B] — клемма 1 — выход комбинатора (у обычных построек — 0, тогда поля опускаются);
 * узлы упорядочены: A*2+клеммаA < B*2+клеммаB (провод со входа комбинатора на его же выход разрешён) */
export type CWire = [number, number, 0 | 1] | [number, number, 0 | 1, 0 | 1, 0 | 1];
export const wt = (w: CWire, i: 0 | 1): 0 | 1 => (w[3 + i] as 0 | 1) || 0;
/** у постройки есть выходная клемма (комбинатор с входом и выходом) */
export const hasOut = (e: { t: string } | null | undefined) => !!e && (e.t === 'arith' || e.t === 'decider');
/** клемма по клетке: передняя (по направлению) клетка комбинатора — выход */
export function termAt(e: Entity, tx: number, ty: number): 0 | 1 {
  if (!hasOut(e)) return 0;
  switch (e.dir) { case 0: return ty === e.y ? 1 : 0; case 2: return ty === e.y + e.h - 1 ? 1 : 0; case 1: return tx === e.x + e.w - 1 ? 1 : 0; default: return tx === e.x ? 1 : 0; }
}
/** точка клеммы (центр клетки входа/выхода; у обычных построек — центр) */
export function termPos(e: Entity, t: 0 | 1): [number, number] {
  if (!hasOut(e)) return [e.x + e.w / 2, e.y + e.h / 2];
  const front = t === 1; let x = e.x + .5, y = e.y + .5;
  if (e.dir === 0) y = front ? e.y + .5 : e.y + 1.5; else if (e.dir === 2) y = front ? e.y + 1.5 : e.y + .5;
  else if (e.dir === 1) x = front ? e.x + 1.5 : e.x + .5; else x = front ? e.x + .5 : e.x + 1.5;
  return [x, y];
}
/** v1.6: концы провода на карте (в клетках): клеммы, красный чуть левее, зелёный правее; провод провисает на 0.35 клетки */
export function wireEnds(g: { ents: Map<number, Entity> }, w: CWire): [number, number, number, number] | null {
  const A = g.ents.get(w[0]), B = g.ents.get(w[1]); if (!A || !B) return null; const o = w[2] ? .14 : -.14;
  const [ax, ay] = termPos(A, wt(w, 0)), [bx, by] = termPos(B, wt(w, 1)); return [ax + o, ay - .15, bx + o, by - .15];
}
export const WIRE_SAG = .35;
/** провод под курсором (индекс в g.cw) — ближе 0.3 клетки к кривой */
export function wireAt(g: { ents: Map<number, Entity>; cw: CWire[] }, x: number, y: number): number {
  let best = -1, bd = .3;
  for (let i = 0; i < g.cw.length; i++) {
    const q = wireEnds(g, g.cw[i]); if (!q) continue; const [ax, ay, bx, by] = q;
    if (x < Math.min(ax, bx) - 1 || x > Math.max(ax, bx) + 1 || y < Math.min(ay, by) - 1 || y > Math.max(ay, by) + 1) continue;
    const cx = (ax + bx) / 2, cy = (ay + by) / 2 + WIRE_SAG;
    for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; const px = u * u * ax + 2 * u * t * cx + t * t * bx, py = u * u * ay + 2 * u * t * cy + t * t * by; const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } }
  }
  return best;
}
const norm = (a: number, b: number, c: 0 | 1, ta: 0 | 1, tb: 0 | 1): CWire => {
  if (a * 2 + ta > b * 2 + tb) [a, b, ta, tb] = [b, a, tb, ta];
  return ta || tb ? [a, b, c, ta, tb] : [a, b, c];
};
const same = (w: CWire, x: CWire) => w[0] === x[0] && w[1] === x[1] && w[2] === x[2] && wt(w, 0) === wt(x, 0) && wt(w, 1) === wt(x, 1);

const CAP_T = new Set(['belt', 'inserter', 'chest', 'tank', 'pump', 'drill', 'pumpjack', 'lamp', 'combinator', 'pole', 'arith', 'decider', 'roboport', 'lab', 'assembler', 'stop', 'tpump', 'reactor', 'radar']);
const COND_T = new Set(['belt', 'inserter', 'pump', 'drill', 'pumpjack', 'lamp', 'stop', 'tpump', 'reactor']);
export const circuitCapable = (e: Entity | null | undefined) => !!e && CAP_T.has(e.t);
export const condCapable = (e: Entity | null | undefined) => !!e && COND_T.has(e.t);
/** чтение: конвейер (прочитать/держать), манипулятор (рука); v1.6: опора, робопорт, лаборатория, сборщик; сундук и цистерна сообщают содержимое всегда */
export const readCapable = (e: Entity) => e.t === 'belt' || e.t === 'inserter' || e.t === 'pole' || e.t === 'roboport' || e.t === 'lab' || e.t === 'assembler' || e.t === 'radar';
export const wireDist = (a: Entity, b: Entity) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
/** все сигналы для выбора: предметы, жидкости, виртуальные (без особых «каждый/любой/все») */
export const signalList = () => Object.keys(ITEMS).filter(k => !ITEMS[k].hidden && !ITEMS[k].meta);

export function hasWire(g: Game, a: number, b: number, c: 0 | 1, ta: 0 | 1 = 0, tb: 0 | 1 = 0) { const x = norm(a, b, c, ta, tb); return g.cw.some(w => same(w, x)); }
/** соединить клеммы ta (постройки a) и tb (постройки b) */
export function addWire(g: Game, a: number, b: number, c: 0 | 1, ta: 0 | 1 = 0, tb: 0 | 1 = 0): 'ok' | 'exists' | 'far' | 'bad' {
  const A = g.ents.get(a), B = g.ents.get(b);
  if (!A || !B || !circuitCapable(A) || !circuitCapable(B)) return 'bad';
  if (ta && !hasOut(A) || tb && !hasOut(B) || (ta !== 0 && ta !== 1) || (tb !== 0 && tb !== 1)) return 'bad';
  if (a === b && (!hasOut(A) || ta === tb)) return 'bad';
  if (wireDist(A, B) > WIRE_REACH + 1e-9) return 'far';
  if (hasWire(g, a, b, c, ta, tb)) return 'exists';
  g.cw.push(norm(a, b, c, ta, tb)); g.cdirty = true; g.cwVer++; return 'ok';
}
export function removeWire(g: Game, a: number, b: number, c: 0 | 1, ta: 0 | 1 = 0, tb: 0 | 1 = 0) {
  const x = norm(a, b, c, ta, tb); const i = g.cw.findIndex(w => same(w, x));
  if (i < 0) return false; g.cw.splice(i, 1); g.cdirty = true; g.cwVer++; return true;
}
/** нормализовать провод из сохранения/чертежа (null — мусор) */
export function cleanWire(w: any): CWire | null {
  if (!Array.isArray(w) || !Number.isInteger(w[0]) || !Number.isInteger(w[1]) || (w[2] !== 0 && w[2] !== 1)) return null;
  const ta = w[3] === 1 ? 1 : 0, tb = w[4] === 1 ? 1 : 0; if (w[0] === w[1] && ta === tb) return null;
  return norm(w[0], w[1], w[2], ta, tb);
}
/** снять все провода постройки (при сносе); возвращает число проводов по цветам */
export function dropWiresOf(g: Game, id: number): [number, number] {
  const n: [number, number] = [0, 0]; if (!g.cw.length) return n;
  const keep: CWire[] = []; for (const w of g.cw) if (w[0] === id || w[1] === id) n[w[2]]++; else keep.push(w);
  if (n[0] || n[1]) { g.cw = keep; g.cdirty = true; g.cwVer++; }
  return n;
}

function find(par: Map<number, number>, a: number): number { let r = a; while (par.get(r) !== r) r = par.get(r)!; while (par.get(a) !== r) { const p = par.get(a)!; par.set(a, r); a = p; } return r; }
/** пересобрать сети (раздельно для красного и зелёного) */
export function rebuildCircuits(g: Game) {
  for (const e of g.ents.values()) { if (e._cn) e._cn = undefined; if (e._co) e._co = undefined; }
  const nets: CNet[] = []; const combs: Entity[] = [];
  for (const c of [0, 1] as const) {
    // узел — клемма постройки: id*2 + клемма (1 — выход комбинатора)
    const par = new Map<number, number>();
    for (const w of g.cw) if (w[2] === c) { const u = w[0] * 2 + wt(w, 0), v = w[1] * 2 + wt(w, 1); for (const k of [u, v]) if (!par.has(k)) par.set(k, k); const ra = find(par, u), rb = find(par, v); if (ra !== rb) par.set(Math.max(ra, rb), Math.min(ra, rb)); }
    const byRoot = new Map<number, CNet>();
    // порядок членов сети — по id (порядок постройки): сумма не зависит от порядка, но так проще отлаживать
    for (const k of [...par.keys()].sort((x, y) => x - y)) {
      const id = k >> 1, t = k & 1; const e = g.ents.get(id); if (!e) continue; const r = find(par, k);
      let n = byRoot.get(r); if (!n) { n = { id: nets.length, c, ents: [], outs: [], sig: new Map() }; nets.push(n); byRoot.set(r, n); }
      if (t) { n.outs.push(e); if (!e._co) e._co = [-1, -1]; e._co[c] = n.id; }
      else { n.ents.push(e); if (!e._cn) e._cn = [-1, -1]; e._cn[c] = n.id; }
    }
  }
  for (const e of g.ents.values()) if (hasOut(e)) { e._cv = undefined; if (e._cn || e._co) combs.push(e); else if (e.co) e.co = undefined; }
  for (const n of nets) { n.src = n.ents.filter(e => !hasOut(e)); n.stat = n.src.every(e => e.t === 'combinator'); }
  g.cnets = nets; g.ccombs = combs; g.cdirty = false;
  // постройки без проводов: условие не действует
  for (const e of g.ents.values()) if (!e._cn && (e.coff || e.ccol)) { e.coff = undefined; e.ccol = undefined; }
}
/** сложение с переполнением по кругу (32 бита со знаком); нулевые сигналы в сети не хранятся */
const add = (m: Map<string, number>, k: string, v: number) => { if (!v) return; const r = ((m.get(k) || 0) + v) | 0; if (r) m.set(k, r); else m.delete(k); };
/** что постройка выдаёт в сеть */
function output(g: Game, e: Entity, m: Map<string, number>) {
  if (e.t === 'combinator') { if (e.cc?.sig && e.cc.on !== false) for (const s of e.cc.sig) if (s && s.s) add(m, s.s, s.n); return; }
  switch (e.t) {
    case 'pole': if (e.cc?.rd === 1 && e._net != null && e._net >= 0) { const n = g.powerNets.get(e._net); if (n) { add(m, 'signal-power', Math.floor(n.satisfaction * 100 + 1e-9)); if (n.storeCap) add(m, 'signal-accu', Math.floor((n.stored || 0) / n.storeCap * 100 + 1e-9)); } } break;
    case 'roboport': if (e.cc?.rd) { const r = roboSignals(g, e); if (r) { if (e.cc.rd & 1) for (const [k, v] of r.items) add(m, k, v); if (e.cc.rd & 2) { add(m, 'signal-lrobot', r.lf); add(m, 'signal-lrobot-all', r.la); add(m, 'signal-crobot', r.cf); add(m, 'signal-crobot-all', r.ca); } } } break;
    case 'lab': if (e.cc?.rd === 1 && g.research.current) { const t = TECHS[g.research.current]; for (const pk of t.packs) add(m, pk, 1); add(m, 'signal-research', Math.floor(g.research.progress / g.techCost(g.research.current) * 100)); } break;
    case 'assembler': if (e.cc?.rd === 1) { const out = e.recipe ? RECIPES[e.recipe]?.out[0]?.[0] : null; if (out) add(m, out, 1); if (e.status === 'working' || e.status === 'low-power') add(m, 'signal-work', 1); } break;
    case 'radar': if (e.cc?.rd === 1 && e.status === 'working') { const r = g.v117.speakers.radar[String(e.id)]; if (r?.enabled) { add(m, 'signal-enemy-count', r.count); add(m, 'signal-attack-active', r.attacking || r.attackedUntil > g.tick ? 1 : 0); } } break;
    case 'stop': if (e.cc?.rd) {
      if (e.cc.rd & 1) { const t = g.trains.find(o => o.st === 'wait' && o.tgt === e.id); if (t) for (const id of t.cars) { const c = g.ents.get(id); if (!c) continue;
        if (c.inv) for (const s of c.inv.slots) if (s) add(m, s.item, s.count);
        if (c.tf && c.tn) add(m, c.tf, Math.floor(c.tn + 1e-6)); } }
      if (e.cc.rd & 2) { let n = 0; for (const o of g.trains) if (!o.manual && o.tgt === e.id) n++; add(m, 'signal-C', n); }
    } break;
    case 'chest': if (e.inv) for (const s of e.inv.slots) if (s) add(m, s.item, s.count); break;
    case 'tank': if (e._fn && e._fn[0] != null) { const n = g.fluidNets[e._fn[0]]; const box = PROTOS[e.proto].fluid![0]; if (n && n.fluid && n.cap > 0) { const a = Math.floor(n.amount * box.cap / n.cap + 1e-6); add(m, n.fluid, a);
      // v1.16: пар — ещё температура (°C) и запас полезной энергии (МДж): ед. × кДж/ед
      if (n.fluid === 'steam' && a > 0) { add(m, 'signal-temperature', n.se >= 97 ? 500 : 165); add(m, 'signal-energy', Math.floor(n.amount * box.cap / n.cap * n.se / 1000 + 1e-6)); } } } break;
    // v1.16: реактор — температура, мощность, соседи, время стержня, перегрев, число стержней и отходов (стержень в горении во входной слот не входит)
    case 'reactor': { add(m, 'signal-temperature', Math.round(heatTemp(e))); add(m, 'signal-heat', Math.round((e._mw || 0) * 1000)); add(m, 'signal-neighbours', e.rn || 0); add(m, 'signal-fuel-time', Math.ceil((e.rt || 0) / 60)); add(m, 'signal-overheat', heatTemp(e) >= 1000 ? 1 : 0);
      add(m, 'nuclear-fuel-cell', e.input?.['nuclear-fuel-cell'] || 0); add(m, 'used-nuclear-fuel-cell', e.output?.['used-nuclear-fuel-cell'] || 0); break; }
    case 'inserter': if (e.cc?.rd === 1 && e.hand) add(m, e.hand, e.hn || 1); break;
    case 'belt':
      if (e.cc?.rd === 2) { for (const seg of e.lanes!) for (const L of seg) for (const it of L) add(m, it.item, it.n || 1); }
      else if (e.cc?.rd === 1 && e._pin) for (const k in e._pin) add(m, k, e._pin[k]);
      break;
  }
}
/** v1.6: сигналы сетей постройки для окна/подсказки: [вход красная, вход зелёная, выход красная, выход зелёная] (null — нет сети) */
export function csigOf(g: Game, e: Entity): ([string, number][] | null)[] {
  const f = (n: number | undefined) => n != null && n >= 0 && g.cnets[n] ? [...g.cnets[n].sig.entries()] : null;
  return [f(e._cn?.[0]), f(e._cn?.[1]), f(e._co?.[0]), f(e._co?.[1])];
}
/** значение сигнала на входе постройки: сумма красной и зелёной сетей */
export function sigValue(g: Game, e: Entity, s: string): number {
  const cn = e._cn; if (!cn) return 0; let v = 0;
  if (cn[0] >= 0) v += g.cnets[cn[0]].sig.get(s) || 0;
  if (cn[1] >= 0) v += g.cnets[cn[1]].sig.get(s) || 0;
  return v;
}
export function condOk(g: Game, e: Entity, c: Cond): boolean {
  if (!c.a) return true;
  const A = sigValue(g, e, c.a), B = c.b ? sigValue(g, e, c.b) : c.n;
  switch (c.op) { case '<': return A < B; case '>': return A > B; case '=': return A === B; default: return A !== B; }
}
const LAMP_ORDER = ['signal-red', 'signal-green', 'signal-blue', 'signal-yellow', 'signal-pink', 'signal-cyan', 'signal-white'];
let ms = 0;
export const circuitsMs = () => ms;
/** шаг сетей сигналов — в конце тика */
export function stepCircuits(g: Game) {
  if (g.cdirty) rebuildCircuits(g);
  if (!g.cnets.length) { ms = 0; return; }
  const t0 = performance.now();
  for (const n of g.cnets) {
    // v1.6: два буфера сигналов сети — новый и прошлого тика; chg — сеть изменилась (комбинаторы с неизменным входом не пересчитываются)
    if (n.stat) { // ссылки на настройки постоянных комбинаторов и выходы комбинаторов те же — сигналы сети прежние
      const r = n.refs || (n.refs = []); let same = r.length === n.src!.length + n.outs.length, j = 0;
      for (const e of n.src!) { if (r[j] !== e.cc) { same = false; r[j] = e.cc; } j++; }
      for (const e of n.outs) { if (r[j] !== e.co) { same = false; r[j] = e.co; } j++; }
      r.length = j; if (same) { n.chg = false; continue; }
    }
    const old = n.sig, m = n.alt || new Map<string, number>(); m.clear();
    for (const e of n.src!) output(g, e, m);
    // выходы комбинаторов — значения, вычисленные в прошлом тике (поле co; _cof — те же пары плоским массивом)
    for (const e of n.outs) { const f = e._cof; if (f) for (let i = 0; i < f.length; i += 2) add(m, f[i] as string, f[i + 1] as number); else if (e.co) { const a: (string | number)[] = []; for (const k in e.co) a.push(k, e.co[k]); e._cof = a; for (let i = 0; i < a.length; i += 2) add(m, a[i] as string, a[i + 1] as number); } }
    n.sig = m; n.alt = old;
    let chg = m.size !== old.size; if (!chg) for (const [k, v] of m) if (old.get(k) !== v) { chg = true; break; }
    n.chg = chg;
  }
  for (const n of g.cnets) for (const e of n.ents) {
    if (e._pin) e._pin = undefined;
    // постройка в обеих сетях считается один раз — по сети с меньшим номером
    if (e._cn![0] >= 0 && e._cn![1] >= 0 && n.id !== Math.min(e._cn![0], e._cn![1])) continue;
    if (e.cc?.en && condCapable(e)) { const off = !condOk(g, e, e.cc.en); if (off !== !!e.coff) e.coff = off || undefined; }
    else if (e.coff) e.coff = undefined;
    if (e.t === 'lamp') {
      let col: string | undefined;
      if (e.cc?.col) for (const s of LAMP_ORDER) if (sigValue(g, e, s) > 0) { col = SIGNAL_COLORS[s]; break; }
      if (col !== e.ccol) { e.ccol = col; g.fxVer++; }
    }
    if (e.t === 'assembler' && e.cc?.setr) recipeBySignal(g, e);
  }
  // v1.6: комбинаторы — двойная буферизация: все новые выходы считаются по сетям этого тика, затем подменяются разом
  // (порядок обхода не влияет на результат; выход виден в сети в следующем тике — задержка 1 тик)
  const cs = g.ccombs; if (cs.length) {
    const nx: (Record<string, number> | undefined)[] = new Array(cs.length);
    for (let i = 0; i < cs.length; i++) {
      const e = cs[i]; const pw = g.sat(e) > 0; const cn = e._cn, inp = e.cc?.inp || 0;
      // вход не изменился (обе используемые сети), настройки и питание те же — выход прежний
      const same = e._cv === 1 && e._ccr === e.cc && e._pw === pw && (!cn || ((cn[0] < 0 || inp === 2 || !g.cnets[cn[0]].chg) && (cn[1] < 0 || inp === 1 || !g.cnets[cn[1]].chg)));
      nx[i] = same ? e.co : pw ? combOut(g, e) : undefined; e._cv = 1; e._ccr = e.cc; e._pw = pw;
    }
    for (let i = 0; i < cs.length; i++) { const e = cs[i], o = nx[i]; if (o === e.co) continue; e._cof = undefined; if (o) e.co = o; else if (e.co) e.co = undefined; }
  }
  ms = performance.now() - t0;
}
/** входные сигналы комбинатора (обе сети или одна — по настройке) */
const EMPTY = new Map<string, number>(); const scratch = new Map<string, number>();
/** вход комбинатора; одна сеть — её карта как есть (не копия, только чтение), две — общий буфер */
export function combIn(g: Game, e: Entity): Map<string, number> {
  const cn = e._cn; if (!cn) return EMPTY; const inp = e.cc?.inp || 0;
  const r = cn[0] >= 0 && inp !== 2 ? g.cnets[cn[0]].sig : null, gr = cn[1] >= 0 && inp !== 1 ? g.cnets[cn[1]].sig : null;
  if (!r || !gr) return r || gr || EMPTY;
  scratch.clear(); for (const [k, v] of r) scratch.set(k, v); for (const [k, v] of gr) add(scratch, k, v);
  return scratch;
}
/** int32: целое деление с усечением, остаток со знаком делимого, деление на 0 — 0; степень по кругу, отрицательная — 0 */
export function arith(op: AOp, a: number, b: number): number {
  a |= 0; b |= 0;
  switch (op) {
    case '+': return (a + b) | 0;
    case '−': return (a - b) | 0;
    case '×': return Math.imul(a, b);
    case '÷': return b === 0 ? 0 : (a / b) | 0;
    case '%': return b === 0 ? 0 : (a % b) | 0;
    case '^': { if (b < 0) return 0; let r = 1, x = a, k = b; while (k > 0) { if (k & 1) r = Math.imul(r, x); x = Math.imul(x, x); k >>>= 1; } return r; }
    case '<<': return a << (b & 31);
    case '>>': return a >> (b & 31);
    case 'AND': return a & b;
    case 'OR': return a | b;
    case 'XOR': return a ^ b;
  }
  return 0;
}
export function cmp(op: DOp, a: number, b: number): boolean {
  switch (op) { case '<': return a < b; case '>': return a > b; case '=': return a === b; case '≠': return a !== b; case '≤': return a <= b; case '≥': return a >= b; }
  return false;
}
const put = (o: Record<string, number>, k: string, v: number) => { if (!v) return; const r = ((o[k] || 0) + v) | 0; if (r) o[k] = r; else delete o[k]; };
/** новый выход комбинатора по входу этого тика (без энергии — пусто) */
export function combOut(g: Game, e: Entity): Record<string, number> | undefined {
  const cc = e.cc; if (!cc) return undefined;
  const ar = e.t === 'arith' ? cc.ar : undefined, de = e.t === 'decider' ? cc.de : undefined;
  const c = ar || de; if (!c || !c.a || !c.o) return undefined;
  const inp = combIn(g, e);
  const B = c.b ? inp.get(c.b) || 0 : c.n; const o: Record<string, number> = {};
  if (ar) {
    if (ar.a === EACH) { for (const [k, v] of inp) { const r = arith(ar.op, v, B); put(o, ar.o === EACH ? k : ar.o!, r); } }
    else { const r = arith(ar.op, inp.get(ar.a!) || 0, B); if (ar.o !== EACH) put(o, ar.o!, r); }
  } else if (de) {
    const one = !!de.one;
    if (de.a === EACH) {
      for (const [k, v] of inp) if (cmp(de.op, v, B)) { if (de.o === EACH) put(o, k, one ? 1 : v); else if (de.o === EVERY) { for (const [k2, v2] of inp) put(o, k2, one ? 1 : v2); break; } else put(o, de.o!, one ? 1 : v); }
    } else {
      let ok: boolean;
      if (de.a === ANY) { ok = false; for (const [, v] of inp) if (cmp(de.op, v, B)) { ok = true; break; } }
      else if (de.a === EVERY) { ok = true; for (const [, v] of inp) if (!cmp(de.op, v, B)) { ok = false; break; } }
      else ok = cmp(de.op, inp.get(de.a!) || 0, B);
      if (ok) { if (de.o === EVERY || de.o === EACH) for (const [k, v] of inp) put(o, k, one ? 1 : v); else put(o, de.o!, de.one ? 1 : inp.get(de.o!) || 0); }
    }
  }
  for (const k in o) return o; return undefined;
}
/** v1.6: сборщик с «рецептом по сигналу» — рецепт предмета с наибольшим положительным сигналом (равные — по алфавиту id); нет подходящих — без рецепта */
function recipeBySignal(g: Game, e: Entity) {
  if (!e._cn) { if (e.recipe) g.setRecipeSig(e, null); return; } let best: string | null = null, bv = 0; const cats = PROTOS[e.proto].cats || ['crafting'];
  for (const c of [0, 1]) { const id = e._cn[c]; if (id < 0) continue; for (const [k] of g.cnets[id].sig) {
    const v = sigValue(g, e, k); if (v <= 0 || !RECIPES[k] || !g.recipeAvailable(k) || !cats.includes(RECIPES[k].cat)) continue;
    if (v > bv || v === bv && best !== null && k < best) { best = k; bv = v; } } }
  if (best !== e.recipe) g.setRecipeSig(e, best);
}
/** конвейер в режиме «прочитать»: предмет вошёл на клетку */
export function beltPulse(e: Entity, item: string, n: number) { if (e.cc?.rd !== 1 || !e._cn) return; const p = e._pin || (e._pin = {}); p[item] = (p[item] || 0) + n; }
/** проверить и нормализовать настройки (команда игрока, чертёж, загрузка) */
export function cleanCC(e: { t: string }, o: any): CC | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const r: CC = {}; const okSig = (s: any) => typeof s === 'string' && !!ITEMS[s] && !ITEMS[s].meta;
  const num = (v: any) => Number.isFinite(+v) ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(+v))) : 0;
  if (o.en && COND_T.has(e.t)) r.en = { a: okSig(o.en.a) ? o.en.a : null, op: OPS.includes(o.en.op) ? o.en.op : '<', n: num(o.en.n), ...(okSig(o.en.b) ? { b: o.en.b } : {}) };
  if ((e.t === 'belt' && [1, 2].includes(o.rd)) || ((e.t === 'inserter' || e.t === 'pole' || e.t === 'lab' || e.t === 'assembler' || e.t === 'radar') && o.rd === 1) || ((e.t === 'roboport' || e.t === 'stop') && [1, 2, 3].includes(o.rd))) r.rd = o.rd;
  if (e.t === 'stop' && o.lim) r.lim = true;
  if (e.t === 'lamp' && o.col) r.col = true;
  if (e.t === 'assembler' && o.setr) r.setr = true;
  if (e.t === 'combinator') {
    r.sig = Array.from({ length: CC_SLOTS }, (_, i) => { const s = Array.isArray(o.sig) ? o.sig[i] : null; return s && okSig(s.s) ? { s: s.s, n: num(s.n) } : null; });
    if (o.on === false) r.on = false;
  }
  // v1.6: особые сигналы — только там, где допустимы
  const isMeta = (s: any, ok: string[]) => typeof s === 'string' && ok.includes(s);
  if (e.t === 'arith' && o.ar && typeof o.ar === 'object') {
    const a = okSig(o.ar.a) && !ITEMS[o.ar.a].meta || isMeta(o.ar.a, [EACH]) ? o.ar.a : null;
    const out = okSig(o.ar.o) && !ITEMS[o.ar.o].meta || (a === EACH && isMeta(o.ar.o, [EACH])) ? o.ar.o : null;
    r.ar = { a, op: AOPS.includes(o.ar.op) ? o.ar.op : '+', n: num(o.ar.n), o: out, ...(okSig(o.ar.b) && !ITEMS[o.ar.b].meta ? { b: o.ar.b } : {}) };
  }
  if (e.t === 'decider' && o.de && typeof o.de === 'object') {
    const a = okSig(o.de.a) && !ITEMS[o.de.a].meta || isMeta(o.de.a, [EACH, ANY, EVERY]) ? o.de.a : null;
    const out = okSig(o.de.o) && !ITEMS[o.de.o].meta || isMeta(o.de.o, a === EACH ? [EACH, EVERY] : [EVERY]) ? o.de.o : null;
    r.de = { a, op: DOPS.includes(o.de.op) ? o.de.op : '>', n: num(o.de.n), o: out, ...(okSig(o.de.b) && !ITEMS[o.de.b].meta ? { b: o.de.b } : {}), ...(o.de.one ? { one: true } : {}) };
  }
  if ((e.t === 'arith' || e.t === 'decider') && (o.inp === 1 || o.inp === 2)) r.inp = o.inp;
  return Object.keys(r).length ? r : undefined;
}
