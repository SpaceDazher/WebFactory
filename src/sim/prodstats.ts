// v1.9: статистика производства 2.0 — окна 5 мин / 1 ч / 10 ч / 50 ч, предметы, жидкости, энергия, узкие места.
// Четыре яруса по 300 корзин: 1 с, 12 с, 2 мин, 10 мин. Каждую секунду накопленное за секунду (Game.curSec + энергия +
// выборка машин) добавляется во все ярусы; корзина яруса закрывается, когда истёк её срок. Сохраняется в партии (формат 13).
// Ключи: p:/c: — предмет или жидкость произведено/потрачено (штук, единиц жидкости), ep:/ec: — энергия по прототипу (кДж),
// bu:/bs: — выборки «машин, которым нужен предмет» / «из них ждут его» (узкие места), bt:/bo: — выборки рецепта / «выход забит».
import type { Game, Entity } from './game';
import { RECIPES } from '../data/recipes';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { TECHS } from '../data/techs';

export const N_BUCKETS = 300;
/** длина корзины яруса в секундах: 300 корзин → окна 5 мин, 1 ч, 10 ч, 50 ч */
export const TIER_SEC = [1, 12, 120, 600];
export const TIER_NAMES = ['5 мин', '1 ч', '10 ч', '50 ч'];
export interface Tier { head: number; n: number; age: number; acc: Record<string, number>; ring: Record<string, number[]>; }
export type Tab = 'items' | 'fluids' | 'energy' | 'bottlenecks';

const newTier = (): Tier => ({ head: 0, n: 0, age: 0, acc: {}, ring: {} });
export class ProdStats {
  tiers: Tier[] = TIER_SEC.map(newTier);
  /** энергия за текущую секунду, кДж: выработка и потребление по прототипу (наполняется в stepPower) */
  ep: Record<string, number> = {}; ec: Record<string, number> = {};
  /** v1.9: сколько секунд записано всего (для подсказки «данных пока мало») */
  secs = 0;
  /** закрыть секунду: предметы из curSec, энергия, выборка машин */
  second(g: Game, cur: { p: Record<string, number>; c: Record<string, number> }) {
    const add: Record<string, number> = {};
    for (const k in cur.p) add['p:' + k] = cur.p[k];
    for (const k in cur.c) add['c:' + k] = cur.c[k];
    for (const k in this.ep) add['ep:' + k] = this.ep[k] / 1; // кВт·тик/60 уже в кДж
    for (const k in this.ec) add['ec:' + k] = this.ec[k];
    this.ep = {}; this.ec = {};
    sampleMachines(g, add);
    this.secs++;
    for (let t = 0; t < this.tiers.length; t++) {
      const T = this.tiers[t];
      for (const k in add) T.acc[k] = (T.acc[k] || 0) + add[k];
      if (++T.age >= TIER_SEC[t]) this.close(T);
    }
  }
  private close(T: Tier) {
    for (const k in T.ring) T.ring[k][T.head] = 0;
    for (const k in T.acc) { let r = T.ring[k]; if (!r) r = T.ring[k] = new Array(N_BUCKETS).fill(0); r[T.head] = Math.round(T.acc[k] * 1000) / 1000; }
    T.acc = {}; T.age = 0; T.head = (T.head + 1) % N_BUCKETS; T.n = Math.min(N_BUCKETS, T.n + 1);
  }
  /** суммы по окну яруса (закрытые корзины) и длительность окна в секундах */
  totals(tier: number): { sum: Record<string, number>; sec: number } {
    const T = this.tiers[tier]; const sum: Record<string, number> = {};
    for (const k in T.ring) { const r = T.ring[k]; let s = 0; for (let i = 0; i < N_BUCKETS; i++) s += r[i]; if (s) sum[k] = s; }
    return { sum, sec: T.n * TIER_SEC[tier] };
  }
  /** ряд по корзинам (старые → новые) для графика */
  series(tier: number, key: string): number[] {
    const T = this.tiers[tier]; const r = T.ring[key]; const out: number[] = [];
    for (let i = 0; i < T.n; i++) { const j = (T.head - T.n + i + N_BUCKETS) % N_BUCKETS; out.push(r ? r[j] : 0); }
    return out;
  }
  toJSON() { return { v: 1, secs: this.secs, ep: this.ep, ec: this.ec, tiers: this.tiers.map(t => ({ head: t.head, n: t.n, age: t.age, acc: t.acc, ring: t.ring })) }; }
  static from(o: any): ProdStats {
    const s = new ProdStats(); if (!o || o.v !== 1 || !Array.isArray(o.tiers)) return s;
    s.secs = +o.secs || 0;
    for (const [src, dst] of [[o.ep, s.ep], [o.ec, s.ec]] as const) for (const k in src || {}) if (Number.isFinite(src[k])) dst[k] = src[k]; // незакрытая секунда энергии
    o.tiers.slice(0, TIER_SEC.length).forEach((t: any, i: number) => {
      const T = s.tiers[i]; T.head = (t.head | 0) % N_BUCKETS; T.n = Math.min(N_BUCKETS, t.n | 0); T.age = t.age | 0;
      for (const k in t.acc || {}) if (Number.isFinite(t.acc[k])) T.acc[k] = t.acc[k];
      for (const k in t.ring || {}) { const r = t.ring[k]; if (Array.isArray(r) && r.length === N_BUCKETS) T.ring[k] = r.map((x: any) => Number.isFinite(x) ? x : 0); }
    });
    return s;
  }
}

