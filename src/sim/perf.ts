// v1.9 «Мегабаза»: приёмы ускорения симуляции (каждый — под своим флагом) и профайлер F3.
// Флаги меняют только скорость, не результат: tests/mega.test.ts гоняет одну партию с флагами и без
// и сравнивает состояние побайтно (общие требования 2.3, риски v1.9).
import type { Entity, Game } from './game';
import { PROTOS } from '../data/entities';

export const OPT = {
  /** спящие конвейеры: лента без движения (пустая или забитая) не обновляется, пока её не тронут */
  sleepBelts: true,
  /** снимок для главного потока: видимые постройки — из корзин по чанкам, подписи невидимых — по 1/30 за кадр */
  snapIndex: true,
  /** карта издалека: снимок без быстрых полей и предметов на лентах */
  lodSnap: true,
  /** предметы на лентах в снимке — Int16 (x, y в 1/64 клетки от угла вида) + Uint16 код вместо трёх Float32 */
  packItems: true,
  /** «пакетный» обход: плотный массив построек с логикой тика вместо Map со всеми постройками (столбы, трубы, сундуки… не обходятся) */
  tickList: true,
  /** электросети: списки потребителей и генераторов по сетям, без обхода всех построек */
  powerLists: true,
  /** манипуляторы: кэш построек на клетках забора и выгрузки (сбрасывается при любой постройке/сносе) */
  inserterCache: true,
  /** пересборка электросетей по сетке (раньше — все пары столбов, O(n²)) */
  gridPoles: true,
};
export type OptKey = keyof typeof OPT;
export function setOpt(on: boolean | Partial<typeof OPT>) { for (const k of Object.keys(OPT) as OptKey[]) OPT[k] = typeof on === 'boolean' ? on : (on[k] ?? OPT[k]); }

/** Map построек со счётчиком изменений состава (по нему пересобираются плотные списки и кэши) */
export class EntMap extends Map<number, Entity> {
  ver = 0;
  set(k: number, v: Entity) { if (!super.has(k) || super.get(k) !== v) this.ver++; return super.set(k, v); }
  delete(k: number) { const e = super.get(k); if (e) { e._gone = true; this.ver++; } return super.delete(k); }
  clear() { this.ver++; super.clear(); }
}

/** типы построек, у которых есть логика тика (switch в Game.step) */
export const TICK_TYPES = new Set(['car', 'pumpjack', 'turret', 'lamp', 'pump', 'tpump', 'boiler', 'reactor', 'hexch', 'hpipe', 'drill', 'furnace', 'assembler', 'lab', 'inserter', 'belt', 'underground', 'splitter', 'engine', 'solar', 'silo', 'radar', 'arith', 'decider', 'beacon', 'accumulator', 'gate', 'flare']);
const ticks = (e: Entity) => TICK_TYPES.has(e.t) || !!PROTOS[e.proto]?.pollution || !!PROTOS[e.proto]?.regen;

/** плотный список построек с логикой тика — в порядке Map (порядок обхода не меняется, результат тот же) */
export function tickList(g: Game): Entity[] {
  const c = g._tl;
  if (c && c.ver === g.ents.ver) return c.list;
  const list: Entity[] = []; for (const e of g.ents.values()) if (ticks(e)) list.push(e);
  g._tl = { ver: g.ents.ver, list }; return list;
}
/** все электрические постройки с сетью — в порядке Map (для stepPower) */
export function powerList(g: Game): Entity[] {
  const c = g._pl;
  if (c && c.ver === g.ents.ver && c.pv === g.powerVer) return c.list;
  const list: Entity[] = []; for (const e of g.ents.values()) if (e._net != null && e._net >= 0) list.push(e);
  g._pl = { ver: g.ents.ver, pv: g.powerVer, list }; return list;
}

// ---------- профайлер ----------
/** подсистемы тика (строки F3) */
export const SUBS = ['cmd', 'player', 'power', 'heat', 'robots', 'ents', 'trains', 'circuits', 'enemies', 'stats'] as const;
export type Sub = typeof SUBS[number];
export const SUB_NAMES: Record<string, string> = { cmd: 'команды', player: 'инженер и стройка', power: 'электросети', heat: 'тепловая сеть', robots: 'роботы', ents: 'постройки', trains: 'поезда', circuits: 'схемотехника', enemies: 'Рой', stats: 'статистика',
  belts: 'конвейеры', machines: 'машины', inserters: 'манипуляторы', other: 'прочие постройки' };
export type Group = 'belts' | 'machines' | 'inserters' | 'other';
export const subOf = (t: string): Group => t === 'belt' || t === 'underground' || t === 'splitter' ? 'belts' : t === 'inserter' ? 'inserters'
  : t === 'furnace' || t === 'assembler' || t === 'drill' || t === 'lab' || t === 'pumpjack' || t === 'silo' || t === 'boiler' ? 'machines' : 'other';

export interface ProfReport {
  ticks: number; total: number; sub: [string, number][]; detail: boolean; groups: [string, number][];
  types: [string, number, number][]; chunks: [number, number, number, number][];
  sleeping: number; belts: number; listed: number; ents: number;
}
/** накопитель за окно в 60 тиков; detail — замер каждой постройки (только пока открыт профайлер F3) */
export class Profiler {
  detail = false; private n = 0; private sub = new Float64Array(SUBS.length); private tot = 0;
  private types = new Map<string, [number, number, string]>(); private chunks = new Map<number, [number, number, number, number]>();
  last: ProfReport | null = null; sleeping = 0; belts = 0;
  add(s: Sub, ms: number) { this.sub[SUBS.indexOf(s)] += ms; }
  addI(i: number, ms: number) { this.sub[i] += ms; }
  ent(e: Entity, ms: number) {
    const t = this.types.get(e.proto); if (t) { t[0] += ms; t[1]++; } else this.types.set(e.proto, [ms, 1, e.t]);
    const cx = Math.floor(e.x / 32), cy = Math.floor(e.y / 32), k = (cx + 32768) * 65536 + (cy + 32768);
    const c = this.chunks.get(k); if (c) { c[2] += ms; c[3]++; } else this.chunks.set(k, [cx, cy, ms, 1]);
  }
  tick(totalMs: number, g: Game) {
    this.tot += totalMs; this.n++;
    if (this.n < 60) return;
    const k = 1 / this.n;
    const gr: Record<string, number> = { belts: 0, machines: 0, inserters: 0, other: 0 };
    for (const [ms, , t] of this.types.values()) gr[subOf(t)] += ms * k;
    const types = [...this.types.entries()].map(([p, [ms, n]]) => [p, ms * k, Math.round(n * k)] as [string, number, number]).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const chunks = [...this.chunks.values()].map(([cx, cy, ms, n]) => [cx, cy, ms * k, Math.round(n * k)] as [number, number, number, number]).sort((a, b) => b[2] - a[2]).slice(0, 10);
    const tl = g._tl ? g._tl.list.length : g.ents.size;
    this.last = { ticks: this.n, total: this.tot * k, sub: SUBS.map((s, i) => [s, this.sub[i] * k] as [string, number]), detail: this.detail && this.types.size > 0, groups: this.types.size ? Object.entries(gr) : [], types, chunks, sleeping: Math.round(this.sleeping * k), belts: Math.round(this.belts * k), listed: tl, ents: g.ents.size };
    this.n = 0; this.tot = 0; this.sub.fill(0); this.types.clear(); this.chunks.clear(); this.sleeping = 0; this.belts = 0;
  }
}
export const now = () => performance.now();
