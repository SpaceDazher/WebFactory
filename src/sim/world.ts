// Мир: чанки 32×32, детерминированная генерация по seed (4.4).
import { Noise2D } from '../core/noise';
import { hash2, RNG } from '../core/rng';
import { CHUNK, ckey } from '../core/types';
import { RESOURCES, MAPGEN } from '../data/resources';
import type { Overlay } from './scenario';

export const T_GRASS = 0, T_SAND = 1, T_STONE = 2, T_SHALLOW = 3, T_DEEP = 4;
export const TERRAIN_NAMES = ['Трава', 'Песок', 'Камень', 'Мелкая вода', 'Глубокая вода'];
export const TERRAIN_SPEED = [1, 0.9, 1, 0, 0];
export const RES_ITEMS = ['', 'iron-ore', 'copper-ore', 'coal', 'stone', 'crude-oil', 'uranium-ore'];
export const R_OIL = 5, R_URAN = 6;
export const D_TREE = 1, D_ROCK = 2;

export interface Chunk {
  cx: number; cy: number;
  terrain: Uint8Array; res: Uint8Array; amt: Uint32Array; decor: Uint8Array; occ: Int32Array;
  mods: Map<number, number>; // изменённые количества руды (для сохранения)
  decorRemoved: Set<number>;
  version: number;           // растёт при изменениях — для перерисовки
  pollution: number; absorb: number; // загрязнение (10.1): количество и поглощение за тик
  ov?: number; av?: number;  // счётчики изменений занятости и запасов руды — для передачи из Worker
  /** v1.14: засыпанные насыпью клетки (сохраняются), слизь Роя (0–255) и её версия, тик последнего роста слизи от гнезда */
  land?: Set<number>; creep?: Uint8Array; cv?: number; cn?: number;
  /** v1.16: чанк создан в мире до 1.16 — урана в нём нет (сохраняется) */ noU?: boolean;
}
/** v1.10: множители ресурса из данных (моды): запасы и размер пятна; 1 — без изменений */
const resK = (res: number) => { const d = RESOURCES[RES_ITEMS[res]]; return (d ? d.richness : 1) * MAPGEN.default.richness; };
const resS = (res: number) => RESOURCES[RES_ITEMS[res]]?.size ?? 1;
/** v1.16: настройки генерации нового мира; массивы индексируются 1–6 по типу ресурса. */
export interface GenSet { water: number; size: number[]; rich: number[]; freq: number[]; spacing: number[]; biomeScale: number; uranium: boolean; }
/** Версия 2 добавляет связные поля и биомы; версии сценариев/сохранений остаются отдельными. */
export const GEN_VER = 2;
/** Старые fmt 2 и сохранения 1.16 rc7 без genv используют первый алгоритм. */
export const GEN_LEGACY_VER = 1;
export const GEN_LIM = { water: [0.5, 2], size: [0.5, 2], rich: [0.25, 4], freq: [0.25, 2] } as const;
const FIELD_SPACING = [0, 240, 240, 270, 300, 440, 650];
const FIELD_RADIUS = [0, 10, 10, 9, 8, 18, 8];
const FIELD_RICHNESS = [0, 900, 900, 850, 800, 0, 620];
export function genSpacingRange(resource: number, frequency = 1): [number, number] {
  const base = FIELD_SPACING[resource] || FIELD_SPACING[1];
  const f = Math.max(GEN_LIM.freq[0], Math.min(GEN_LIM.freq[1], Number.isFinite(+frequency) ? +frequency : 1));
  const ideal = base / Math.sqrt(f);
  return [Math.max(80, Math.floor(ideal * 0.75 / 10) * 10), Math.min(1200, Math.ceil(ideal * 1.35 / 10) * 10)];
}
export function genSpacingDefault(resource: number, frequency = 1): number {
  const range = genSpacingRange(resource, frequency), ideal = FIELD_SPACING[resource] / Math.sqrt(Math.max(0.25, Math.min(2, frequency)));
  return Math.max(range[0], Math.min(range[1], Math.round(ideal / 10) * 10));
}
/** очистка и сжатие настроек: всё по умолчанию → null (мир как в 1.15) */
export function cleanGen(raw: any): GenSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v: any, lim: readonly number[]) => { const x = +v; return Number.isFinite(x) ? Math.round(Math.max(lim[0], Math.min(lim[1], x)) * 100) / 100 : 1; };
  const arr = (a: any, lim: readonly number[]) => [1, 2, 3, 4, 5, 6].reduce((o, i) => { o[i] = n(Array.isArray(a) ? a[i] : 1, lim); return o; }, [1, 1, 1, 1, 1, 1, 1] as number[]);
  const biomeScale = Number.isFinite(+raw.biomeScale) ? Math.round(Math.max(0.5, Math.min(2, +raw.biomeScale)) * 100) / 100 : 1.5;
  const g: GenSet = { water: n(raw.water ?? 1, GEN_LIM.water), size: arr(raw.size, GEN_LIM.size), rich: arr(raw.rich, GEN_LIM.rich), freq: arr(raw.freq, GEN_LIM.freq), spacing: [1, 1, 1, 1, 1, 1, 1], biomeScale, uranium: raw.uranium !== false };
  for (let i = 1; i <= 6; i++) {
    const range = genSpacingRange(i, g.freq[i]);
    const x = Number.isFinite(+(raw.spacing?.[i])) ? +(raw.spacing[i]) : genSpacingDefault(i, g.freq[i]);
    g.spacing[i] = Math.max(range[0], Math.min(range[1], Math.round(Math.max(0, x) / 10) * 10));
  }
  const defaultSpacing = g.spacing.every((v, i) => i === 0 || v === genSpacingDefault(i, 1));
  return g.water === 1 && [g.size, g.rich, g.freq].every(a => a.every(v => v === 1)) && defaultSpacing && g.biomeScale === 1.5 && g.uranium ? null : g;
}
interface Patch { x: number; y: number; r: number; res: number; rich: number; }
interface OccChunkCache {
  last: { cx: number; cy: number; key: number; chunk: Chunk } | null;
  getChunk: World['getChunk'];
  chunkAt: World['chunkAt'];
}