/** машины с рецептом: кому чего не хватает (узкие места), у кого забит выход — выборка раз в секунду */
const MACHINES = new Set(['assembler', 'furnace', 'lab', 'silo']);
function sampleMachines(g: Game, add: Record<string, number>) {
  const list: Entity[] = g._tl ? g._tl.list : [...g.ents.values()];
  for (let i = 0; i < list.length; i++) {
    const e = list[i]; if (!MACHINES.has(e.t) || e._gone) continue;
    let ins: string[] | null = null, rid: string | null = null;
    if (e.t === 'lab') { const t = g.research.current; ins = t ? labPacks(g) : null; rid = 'lab'; }
    else { rid = e.recipe || null; const r = rid ? RECIPES[rid] : null; ins = r ? r.in.map(x => x[0]) : null; }
    if (!rid || !ins) continue;
    add['bt:' + rid] = (add['bt:' + rid] || 0) + 1;
    if (e.status === 'output-full') add['bo:' + rid] = (add['bo:' + rid] || 0) + 1;
    for (const it of ins) add['bu:' + it] = (add['bu:' + it] || 0) + 1;
    if (e.status === 'no-input') { const m = missing(g, e, ins); if (m) add['bs:' + m] = (add['bs:' + m] || 0) + 1; }
  }
}
let labCache: { t: string | null; packs: string[] } = { t: null, packs: [] };
function labPacks(g: Game): string[] {
  const t = g.research.current; if (labCache.t === t) return labCache.packs;
  labCache = { t, packs: (t && TECHS[t]?.packs) || [] }; return labCache.packs;
}
/** какого входа не хватает машине в состоянии «нет сырья» */
function missing(g: Game, e: Entity, ins: string[]): string | null {
  if (e.t === 'furnace') return ins[0] || null;
  const r = e.recipe ? RECIPES[e.recipe] : null;
  for (const it of ins) {
    const need = r ? (r.in.find(x => x[0] === it)?.[1] ?? 1) : 1;
    if (ITEMS[it]?.fluid) { const fn = g.fluidNetFor(e, it, 'in'); if (!fn || fn.amount < need - 1e-6) return it; continue; }
    if ((e.input?.[it] || 0) < need) return it;
  }
  return null;
}

/** строки окна статистики: что показать во вкладке */
export interface StatRow { id: string; p: number; c: number; series?: number[]; cs?: number[]; }
export interface Bottleneck { item: string; share: number; waiting: number; using: number; }
export interface BlockRow { recipe: string; share: number; machines: number; }
export interface StatsView { tier: number; sec: number; tab: Tab; rows: StatRow[]; bott?: Bottleneck[]; blocked?: BlockRow[]; secs: number; }
/** данные вкладки (считает Worker, в главный поток уходит только это) */
export function statsView(g: Game, tier: number, tab: Tab, top = 40, sel: string | null = null): StatsView {
  const ps = g.pstats; tier = Math.max(0, Math.min(TIER_SEC.length - 1, tier | 0));
  const { sum, sec } = ps.totals(tier);
  const v: StatsView = { tier, sec, tab, rows: [], secs: ps.secs };
  if (tab === 'bottlenecks') {
    const bott: Bottleneck[] = [], blocked: BlockRow[] = [];
    const samples = Math.max(1, sec);
    for (const k in sum) {
      if (k.startsWith('bu:')) { const it = k.slice(3), u = sum[k], w = sum['bs:' + it] || 0; if (w > 0) bott.push({ item: it, share: w / u, waiting: w / samples, using: u / samples }); }
      else if (k.startsWith('bt:')) { const r = k.slice(3), t = sum[k], o = sum['bo:' + r] || 0; if (o > 0) blocked.push({ recipe: r, share: o / t, machines: t / samples }); }
    }
    bott.sort((a, b) => b.share - a.share || a.item.localeCompare(b.item)); blocked.sort((a, b) => b.share - a.share || a.recipe.localeCompare(b.recipe));
    v.bott = bott.slice(0, top); v.blocked = blocked.slice(0, top); return v;
  }
  const P = tab === 'energy' ? 'ep:' : 'p:', C = tab === 'energy' ? 'ec:' : 'c:';
  const ids = new Set<string>();
  for (const k in sum) { if (k.startsWith(P)) ids.add(k.slice(P.length)); else if (k.startsWith(C)) ids.add(k.slice(C.length)); }
  for (const id of ids) {
    if (tab !== 'energy') { const fl = !!ITEMS[id]?.fluid; if ((tab === 'fluids') !== fl) continue; }
    v.rows.push({ id, p: sum[P + id] || 0, c: sum[C + id] || 0 });
  }
  v.rows.sort((a, b) => Math.max(b.p, b.c) - Math.max(a.p, a.c) || a.id.localeCompare(b.id));
  v.rows = v.rows.slice(0, top);
  for (const r of v.rows) if (r.id === sel) { r.series = ps.series(tier, P + r.id); r.cs = ps.series(tier, C + r.id); }
  return v;
}
/** подпись прототипа для вкладки «Энергия» */
export const energyName = (id: string) => PROTOS[id]?.name || ITEMS[id]?.name || id;
