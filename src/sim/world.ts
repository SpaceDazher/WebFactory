// Мир: чанки 32×32, детерминированная генерация по seed (4.4).
import { Noise2D } from '../core/noise';
import { hash2, RNG } from '../core/rng';
import { CHUNK, ckey } from '../core/types';
import { RESOURCES, MAPGEN } from '../data/resources';

export const T_GRASS = 0, T_SAND = 1, T_STONE = 2, T_SHALLOW = 3, T_DEEP = 4;
export const TERRAIN_NAMES = ['Трава', 'Песок', 'Камень', 'Мелкая вода', 'Глубокая вода'];
export const TERRAIN_SPEED = [1, 0.9, 1, 0, 0];
export const RES_ITEMS = ['', 'iron-ore', 'copper-ore', 'coal', 'stone', 'crude-oil'];
export const R_OIL = 5;
export const D_TREE = 1, D_ROCK = 2;

export interface Chunk {
  cx: number; cy: number;
  terrain: Uint8Array; res: Uint8Array; amt: Uint32Array; decor: Uint8Array; occ: Int32Array;
  mods: Map<number, number>; // изменённые количества руды (для сохранения)
  decorRemoved: Set<number>;
  version: number;           // растёт при изменениях — для перерисовки
  pollution: number; absorb: number; // загрязнение (10.1): количество и поглощение за тик
  ov?: number; av?: number;  // счётчики изменений занятости и запасов руды — для передачи из Worker
}
/** v1.10: множители ресурса из данных (моды): запасы и размер пятна; 1 — без изменений */
const resK = (res: number) => { const d = RESOURCES[RES_ITEMS[res]]; return (d ? d.richness : 1) * MAPGEN.default.richness; };
const resS = (res: number) => RESOURCES[RES_ITEMS[res]]?.size ?? 1;
interface Patch { x: number; y: number; r: number; res: number; rich: number; }

export class World {
  seed: number; chunks = new Map<number, Chunk>();
  nH: Noise2D; nM: Noise2D; nR: Noise2D[]; nF: Noise2D;
  patches: Patch[] = []; lake: Patch; oil: Patch;
  onChunkGen: ((c: Chunk) => void) | null = null; // для врагов (симуляция)
  onAnyGen: ((c: Chunk) => void) | null = null;   // для рендера
  constructor(seed: number) {
    this.seed = seed;
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
  }
  getChunk(cx: number, cy: number): Chunk {
    const k = ckey(cx, cy); let c = this.chunks.get(k);
    if (!c) { c = this.gen(cx, cy); this.chunks.set(k, c); if (this.onChunkGen) this.onChunkGen(c); this.onAnyGen?.(c); }
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
  occ(x: number, y: number) { return this.chunkAt(x, y).occ[this.idx(x, y)]; }
  setOcc(x: number, y: number, id: number) { const c = this.chunkAt(x, y); c.occ[this.idx(x, y)] = id; c.ov = (c.ov || 0) + 1; }
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

  private gen(cx: number, cy: number): Chunk {
    const N = CHUNK * CHUNK;
    const c: Chunk = { cx, cy, terrain: new Uint8Array(N), res: new Uint8Array(N), amt: new Uint32Array(N), decor: new Uint8Array(N), occ: new Int32Array(N).fill(-1), mods: new Map(), decorRemoved: new Set(), version: 1, pollution: 0, absorb: 0 };
    const seed = this.seed; const MG = MAPGEN.default;
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
      else if (h < -0.42) t = h < -0.5 ? T_DEEP : T_SHALLOW;
      else if (m < -0.28) t = T_SAND;
      else if (h > 0.42) t = T_STONE;
      c.terrain[i] = t;
      if (t >= T_SHALLOW) continue;
      // ресурсы
      let res = 0, amount = 0;
      for (const p of this.patches) {
        const d = Math.hypot(x - p.x, y - p.y);
        const edge = p.r * resS(p.res) * (1 + 0.22 * this.nR[0].get(x / 5 + p.res * 50, y / 5));
        if (d < edge) { res = p.res; amount = Math.floor(p.rich * resK(p.res) * (1.2 - d / edge)); break; }
      }
      if (!res && dist > 90) {
        let best = 0;
        for (let k = 1; k <= 4; k++) {
          const n = this.nR[k].fbm(x, y, 3, 1 / 70) - 0.5;
          if (n > best) { best = n; res = k; }
        }
        if (res) amount = Math.floor(best * 9000 * (1 + dist / 2000) * resK(res)) + 50;
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
    if (cd > 200 && hash2(cx, cy, seed ^ 0x0177) < 0.07) {
      const rr = new RNG(seed ^ (cx * 7349 + cy * 1931));
      const n = 3 + rr.int(5); const bx = 6 + rr.int(20), by = 6 + rr.int(20);
      for (let k = 0; k < n; k++) wells.push([bx + rr.int(12) - 6, by + rr.int(12) - 6]);
    }
    for (const [lx, ly] of wells) {
      if (lx < 1 || ly < 1 || lx > CHUNK - 2 || ly > CHUNK - 2) continue;
      const i = ly * CHUNK + lx; if (c.terrain[i] >= T_SHALLOW) continue;
      let near = false; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (ly + dy) * CHUNK + lx + dx; if (j >= 0 && j < N && c.res[j] === R_OIL) near = true; }
      if (near) continue;
      c.res[i] = R_OIL; c.amt[i] = Math.floor((30 + Math.floor(hash2(lx + cx * 99, ly, seed) * 270) + Math.floor(cd / 40)) * resK(R_OIL)); c.decor[i] = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.decor[(ly + dy) * CHUNK + lx + dx] = 0;
    }
    // поглощение загрязнения поверхностью и деревьями (10.1)
    let ab = 0; const RATE = [0.0075, 0.002, 0.004, 0, 0];
    for (let i = 0; i < N; i++) { ab += RATE[c.terrain[i]]; if (c.decor[i] === D_TREE) ab += 0.004; }
    c.absorb = ab / N;
    return c;
  }
}