export class World {
  seed: number; genv: number; chunks = new Map<number, Chunk>();
  private occChunkCache: OccChunkCache | null = null;
  nH: Noise2D; nM: Noise2D; nR: Noise2D[]; nF: Noise2D;
  patches: Patch[] = []; lake: Patch; oil: Patch;
  /** v1.16: гарантированное урановое месторождение; noise — отдельный шум; noUranium — новые чанки создаются без урана (чанки старых сохранений) */
  uranium: Patch; nU: Noise2D; noUranium = false;
  onChunkGen: ((c: Chunk) => void) | null = null; // для врагов (симуляция)
  onAnyGen: ((c: Chunk) => void) | null = null;   // для рендера
  /** v1.11: событие on_chunk_generated для скриптов модов */ onGenScript: ((c: Chunk) => void) | null = null;
  /** v1.15: правки карты сценария (границы, чистая карта, нарисованные клетки) */ ov: Overlay | null;
  /** v1.16: настройки генерации (null — стандартные) */ gs: GenSet | null;
  private K(res: number) { return resK(res) * (this.gs?.rich[res] ?? 1); }
  private S(res: number) { return resS(res) * (this.gs?.size[res] ?? 1); }
  private F(res: number) { return this.gs?.freq[res] ?? 1; }
  private wsh() { return this.gs ? (this.gs.water - 1) * 0.12 : 0; }
  constructor(seed: number, ov: Overlay | null = null, gen: any = null, genv = GEN_VER) {
    this.seed = seed; this.genv = Number.isInteger(genv) && genv >= GEN_LEGACY_VER && genv <= GEN_VER ? genv : GEN_LEGACY_VER; this.ov = ov; this.gs = cleanGen(gen);
    this.nH = new Noise2D(seed ^ 0x1111); this.nM = new Noise2D(seed ^ 0x2222); this.nF = new Noise2D(seed ^ 0x3333);
    this.nR = [0, 1, 2, 3, 4].map(i => new Noise2D(seed + 1000 * (i + 1)));
    const r = new RNG(seed ^ 0xabcdef);
    const a0 = r.float() * Math.PI * 2;
    const ld = 26 + r.float() * 10;
    this.lake = { x: Math.cos(a0) * ld, y: Math.sin(a0) * ld, r: 8 + r.float() * 3, res: 0, rich: 0 };
    const ao = a0 + Math.PI + (r.float() - 0.5);
    const od = 95 + r.float() * 30;
    this.oil = { x: Math.cos(ao) * od, y: Math.sin(ao) * od, r: 6, res: 5, rich: 0 };
    const order = [1, 3, 2, 4];
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i + 1) * (Math.PI * 2 / 5) + (r.float() - 0.5) * 0.3;
      const d = 22 + r.float() * 18;
      this.patches.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: order[i] === 4 ? 6 : 8 + r.float() * 2, res: order[i], rich: 900 + r.float() * 600 });
    }
    // v1.16: уран — отдельные шум и ГПСЧ, прежняя генерация карты не сдвигается
    this.nU = new Noise2D(seed ^ 0x6a6a55);
    this.uranium = this.findUranium();
  }
  private biomeScale() { return this.genv >= 2 ? (this.gs?.biomeScale ?? 1.5) : 1; }
  private spacing(res: number) { return this.gs?.spacing[res] ?? genSpacingDefault(res, this.F(res)); }
  /** Кандидаты стоят на координатной решётке с ограниченным сдвигом и запасом на максимальную ширину края. */
  private fieldPitch(res: number) {
    const radius = FIELD_RADIUS[res] * this.S(res) * 1.12;
    return (this.spacing(res) + 2 * radius) / 0.75;
  }
  private fieldCenter(res: number, gx: number, gy: number): [number, number] {
    const pitch = this.fieldPitch(res), salt = (0x5a17 + res * 0x9e3779b1) | 0;
    const jx = (hash2(gx, gy, this.seed ^ salt) - 0.5) * pitch * 0.25;
    const jy = (hash2(gy, gx, this.seed ^ salt ^ 0x6d2b79f5) - 0.5) * pitch * 0.25;
    return [(gx + 0.5) * pitch + jx, (gy + 0.5) * pitch + jy];
  }
  private fieldSelected(res: number, gx: number, gy: number) {
    const salt = (0x71c3 + res * 0x45d9f3b) | 0;
    return hash2(gx, gy, this.seed ^ salt) < Math.min(0.92, 0.38 * this.F(res));
  }
  /** Связное поле дальней карты. Все значения зависят только от seed и координат, не от порядка чанков. */
  private distantFieldAmount(res: number, x: number, y: number): number {
    const pitch = this.fieldPitch(res), radius = FIELD_RADIUS[res] * this.S(res);
    const gx0 = Math.floor(x / pitch), gy0 = Math.floor(y / pitch);
    let amount = 0;
    for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
      if (!this.fieldSelected(res, gx, gy)) continue;
      const [fx, fy] = this.fieldCenter(res, gx, gy), fd = Math.hypot(fx, fy);
      if (fd < 150) continue;
      const d = Math.hypot(x - fx, y - fy);
      // Keep the edge irregular between fields, but stable within one field so high-frequency noise
      // cannot leave isolated resource cells beyond an otherwise coherent deposit.
      const edge = radius * (1 + 0.12 * this.nR[0].get(fx / 40 + res * 50, fy / 40 + res * 31));
      if (d < edge) amount = Math.max(amount, Math.floor((FIELD_RICHNESS[res] + Math.max(0, fd - 150) * 0.18) * this.K(res) * (1.2 - d / edge)));
    }
    return amount;
  }
  private hasNearbyOilField(x: number, y: number): boolean {
    const pitch = this.fieldPitch(R_OIL), gx0 = Math.floor(x / pitch), gy0 = Math.floor(y / pitch);
    for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
      if (!this.fieldSelected(R_OIL, gx, gy)) continue;
      const [fx, fy] = this.fieldCenter(R_OIL, gx, gy);
      if (Math.hypot(fx, fy) > 200 && Math.hypot(fx - x, fy - y) < 28) return true;
    }
    return false;
  }
  private terrainV2At(x: number, y: number): number {
    const dist = Math.hypot(x, y), scale = this.biomeScale();
    let h = this.nH.fbm(x, y, 4, 1 / (220 * scale));
    const m = this.nM.fbm(x + 5000, y - 3000, 3, 1 / (260 * scale));
    if (dist < 60) h = h * (dist / 60) + 0.2 * (1 - dist / 60);
    const ld = Math.hypot(x - this.lake.x, y - this.lake.y);
    const lakeEdge = this.lake.r * (1 + 0.25 * this.nF.get(x / 6, y / 6));
    if (ld < lakeEdge) return ld < lakeEdge - 3 ? T_DEEP : T_SHALLOW;
    if (h < -0.42 + this.wsh()) return h < -0.5 + this.wsh() ? T_DEEP : T_SHALLOW;
    if (m < -0.28) return T_SAND;
    if (h > 0.42) return T_STONE;
    return T_GRASS;
  }
  /** тип поверхности в точке (та же формула, что в gen) */
  terrainAt(x: number, y: number): number {
    if (this.genv >= 2) return this.terrainV2At(x, y);
    const dist = Math.hypot(x, y);
    let h = this.nH.fbm(x, y, 4, 1 / 220);
    const m = this.nM.fbm(x + 5000, y - 3000, 3, 1 / 260);
    if (dist < 60) h = h * (dist / 60) + 0.2 * (1 - dist / 60);
    const ld = Math.hypot(x - this.lake.x, y - this.lake.y);
    const lakeEdge = this.lake.r * (1 + 0.25 * this.nF.get(x / 6, y / 6));
    if (ld < lakeEdge) return ld < lakeEdge - 3 ? T_DEEP : T_SHALLOW;
    if (h < -0.42 + this.wsh()) return h < -0.5 + this.wsh() ? T_DEEP : T_SHALLOW;
    if (m < -0.28) return T_SAND;
    if (h > 0.42) return T_STONE;
    return T_GRASS;
  }
  /** есть ли в точке «фоновая» руда дальней карты */
  private noiseOre(x: number, y: number): boolean { if (Math.hypot(x, y) <= 90) return false; for (let k = 1; k <= 4; k++) if (this.nR[k].fbm(x, y, 3, 1 / 70) - 0.5 > 0) return true; return false; }
  private uEdge(p: Patch, x: number, y: number) { return p.r * (1 + 0.22 * this.nU.get(x / 5 + 77, y / 5)); }
  /** запас урана в клетке поля */
  uAmount(p: Patch, x: number, y: number): number { const d = Math.hypot(x - p.x, y - p.y), e = this.uEdge(p, x, y); return d < e ? Math.floor(p.rich * this.K(R_URAN) * (1.2 - d / e)) : 0; }
  /** Детерминированный поиск суши для гарантированного поля урана: 200–500 клеток от старта, запас 50 000–150 000 */
  private findUranium(): Patch {
    if (this.genv >= 2 && this.gs?.uranium === false) return { x: 0, y: 0, r: 0, res: R_URAN, rich: 0 };
    const rr = new RNG(this.seed ^ 0x75a3c1);
    const r = (6.5 + rr.float() * 2) * (this.genv >= 2 ? this.S(R_URAN) : 1), total = 55000 + rr.float() * 90000;
    const ok = (x: number, y: number, strict: boolean) => {
      if (this.terrainAt(x, y) >= T_SHALLOW) return false;
      if (!strict) return true;
      const hasOre = (px: number, py: number) => this.genv >= 2 ? [1, 2, 3, 4].some(k => this.distantFieldAmount(k, px, py) > 0) : this.noiseOre(px, py);
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, px = x + Math.cos(a) * (r + 2), py = y + Math.sin(a) * (r + 2); if (this.terrainAt(px, py) >= T_SHALLOW || hasOre(px, py)) return false; }
      for (const [dx, dy] of [[0, 0], [r / 2, 0], [-r / 2, 0], [0, r / 2], [0, -r / 2]]) if (hasOre(x + dx, y + dy)) return false;
      return Math.hypot(x - this.oil.x, y - this.oil.y) > r + 12 && (this.genv < 2 || !this.hasNearbyOilField(x, y));
    };
    let cx = 0, cy = 0, found = false;
    for (let k = 0; k < 900 && !found; k++) {
      const a = rr.float() * Math.PI * 2, d = 200 + rr.float() * 300; cx = Math.cos(a) * d; cy = Math.sin(a) * d;
      found = ok(cx, cy, k < 700);
    }
    if (!found) { cx = 260; cy = 0; }
    const p: Patch = { x: cx, y: cy, r, res: R_URAN, rich: 1 };
    let sum = 0; for (let y = Math.floor(cy - r * 1.3) - 1; y <= cy + r * 1.3 + 1; y++) for (let x = Math.floor(cx - r * 1.3) - 1; x <= cx + r * 1.3 + 1; x++) { if (this.terrainAt(x, y) >= T_SHALLOW) continue; const d = Math.hypot(x - cx, y - cy), e = this.uEdge(p, x, y); if (d < e) sum += 1.2 - d / e; }
    p.rich = sum > 0 ? total / sum : 1000;
    return p;
  }
  getChunk(cx: number, cy: number): Chunk {
    const k = ckey(cx, cy); let c = this.chunks.get(k);
    if (!c) { c = this.gen(cx, cy); this.chunks.set(k, c); if (this.onChunkGen) this.onChunkGen(c); this.onAnyGen?.(c); this.onGenScript?.(c); }
    return c;
  }
  hasChunk(cx: number, cy: number) { return this.chunks.has(ckey(cx, cy)); }
  chunkAt(x: number, y: number) { return this.getChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); }
  idx(x: number, y: number) { return (((y % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((x % CHUNK) + CHUNK) % CHUNK); }
  terrain(x: number, y: number) { return this.chunkAt(x, y).terrain[this.idx(x, y)]; }
  res(x: number, y: number) { const c = this.chunkAt(x, y), i = this.idx(x, y); return c.amt[i] > 0 ? c.res[i] : 0; }
  /** руда, которую можно добыть буром/рукой (без нефти) */
  ore(x: number, y: number) { const r = this.res(x, y); return r === R_OIL ? 0 : r; }
  amt(x: number, y: number) { return this.chunkAt(x, y).amt[this.idx(x, y)]; }
  decor(x: number, y: number) { return this.chunkAt(x, y).decor[this.idx(x, y)]; }
  occ(x: number, y: number) {
    const cache = this.occChunkCache;
    return cache ? this.occCached(x, y, cache) : this.chunkAt(x, y).occ[this.idx(x, y)];
  }
  setOcc(x: number, y: number, id: number) { const c = this.chunkAt(x, y); c.occ[this.idx(x, y)] = id; c.ov = (c.ov || 0) + 1; }
  private occCached(x: number, y: number, cache: OccChunkCache) {
    // A hook may install lookup overrides during a scoped rebuild. Keep those
    // observable even when the previous tile came from the same chunk.
    if (this.getChunk !== cache.getChunk || this.chunkAt !== cache.chunkAt) {
      cache.last = null;
      return this.chunkAt(x, y).occ[this.idx(x, y)];
    }
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), key = ckey(cx, cy);
    const last = cache.last;
    if (last && last.cx === cx && last.cy === cy && this.chunks.get(last.key) === last.chunk)
      return last.chunk.occ[this.idx(x, y)];
    const chunk = this.chunkAt(x, y);
    // Generation hooks can replace the just-created chunk before chunkAt returns.
    cache.last = this.chunks.get(key) === chunk ? { cx, cy, key, chunk } : null;
    return chunk.occ[this.idx(x, y)];
  }
  /** Reuse the current occupancy chunk only during a synchronous read batch. */
  withOccChunkCache<T>(run: () => T): T {
    if (this.getChunk !== World.prototype.getChunk || this.chunkAt !== World.prototype.chunkAt
      || this.occ !== World.prototype.occ || this.setOcc !== World.prototype.setOcc) return run();
    const previous = this.occChunkCache;
    this.occChunkCache = { last: null, getChunk: this.getChunk, chunkAt: this.chunkAt };
    try { return run(); }
    finally { this.occChunkCache = previous; }
  }
  /** уменьшить руду на 1, вернуть id предмета */
  mineRes(x: number, y: number): string | null {
    const c = this.chunkAt(x, y), i = this.idx(x, y);
    if (c.amt[i] <= 0) return null;
    c.amt[i]--; c.mods.set(i, c.amt[i]); c.av = (c.av || 0) + 1;
    const item = RES_ITEMS[c.res[i]];
    if (c.amt[i] === 0) { c.res[i] = 0; c.version++; }
    return item;
  }
  removeDecor(x: number, y: number) { const c = this.chunkAt(x, y), i = this.idx(x, y); c.decor[i] = 0; c.decorRemoved.add(i); c.version++; }
  walkable(x: number, y: number) { return TERRAIN_SPEED[this.terrain(x, y)] > 0; }

  /** v1.16: урановые поля — гарантированное и редкие дальние (отдельный ГПСЧ на чанк) */
  private genUranium(c: Chunk) {
    if (this.genv >= 2) { this.genUraniumV2(c); return; }
    if (this.gs?.uranium === false) return;
    const cx = c.cx, cy = c.cy, N = CHUNK * CHUNK;
    const put = (lx: number, ly: number, amt: number) => {
      if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK || amt <= 0) return; const i = ly * CHUNK + lx;
      if (c.terrain[i] >= T_SHALLOW || c.res[i]) return;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (ly + dy) * CHUNK + lx + dx; if (j >= 0 && j < N && c.res[j] === R_OIL) return; }
      c.res[i] = R_URAN; c.amt[i] = amt; c.decor[i] = 0;
    };
    const P = this.uranium;
    if (Math.abs(P.x - (cx * CHUNK + 16)) < 16 + P.r * 1.3 + 2 && Math.abs(P.y - (cy * CHUNK + 16)) < 16 + P.r * 1.3 + 2) {
      for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) put(lx, ly, this.uAmount(P, cx * CHUNK + lx, cy * CHUNK + ly));
    }
    const cd = Math.hypot(cx * CHUNK + 16, cy * CHUNK + 16);
    if (cd > 250 && hash2(cx, cy, this.seed ^ 0x0aa5) < 0.045 * this.F(R_URAN)) {
      const rr = new RNG(this.seed ^ (cx * 9157 + cy * 3331) ^ 0x7e11);
      const fx = 9 + rr.int(14), fy = 9 + rr.int(14), fr = 3.2 + rr.float() * 2.6, rich = (260 + rr.float() * 500) * (1 + cd / 3000);
      for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const d = Math.hypot(lx - fx, ly - fy), e = fr * (1 + 0.22 * this.nU.get((cx * CHUNK + lx) / 5 + 77, (cy * CHUNK + ly) / 5));
        if (d < e) put(lx, ly, Math.floor(rich * this.K(R_URAN) * (1.2 - d / e)));
      }
    }
  }
  /** Версия 2: уран генерируется своим шумом и решёткой месторождений, не трогая поверхность, нефть и декор. */
  private genUraniumV2(c: Chunk) {
    if (this.gs?.uranium === false) return;
    const cx = c.cx, cy = c.cy, N = CHUNK * CHUNK, ox = cx * CHUNK, oy = cy * CHUNK;
    const put = (lx: number, ly: number, amount: number) => {
      if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK || amount <= 0) return;
      const i = ly * CHUNK + lx;
      if (c.terrain[i] >= T_SHALLOW || c.res[i]) return;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = lx + dx, ny = ly + dy;
        if (nx >= 0 && ny >= 0 && nx < CHUNK && ny < CHUNK && c.res[ny * CHUNK + nx] === R_OIL) return;
      }
      c.res[i] = R_URAN; c.amt[i] = amount;
    };
    const p = this.uranium;
    if (p.r > 0 && Math.abs(p.x - (ox + 16)) < 16 + p.r * 1.3 + 2 && Math.abs(p.y - (oy + 16)) < 16 + p.r * 1.3 + 2) {
      for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        put(lx, ly, this.uAmount(p, ox + lx, oy + ly));
      }
    }
    const pitch = this.fieldPitch(R_URAN), radius = FIELD_RADIUS[R_URAN] * this.S(R_URAN), maxEdge = radius * 1.12;
    const gx0 = Math.floor((ox - maxEdge) / pitch), gx1 = Math.floor((ox + CHUNK + maxEdge) / pitch);
    const gy0 = Math.floor((oy - maxEdge) / pitch), gy1 = Math.floor((oy + CHUNK + maxEdge) / pitch);
    for (let gy = gy0 - 1; gy <= gy1 + 1; gy++) for (let gx = gx0 - 1; gx <= gx1 + 1; gx++) {
      if (!this.fieldSelected(R_URAN, gx, gy)) continue;
      const [fx, fy] = this.fieldCenter(R_URAN, gx, gy), fd = Math.hypot(fx, fy);
      if (fd <= 250 || (p.r > 0 && Math.hypot(fx - p.x, fy - p.y) < p.r * 1.22 + maxEdge + this.spacing(R_URAN))) continue;
      for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const x = ox + lx, y = oy + ly, d = Math.hypot(x - fx, y - fy);
        const edge = radius * (1 + 0.12 * this.nU.get(fx / 40 + 77, fy / 40 + 31));
        if (d < edge) {
          const rich = 260 + hash2(gx, gy, this.seed ^ 0x7e11) * 500;
          put(lx, ly, Math.floor(rich * (1 + fd / 3000) * this.K(R_URAN) * (1.2 - d / edge)));
        }
      }
    }
    void N;
  }
  private gen(cx: number, cy: number): Chunk {
    if (this.genv >= 2) return this.genV2(cx, cy);
    const N = CHUNK * CHUNK;
    const c: Chunk = { cx, cy, terrain: new Uint8Array(N), res: new Uint8Array(N), amt: new Uint32Array(N), decor: new Uint8Array(N), occ: new Int32Array(N).fill(-1), mods: new Map(), decorRemoved: new Set(), version: 1, pollution: 0, absorb: 0 };
    const seed = this.seed; const MG = MAPGEN.default;
    const ov = this.ov;
    if (ov && (ov.blank || ov.outside(cx, cy))) { // v1.15: чистая карта сценария или чанк целиком за границей — без шума
      if (ov.outside(cx, cy)) c.terrain.fill(T_DEEP);
      else { ov.apply(cx, cy, c.terrain, c.res, c.amt, c.decor); }
      let ab = 0; const RATE = [0.0075, 0.002, 0.004, 0, 0]; for (let i = 0; i < N; i++) { ab += RATE[c.terrain[i]]; if (c.decor[i] === D_TREE) ab += 0.004; } c.absorb = ab / N; return c;
    }
    const rockA = MG.rocks === 1 ? 0.9975 : 1 - 0.0025 * MG.rocks, rockB = MG.rocks === 1 ? 0.997 : 1 - 0.003 * MG.rocks;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = cx * CHUNK + lx, y = cy * CHUNK + ly, i = ly * CHUNK + lx;
      const dist = Math.hypot(x, y);
      let h = this.nH.fbm(x, y, 4, 1 / 220);
      const m = this.nM.fbm(x + 5000, y - 3000, 3, 1 / 260);
      // стартовая зона: нет природной воды рядом с крушением
      if (dist < 60) h = h * (dist / 60) + 0.2 * (1 - dist / 60);
      let t = T_GRASS;
      const ld = Math.hypot(x - this.lake.x, y - this.lake.y);
      const lakeEdge = this.lake.r * (1 + 0.25 * this.nF.get(x / 6, y / 6));
      if (ld < lakeEdge) t = ld < lakeEdge - 3 ? T_DEEP : T_SHALLOW;
      else if (h < -0.42 + this.wsh()) t = h < -0.5 + this.wsh() ? T_DEEP : T_SHALLOW;
      else if (m < -0.28) t = T_SAND;
      else if (h > 0.42) t = T_STONE;
      c.terrain[i] = t;
      if (t >= T_SHALLOW) continue;
      // ресурсы
      let res = 0, amount = 0;
      for (const p of this.patches) {
        const d = Math.hypot(x - p.x, y - p.y);
        const edge = p.r * this.S(p.res) * (1 + 0.22 * this.nR[0].get(x / 5 + p.res * 50, y / 5));
        if (d < edge) { res = p.res; amount = Math.floor(p.rich * this.K(p.res) * (1.2 - d / edge)); break; }
      }
      if (!res && dist > 90) {
        let best = 0, bs = 0, raw = 0;
        for (let k = 1; k <= 4; k++) {
          const n = this.nR[k].fbm(x, y, 3, 1 / 70) - 0.5, ns = n + (this.F(k) - 1) * 0.1; // v1.16: частота — сдвиг порога шума
          if (ns > bs) { bs = ns; best = n; res = k; raw = n > 0 ? n : 0.03; }
        }
        if (res) amount = Math.floor(raw * 9000 * (1 + dist / 2000) * this.K(res)) + 50;
      }
      if (res) { c.res[i] = res; c.amt[i] = amount; continue; }
      // декор
      if (dist < 5) continue;
      const hv = hash2(x, y, seed);
      if (t === T_GRASS) {
        const forest = this.nF.fbm(x, y, 2, 1 / 90) + m * 0.5;
        if (forest > 0.15 && hv < (forest - 0.1) * 0.35 * MG.trees) c.decor[i] = D_TREE;
        else if (hv > rockA) c.decor[i] = D_ROCK;
      } else if (hv > rockB) c.decor[i] = D_ROCK;
    }
    // нефтяные источники — точечные (4.3): гарантированное поле + случайные вдали
    const wells: [number, number][] = [];
    const ox = this.oil.x - cx * CHUNK, oy = this.oil.y - cy * CHUNK;
    if (ox > -8 && ox < CHUNK + 8 && oy > -8 && oy < CHUNK + 8) {
      const rr = new RNG(seed ^ 0x0111);
      for (let k = 0; k < 6; k++) wells.push([Math.floor(ox + (rr.float() - .5) * 14), Math.floor(oy + (rr.float() - .5) * 14)]);
    }
    const cd = Math.hypot(cx * CHUNK + 16, cy * CHUNK + 16);
    if (cd > 200 && hash2(cx, cy, seed ^ 0x0177) < 0.07 * this.F(R_OIL)) {
      const rr = new RNG(seed ^ (cx * 7349 + cy * 1931));
      const n = 3 + rr.int(5); const bx = 6 + rr.int(20), by = 6 + rr.int(20);
      for (let k = 0; k < n; k++) wells.push([bx + rr.int(12) - 6, by + rr.int(12) - 6]);
    }
    for (const [lx, ly] of wells) {
      if (lx < 1 || ly < 1 || lx > CHUNK - 2 || ly > CHUNK - 2) continue;
      const i = ly * CHUNK + lx; if (c.terrain[i] >= T_SHALLOW) continue;
      let near = false; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (ly + dy) * CHUNK + lx + dx; if (j >= 0 && j < N && c.res[j] === R_OIL) near = true; }
      if (near) continue;
      c.res[i] = R_OIL; c.amt[i] = Math.floor((30 + Math.floor(hash2(lx + cx * 99, ly, seed) * 270) + Math.floor(cd / 40)) * this.K(R_OIL)); c.decor[i] = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.decor[(ly + dy) * CHUNK + lx + dx] = 0;
    }
    if (this.noUranium) c.noU = true; else this.genUranium(c);
    if (ov) ov.apply(cx, cy, c.terrain, c.res, c.amt, c.decor); // v1.15: границы и нарисованные клетки поверх генерации
    // поглощение загрязнения поверхностью и деревьями (10.1)
    let ab = 0; const RATE = [0.0075, 0.002, 0.004, 0, 0];
    for (let i = 0; i < N; i++) { ab += RATE[c.terrain[i]]; if (c.decor[i] === D_TREE) ab += 0.004; }
    c.absorb = ab / N;
    return c;
  }
  /** Новая карта 1.16+: поля и биомы вычисляются только по seed и координатам мира. */
  private genV2(cx: number, cy: number): Chunk {
    const N = CHUNK * CHUNK, ox = cx * CHUNK, oy = cy * CHUNK;
    const c: Chunk = { cx, cy, terrain: new Uint8Array(N), res: new Uint8Array(N), amt: new Uint32Array(N), decor: new Uint8Array(N), occ: new Int32Array(N).fill(-1), mods: new Map(), decorRemoved: new Set(), version: 1, pollution: 0, absorb: 0 };
    const ov = this.ov;
    if (ov && (ov.blank || ov.outside(cx, cy))) {
      if (ov.outside(cx, cy)) c.terrain.fill(T_DEEP);
      else ov.apply(cx, cy, c.terrain, c.res, c.amt, c.decor);
      let ab = 0; const RATE = [0.0075, 0.002, 0.004, 0, 0];
      for (let i = 0; i < N; i++) { ab += RATE[c.terrain[i]]; if (c.decor[i] === D_TREE) ab += 0.004; }
      c.absorb = ab / N; return c;
    }
    const MG = MAPGEN.default, scale = this.biomeScale();
    const rockA = MG.rocks === 1 ? 0.9975 : 1 - 0.0025 * MG.rocks, rockB = MG.rocks === 1 ? 0.997 : 1 - 0.003 * MG.rocks;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = ox + lx, y = oy + ly, i = ly * CHUNK + lx, dist = Math.hypot(x, y);
      let h = this.nH.fbm(x, y, 4, 1 / (220 * scale));
      const m = this.nM.fbm(x + 5000, y - 3000, 3, 1 / (260 * scale));
      if (dist < 60) h = h * (dist / 60) + 0.2 * (1 - dist / 60);
      const ld = Math.hypot(x - this.lake.x, y - this.lake.y), lakeEdge = this.lake.r * (1 + 0.25 * this.nF.get(x / 6, y / 6));
      let t = T_GRASS;
      if (ld < lakeEdge) t = ld < lakeEdge - 3 ? T_DEEP : T_SHALLOW;
      else if (h < -0.42 + this.wsh()) t = h < -0.5 + this.wsh() ? T_DEEP : T_SHALLOW;
      else if (m < -0.28) t = T_SAND;
      else if (h > 0.42) t = T_STONE;
      c.terrain[i] = t;
      if (t >= T_SHALLOW) continue;

      let res = 0, amount = 0;
      if (dist <= 90) {
        for (const p of this.patches) {
          const d = Math.hypot(x - p.x, y - p.y);
          const edge = p.r * this.S(p.res) * (1 + 0.22 * this.nR[0].get(x / 5 + p.res * 50, y / 5));
          if (d < edge) { res = p.res; amount = Math.floor(p.rich * this.K(p.res) * (1.2 - d / edge)); break; }
        }
      } else {
        for (let k = 1; k <= 4; k++) {
          const a = this.distantFieldAmount(k, x, y);
          if (a > amount) { res = k; amount = a; }
        }
      }
      if (res) { c.res[i] = res; c.amt[i] = amount; continue; }
      if (dist < 5) continue;
      const hv = hash2(x, y, this.seed);
      if (t === T_GRASS) {
        const forest = this.nF.fbm(x, y, 2, 1 / (90 * scale)) + m * 0.5;
        if (forest > 0.15 && hv < (forest - 0.1) * 0.35 * MG.trees) c.decor[i] = D_TREE;
        else if (hv > rockA) c.decor[i] = D_ROCK;
      } else if (hv > rockB) c.decor[i] = D_ROCK;
    }

    const wells: { x: number; y: number; order: string }[] = [];
    const starterRng = new RNG(this.seed ^ 0x0111);
    const starterSpread = 7 * this.S(R_OIL);
    for (let k = 0; k < 6; k++) wells.push({
      x: Math.floor(this.oil.x + (starterRng.float() - 0.5) * starterSpread * 2),
      y: Math.floor(this.oil.y + (starterRng.float() - 0.5) * starterSpread * 2),
      order: `0:${String(k).padStart(2, '0')}`,
    });
    const oilPitch = this.fieldPitch(R_OIL);
    const oilMaxEdge = FIELD_RADIUS[R_OIL] * this.S(R_OIL) * 1.12;
    const oilMinCenterGap = 2 * oilMaxEdge + this.spacing(R_OIL);
    const spread = Math.round(12 * this.S(R_OIL)), oilMargin = spread + 1;
    const gx0 = Math.floor((ox - oilMargin) / oilPitch), gx1 = Math.floor((ox + CHUNK + oilMargin) / oilPitch);
    const gy0 = Math.floor((oy - oilMargin) / oilPitch), gy1 = Math.floor((oy + CHUNK + oilMargin) / oilPitch);
    for (let gy = gy0 - 1; gy <= gy1 + 1; gy++) for (let gx = gx0 - 1; gx <= gx1 + 1; gx++) {
      if (!this.fieldSelected(R_OIL, gx, gy)) continue;
      const [fx, fy] = this.fieldCenter(R_OIL, gx, gy);
      if (Math.hypot(fx, fy) <= 200 || Math.hypot(fx - this.oil.x, fy - this.oil.y) < oilMinCenterGap) continue;
      const rr = new RNG(this.seed ^ (gx * 7349 + gy * 1931) ^ 0x0111), n = 3 + rr.int(5);
      const seen = new Set<string>();
      for (let k = 0; k < n; k++) {
        const x = Math.floor(fx) + rr.int(spread * 2 + 1) - spread, y = Math.floor(fy) + rr.int(spread * 2 + 1) - spread, key = `${x},${y}`;
        if (seen.has(key)) continue; seen.add(key);
        wells.push({ x, y, order: `${gx}:${gy}:${String(k).padStart(2, '0')}` });
      }
    }
    wells.sort((a, b) => a.order.localeCompare(b.order));
    for (let wi = 0; wi < wells.length; wi++) {
      const w = wells[wi];
      if (Math.floor(w.x / CHUNK) !== cx || Math.floor(w.y / CHUNK) !== cy) continue;
      if (wells.some((q, qi) => qi < wi && Math.abs(q.x - w.x) <= 2 && Math.abs(q.y - w.y) <= 2)) continue;
      const lx = w.x - ox, ly = w.y - oy, i = ly * CHUNK + lx;
      if (lx < 1 || ly < 1 || lx >= CHUNK - 1 || ly >= CHUNK - 1 || c.terrain[i] >= T_SHALLOW || c.res[i]) continue;
      c.res[i] = R_OIL; c.amt[i] = Math.floor((30 + Math.floor(hash2(w.x, w.y, this.seed) * 270) + Math.hypot(w.x, w.y) / 40) * this.K(R_OIL));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.decor[(ly + dy) * CHUNK + lx + dx] = 0;
    }
    if (this.noUranium) c.noU = true; else this.genUraniumV2(c);
    if (ov) ov.apply(cx, cy, c.terrain, c.res, c.amt, c.decor);
    let ab = 0; const RATE = [0.0075, 0.002, 0.004, 0, 0];
    for (let i = 0; i < N; i++) { ab += RATE[c.terrain[i]]; if (c.decor[i] === D_TREE) ab += 0.004; }
    c.absorb = ab / N;
    return c;
  }
}
