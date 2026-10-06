// Рендер на Canvas2D (прототип по 14.1: «Canvas2D и одна нить»). Слои по 14.7.
import { CHUNK, DX, DY, ckey } from '../core/types';
import { hash2 } from '../core/rng';
import { PROTOS, FLOORS, FLOOR_BY_ITEM, brushOrigin } from '../data/entities';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { Game, Entity } from '../sim/game';
import { Chunk, D_ROCK, D_TREE, RES_ITEMS, T_DEEP, T_SHALLOW } from '../sim/world';
import { beltItemPos } from '../sim/belts';
import { fluidConns } from '../sim/networks';
import { drawEntityArt, itemIcon, shade, wireColor, colorblind, ArtState } from './art';
import { drawRail, drawCar, drawSignal, railPaths } from './rails';
import { graph as railGraph, isChain } from '../sim/trains';
import { shapeOf } from '../sim/railgeo';
import { PROTOS as _P } from '../data/entities';
import { tr } from '../core/i18n';
import { Batch, CanvasBatch, GLBatch, rgba } from './batch';
import { drawItemIcon, drone } from './art';
import { robotView, ROBOT_STRIDE } from '../sim/robots';
import { wireEnds, WIRE_SAG, termPos } from '../sim/circuits';
import { ITEM_IDX } from '../data/items';
import { ITEM_IDS } from '../data/items';
import { buildGeo, drawGeo, ChunkGeo } from './terrain';
import { oreSprite, treeSprite, rockSprite, oilSprite } from './sprites';
import { texReady } from './textures';
import { UNITS, Unit } from '../sim/enemies';
import { World, R_OIL } from '../sim/world';
import type { Blueprint } from '../sim/blueprint';
import { bpEntDims } from '../sim/blueprint';

const TS = 16; // пикселей на клетку в кеше поверхности
const TERRAIN_COL = ['#56703a', '#c4a86e', '#857b6c', '#3f7898', '#275475'];
/** v1.9: порог масштаба карты издалека (LOD) — тот же, что у прежнего «режима карты» */
export const LOD_ZOOM = 0.3;
const rgbCache = new Map<string, number[]>();
const lodRgb = (h: string) => { let c = rgbCache.get(h); if (!c) { const n = parseInt(h.slice(1), 16); c = [n >> 16, (n >> 8) & 255, n & 255]; rgbCache.set(h, c); } return c; };
const LOD_T = TERRAIN_COL.map(lodRgb), LOD_TREE = [40, 72, 32], LOD_NEST = [220, 40, 90], LOD_UNK = [140, 140, 140];
export const STATUS_TEXT: Record<string, string> = {
  disabled: 'Выключено условием',
  working: 'Работает', idle: 'Ожидание', 'no-robots': 'Нет роботов', 'no-power': 'Нет энергии', 'low-power': 'Мало энергии', 'no-fuel': 'Нет топлива', 'no-input': 'Нет ингредиентов',
  'output-full': 'Выход забит', 'no-recipe': 'Нет рецепта', 'no-ore': 'Нет руды', 'no-research': 'Нет исследования', 'no-water': 'Нет воды', 'no-target': 'Нет цели', waiting: 'Ждёт предмет', 'no-ammo': 'Нет патронов', 'fluid-mix': 'Смешаны жидкости', launching: 'Запуск ракеты', 'no-satellite': 'Нет спутника', charging: 'Заряжается', discharging: 'Разряжается',
};
/** v1.6: короткая запись значения сигнала: 1234, 12.3k, −4.5M */
export function fmtSig(v: number) { const a = Math.abs(v), m = v < 0 ? '−' : ''; return a < 10000 ? m + a : a < 1e6 ? m + (a / 1000).toFixed(a < 1e5 ? 1 : 0) + 'k' : m + (a / 1e6).toFixed(a < 1e8 ? 1 : 0) + 'M'; }
export interface View {
  zoom: number; cursor: string | null; rot: number; alt: boolean; mouseX: number; mouseY: number; mouseIn: boolean;
  hoverEnt: Entity | null; ghostOk: { ok: boolean; reason?: string } | null; ghostPos: [number, number] | null; debug: boolean;
  /** v1.7: план пути под курсором (рельсы в руке): куски, начало, конец, можно ли уложить, подпись; призрак вагона на рельсах */
  railPlan?: { pieces: { proto: string; x: number; y: number; dir: number; have?: boolean }[]; start: [number, number] | null; end: [number, number]; ok: boolean; label?: string } | null;
  carGhost?: { proto: string; x: number; y: number; dx: number; dy: number; ok: boolean; reason?: string } | null;
  pollution?: boolean; smoke?: boolean; noNight?: boolean;
  /** чертёж в руке и его позиция; инструмент выделения и текущая рамка */
  bp?: Blueprint | null; bpPos?: [number, number] | null;
  /** v1.5: первая постройка провода (провод в руке) */ wireFrom?: number | null; /** v1.6: клемма первой постройки; провод под курсором (индекс g.cw) */ wireFromT?: 0 | 1; hoverWire?: number;
  /** v1.2: показать зоны робопортов (выбран робопорт или призрак, открыто окно робопорта) */ zones?: boolean;
  /** v1.4: размер кисти покрытий (когда в руке бетон / кирпич) */ brush?: number;
  tool?: 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel' | null; sel?: { x0: number; y0: number; x1: number; y1: number; cancel?: boolean } | null;
}
const TOOL_COL: Record<string, [string, string]> = { copy: ['rgba(80,170,255,.15)', '#58b0ff'], cut: ['rgba(255,170,60,.15)', '#ffaa3c'], decon: ['rgba(240,60,60,.15)', '#f04848'], upgrade: ['rgba(80,220,110,.15)', '#4be36b'], cancel: ['rgba(120,190,255,.12)', '#9ac8ff'] };
export class Renderer {
  ctx: CanvasRenderingContext2D; mainCtx: CanvasRenderingContext2D; dark: HTMLCanvasElement;
  /** режим среднего слоя: webgl — WebGL2-пакет, canvas — спрайты из атласа на Canvas2D, legacy — векторная отрисовка каждый кадр */
  mode: 'webgl' | 'canvas' | 'legacy' = 'legacy'; modeNote = ''; batch: Batch | null = null; glCanvas: HTMLCanvasElement | null = null; topCanvas: HTMLCanvasElement | null = null; topCtx: CanvasRenderingContext2D | null = null;
  /** для замеров: 1 — не рисовать поверхность, 2 — не рисовать верхний слой */
  skip = 0;
  stat = { mid: 0, quads: 0, rast: 0, rastMs: 0, evict: 0, robots: 0, badges: 0, floors: 0, cwires: 0, conds: 0, rails: 0, cars: 0, blk: 0, sigs: 0, ticons: 0, lod: 0 };
  cache = new Map<number, { cv: HTMLCanvasElement; ver: number; used: number }>();
  frame = 0; camX = 0; camY = 0; W = 0; H = 0; s = 32;
  geo = new Map<number, ChunkGeo>(); world: World | null = null; texWas = false;
  /** привязка к миру: сброс кешей и инвалидация соседей при генерации новых чанков (контуры берегов зависят от соседей) */
  attach(w: World) {
    if (this.world === w && this.texWas === texReady) return;
    this.world = w; this.texWas = texReady; this.geo.clear(); this.cache.clear();
    w.onAnyGen = c => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = ckey(c.cx + dx, c.cy + dy); this.geo.delete(k); this.cache.delete(k); } };
  }
  private geoFor(w: World, c: Chunk): ChunkGeo {
    const k = ckey(c.cx, c.cy); let g = this.geo.get(k);
    if (!g) { g = buildGeo(w, c); this.geo.set(k, g); if (this.geo.size > 200) { let oldK = -1, oldU = Infinity; for (const [kk, v] of this.geo) if (v.used < oldU) { oldU = v.used; oldK = kk; } this.geo.delete(oldK); } }
    g.used = this.frame; return g;
  }
  /** v1.9: карта издалека (LOD) — при масштабе < LOD_ZOOM чанк рисуется одной картинкой 32×32 (1 пиксель = клетка: земля,
   *  руда, деревья, постройки цветом прототипа), пересобирается по версии чанка (постройка/снос меняют occ и версию).
   *  Постройки по одной не перебираются, предметы на лентах и быстрые поля Worker в этом режиме не присылает. */
  lod = true; lodCache = new Map<number, { cv: HTMLCanvasElement; ver: number; used: number; miss: boolean }>(); lodBuilt = 0;
  private lodCanvas(g: Game, ch: Chunk): HTMLCanvasElement {
    const k = ckey(ch.cx, ch.cy); let e = this.lodCache.get(k);
    if (e && e.ver === ch.version && !(e.miss && (this.frame + k) % 30 === 0)) { e.used = this.frame; return e.cv; }
    const cv = e?.cv || document.createElement('canvas'); cv.width = cv.height = CHUNK;
    const x = cv.getContext('2d')!; const img = x.createImageData(CHUNK, CHUNK); const d = img.data; let miss = false;
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      let c = LOD_T[ch.terrain[i]] || LOD_T[0]; const id = ch.occ[i];
      if (id >= 0) { const en = g.ents.get(id); if (en) c = en.t === 'nest' ? LOD_NEST : lodRgb(PROTOS[en.proto]?.color || '#888888'); else { miss = true; c = LOD_UNK; } }
      else if (ch.amt[i] > 0 && ch.res[i]) c = lodRgb(ITEMS[RES_ITEMS[ch.res[i]]]?.color || '#000000');
      else if (ch.decor[i] === D_TREE) c = LOD_TREE;
      const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0); this.lodBuilt++;
    this.lodCache.set(k, { cv, ver: ch.version, used: this.frame, miss });
    if (this.lodCache.size > 4096) { const old = [...this.lodCache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 512); for (const [kk] of old) this.lodCache.delete(kk); }
    return cv;
  }
  /** графика для слабых ПК (client/gfx.ts): доля разрешения, потолок devicePixelRatio, подробная поверхность вблизи */
  resScale = 1; dprMax = 3; detail = true;
  /** пикселей холста на CSS-пиксель */
  /** v1.10: после смены модов — растеризовать спрайты построек заново (атлас, кэши чанков) */
  resetArt() { const a = this.batch?.atlas; if (a) { a.slots.clear(); a.byBase.clear(); for (const pg of a.pages) { pg.keys = []; pg.shelves = []; pg.top = 0; } } this.cache.clear(); this.geo.clear(); }
  pixelRatio() { return Math.max(0.25, Math.min(window.devicePixelRatio || 1, this.dprMax) * this.resScale); }
  constructor(public canvas: HTMLCanvasElement) { this.ctx = this.mainCtx = canvas.getContext('2d')!; this.dark = document.createElement('canvas'); }
  /** выбрать рендер среднего слоя; WebGL2 недоступен — откат на Canvas2D-атлас */
  setMode(m: 'auto' | 'webgl' | 'canvas' | 'legacy'): string {
    this.modeNote = ''; const auto = m === 'auto'; if (auto) m = 'webgl';
    if (this.glCanvas) { this.glCanvas.remove(); this.glCanvas = null; } if (this.topCanvas) { this.topCanvas.remove(); this.topCanvas = null; this.topCtx = null; }
    this.batch = null; this.mode = m as any;
    if (m === 'webgl') {
      const mk = () => { const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none'; this.canvas.after(cv); return cv; };
      const top = mk(), gl = mk(); // порядок в DOM: game, gl, top
      top.remove(); gl.after(top);
      let b: GLBatch | null = null; try { b = GLBatch.create(gl); } catch (e) { console.warn('WebGL2 недоступен', e); b = null; }
      if (b && auto && GLBatch.isSoftware(b.gl)) { this.modeNote = 'soft'; b.gl.getExtension('WEBGL_lose_context')?.loseContext(); b = null; }
      if (b) { this.batch = b; this.glCanvas = gl; this.topCanvas = top; this.topCtx = top.getContext('2d')!; }
      else { if (!this.modeNote) this.modeNote = 'nogl'; gl.remove(); top.remove(); this.mode = m = 'canvas'; }
    }
    if (m === 'canvas') this.batch = new CanvasBatch(this.mainCtx);
    return this.mode;
  }
  screenToWorld(px: number, py: number): [number, number] { return [(px - this.W / 2) / this.s + this.camX, (py - this.H / 2) / this.s + this.camY]; }
  /** кеш чанка для мелкого масштаба (16 px/клетку): та же поверхность, что и вблизи, плюс запечённые руда и декор */
  private chunkCanvas(w: World, c: Chunk): HTMLCanvasElement {
    const k = ckey(c.cx, c.cy); let e = this.cache.get(k);
    if (e && e.ver === c.version) { e.used = this.frame; return e.cv; }
    const cv = e?.cv || document.createElement('canvas'); cv.width = cv.height = CHUNK * TS;
    const x = cv.getContext('2d')!;
    x.save(); x.scale(TS, TS); drawGeo(x, this.geoFor(w, c), c, TS, 0, false); x.restore();
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const i = ly * CHUNK + lx, wx = c.cx * CHUNK + lx, wy = c.cy * CHUNK + ly;
      if (c.amt[i] > 0 && c.res[i]) this.drawRes(x, c.res[i], c.amt[i], wx, wy, lx * TS, ly * TS, TS);
      const d = c.decor[i];
      if (d === D_ROCK) x.drawImage(rockSprite(hash2(wx, wy, 6) * 4 | 0), lx * TS - TS * .25, ly * TS - TS * .3, TS * 1.5, TS * 1.5);
    }
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const i = ly * CHUNK + lx; if (c.decor[i] !== D_TREE) continue;
      this.drawTree(x, c.cx * CHUNK + lx, c.cy * CHUNK + ly, lx * TS, ly * TS, TS, true);
    }
    this.cache.set(k, { cv, ver: c.version, used: this.frame });
    if (this.cache.size > 90) { let oldK = -1, oldU = Infinity; for (const [kk, v] of this.cache) if (v.used < oldU) { oldU = v.used; oldK = kk; } this.cache.delete(oldK); }
    return cv;
  }
  /** руда/нефть клетки; px,py — левый верх клетки в пикселях */
  private drawRes(x: CanvasRenderingContext2D, res: number, amt: number, wx: number, wy: number, px: number, py: number, s: number) {
    if (res === R_OIL) { x.drawImage(oilSprite(), px - s * .5, py - s * .5, s * 2, s * 2); return; }
    const rich = amt < 150 ? 0 : amt < 600 ? 1 : amt < 2500 ? 2 : 3;
    const h = hash2(wx, wy, 1), ox = (hash2(wx, wy, 2) - .5) * .2 * s, oy = (hash2(wx, wy, 3) - .5) * .2 * s;
    x.drawImage(oreSprite(RES_ITEMS[res], rich, h * 4 | 0), px - s * .18 + ox, py - s * .18 + oy, s * 1.36, s * 1.36);
  }
  private drawTree(x: CanvasRenderingContext2D, wx: number, wy: number, px: number, py: number, s: number, withShadow: boolean, onlyShadow = false) {
    const v = hash2(wx, wy, 5) * 6 | 0; const sc = 0.85 + hash2(wx, wy, 7) * 0.3; const { img, shadow } = treeSprite(v);
    const ax = px + s * (.5 + (hash2(wx, wy, 3) - .5) * .25), ay = py + s * (.78 + (hash2(wx, wy, 4) - .5) * .2);
    const W = 2 * s * sc, H = 2.5 * s * sc, dx = ax - s * sc, dy = ay - 2.1 * s * sc;
    if (withShadow || onlyShadow) x.drawImage(shadow, dx, dy, W, H);
    if (!onlyShadow) x.drawImage(img, dx, dy, W, H);
  }
  beltItemPos(e: Entity, s: number, L: number, pos: number): [number, number] { return beltItemPos(e, s, L, pos); }
  draw(g: Game, v: View, px: number, py: number) {
    this.stat.badges = 0; this.stat.floors = 0; this.stat.cwires = 0; this.stat.conds = 0;
    const cv = this.canvas, dpr = this.pixelRatio();
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (this.topCanvas && (this.topCanvas.width !== W || this.topCanvas.height !== H)) { this.topCanvas.width = W; this.topCanvas.height = H; }
    this.W = W; this.H = H; this.frame++;
    const s = this.s = 32 * v.zoom * dpr; this.camX = px; this.camY = py;
    let c = this.mainCtx; this.ctx = c; c.imageSmoothingEnabled = true;
    c.fillStyle = '#07090c'; c.fillRect(0, 0, W, H);
    const x0 = Math.floor(px - W / 2 / s) - 1, y0 = Math.floor(py - H / 2 / s) - 1, x1 = Math.ceil(px + W / 2 / s) + 1, y1 = Math.ceil(py + H / 2 / s) + 1;
    const sx = (wx: number) => (wx - px) * s + W / 2, sy = (wy: number) => (wy - py) * s + H / 2;
    // 1-3. поверхность, руда, декор
    this.attach(g.world);
    const lod = this.lod && v.zoom < LOD_ZOOM; const hi = s >= 17 && this.detail && !lod; this.stat.lod = lod ? 1 : 0; if (lod) c.imageSmoothingEnabled = false; // вблизи — векторные контуры с 2K-текстурами и спрайты; издалека — кеш чанков
    const trees: [number, number][] = [];
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      if (!g.world.hasChunk(cx, cy)) continue;
      const ch = g.world.getChunk(cx, cy);
      if (this.skip & 1) continue;
      if (lod) { c.drawImage(this.lodCanvas(g, ch), Math.floor(sx(cx * CHUNK)), Math.floor(sy(cy * CHUNK)), Math.ceil(CHUNK * s) + 1, Math.ceil(CHUNK * s) + 1); continue; }
      if (hi) {
        c.save(); c.setTransform(s, 0, 0, s, sx(cx * CHUNK), sy(cy * CHUNK));
        drawGeo(c, this.geoFor(g.world, ch), ch, s, g.tick + (performance.now() % 1e6) * 0, true);
        c.restore();
      } else c.drawImage(this.chunkCanvas(g.world, ch), Math.floor(sx(cx * CHUNK)), Math.floor(sy(cy * CHUNK)), Math.ceil(CHUNK * s) + 1, Math.ceil(CHUNK * s) + 1);
    }
    if (hi) {
      let ch: Chunk | null = null;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const ccx = Math.floor(tx / CHUNK), ccy = Math.floor(ty / CHUNK);
        if (!ch || ch.cx !== ccx || ch.cy !== ccy) { if (!g.world.hasChunk(ccx, ccy)) { ch = null; continue; } ch = g.world.getChunk(ccx, ccy); }
        const i = g.world.idx(tx, ty);
        if (this.skip & 1) { if (ch.decor[i] === D_TREE) trees.push([tx, ty]); continue; }
        if (ch.amt[i] > 0 && ch.res[i]) this.drawRes(c, ch.res[i], ch.amt[i], tx, ty, sx(tx), sy(ty), s);
        const d = ch.decor[i];
        if (d === D_ROCK) c.drawImage(rockSprite(hash2(tx, ty, 6) * 4 | 0), sx(tx) - s * .25, sy(ty) - s * .3, s * 1.5, s * 1.5);
        else if (d === D_TREE) { this.drawTree(c, tx, ty, sx(tx), sy(ty), s, false, true); trees.push([tx, ty]); }
      }
    }
    // v1.4: покрытия — поверх земли и руды, под постройками
    if (lod) c.imageSmoothingEnabled = true;
    if (g.floors.size && !(this.skip & 1) && !lod) this.drawFloors(g, c, x0, y0, x1, y1, sx, sy, s);
    // v1.7: рельсы — под постройками: сначала все шпалы, потом нитки (стрелки и пересечения выглядят цельно)
    if (g.railCells.size) {
      const rs: Entity[] = []; for (const e of g.ents.values()) if (e.t === 'rail' && e.x + e.w >= x0 && e.x <= x1 && e.y + e.h >= y0 && e.y <= y1) rs.push(e);
      const mm = v.zoom < 0.3; this.stat.rails = rs.length;
      for (const L of mm ? [0] as const : [1, 2] as const) for (const e of rs) { const sh = shapeOf(e.proto, e.dir); drawRail(c, e.proto, e.dir, sx(e.x + sh.ox), sy(e.y + sh.oy), s, { map: mm, layer: L }); }
    }
    // загрязнение
    if (v.pollution) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      if (!g.world.hasChunk(cx, cy)) continue; const p = g.world.getChunk(cx, cy).pollution; if (p < 0.05) continue;
      c.fillStyle = `rgba(150,40,20,${Math.min(0.5, Math.log10(1 + p) * 0.16)})`; c.fillRect(sx(cx * CHUNK), sy(cy * CHUNK), CHUNK * s + 1, CHUNK * s + 1);
    }
    if (v.zoom < 0.3) { c.fillStyle = 'rgba(0,0,0,0)'; }
    const t = g.tick;
    // предметы на земле
    for (const it of g.ground.values()) if (it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1) c.drawImage(itemIcon(it.item), sx(it.x + .2), sy(it.y + .2), s * .6, s * .6);
    // сбор видимых построек
    const flat: Entity[] = [], tall: Entity[] = [], sigs: Entity[] = [], stops: Entity[] = [];
    if (!lod) for (const e of g.ents.values()) {
      if (e.x + e.w < x0 || e.x > x1 || e.y + e.h < y0 || e.y > y1) continue;
      if (e.t === 'signal') { sigs.push(e); continue; } // v1.8: светофоры — верхним слоем (свет меняется каждый тик)
      if (e.t === 'stop') stops.push(e);
      if (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter' || e.t === 'pipe') flat.push(e); else if (e.t !== 'rail' && e.t !== 'loco' && e.t !== 'wagon') tall.push(e);
    }
    const mapMode = v.zoom < 0.3;
    const batch = this.mode !== 'legacy' ? this.batch : null;
    if (batch) this.midBatched(g, v, { s, px, py, x0, y0, x1, y1, sx, sy, t, mapMode, flat, tall, trees, W, H });
    else {
    // 4. конвейеры и трубы
    for (const e of flat) {
      if (mapMode) { c.fillStyle = PROTOS[e.proto].color; c.fillRect(sx(e.x), sy(e.y), e.w * s, e.h * s); continue; }
      if (e.t === 'pipe') this.drawPipe(g, e, sx(e.x), sy(e.y), s);
      else drawEntityArt(c, e.proto, sx(e.x), sy(e.y), s, e.dir, { t: e.moving === false ? 0 : t, curve: e.curve, ug: e.ug });
    }
    // 5. предметы на конвейерах
    const bi = this.beltItems;
    if (!mapMode && bi && bi.tick === g.tick) { const a = bi.data; for (let i = 0; i < bi.n; i++) { const ix = a[i * 3], iy = a[i * 3 + 1]; if (ix < x0 || ix > x1 || iy < y0 || iy > y1) continue; const v = a[i * 3 + 2], n = (v >> 12) + 1; c.drawImage(itemIcon(ITEM_IDS[v & 4095]), sx(ix) - s * .2, sy(iy) - s * .2, s * .4, s * .4); if (n > 1) this.stat.badges += stackBadge2d(c, n, sx(ix) + s * .12, sy(iy) + s * .12, s); } }
    else if (!mapMode) for (const e of flat) {
      if (!e.lanes) continue;
      for (let si = 0; si < e.lanes.length; si++) for (let L = 0; L < 2; L++) for (const it of e.lanes[si][L]) {
        const [ix, iy] = this.beltItemPos(e, si, L, Math.min(255, it.pos));
        c.drawImage(itemIcon(it.item), sx(ix) - s * .2, sy(iy) - s * .2, s * .4, s * .4); if (it.n > 1) this.stat.badges += stackBadge2d(c, it.n, sx(ix) + s * .12, sy(iy) + s * .12, s);
      }
    }
    // 6. постройки, деревья, юниты Роя и персонаж — сортировка по Y
    type Obj = { y: number; k: 0 | 1 | 2; e?: Entity; tx?: number; ty?: number; u?: Unit };
    const objs: Obj[] = [];
    for (const e of tall) objs.push({ y: e.y + e.h, k: 0, e });
    for (const [tx, ty] of trees) objs.push({ y: ty + .8, k: 1, tx, ty });
    if (!mapMode) for (const u of g.units) if (u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) objs.push({ y: u.y + .2, k: 2, u });
    objs.sort((a, b) => a.y - b.y);
    let playerDrawn = false;
    const drawPlayer = () => { playerDrawn = true; if (!g.player.dead && g.player.veh == null) this.drawPlayer(g, sx(px), sy(py), s); };
    for (const o of objs) {
      if (!playerDrawn && o.y > py + 0.3) drawPlayer();
      if (o.k === 1) { this.drawTree(c, o.tx!, o.ty!, sx(o.tx!), sy(o.ty!), s, false); continue; }
      if (o.k === 2) { this.drawUnit(c, o.u!, sx(o.u!.x), sy(o.u!.y), s, t); continue; }
      const e = o.e!;
      if (mapMode) { c.fillStyle = PROTOS[e.proto].color; c.fillRect(sx(e.x), sy(e.y), e.w * s, e.h * s); continue; }
      const st: any = { t, seed: e.id, working: e.status === 'working' || e.status === 'low-power', recipeColor: e.recipe && RECIPES[e.recipe] ? ITEMS[RECIPES[e.recipe].out[0][0]]?.color : undefined };
      if (e.t === 'turret') { st.aim = e.aim; st.flash = (e.fireCd || 0) >= 4; }
      if (e.t === 'lamp') { st.lit = e.active; st.lampColor = e.ccol; }
      if (e.modules) st.mods = e.modules;
      if (e.t === 'beacon') st.working = !!e._on;
      if (e.t === 'accumulator') st.fill = (e.charge || 0) / (PROTOS[e.proto].accum!.MJ * 1e6);
      if (e.t === 'silo') { st.parts = e.parts || 0; st.launch = e.launchT ? 1 - e.launchT / 900 : 0; st.working = e.status === 'working' || e.status === 'launching'; }
      if (e.t === 'radar') st.working = e.status === 'working';
      if (e.t === 'tpump') (st as any).drain = e.pm === 1;
      if (e.t === 'tank' && e._fn) { const n = g.fluidNets[e._fn[0]]; if (n) { st.fill = n.cap ? Math.min(1, n.amount / n.cap) : 0; st.fluidColor = n.fluid ? ITEMS[n.fluid]?.color : undefined; } }
      drawEntityArt(c, e.proto, sx(e.x), sy(e.y), s, e.dir, st);
      if (e.t === 'inserter') this.drawArm(g, e, sx, sy, s);
    }
    if (!playerDrawn) drawPlayer();
    }
    if (this.skip & 2) { this.ctx = this.mainCtx; return; }
    // верхний слой: при WebGL — отдельный прозрачный холст поверх
    if (batch && batch.kind === 'webgl') { c = this.topCtx!; this.ctx = c; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); }
    // v1.8: блоки путей — когда в руке светофор или курсор на светофоре: рельсы цветом блока, у развилок — подсказка
    const curP = v.cursor ? ITEMS[v.cursor]?.place : undefined;
    const showBlk = !mapMode && (curP === 'rail-signal' || curP === 'rail-chain-signal' || v.hoverEnt?.t === 'signal');
    this.stat.blk = 0; this.stat.sigs = 0; this.stat.ticons = 0;
    if (showBlk && g.railCells.size) {
      const G = railGraph(g); c.save(); c.lineCap = 'round';
      for (const [id, r] of G.info) { const e = r.e; if (e.x + e.w < x0 || e.x > x1 || e.y + e.h < y0 || e.y > y1) continue;
        const b = G.blk.get(id) ?? 0; const hue = (b * 137.508) % 360; const P = railPaths(e.proto, e.dir); this.stat.blk++;
        c.save(); c.translate(sx(r.ax), sy(r.ay)); c.scale(s, s); c.strokeStyle = G.jblk.has(b) ? `hsla(${hue},85%,60%,.75)` : `hsla(${hue},80%,55%,.6)`; c.lineWidth = G.jblk.has(b) ? .75 : .55; c.stroke(P.axis); c.restore(); }
      c.restore();
    }
    // v1.8: светофоры (свет — состояние блока за ним)
    if (sigs.length && !mapMode) { const G = showBlk ? railGraph(g) : null;
      for (const e of sigs) { const b = G?.sigB.get(e.id); const warn = !!G && !isChain(e) && b != null && G.jblk.has(b); drawSignal(c, sx(e.x), sy(e.y), s, e.dir & 7, e.ss ?? 0, isChain(e), { warn }); this.stat.sigs++; }
    }
    // v1.8: имена станций над ними
    if (stops.length && !mapMode && s >= 7) { c.font = `${Math.round(Math.min(14, s * .45) * dpr)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const e of stops) { const nm = e.sname || tr('Станция'); const tw = c.measureText(nm).width; const cx = sx(e.x + 1), cy = sy(e.y) - 8 * dpr; c.fillStyle = e.coff ? 'rgba(80,20,20,.75)' : 'rgba(0,0,0,.6)'; c.fillRect(cx - tw / 2 - 4, cy - 8 * dpr, tw + 8, 16 * dpr); c.fillStyle = e.coff ? '#ff9a8a' : '#ffe9a0'; c.fillText(nm, cx, cy); } }
    // v1.7: поезда — поверх построек (по позам вагонов из снимка)
    if (g.trains.length) {
      let n = 0; const hv = v.hoverEnt;
      for (const tr of g.trains) for (const id of tr.cars) { const e = g.ents.get(id); if (!e || e._cx == null || e._cx < x0 - 5 || e._cx > x1 + 5 || e._cy! < y0 - 5 || e._cy! > y1 + 5) continue; n++;
        if (mapMode) { c.fillStyle = _P[e.proto].color; c.beginPath(); c.arc(sx(e._cx), sy(e._cy!), Math.max(2, s * 1.2), 0, 7); c.fill(); continue; }
        drawCar(c, e.proto, sx(e._cx), sy(e._cy!), e._dx!, e._dy!, s, { fl: !!e.fl, sel: hv === e || (hv?.tr != null && hv.tr === tr.id), t, moving: tr.v > 0, fluid: e.tf ? ITEMS[e.tf]?.color : undefined, fill: (e.tn || 0) / 25000 }); }
      // v1.8: значок состояния над головой автоматического поезда
      if (!mapMode) for (const tr of g.trains) { if (tr.manual) continue; const ic = TRAIN_ICON[tr.st]; if (!ic) continue; const e = g.ents.get(tr.cars[0]); if (!e || e._cx == null || e._cx < x0 || e._cx > x1 || e._cy! < y0 || e._cy! > y1) continue;
        this.stat.ticons++; const ix = sx(e._cx), iy = sy(e._cy!) - s * 1.6, r = Math.max(7, s * .42); c.fillStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.arc(ix, iy, r + 2, 0, 7); c.fill(); c.fillStyle = ic[1]; c.beginPath(); c.arc(ix, iy, r, 0, 7); c.fill();
        c.fillStyle = '#fff'; c.font = `bold ${Math.round(r * 1.2)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ic[0], ix, iy + r * .05); }
      this.stat.cars = n;
    }
    // v1.2: зоны робопортов — стройки (оранжевая) и логистики (жёлтая)
    const curPlace = v.cursor ? ITEMS[v.cursor]?.place : undefined;
    const hovGhost = v.mouseIn && !v.cursor ? (() => { const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr); return g.ghostAt(Math.floor(wx), Math.floor(wy)); })() : null;
    if (v.zones || v.alt || hovGhost || v.hoverEnt?.t === 'roboport' || curPlace === 'roboport') this.drawZones(g, c, sx, sy, s, curPlace === 'roboport' && v.ghostPos ? v.ghostPos : null);
    // призраки (чертежи) и метки сноса/улучшения
    if (!mapMode) {
      for (const gh of g.ghosts.values()) {
        if (gh.x + gh.w < x0 || gh.x > x1 || gh.y + gh.h < y0 || gh.y > y1) continue;
        if (_P[gh.proto]?.type === 'rail') { const sh = shapeOf(gh.proto, gh.dir); drawRail(c, gh.proto, gh.dir, sx(gh.x + sh.ox), sy(gh.y + sh.oy), s, { ghost: true }); continue; }
        c.globalAlpha = .42; drawEntityArt(c, gh.proto, sx(gh.x), sy(gh.y), s, gh.dir, { t: 0, ug: 'in', ghost: true }); c.globalAlpha = 1;
        c.fillStyle = gh.rb ? 'rgba(255,170,60,.2)' : 'rgba(90,170,255,.2)'; c.fillRect(sx(gh.x), sy(gh.y), gh.w * s, gh.h * s);
        c.strokeStyle = gh.rb ? 'rgba(255,190,90,.85)' : 'rgba(120,190,255,.8)'; c.lineWidth = 1; c.setLineDash([4, 3]); c.strokeRect(sx(gh.x) + .5, sy(gh.y) + .5, gh.w * s - 1, gh.h * s - 1); c.setLineDash([]);
        if (gh.st && s >= 14) this.ghostIcon(c, gh.st, gh.proto, sx(gh.x + gh.w) - Math.min(gh.w, 1) * s * .32, sy(gh.y) + Math.min(gh.h, 1) * s * .32, s * Math.min(1, .5 + .15 * Math.max(gh.w, gh.h)), t);
      }
      // v1.4: призраки покрытий
      if (g.tileMarks.size) for (const [k, it] of g.tileMarks) {
        const tx = Math.floor(k / 131072) - 65536, ty = (k % 131072) - 65536; if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
        const f = FLOOR_BY_ITEM[it]; if (!f) continue;
        c.globalAlpha = .35; c.fillStyle = FLOORS[f - 1].color; c.fillRect(sx(tx), sy(ty), s, s); c.globalAlpha = 1;
        if (s >= 10) { c.strokeStyle = 'rgba(120,190,255,.7)'; c.lineWidth = 1; c.strokeRect(sx(tx) + .5, sy(ty) + .5, s - 1, s - 1); }
      }
      for (const id of g.marked) {
        const e = g.ents.get(id); if (!e || e.x + e.w < x0 || e.x > x1 || e.y + e.h < y0 || e.y > y1) continue;
        const cx = sx(e.x + e.w / 2), cy = sy(e.y + e.h / 2), r = Math.min(e.w, e.h) * s * .3;
        if (e.decon) { c.fillStyle = 'rgba(240,50,50,.18)'; c.fillRect(sx(e.x), sy(e.y), e.w * s, e.h * s); this.markX(c, cx, cy, r); }
        else if (e.upgrade) this.markUp(c, cx, cy, r);
      }
      for (const k of g.treeMarks) { const tx = Math.floor(k / 131072) - 65536, ty = k % 131072 - 65536; if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) this.markX(c, sx(tx + .5), sy(ty + .5), s * .25); }
    }
    // снаряды и эффекты
    if (!mapMode) this.drawFx(g, c, sx, sy, s);
    // v1.2: строительные роботы — поверх построек, с тенью и грузом
    this.drawRobots(g, c, sx, sy, s, x0, y0, x1, y1, t, mapMode);
    // дым из труб: печи на топливе, бойлеры, твердотопливные буры; ракета — клубы при старте
    if (!mapMode && v.smoke !== false) for (const e of tall) {
      if (e.status !== 'working' && e.status !== 'launching') continue;
      const burner = PROTOS[e.proto].energy?.kind === 'burner';
      if (!(burner && (e.t === 'furnace' || e.t === 'boiler' || e.t === 'drill')) && !(e.t === 'silo' && e.status === 'launching')) continue;
      const big = e.t === 'silo'; const N = big ? 14 : 4, life = big ? 90 : 150;
      const ox = e.x + e.w * .5, oy = e.y + (big ? e.h * .5 : .12);
      for (let i = 0; i < N; i++) {
        const ph = ((t + e.id * 37 + i * life / N) % life) / life; const hx = hash2(e.id, i + Math.floor((t + e.id * 37 + i * life / N) / life), 9);
        const x = sx(ox + (hx - .5) * (big ? 4 : .3) + ph * (big ? (hx - .5) * 4 : .9)), y = sy(oy - ph * (big ? 1.5 : 2.2)) ;
        const r = s * (big ? .8 + ph * 2.2 : .14 + ph * .55); const al = (1 - ph) * (big ? .4 : .5) * Math.min(1, ph * 6);
        const sh = big ? 190 : 70 + hx * 35;
        c.fillStyle = `rgba(${sh},${sh},${sh + 6},${al.toFixed(3)})`; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      }
    }
    if (!mapMode) this.drawPeers(g, c, sx, sy, s, x0, y0, x1, y1);
    if (g.notes.length) this.drawNotes(g, c, sx, sy, s, x0, y0, x1, y1);
    // тела погибших инженеров
    for (const cp of g.corpses) { const x = sx(cp.x), y = sy(cp.y); c.fillStyle = '#5a4a3a'; c.beginPath(); c.roundRect(x - s * .3, y - s * .2, s * .6, s * .4, s * .08); c.fill(); c.strokeStyle = '#ffcc66'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#ffcc66'; c.font = `bold ${Math.max(10, s * .3)}px system-ui`; c.textAlign = 'center'; c.fillText('✝', x, y + s * .1); }
    // 7. провода
    c.strokeStyle = wireColor(); c.lineWidth = Math.max(1, s * (colorblind() ? .05 : .035));
    for (const [a, b] of g.wires) {
      const A = g.ents.get(a), B = g.ents.get(b); if (!A || !B) continue;
      if (Math.max(A.x, B.x) < x0 || Math.min(A.x, B.x) > x1 || Math.max(A.y, B.y) < y0 || Math.min(A.y, B.y) > y1) continue;
      const ax = sx(A.x + A.w / 2), ay = sy(A.y + .2), bx = sx(B.x + B.w / 2), by = sy(B.y + .2);
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + s * .5, bx, by); c.stroke();
    }
    // v1.5: провода сигналов — красный и зелёный, чуть разведены; провод в руке — от первой постройки к курсору
    const wired = new Set<number>();
    if (g.cw.length) {
      c.lineWidth = Math.max(1.2, s * .045);
      for (let i = 0; i < g.cw.length; i++) {
        const w = g.cw[i]; const [a, b, col] = w;
        wired.add(a); wired.add(b);
        const A = g.ents.get(a), B = g.ents.get(b); if (!A || !B) continue;
        if (Math.max(A.x, B.x) < x0 || Math.min(A.x, B.x) > x1 || Math.max(A.y, B.y) < y0 || Math.min(A.y, B.y) > y1) continue;
        const q = wireEnds(g, w)!; const ax = sx(q[0]), ay = sy(q[1]), bx = sx(q[2]), by = sy(q[3]);
        c.strokeStyle = col ? (colorblind() ? '#4ab0ff' : '#3fd04f') : '#e8433a'; if (v.hoverWire === i) { c.lineWidth = Math.max(2.5, s * .1); }
        c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + s * WIRE_SAG, bx, by); c.stroke(); this.stat.cwires++;
        if (v.hoverWire === i) c.lineWidth = Math.max(1.2, s * .045);
      }
    }
    if (v.wireFrom != null && v.cursor && (v.cursor === 'red-wire' || v.cursor === 'green-wire') && v.mouseIn) {
      const A = g.ents.get(v.wireFrom);
      if (A) {
        const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr); const far = Math.hypot(wx - (A.x + A.w / 2), wy - (A.y + A.h / 2)) > 9.5;
        c.strokeStyle = far ? 'rgba(255,255,255,.5)' : v.cursor === 'green-wire' ? '#3fd04f' : '#e8433a'; c.lineWidth = Math.max(1.5, s * .05); c.setLineDash([s * .2, s * .12]);
        const [tpx, tpy] = termPos(A, v.wireFromT || 0); c.beginPath(); c.moveTo(sx(tpx), sy(tpy - .15)); c.lineTo(v.mouseX * dpr, v.mouseY * dpr); c.stroke(); c.setLineDash([]);
        c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.beginPath(); c.arc(sx(A.x + A.w / 2), sy(A.y + A.h / 2), 9 * s, 0, 7); c.stroke();
      }
    }
    // v1.5 (Alt): условие включения — значок сигнала A, знак и число или значок B
    const condIcon = (e: Entity) => {
      if (!e.cc?.en?.a || !wired.has(e.id)) return; const ex = sx(e.x + e.w / 2); this.stat.conds++;
      const en = e.cc.en; const z = s * .34; const txt = en.b ? '' : String(en.n); c.font = `bold ${Math.round(z * .8)}px system-ui,sans-serif`;
      const tw = (en.b ? z : c.measureText(txt).width) + z + c.measureText(en.op).width + z * .6; const bx0 = ex - tw / 2, by0 = sy(e.y) - z * 1.25;
      c.fillStyle = e.coff ? 'rgba(90,20,20,.8)' : 'rgba(0,0,0,.7)'; c.beginPath(); c.roundRect(bx0, by0, tw, z * 1.15, z * .25); c.fill();
      c.drawImage(itemIcon(en.a!), bx0 + z * .15, by0 + z * .07, z, z); c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle';
      const ox = bx0 + z * 1.25; c.fillText(en.op, ox, by0 + z * .6); const ow = c.measureText(en.op).width + z * .15;
      if (en.b) c.drawImage(itemIcon(en.b), ox + ow, by0 + z * .07, z, z); else c.fillText(txt, ox + ow, by0 + z * .6);
      c.textBaseline = 'alphabetic';
    };
    if (!mapMode && v.alt) for (const e of flat) if (e.cc) condIcon(e);
    // 8. значки состояния, Alt-режим
    if (!mapMode) for (const e of tall) {
      const bad = e.status && !['working', 'idle', 'waiting', 'no-target'].includes(e.status) && e.t !== 'pole' && e.t !== 'chest';
      const ex = sx(e.x + e.w / 2), ey = sy(e.y + e.h / 2);
      if (v.alt) {
        if ((e.t === 'assembler' || e.t === 'furnace') && e.recipe) { c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(ex, ey, s * .42, 0, 7); c.fill(); c.drawImage(itemIcon(RECIPES[e.recipe].out[0][0]), ex - s * .35, ey - s * .35, s * .7, s * .7); }
        if (e.t === 'chest' && e.inv) { const f = e.req?.find(q => q)?.item || e.lfilter || e.inv.firstItem(); if (f) c.drawImage(itemIcon(f), ex - s * .3, ey - s * .3, s * .6, s * .6); }
        if (e.t === 'inserter') { c.save(); c.translate(ex, ey); c.rotate(e.dir * Math.PI / 2); c.fillStyle = '#ffd34d'; c.beginPath(); c.moveTo(0, -s * .45); c.lineTo(s * .15, -s * .25); c.lineTo(-s * .15, -s * .25); c.fill(); c.restore(); }
        if (e.modules && e.modules.some(m => m)) { const n = e.modules.length, sz = Math.min(s * .36, e.w * s * .9 / n); for (let i = 0; i < n; i++) { const m = e.modules[i]; const mx0 = ex - n * sz / 2 + i * sz, my0 = sy(e.y + e.h) - sz - 2; c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(mx0, my0, sz - 1, sz - 1); if (m) c.drawImage(itemIcon(m), mx0 + 1, my0 + 1, sz - 3, sz - 3); } }
        if (e.t === 'silo') { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(ex - s * 1.2, ey + s * .8, s * 2.4, s * .5); c.fillStyle = '#fff'; c.font = `bold ${Math.round(s * .35)}px system-ui`; c.textAlign = 'center'; c.fillText(`${e.parts || 0}/100`, ex, ey + s * 1.18); }
        condIcon(e);
        if (e.t === 'combinator' && e.cc?.sig) { const q = e.cc.sig.find(x => x); if (q) c.drawImage(itemIcon(q.s), ex - s * .3, ey - s * .3, s * .6, s * .6); }
        if (e.t === 'arith' || e.t === 'decider') { // v1.6: первый сигнал выхода и его значение (и сколько ещё)
          const co = g.cco ? g.cco[e.id] : e.co; const ks = co ? Object.keys(co) : []; this.stat.conds++;
          c.fillStyle = 'rgba(0,0,0,.72)'; c.beginPath(); c.roundRect(ex - s * .48, ey - s * .42, s * .96, s * .84, s * .12); c.fill();
          if (ks.length) { const k = ks[0]; c.drawImage(itemIcon(k), ex - s * .22, ey - s * .4, s * .44, s * .44); c.fillStyle = '#fff'; c.font = `bold ${Math.round(s * .26)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(fmtSig(co![k]) + (ks.length > 1 ? ` +${ks.length - 1}` : ''), ex, ey + s * .34); }
          else { c.fillStyle = '#8a949c'; c.font = `bold ${Math.round(s * .28)}px system-ui,sans-serif`; c.textAlign = 'center'; c.fillText('0', ex, ey + s * .1); }
        }
        if (e.t === 'drill') { const o = g.drillOut(e); c.strokeStyle = '#ffd34d'; c.lineWidth = 2; c.strokeRect(sx(o.x) + 2, sy(o.y) + 2, s - 4, s - 4); }
      }
      if (bad && (t >> 5) % 2 === 0 || bad && e.status === 'no-power') this.statusIcon(e.status!, ex, ey - (v.alt ? s * .5 : 0), s);
      else if (e.lst && (t >> 5) % 2 === 0) this.statusIcon(e.lst === 'noitem' ? 'no-input' : 'no-robots', ex, ey - (v.alt ? s * .5 : 0), s); // v1.3: сундук запроса ждёт
    }
    // полосы прочности
    if (!mapMode) {
      for (const e of tall) { const max = PROTOS[e.proto].hp; if (e.hp != null && e.hp < max) this.hpBar(c, sx(e.x + e.w / 2), sy(e.y) - s * .1, e.w * s * .8, e.hp / max, e.t === 'nest'); }
      for (const u of g.units) { const max = UNITS[u.k].hp; if (u.hp < max && u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) this.hpBar(c, sx(u.x), sy(u.y) - UNITS[u.k].size * s * .7, UNITS[u.k].size * s, u.hp / max, true); }
    }
    // зона подсветки наведения
    if (v.hoverEnt && !v.cursor) { const e = v.hoverEnt; c.strokeStyle = 'rgba(255,220,100,.9)'; c.lineWidth = 2; c.strokeRect(sx(e.x) + 1, sy(e.y) + 1, e.w * s - 2, e.h * s - 2);
      if (e.t === 'inserter') { const it = g.inserterTiles(e); c.strokeStyle = 'rgba(80,200,255,.9)'; c.strokeRect(sx(it.sx) + 3, sy(it.sy) + 3, s - 6, s - 6); c.strokeStyle = 'rgba(255,180,60,.9)'; c.strokeRect(sx(it.dx) + 3, sy(it.dy) + 3, s - 6, s - 6); }
      if (e.t === 'drill') { const a = PROTOS[e.proto].area!; const off = (a - e.w) / 2; c.fillStyle = 'rgba(80,200,255,.12)'; c.fillRect(sx(e.x - off), sy(e.y - off), a * s, a * s); }
      if (e.t === 'pole') { const r = PROTOS[e.proto].supply!; c.fillStyle = 'rgba(80,200,255,.12)'; c.fillRect(sx(e.x - r), sy(e.y - r), (2 * r + e.w) * s, (2 * r + e.h) * s); }
      if (e.t === 'beacon') { const r = PROTOS[e.proto].beaconRange!; c.fillStyle = 'rgba(200,120,255,.12)'; c.fillRect(sx(e.x - r), sy(e.y - r), (2 * r + e.w) * s, (2 * r + e.h) * s); c.strokeStyle = 'rgba(200,120,255,.7)'; c.strokeRect(sx(e.x - r), sy(e.y - r), (2 * r + e.w) * s, (2 * r + e.h) * s);
        for (const o of g.ents.values()) if (o.modules && o.t !== 'beacon' && o.x < e.x + e.w + r && o.x + o.w > e.x - r && o.y < e.y + e.h + r && o.y + o.h > e.y - r) { c.strokeStyle = 'rgba(200,120,255,.9)'; c.strokeRect(sx(o.x) + 2, sy(o.y) + 2, o.w * s - 4, o.h * s - 4); } }
    }
    // добыча рукой — полоса
    const m = g.player.mining;
    if (m && m.total) { c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2; c.strokeRect(sx(m.x) + 1, sy(m.y) + 1, s - 2, s - 2); c.fillStyle = '#222'; c.fillRect(sx(px) - s * .5, sy(py) - s * 1.1, s, s * .14); c.fillStyle = '#ffcc33'; c.fillRect(sx(px) - s * .5, sy(py) - s * 1.1, s * m.p / m.total, s * .14); }
    // призрак постройки
    // v1.4: кисть покрытий
    if (v.cursor && FLOOR_BY_ITEM[v.cursor] && v.mouseIn && !mapMode) {
      const n = v.brush || 1; const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr); const [bx, by] = brushOrigin(wx, wy, n);
      const f = FLOORS[FLOOR_BY_ITEM[v.cursor] - 1];
      c.globalAlpha = .45; c.fillStyle = f.color; c.fillRect(sx(bx), sy(by), n * s, n * s); c.globalAlpha = 1;
      c.strokeStyle = '#4be36b'; c.lineWidth = 2; c.strokeRect(sx(bx), sy(by), n * s, n * s);
      if (s >= 12) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(sx(bx), sy(by) - 16, 46, 15); c.fillStyle = '#e8f0d8'; c.font = '11px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(`${n}×${n}`, sx(bx) + 4, sy(by) - 8); }
    }
    // v1.7: план пути (рельсы в руке) и вагон на рельсах
    if (v.railPlan && v.mouseIn) {
      const rp = v.railPlan;
      for (const pc of rp.pieces) { const sh = shapeOf(pc.proto, pc.dir); c.globalAlpha = pc.have ? .35 : .9; drawRail(c, pc.proto, pc.dir, sx(pc.x + sh.ox), sy(pc.y + sh.oy), s, { ghost: true, map: mapMode }); c.globalAlpha = 1; }
      const [ex, ey] = rp.end; c.strokeStyle = rp.ok ? '#4be36b' : '#f04848'; c.lineWidth = 2; c.beginPath(); c.arc(sx(ex), sy(ey), Math.max(4, s * .5), 0, 7); c.stroke();
      if (rp.start) { c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(sx(rp.start[0]), sy(rp.start[1]), Math.max(3, s * .3), 0, 7); c.fill(); }
      const label = rp.label; if (label) { c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle'; const tw = c.measureText(label).width; c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(sx(ex) + 12, sy(ey) - 10, tw + 10, 20); c.fillStyle = rp.ok ? '#e8f0d8' : '#ff9a8a'; c.fillText(label, sx(ex) + 17, sy(ey)); }
    } else if (v.carGhost && v.mouseIn && !mapMode) {
      const q = v.carGhost; c.globalAlpha = .6; drawCar(c, q.proto, sx(q.x), sy(q.y), q.dx, q.dy, s, { ghost: true }); c.globalAlpha = 1;
      if (!q.ok && q.reason) { c.font = `${Math.round(13 * dpr)}px system-ui,sans-serif`; c.textAlign = 'center'; c.fillStyle = 'rgba(0,0,0,.7)'; const rs = tr(q.reason); const tw = c.measureText(rs).width; c.fillRect(sx(q.x) - tw / 2 - 6, sy(q.y) - s * 2 - 22, tw + 12, 20); c.fillStyle = '#ff9a8a'; c.fillText(rs, sx(q.x), sy(q.y) - s * 2 - 8); }
    } else if (v.cursor && v.ghostPos && v.mouseIn) {
      const pid = ITEMS[v.cursor]?.place;
      if (pid) {
        const p = PROTOS[pid]; const [gx, gy] = v.ghostPos; const w = v.rot % 2 ? p.h : p.w, h = v.rot % 2 ? p.w : p.h;
        if (p.type === 'drill') { const a = p.area!, off = (a - w) / 2; c.fillStyle = 'rgba(80,200,255,.15)'; c.fillRect(sx(gx - off), sy(gy - off), a * s, a * s); }
        if (p.type === 'pole') { const r = p.supply!; c.fillStyle = 'rgba(80,200,255,.13)'; c.fillRect(sx(gx - r), sy(gy - r), (2 * r + w) * s, (2 * r + h) * s);
          c.strokeStyle = 'rgba(255,200,120,.6)'; c.lineWidth = 1.5; for (const e of g.ents.values()) if (e.t === 'pole' && Math.hypot(e.x + e.w / 2 - gx - w / 2, e.y + e.h / 2 - gy - h / 2) <= Math.min(p.wire!, PROTOS[e.proto].wire!)) { c.beginPath(); c.moveTo(sx(gx + w / 2), sy(gy + .2)); c.lineTo(sx(e.x + e.w / 2), sy(e.y + .2)); c.stroke(); } }
        if (p.type === 'beacon') { const r = p.beaconRange!; c.fillStyle = 'rgba(200,120,255,.13)'; c.fillRect(sx(gx - r), sy(gy - r), (2 * r + w) * s, (2 * r + h) * s); }
        if (p.type === 'underground') { c.fillStyle = 'rgba(255,220,100,.12)'; for (let i = 1; i <= p.reach!; i++) c.fillRect(sx(gx + DX[v.rot] * i), sy(gy + DY[v.rot] * i), s, s); }
        c.globalAlpha = .6; drawEntityArt(c, pid, sx(gx), sy(gy), s, v.rot, { t: 0, ug: 'in' }); c.globalAlpha = 1;
        const ok = v.ghostOk?.ok;
        c.fillStyle = ok ? 'rgba(60,220,90,.25)' : 'rgba(240,60,60,.3)'; c.fillRect(sx(gx), sy(gy), w * s, h * s);
        c.strokeStyle = ok ? '#4be36b' : '#f04848'; c.lineWidth = 2; c.strokeRect(sx(gx), sy(gy), w * s, h * s);
        if (p.type === 'inserter' || p.type === 'belt' || p.type === 'drill' || p.type === 'pump' || p.type === 'underground' || p.type === 'splitter') {
          c.save(); c.translate(sx(gx + w / 2), sy(gy + h / 2)); c.rotate(v.rot * Math.PI / 2); c.fillStyle = '#ffd34d'; c.beginPath(); c.moveTo(0, -s * (h / 2 + .3)); c.lineTo(s * .2, -s * (h / 2 + .05)); c.lineTo(-s * .2, -s * (h / 2 + .05)); c.fill(); c.restore();
        }
        if (!ok && v.ghostOk?.reason) { c.font = `${Math.round(13 * dpr)}px system-ui,sans-serif`; c.textAlign = 'center'; c.fillStyle = 'rgba(0,0,0,.7)'; const rs = tr(v.ghostOk.reason); const tw = c.measureText(rs).width; c.fillRect(sx(gx + w / 2) - tw / 2 - 6, sy(gy) - 26 * dpr, tw + 12, 20 * dpr); c.fillStyle = '#ffb0a0'; c.fillText(rs, sx(gx + w / 2), sy(gy) - 11 * dpr); }
      }
    }
    // чертёж в руке
    if (v.bp && v.bpPos && v.mouseIn) {
      const [bx, by] = v.bpPos;
      for (const be of v.bp.entities) {
        const [w, h] = bpEntDims(be); const x = bx + be.x, y = by + be.y;
        if (x + w < x0 || x > x1 || y + h < y0 || y > y1) continue;
        const ok = g.canPlace(be.p, x, y, be.d, false).ok || !!g.replaceTarget(be.p, x, y, be.d);
        c.globalAlpha = .5; if (PROTOS[be.p].type === 'pipe' || PROTOS[be.p].type === 'belt' || !mapMode) drawEntityArt(c, be.p, sx(x), sy(y), s, be.d, { t: 0, ug: 'in' }); c.globalAlpha = 1;
        c.fillStyle = ok ? 'rgba(80,170,255,.18)' : 'rgba(240,60,60,.35)'; c.fillRect(sx(x), sy(y), w * s, h * s);
        if (be.recipe && s > 20) { c.drawImage(itemIcon(RECIPES[be.recipe]?.out[0][0] || be.p), sx(x + w / 2) - s * .3, sy(y + h / 2) - s * .3, s * .6, s * .6); }
      }
      c.strokeStyle = '#58b0ff'; c.lineWidth = 2; c.setLineDash([6, 4]); c.strokeRect(sx(bx), sy(by), v.bp.w * s, v.bp.h * s); c.setLineDash([]);
    }
    // рамка инструмента выделения
    if (v.sel) {
      const X0 = Math.min(v.sel.x0, v.sel.x1), Y0 = Math.min(v.sel.y0, v.sel.y1), X1 = Math.max(v.sel.x0, v.sel.x1) + 1, Y1 = Math.max(v.sel.y0, v.sel.y1) + 1;
      const [f, st] = v.sel.cancel ? ['rgba(255,255,255,.08)', '#ddd'] : TOOL_COL[v.tool || 'copy'];
      c.fillStyle = f; c.fillRect(sx(X0), sy(Y0), (X1 - X0) * s, (Y1 - Y0) * s); c.strokeStyle = st; c.lineWidth = 2; c.strokeRect(sx(X0), sy(Y0), (X1 - X0) * s, (Y1 - Y0) * s);
      c.font = `${Math.round(12 * dpr)}px system-ui`; c.fillStyle = st; c.textAlign = 'left'; c.fillText(`${X1 - X0}×${Y1 - Y0}`, sx(X1) + 4, sy(Y1) + 4);
    } else if (v.tool && v.mouseIn) { const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr); c.strokeStyle = TOOL_COL[v.tool][1]; c.lineWidth = 2; c.strokeRect(sx(Math.floor(wx)), sy(Math.floor(wy)), s, s); }
    // 9. ночь
    const day = v.noNight ? 1 : g.daylight();
    if (day < 1) {
      const d = this.dark; if (d.width !== W || d.height !== H) { d.width = W; d.height = H; }
      const x = d.getContext('2d')!; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H);
      x.fillStyle = `rgba(6,10,28,${(1 - day) * 0.72})`; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-out';
      const light = (lx: number, ly: number, r: number, k: number) => { const gr = x.createRadialGradient(lx, ly, 0, lx, ly, r); gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(lx - r, ly - r, r * 2, r * 2); };
      light(sx(px), sy(py), s * 7, 0.9);
      for (const e of tall) {
        if ((e.t === 'furnace' || e.t === 'boiler' || e.t === 'lab' || e.t === 'assembler' || e.t === 'radar') && e.status === 'working' || e.t === 'beacon' && e._on) light(sx(e.x + e.w / 2), sy(e.y + e.h / 2), s * 3, .6);
        else if (e.t === 'silo' && (e.status === 'working' || e.status === 'launching')) light(sx(e.x + 4.5), sy(e.y + 4.5), s * (e.status === 'launching' ? 14 : 7), .8)
        else if (e.t === 'lamp' && e.active) light(sx(e.x + .5), sy(e.y + .5), s * 9, 1);
        else if (e.t === 'turret' && (e.fireCd || 0) >= 4) light(sx(e.x + 1), sy(e.y + 1), s * 4, .7);
        else if (e.t === 'nest') light(sx(e.x + 1.5), sy(e.y + 1.5), s * 2.5, .35);
      }
      for (const f of g.fx) if (f.k === 'boom') light(sx(f.x), sy(f.y), s * 5 * (f.s || 1), f.t / 40);
      c.drawImage(d, 0, 0);
    }
    this.ctx = this.mainCtx;
  }
  /** направления, в которые труба реально соединена с соседями, и заливка (цвет, радиус 0..1) */
  pipeInfo(g: Game, e: Entity): { mask: number; col: string | null; r: number } {
    let mask = 0;
    for (const cn of fluidConns(e, 0)) {
      const nx = cn.x + DX[cn.d], ny = cn.y + DY[cn.d]; const o = g.entAt(nx, ny);
      if (!o || !PROTOS[o.proto].fluid) continue;
      if (PROTOS[o.proto].fluid!.some((_, b) => fluidConns(o, b).some(oc => oc.x === nx && oc.y === ny && oc.d === (cn.d + 2) % 4))) mask |= 1 << cn.d;
    }
    const net = e._fn ? g.fluidNets[e._fn[0]] : null;
    if (net && net.amount > 0.5 && !PROTOS[e.proto].ugReach) return { mask, col: net.fluid ? ITEMS[net.fluid]?.color || '#3c8fd8' : '#3c8fd8', r: Math.min(1, .3 + net.amount / net.cap) };
    return { mask, col: null, r: 0 };
  }
  pipeArt(c: CanvasRenderingContext2D, e: { proto: string; dir: number; id: number }, info: { mask: number; col: string | null; r: number }, x: number, y: number, s: number) {
    for (let d = 0; d < 4; d++) if (info.mask & (1 << d)) { c.save(); c.translate(x + s / 2, y + s / 2); c.rotate(d * Math.PI / 2); c.fillStyle = '#7a838b'; c.fillRect(-s * .2, -s * .52, s * .4, s * .52); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-s * .2, -s * .52, s * .4, s * .06); c.restore(); }
    drawEntityArt(c, e.proto, x, y, s, e.dir, { t: 0, seed: e.id });
    if (info.col) { c.fillStyle = info.col; c.beginPath(); c.arc(x + s / 2, y + s / 2, s * .14 * info.r, 0, 7); c.fill(); }
  }

  private colCache = new Map<string, number>(); private colCv: CanvasRenderingContext2D | null = null;
  /** CSS-цвет → упакованный RGBA для пакета */
  col(css: string, a = 1): number {
    const k = css + a; let n = this.colCache.get(k); if (n !== undefined) return n;
    if (css[0] === '#' && (css.length === 7 || css.length === 4)) n = rgba(css, a);
    else { const m = css.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); n = (((Math.round((p[3] ?? 1) * a * 255)) << 24) | (p[2] << 16) | (p[1] << 8) | p[0]) >>> 0; } else n = rgba('#ff00ff', a); }
    this.colCache.set(k, n); return n;
  }
  /** Средний слой из атласа: конвейеры, предметы, постройки, деревья, юниты, персонаж — по Y */
  private midBatched(g: Game, v: View, F: { s: number; px: number; py: number; x0: number; y0: number; x1: number; y1: number; sx: (n: number) => number; sy: (n: number) => number; t: number; mapMode: boolean; flat: Entity[]; tall: Entity[]; trees: [number, number][]; W: number; H: number }) {
    const b = this.batch!; const { s, px, py, x0, y0, x1, y1, sx, sy, t, mapMode, flat, tall, trees, W, H } = F;
    const T0 = performance.now(); b.begin(W, H);
    const R = s <= 20 ? 16 : s <= 40 ? 32 : s <= 76 ? 64 : 128;
    const ent = (e: Entity, st: ArtState, stKey: string, frame: number, flatPad: boolean, force = false) => {
      const [pl, pt, pr, pb] = force && e.t === 'silo' ? [1, 14, 1, 1] : this.padFor(e);
      const base = `${e.proto}|${e.dir}|${stKey}`;
      const bw = e.w * R, bh = e.h * R;
      b.sprite(`${base}#${frame}@${R}`, base, (e.w + pl + pr) * R, (e.h + pt + pb) * R, c => {
        c.translate(pl * R, pt * R);
        if (flatPad) { c.translate(-1, -1); c.scale((bw + 2) / bw, (bh + 2) / bh); } // +1 px за край клетки — без швов между соседями
        drawEntityArt(c, e.proto, 0, 0, R, e.dir, st);
      }, Math.round(sx(e.x) - pl * s), Math.round(sy(e.y) - pt * s), Math.round((e.w + pl + pr) * s), Math.round((e.h + pt + pb) * s), 1, force);
    };
    /** v1.4: значок размера стопки на ленте (2–4) */
    const badge = (n: number, x: number, y: number, sz: number) => { const iz = Math.max(8, Math.ceil(R * sz / s)); const key = `n|${n}|${iz}`; this.stat.badges++; b.sprite(key, key, iz, iz, c => drawStackBadge(c, n, iz), x, y, sz, sz); };
    const icon = (item: string, x: number, y: number, sz: number) => { const iz = Math.max(8, Math.ceil(R * sz / s)); const key = `i|${item}|${iz}`; b.sprite(key, key, iz, iz, c => drawItemIcon(c, item, iz), x, y, sz, sz); };
    // 4. конвейеры и трубы
    for (const e of flat) {
      if (mapMode) { b.rect(sx(e.x), sy(e.y), e.w * s, e.h * s, this.col(PROTOS[e.proto].color)); continue; }
      if (e.t === 'pipe') {
        const info = this.pipeInfo(g, e); const v2 = e.id & 1; const base = `pipe|${e.proto}|${e.dir}|${info.mask}|${info.col}|${Math.round(info.r * 4)}|${v2}`;
        b.sprite(`${base}@${R}`, base, 1.2 * R, 1.2 * R, c => this.pipeArt(c, { proto: e.proto, dir: e.dir, id: v2 * 7 + 3 }, { ...info, r: Math.round(info.r * 4) / 4 }, .1 * R, .1 * R, R), sx(e.x) - .1 * s, sy(e.y) - .1 * s, 1.2 * s, 1.2 * s);
        continue;
      }
      const sp = PROTOS[e.proto].speed || 8; const fr = e.moving === false ? 0 : Math.floor(((t * sp / 64) % 1) * 8);
      ent(e, { t: fr * 8 / sp, curve: e.curve, ug: e.ug }, `${e.curve ?? ''}|${e.ug || ''}`, fr, true);
    }
    // 5. предметы на конвейерах
    if (!mapMode) {
      const bi = this.beltItems;
      if (bi && bi.tick === g.tick) { const a = bi.data; for (let i = 0; i < bi.n; i++) { const ix = a[i * 3], iy = a[i * 3 + 1]; if (ix < x0 || ix > x1 || iy < y0 || iy > y1) continue; const v = a[i * 3 + 2], n = (v >> 12) + 1; icon(ITEM_IDS[v & 4095], sx(ix) - s * .2, sy(iy) - s * .2, s * .4); if (n > 1 && s >= 20) badge(n, sx(ix) + s * .02, sy(iy) + s * .02, s * .2); } }
      else for (const e of flat) {
        if (!e.lanes) continue;
        for (let si = 0; si < e.lanes.length; si++) for (let L = 0; L < 2; L++) for (const it of e.lanes[si][L]) {
          const [ix, iy] = this.beltItemPos(e, si, L, Math.min(255, it.pos)); icon(it.item, sx(ix) - s * .2, sy(iy) - s * .2, s * .4); if (it.n > 1 && s >= 20) badge(it.n, sx(ix) + s * .02, sy(iy) + s * .02, s * .2);
        }
      }
    }
    // 6. постройки, деревья, юниты Роя и персонаж — сортировка по Y
    type Obj = { y: number; k: 0 | 1 | 2; e?: Entity; tx?: number; ty?: number; u?: Unit };
    const objs: Obj[] = [];
    for (const e of tall) objs.push({ y: e.y + e.h, k: 0, e });
    for (const [tx, ty] of trees) objs.push({ y: ty + .8, k: 1, tx, ty });
    if (!mapMode) for (const u of g.units) if (u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) objs.push({ y: u.y + .2, k: 2, u });
    objs.sort((a, b2) => a.y - b2.y);
    let playerDrawn = false;
    const drawPlayer = () => { playerDrawn = true; if (g.player.dead || g.player.veh != null) return;
      b.sprite(`player@${R}`, 'player', 1.3 * R, 1.4 * R, c => this.drawPlayer(g, .65 * R, .95 * R, R, c), sx(px) - .65 * s, sy(py) - .95 * s, 1.3 * s, 1.4 * s, 1, true); };
    for (const o of objs) {
      if (!playerDrawn && o.y > py + 0.3) drawPlayer();
      if (o.k === 1) {
        const tx = o.tx!, ty = o.ty!; const vv = hash2(tx, ty, 5) * 6 | 0; const sc = 0.85 + hash2(tx, ty, 7) * 0.3;
        const ax = sx(tx) + s * (.5 + (hash2(tx, ty, 3) - .5) * .25), ay = sy(ty) + s * (.78 + (hash2(tx, ty, 4) - .5) * .2);
        const key = `tree|${vv}@${R}`; b.sprite(key, `tree|${vv}`, 2 * R, 2.5 * R, c => c.drawImage(treeSprite(vv).img, 0, 0, 2 * R, 2.5 * R), ax - s * sc, ay - 2.1 * s * sc, 2 * s * sc, 2.5 * s * sc);
        continue;
      }
      if (o.k === 2) {
        const u = o.u!; const d = UNITS[u.k]; const L = d.size * s * 1.45, LR = d.size * R * 1.45;
        const aq = ((Math.round(u.ang / (Math.PI * 2) * 16) % 16) + 16) % 16; const ph = (t + u.id * 7) * (0.35 + d.speed); const pq = Math.floor(((ph / (Math.PI * 2)) % 1) * 8);
        const base = `unit|${u.k}|${aq}`;
        b.sprite(`${base}|${pq}@${R}`, base, 1.5 * LR, 1.5 * LR, c => this.drawUnit(c, { ...u, ang: aq * Math.PI * 2 / 16 } as Unit, .75 * LR, .75 * LR, R, 0, pq * Math.PI * 2 / 8), sx(u.x) - .75 * L, sy(u.y) - .75 * L, 1.5 * L, 1.5 * L);
        continue;
      }
      const e = o.e!;
      if (mapMode) { b.rect(sx(e.x), sy(e.y), e.w * s, e.h * s, this.col(PROTOS[e.proto].color)); continue; }
      const working = e.status === 'working' || e.status === 'low-power';
      const st: ArtState = { t: 0, seed: (e.id & 1) * 7 + 3, working, recipeColor: e.recipe && RECIPES[e.recipe] ? ITEMS[RECIPES[e.recipe].out[0][0]]?.color : undefined };
      let key = `${working ? 1 : 0}|${st.recipeColor || ''}|${e.id & 1}`; let anim = working, force = false;
      if (e.t === 'turret') { const q = Math.round((e.aim || 0) / (Math.PI * 2) * 32); st.aim = q * Math.PI * 2 / 32; st.flash = (e.fireCd || 0) >= 4; key += `|${q}|${st.flash ? 1 : 0}`; }
      if (e.t === 'lamp') { st.lit = e.active; st.lampColor = e.ccol; key += `|${e.active ? 1 : 0}|${e.ccol || ''}`; }
      if (e.modules) { st.mods = e.modules; key += `|${e.modules.join(',')}`; }
      if (e.t === 'beacon') { st.working = anim = !!e._on; key += `|${e._on ? 1 : 0}`; }
      if (e.t === 'accumulator') { const f = Math.round((e.charge || 0) / (PROTOS[e.proto].accum!.MJ * 1e6) * 10) / 10; st.fill = f; key += `|${f}`; }
      if (e.t === 'silo') { st.parts = Math.floor((e.parts || 0) / 5) * 5; st.launch = e.launchT ? 1 - e.launchT / 900 : 0; st.working = anim = e.status === 'working' || e.status === 'launching'; key += `|${st.parts}`; if (e.launchT) { force = true; key += `|L${e.id}`; st.t = t; } }
      if (e.t === 'radar') { st.working = anim = e.status === 'working'; }
      if (e.t === 'tank' && e._fn) { const n = g.fluidNets[e._fn[0]]; if (n) { st.fill = n.cap ? Math.round(Math.min(1, n.amount / n.cap) * 10) / 10 : 0; st.fluidColor = n.fluid ? ITEMS[n.fluid]?.color : undefined; key += `|${st.fill}|${st.fluidColor}`; } }
      if (e.t === 'nest') anim = true;
      if (e.t === 'arith' || e.t === 'decider') { st.op = e.t === 'arith' ? e.cc?.ar?.op : e.cc?.de?.op; anim = false; key += `|${st.op || ''}`; }
      const fr = anim && !force ? Math.floor((t % 96) / 4) : 0; if (!force) st.t = fr * 4;
      ent(e, st, key, fr, false, force);
      if (e.t === 'inserter') {
        const p = PROTOS[e.proto]; const half = 60 / (p.rot! * 2);
        let kk = 0; if (e.ist === 1) kk = e.itimer! / half; else if (e.ist === 2) kk = 1; else if (e.ist === 3) kk = 1 - e.itimer! / half;
        const a = (e.dir + 2) % 4 * Math.PI / 2 + kk * Math.PI; const len = p.reach! * s * (0.75 + 0.25 * Math.abs(Math.cos(kk * Math.PI)));
        const bx = sx(e.x + .5), by = sy(e.y + .5), ex = bx + Math.sin(a) * len, ey = by - Math.cos(a) * len;
        const mx = bx + Math.sin(a) * len * .5 + Math.cos(a) * s * .12, my = by - Math.cos(a) * len * .5 + Math.sin(a) * s * .12 - s * .2;
        const ac = this.col(shade(p.color, -.2)); b.line(bx, by, mx, my, s * .1, ac); b.line(mx, my, ex, ey, s * .1, ac);
        const dk = `dot@${R}`; b.sprite(dk, 'dot', R * .2, R * .2, c => { c.fillStyle = '#333'; c.beginPath(); c.arc(R * .1, R * .1, R * .07, 0, 7); c.fill(); }, ex - s * .1, ey - s * .1, s * .2, s * .2);
        if (e.hand) icon(e.hand, ex - s * .18, ey - s * .18, s * .36);
      }
    }
    if (!playerDrawn) drawPlayer();
    b.end();
    const A = b.atlas; this.stat.mid = performance.now() - T0; this.stat.quads = b.quads; this.stat.rast = A.rastN; this.stat.rastMs = A.rastMs; this.stat.evict = A.evictions;
  }
  private pads = new Map<string, [number, number, number, number]>();
  /** поля спрайта вокруг клеток постройки (в клетках): измеряются один раз по непрозрачным пикселям рисунка в разных состояниях */
  padFor(e: Entity): [number, number, number, number] {
    const k = e.proto + '|' + e.dir; let r = this.pads.get(k); if (r) return r;
    const R = 32, P = 2, PT = 4, w = e.w, h = e.h; const cv = document.createElement('canvas'); cv.width = (w + 2 * P) * R; cv.height = (h + PT + P) * R;
    const c = cv.getContext('2d', { willReadFrequently: true })!; const t = PROTOS[e.proto].type;
    const sts: ArtState[] = [{ t: 0 }, { t: 0, working: true }, { t: 24, working: true }, { t: 48, working: true }, { t: 72, working: true }, { t: 0, lit: true }, { t: 0, fill: 1, parts: 100 }];
    if (t === 'turret') for (let i = 0; i < 8; i++) sts.push({ t: 0, aim: i * Math.PI / 4, flash: true });
    for (const st of sts) { c.save(); c.translate(P * R, PT * R); drawEntityArt(c, e.proto, 0, 0, R, e.dir, { seed: 3, ...st }); c.restore(); }
    const d = c.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const q = (v: number) => Math.max(1 / 16, Math.ceil((v + 2 / R) * 16) / 16);
    r = x1 < 0 ? [.1, .1, .1, .1] : [q(P - x0 / R), q(PT - y0 / R), q((x1 + 1) / R - P - w), q((y1 + 1) / R - PT - h)];
    this.pads.set(k, r); return r;
  }
  /** предметы на конвейерах, посчитанные в Worker (Float32Array x, y, индекс предмета) */
  beltItems: { tick: number; n: number; data: Float32Array } | null = null;
  private drawPipe(g: Game, e: Entity, x: number, y: number, s: number) { this.pipeArt(this.ctx, e, this.pipeInfo(g, e), x, y, s); }
  private drawArm(g: Game, e: Entity, sx: (n: number) => number, sy: (n: number) => number, s: number) {
    const c = this.ctx; const p = PROTOS[e.proto]; const half = 60 / (p.rot! * 2);
    let k = 0; if (e.ist === 1) k = e.itimer! / half; else if (e.ist === 2) k = 1; else if (e.ist === 3) k = 1 - e.itimer! / half;
    const a0 = (e.dir + 2) % 4 * Math.PI / 2, a = a0 + k * Math.PI; // от источника к цели
    const len = p.reach! * s * (0.75 + 0.25 * Math.abs(Math.cos(k * Math.PI)));
    const bx = sx(e.x + .5), by = sy(e.y + .5);
    const ex = bx + Math.sin(a) * len, ey = by - Math.cos(a) * len;
    const mx = bx + Math.sin(a) * len * .5 + Math.cos(a) * s * .12, my = by - Math.cos(a) * len * .5 + Math.sin(a) * s * .12 - s * .2;
    c.strokeStyle = shade(p.color, -.2); c.lineCap = 'round'; c.lineWidth = s * .1;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(mx, my); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = '#333'; c.beginPath(); c.arc(ex, ey, s * .07, 0, 7); c.fill();
    if (e.hand) c.drawImage(itemIcon(e.hand), ex - s * .18, ey - s * .18, s * .36, s * .36);
  }
  /** v1.4: покрытия. Плитки по виду и размеру клетки кешируются; при большом обзоре обходим словарь покрытий, а не клетки экрана */
  private floorTiles = new Map<string, HTMLCanvasElement>();
  private floorTile(f: number, z: number) {
    const k = f + '|' + z; let cv = this.floorTiles.get(k); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = z; const c = cv.getContext('2d')!; const F = FLOORS[f - 1];
    c.fillStyle = F.color; c.fillRect(0, 0, z, z);
    if (z >= 12) {
      if (F.id === 'stone-path') { // кирпичная кладка
        c.strokeStyle = 'rgba(40,30,24,.45)'; c.lineWidth = Math.max(1, z / 32);
        for (let r = 0; r < 4; r++) { const y = r * z / 4; c.beginPath(); c.moveTo(0, y); c.lineTo(z, y); c.stroke(); const o = r % 2 ? z / 4 : 0; for (let x = o; x < z; x += z / 2) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + z / 4); c.stroke(); } }
        c.fillStyle = 'rgba(255,240,220,.06)'; for (let r = 0; r < 4; r++) c.fillRect(0, r * z / 4 + 1, z, z / 16);
      } else { // бетон: шов по краю плиты и зерно
        let h = f * 7919; const rnd = () => (h = (h * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < z * z / 24; i++) { c.fillStyle = rnd() < .5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.06)'; c.fillRect(rnd() * z, rnd() * z, Math.max(1, z / 40), Math.max(1, z / 40)); }
        c.strokeStyle = F.fireproof ? 'rgba(200,170,60,.35)' : 'rgba(0,0,0,.28)'; c.lineWidth = Math.max(1, z / 40); c.strokeRect(.5, .5, z - 1, z - 1);
      }
    }
    if (this.floorTiles.size > 64) this.floorTiles.clear();
    this.floorTiles.set(k, cv); return cv;
  }
  private drawFloors(g: Game, c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, sx: (n: number) => number, sy: (n: number) => number, s: number) {
    const z = Math.max(4, Math.min(64, Math.round(s))); const tiles: (HTMLCanvasElement | null)[] = [null, this.floorTile(1, z), this.floorTile(2, z), this.floorTile(3, z)];
    const sz = Math.ceil(s) + 1;
    const draw = (tx: number, ty: number, f: number) => { const t = tiles[f]; if (t) this.stat.floors++, c.drawImage(t, Math.floor(sx(tx)), Math.floor(sy(ty)), sz, sz); };
    if (g.floors.size < (x1 - x0 + 1) * (y1 - y0 + 1)) {
      for (const [k, f] of g.floors) { const tx = Math.floor(k / 131072) - 65536, ty = (k % 131072) - 65536; if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) draw(tx, ty, f); }
    } else for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const f = g.floors.get((tx + 65536) * 131072 + (ty + 65536)); if (f) draw(tx, ty, f); }
  }
  private statusIcon(st: string, x: number, y: number, s: number) {
    const c = this.ctx; const r = Math.max(8, s * .28);
    const colr = st === 'disabled' ? '#9aa3ab' : st === 'no-power' || st === 'low-power' ? '#e8c22e' : st === 'no-fuel' ? '#ff8a2a' : st === 'output-full' ? '#4aa3ff' : '#e84a4a';
    c.fillStyle = 'rgba(20,20,20,.8)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.strokeStyle = colr; c.lineWidth = 2; c.stroke();
    c.fillStyle = colr; c.font = `bold ${Math.round(r * 1.2)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const sym: Record<string, string> = { 'no-power': '⚡', 'low-power': '⚡', 'no-fuel': '🔥', 'no-input': '!', 'output-full': '▣', 'no-recipe': '?', 'no-ore': '⛏', 'no-research': '?', 'no-water': '≈', 'no-robots': '⊘', disabled: '⏸' };
    c.fillText(sym[st] || '!', x, y + 1); c.textBaseline = 'alphabetic';
  }
  /** зоны робопортов; при Alt — все, иначе тоже все (сеть видна целиком), плюс зона ставимого робопорта и личного */
  private drawZones(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, place: [number, number] | null) {
    const ports: { x: number; y: number; cz: number; lz: number; ghost?: boolean }[] = [];
    for (const e of g.ents.values()) if (e.t === 'roboport') { const R = PROTOS[e.proto].robo!; ports.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, cz: R.cz, lz: R.lz }); }
    if (place) { const R = PROTOS['roboport'].robo!; ports.push({ x: place[0] + 2, y: place[1] + 2, cz: R.cz, lz: R.lz, ghost: true }); }
    if (ports.length > 200) ports.length = 200;
    c.save();
    c.fillStyle = 'rgba(255,140,30,.06)'; for (const p of ports) c.fillRect(sx(p.x - p.cz / 2), sy(p.y - p.cz / 2), p.cz * s, p.cz * s);
    c.fillStyle = 'rgba(255,220,60,.08)'; for (const p of ports) c.fillRect(sx(p.x - p.lz / 2), sy(p.y - p.lz / 2), p.lz * s, p.lz * s);
    c.lineWidth = Math.max(1, s * .05);
    for (const p of ports) {
      c.setLineDash(p.ghost ? [8, 6] : []);
      c.strokeStyle = 'rgba(255,150,40,.75)'; c.strokeRect(sx(p.x - p.cz / 2), sy(p.y - p.cz / 2), p.cz * s, p.cz * s);
      c.strokeStyle = 'rgba(255,225,70,.85)'; c.strokeRect(sx(p.x - p.lz / 2), sy(p.y - p.lz / 2), p.lz * s, p.lz * s);
    }
    c.setLineDash([]);
    const eq = g.equip ? ITEMS[g.equip]?.equip : undefined;
    if (eq && !g.player.dead) { const z = eq.zone; c.fillStyle = 'rgba(120,255,140,.07)'; c.fillRect(sx(g.player.x - z / 2), sy(g.player.y - z / 2), z * s, z * s); c.strokeStyle = 'rgba(120,255,140,.7)'; c.strokeRect(sx(g.player.x - z / 2), sy(g.player.y - z / 2), z * s, z * s); }
    c.restore();
  }
  /** значок состояния призрака: ждёт робота / нет предмета / нет роботов / вне зоны */
  private ghostIcon(c: CanvasRenderingContext2D, st: string, item: string, x: number, y: number, s: number, t: number) {
    const r = Math.max(6, s * .26);
    c.fillStyle = 'rgba(15,18,22,.85)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    const col = st === 'wait' ? '#7cc4ff' : st === 'out' ? '#ffaa3c' : '#ff5a4a';
    c.strokeStyle = col; c.lineWidth = Math.max(1.5, r * .16); c.stroke();
    if (st === 'wait' || st === 'norobot') drone(c, x, y + r * .05, r * 1.5, false);
    else if (st === 'noitem') { c.drawImage(itemIcon(item), x - r * .7, y - r * .7, r * 1.4, r * 1.4); }
    else { c.fillStyle = col; c.font = `bold ${Math.round(r * 1.3)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('⊘', x, y + 1); c.textBaseline = 'alphabetic'; }
    if (st === 'noitem' || st === 'norobot') { c.strokeStyle = '#ff5a4a'; c.lineWidth = Math.max(1.5, r * .2); c.beginPath(); c.moveTo(x - r * .65, y + r * .65); c.lineTo(x + r * .65, y - r * .65); c.stroke(); }
    if (st === 'wait') { c.strokeStyle = 'rgba(124,196,255,.8)'; c.lineWidth = Math.max(1, r * .12); c.beginPath(); c.arc(x, y, r * 1.25, (t % 60) / 60 * 6.28, (t % 60) / 60 * 6.28 + 1.6); c.stroke(); }
  }
  private droneCache = new Map<number, HTMLCanvasElement>();
  /** роботы из буфера x, y, груз, флаги (sim/robots.ts robotBuffer) */
  private drawRobots(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, t: number, mapMode: boolean) {
    const a = robotView(g, ITEM_IDX).buf; const n = a.length / ROBOT_STRIDE; if (!n) return;
    const sz = Math.max(6, Math.round(s * .7)); const q = Math.min(128, Math.round(sz / 4) * 4 || 4);
    const sprite = (lg: number) => { const key = q * 4 + ((t >> 3) & 1) * 2 + lg; let spr = this.droneCache.get(key);
      if (!spr) { spr = document.createElement('canvas'); spr.width = spr.height = q; drone(spr.getContext('2d')!, q / 2, q / 2, q * .95, true, (t >> 3) & 1, !!lg); this.droneCache.set(key, spr); } return spr; };
    const sprC = sprite(0), sprL = sprite(1);
    this.stat.robots = 0;
    for (let i = 0; i < n; i++) {
      const o = i * ROBOT_STRIDE; const x = a[o], y = a[o + 1]; if (x < x0 || x > x1 || y < y0 - 2 || y > y1 + 2) continue;
      this.stat.robots++;
      const f = a[o + 3]; const bob = Math.sin((t + i * 13) * .12) * s * .05; const X = sx(x), Y = sy(y) - s * .55 + bob;
      if (mapMode) { c.fillStyle = f & 1 ? '#7cff8c' : f & 8 ? '#8fc4ff' : '#ffc040'; c.fillRect(X - 1, Y - 1, 3, 3); continue; }
      c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(X + s * .25, sy(y) + s * .15, s * .22, s * .09, 0, 0, 7); c.fill();
      c.drawImage(f & 8 ? sprL : sprC, X - sz / 2, Y - sz / 2, sz, sz);
      const ci = a[o + 2]; if (ci >= 0 && s >= 12) { const it = ITEM_IDS[ci]; if (it) c.drawImage(itemIcon(it), X - s * .16, Y + sz * .22, s * .32, s * .32); }
      if (f & 4 && (t >> 4) % 2 === 0) { c.fillStyle = '#e8c22e'; c.font = `bold ${Math.round(s * .3)}px system-ui`; c.textAlign = 'center'; c.fillText('⚡', X, Y - sz * .45); }
    }
  }
  private markX(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(3, r * .5); c.lineCap = 'round'; c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke();
    c.strokeStyle = '#ff4a3a'; c.lineWidth = Math.max(2, r * .3); c.stroke(); c.lineCap = 'butt';
  }
  private markUp(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(x, y, r * 1.1, 0, 7); c.fill();
    c.fillStyle = '#4be36b'; c.beginPath(); c.moveTo(x, y - r * .8); c.lineTo(x + r * .7, y); c.lineTo(x + r * .25, y); c.lineTo(x + r * .25, y + r * .7); c.lineTo(x - r * .25, y + r * .7); c.lineTo(x - r * .25, y); c.lineTo(x - r * .7, y); c.closePath(); c.fill();
  }
  private hpBar(c: CanvasRenderingContext2D, x: number, y: number, w: number, f: number, enemy: boolean) {
    const h = Math.max(3, w * .08); c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    c.fillStyle = enemy ? '#d8443a' : f > .5 ? '#5fd35f' : f > .25 ? '#e8c22e' : '#e8503a'; c.fillRect(x - w / 2, y, w * Math.max(0, f), h);
  }
  /** юнит Роя: процедурный «жук» с анимированными лапами */
  private drawUnit(c: CanvasRenderingContext2D, u: Unit, x: number, y: number, s: number, t: number, phOverride?: number) {
    const d = UNITS[u.k]; const L = d.size * s * 1.45; const ph = phOverride ?? (t + u.id * 7) * (0.35 + d.speed);
    c.save(); c.translate(x, y);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(L * .08, L * .12, L * .45, L * .3, 0, 0, 7); c.fill();
    c.rotate(u.ang + Math.PI / 2);
    c.strokeStyle = shade(d.color, -.55); c.lineWidth = Math.max(1, L * .07); c.lineCap = 'round';
    for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + i * 2.1 + (sd > 0 ? Math.PI : 0)) * .25; const by = (-.15 + i * .2) * L;
      c.beginPath(); c.moveTo(sd * L * .12, by); c.lineTo(sd * L * .38, by - L * (.08 - sw * .5)); c.lineTo(sd * L * .5, by + L * (.12 + sw)); c.stroke();
    }
    const g1 = c.createRadialGradient(-L * .08, L * .1, L * .02, 0, L * .18, L * .32); g1.addColorStop(0, shade(d.color, .35)); g1.addColorStop(1, shade(d.color, -.4));
    c.fillStyle = g1; c.beginPath(); c.ellipse(0, L * .2, L * .22, L * .3, 0, 0, 7); c.fill();
    if (d.ranged) { c.fillStyle = 'rgba(190,255,90,.75)'; c.beginPath(); c.ellipse(0, L * .3, L * .14, L * .17, 0, 0, 7); c.fill(); }
    const g2 = c.createRadialGradient(-L * .05, -L * .2, L * .02, 0, -L * .15, L * .2); g2.addColorStop(0, shade(d.color, .25)); g2.addColorStop(1, shade(d.color, -.5));
    c.fillStyle = g2; c.beginPath(); c.ellipse(0, -L * .17, L * .16, L * .18, 0, 0, 7); c.fill();
    c.strokeStyle = shade(d.color, -.65); c.lineWidth = Math.max(1, L * .05); const m = Math.sin(phOverride ?? (t * .4 + u.id)) * .15;
    c.beginPath(); c.moveTo(-L * .07, -L * .3); c.quadraticCurveTo(-L * .14, -L * .45, -L * (.02 + m * .2), -L * .48); c.moveTo(L * .07, -L * .3); c.quadraticCurveTo(L * .14, -L * .45, L * (.02 + m * .2), -L * .48); c.stroke();
    c.fillStyle = '#ff5030'; c.beginPath(); c.arc(-L * .07, -L * .22, L * .03, 0, 7); c.arc(L * .07, -L * .22, L * .03, 0, 7); c.fill();
    c.restore();
  }
  private drawFx(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number) {
    for (const p of g.projectiles) {
      const x = sx(p.x), y = sy(p.y); const gr = c.createRadialGradient(x, y, 0, x, y, s * .3); gr.addColorStop(0, 'rgba(220,255,120,1)'); gr.addColorStop(1, 'rgba(120,200,40,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, s * .3, 0, 7); c.fill();
    }
    for (const f of g.fx) {
      const x = sx(f.x), y = sy(f.y);
      if (f.k === 'tracer') { c.strokeStyle = `rgba(255,230,140,${f.t / 4})`; c.lineWidth = Math.max(1, s * .05); c.beginPath(); c.moveTo(x, y); c.lineTo(sx(f.x2!), sy(f.y2!)); c.stroke(); c.fillStyle = 'rgba(255,240,180,.9)'; c.beginPath(); c.arc(sx(f.x2!), sy(f.y2!), s * .08, 0, 7); c.fill(); }
      else if (f.k === 'boom') {
        const k = 1 - f.t / 40, R = s * (f.s || 1) * (.4 + k * 1.1);
        const gr = c.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(255,240,180,${(1 - k) * .95})`); gr.addColorStop(.4, `rgba(255,140,40,${(1 - k) * .8})`); gr.addColorStop(1, 'rgba(60,40,30,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
        c.fillStyle = `rgba(50,45,40,${k * .5})`; for (let i = 0; i < 5; i++) { const a = i * 1.26 + f.x; c.beginPath(); c.arc(x + Math.cos(a) * R * .5, y + Math.sin(a) * R * .5 - k * s * .5, R * .35, 0, 7); c.fill(); }
      } else if (f.k === 'acid') { c.fillStyle = `rgba(150,220,60,${f.t / 40 * .55})`; c.beginPath(); c.ellipse(x, y, s * 1.1, s * .8, 0, 0, 7); c.fill(); }
      else if (f.k === 'hit') { c.fillStyle = `rgba(120,60,40,${f.t / 30 * .8})`; const R = s * (f.s || .6); for (let i = 0; i < 6; i++) { const a = i * 1.05 + f.y; c.beginPath(); c.arc(x + Math.cos(a) * R * .4 * (1.5 - f.t / 30), y + Math.sin(a) * R * .4 * (1.5 - f.t / 30), R * .18, 0, 7); c.fill(); } }
    }
  }
  /** v1.12: другие игроки (цвет, имя над головой) и метки на карте — верхний слой */
  private drawPeers(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number) {
    const mv = g.mpv; if (!mv) return; const me = mv.mp?.me ?? 0;
    for (const m of g.marks) {
      const age = g.tick - m.tick; if (age > 60 * 60 || m.x < x0 - 1 || m.x > x1 + 1 || m.y < y0 - 1 || m.y > y1 + 1) continue;
      const col = mv.peers[m.pl]?.color || '#ffcc33'; const x = sx(m.x), y = sy(m.y); const r = Math.max(6, s * .35);
      const ph = (g.tick % 60) / 60; c.strokeStyle = col; c.globalAlpha = 1 - ph; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r * (1 + ph * 1.5), 0, 7); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col; c.beginPath(); c.moveTo(x, y); c.lineTo(x - r * .5, y - r * 1.2); c.arc(x, y - r * 1.4, r * .55, Math.PI * .8, Math.PI * .2); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5; c.stroke();
    }
    if (mv.peers.length < 2) return;
    c.font = `bold ${Math.max(11, Math.round(s * .36))}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
    mv.peers.forEach((p, i) => {
      if (p.x < x0 - 2 || p.x > x1 + 2 || p.y < y0 - 2 || p.y > y1 + 2) return;
      const x = sx(p.x), y = sy(p.y);
      if (i !== me && !p.dead && p.veh == null) this.drawPlayer(g, x, y, s, c, p as any, p.color);
      if (i === me) return;
      const t = (p.name || '') + (p.dead ? ' ✝' : ''); const w = c.measureText(t).width + 8, hy = y - s * .8;
      c.fillStyle = 'rgba(15,18,22,.7)'; c.fillRect(x - w / 2, hy - s * .4 - 2, w, s * .4 + 4); c.fillStyle = p.color; c.fillText(t, x, hy + 1);
    });
  }
  private drawPlayer(g: Game, x: number, y: number, s: number, c: CanvasRenderingContext2D = this.ctx, pl: { walking: boolean; facing: number; shootCd: number; aim?: number | null } = g.player, color = g.mpv?.peers[g.mpv.mp?.me ?? 0]?.color || '#d2782e') { const bob = pl.walking ? Math.sin(g.tick * .4) * s * .03 : 0;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + s * .05, y + s * .25, s * .28, s * .13, 0, 0, 7); c.fill();
    c.fillStyle = color; c.beginPath(); c.roundRect(x - s * .22, y - s * .45 + bob, s * .44, s * .6, s * .15); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#e9e2d0'; c.beginPath(); c.arc(x, y - s * .55 + bob, s * .18, 0, 7); c.fill(); c.stroke();
    const fx = [0, .1, 0, -.1][pl.facing], fy = [-.05, 0, .05, 0][pl.facing];
    c.fillStyle = '#3aa0d8'; c.beginPath(); c.ellipse(x + fx * s, y - s * .55 + bob + fy * s, s * .11, s * .07, 0, 0, 7); c.fill();
    c.fillStyle = '#6b6f73'; c.fillRect(x - s * .3, y - s * .35 + bob, s * .1, s * .35);
    if (pl.shootCd > 0 && pl.aim != null) { c.save(); c.translate(x, y - s * .3); c.rotate(pl.aim); c.fillStyle = '#3a3d40'; c.fillRect(0, -s * .04, s * .42, s * .08); c.fillStyle = 'rgba(255,220,120,.9)'; c.beginPath(); c.arc(s * .48, 0, s * .08, 0, 7); c.fill(); c.restore(); }
  }
  // мини-карта
  /** Картинка мира для карточки сохранения (JPEG data URL). Вызывать сразу после draw() в том же кадре —
   *  буфер WebGL ещё не сброшен. Слои (земля, WebGL, верхний Canvas2D) сводятся в одну картинку: середина экрана (crop) под w×h. */
  thumbnail(w: number, h: number, crop = 0.6): string | null {
    try {
      const W = this.canvas.width, H = this.canvas.height; if (!W || !H) return null;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d')!;
      const k = Math.min(W / w, H / h) * crop, sw = w * k, sh = h * k, sx = (W - sw) / 2, sy = (H - sh) / 2;
      x.fillStyle = '#1b1d1f'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high';
      for (const c of [this.canvas, this.glCanvas, this.topCanvas]) if (c && c.width && c.isConnected) { const fx = c.width / W, fy = c.height / H; x.drawImage(c, sx * fx, sy * fy, sw * fx, sh * fy, 0, 0, w, h); }
      return cv.toDataURL('image/jpeg', 0.75);
    } catch { return null; }
  }
  /** v1.9: заметки на карте — флажок и заголовок (вблизи — ещё и первые строки текста) */
  private drawNotes(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number) {
    const dpr = this.pixelRatio(); c.save(); c.textBaseline = 'bottom';
    for (const n of g.notes) {
      if (n.x < x0 - 4 || n.x > x1 + 4 || n.y < y0 - 2 || n.y > y1 + 2) continue;
      const px = sx(n.x), py = sy(n.y), r = Math.max(4, Math.min(10, s * .3));
      c.fillStyle = '#ffd54a'; c.strokeStyle = '#000'; c.lineWidth = 1.5 * dpr;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - r * 3); c.stroke();
      c.beginPath(); c.moveTo(px, py - r * 3); c.lineTo(px + r * 2, py - r * 2.4); c.lineTo(px, py - r * 1.8); c.closePath(); c.fill(); c.stroke();
      c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; const t = n.title; const tw = c.measureText(t).width;
      c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(px + r * 2.4, py - r * 3 - 2, tw + 8, 16 * dpr); c.fillStyle = '#ffe9a0'; c.fillText(t, px + r * 2.4 + 4, py - r * 3 + 13 * dpr);
      if (s >= 24 && n.text) { c.font = `${Math.round(11 * dpr)}px system-ui,sans-serif`; const L = n.text.split('\n').slice(0, 6); const w = Math.max(...L.map(l => c.measureText(l).width)) + 10;
        c.fillStyle = 'rgba(10,12,14,.82)'; c.fillRect(px + r * 2.4, py - r * 3 + 16 * dpr, w, (L.length * 14 + 6) * dpr); c.fillStyle = '#dfe6ea'; L.forEach((l, i) => c.fillText(l, px + r * 2.4 + 5, py - r * 3 + (16 + 17 + i * 14) * dpr)); }
    }
    c.restore();
  }
  drawMap(g: Game, cv: HTMLCanvasElement, cx: number, cy: number, tilesPerPx: number, pollution = false) {
    const W = cv.width, H = cv.height; const x = cv.getContext('2d')!; const img = x.createImageData(W, H); const d = img.data;
    const col = TERRAIN_COL.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    const resCol = RES_ITEMS.map(r => r ? (() => { const n = parseInt(ITEMS[r].color.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; })() : [0, 0, 0]);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const wx = Math.floor(cx + (px - W / 2) * tilesPerPx), wy = Math.floor(cy + (py - H / 2) * tilesPerPx); const o = (py * W + px) * 4;
      if (!g.world.hasChunk(Math.floor(wx / CHUNK), Math.floor(wy / CHUNK))) { d[o] = 8; d[o + 1] = 10; d[o + 2] = 14; d[o + 3] = 255; continue; }
      const ch = g.world.getChunk(Math.floor(wx / CHUNK), Math.floor(wy / CHUNK)); const i = g.world.idx(wx, wy);
      let c = col[ch.terrain[i]];
      if (ch.occ[i] >= 0) { const e = g.ents.get(ch.occ[i]); if (e) { if (e.t === 'nest') c = [220, 40, 90]; else { const n = parseInt(PROTOS[e.proto].color.slice(1), 16); c = [n >> 16, (n >> 8) & 255, n & 255]; } } }
      else if (ch.amt[i] > 0 && ch.res[i]) c = resCol[ch.res[i]];
      else if (ch.decor[i] === D_TREE) c = [40, 72, 32];
      if (pollution && ch.pollution > 0.05) { const k = Math.min(0.6, Math.log10(1 + ch.pollution) * 0.2); c = [c[0] + (200 - c[0]) * k, c[1] * (1 - k), c[2] * (1 - k)]; }
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const mx = (wx: number) => W / 2 + (wx - cx) / tilesPerPx, my = (wy: number) => H / 2 + (wy - cy) / tilesPerPx;
    x.fillStyle = 'rgba(110,180,255,.8)'; for (const gh of g.ghosts.values()) { const gx = mx(gh.x), gy = my(gh.y); if (gx >= 0 && gy >= 0 && gx < W && gy < H) x.fillRect(gx, gy, Math.max(1, gh.w / tilesPerPx), Math.max(1, gh.h / tilesPerPx)); }
    // v1.7: рельсы — линии по клеткам, поезда — точки (локомотив красный)
    if (g.railCells.size) { x.fillStyle = '#9aa1a8'; const step = Math.max(1, Math.floor(tilesPerPx)); for (const k of g.railCells.keys()) { const tx = Math.floor(k / 131072) - 65536, ty = (k % 131072) - 65536; if ((tx | ty) % step) continue; const gx = mx(tx), gy = my(ty); if (gx >= 0 && gy >= 0 && gx < W && gy < H) x.fillRect(gx, gy, 1, 1); } }
    for (const t of g.trains) for (const id of t.cars) { const e = g.ents.get(id); if (!e || e._cx == null) continue; x.fillStyle = e.t === 'loco' ? '#ff6a3a' : '#e0e6ea'; x.fillRect(mx(e._cx) - 1.5, my(e._cy!) - 1.5, 3, 3); }
    // v1.8: имена станций на карте
    if (g.trains.length || g.railCells.size) { x.font = '11px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'bottom'; const seen = new Set<string>();
      for (const e of g.ents.values()) if (e.t === 'stop') { const px = mx(e.x + 1), py = my(e.y); if (px < 0 || py < 0 || px > W || py > H) continue; const nm = e.sname || tr('Станция'); const k = nm + Math.round(px / 40) + ',' + Math.round(py / 14); if (seen.has(k)) continue; seen.add(k);
        x.fillStyle = '#c9563a'; x.fillRect(px - 2, py - 2, 4, 4); x.fillStyle = 'rgba(0,0,0,.65)'; const tw = x.measureText(nm).width; x.fillRect(px - tw / 2 - 3, py - 16, tw + 6, 13); x.fillStyle = '#ffe9a0'; x.fillText(nm, px, py - 4); } }
    x.fillStyle = '#ff3a3a'; for (const u of g.units) { const ux = mx(u.x), uy = my(u.y); if (ux >= 0 && uy >= 0 && ux < W && uy < H) x.fillRect(ux - 1, uy - 1, 2, 2); }
    for (const a of g.alerts) if (g.tick - a.tick < 20 * 60 && (g.tick >> 4) % 2) { x.strokeStyle = '#ff3a3a'; x.lineWidth = 2; x.beginPath(); x.arc(mx(a.x), my(a.y), 7, 0, 7); x.stroke(); }
    for (const cp of g.corpses) { x.fillStyle = '#ffcc66'; x.fillRect(mx(cp.x) - 2, my(cp.y) - 2, 4, 4); }
    // v1.9: заметки — жёлтые флажки с заголовком
    if (g.notes.length) { x.font = '11px system-ui,sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; for (const n of g.notes) { const px = mx(n.x), py = my(n.y); if (px < -40 || py < -10 || px > W + 40 || py > H + 10) continue; x.fillStyle = '#ffd54a'; x.fillRect(px - 2, py - 2, 5, 5); if (W > 300) { x.fillStyle = 'rgba(0,0,0,.6)'; const tw = x.measureText(n.title).width; x.fillRect(px + 5, py - 7, tw + 6, 13); x.fillStyle = '#ffe9a0'; x.fillText(n.title, px + 8, py); } } }
    // v1.12: другие игроки — точки их цвета, метки — кольца
    const mv = g.mpv; if (mv) { const me = mv.mp?.me ?? 0;
      mv.peers.forEach((p, i) => { if (i === me || p.dead) return; x.fillStyle = p.color; x.fillRect(mx(p.x) - 2.5, my(p.y) - 2.5, 5, 5); x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(mx(p.x) - 2.5, my(p.y) - 2.5, 5, 5); });
      for (const m of g.marks) if (g.tick - m.tick < 3600) { x.strokeStyle = mv.peers[m.pl]?.color || '#fc3'; x.lineWidth = 2; x.beginPath(); x.arc(mx(m.x), my(m.y), 5, 0, 7); x.stroke(); } }
    x.fillStyle = '#fff'; x.fillRect(W / 2 + (g.player.x - cx) / tilesPerPx - 2, H / 2 + (g.player.y - cy) / tilesPerPx - 2, 4, 4);
  }
}

/** v1.8: значок состояния поезда: [знак, цвет] */
const TRAIN_ICON: Record<string, [string, string]> = { nopath: ['?', '#d8432f'], nofuel: ['!', '#e08a1e'], signal: ['■', '#c0392b'], full: ['∅', '#8e44ad'], blocked: ['■', '#7f8c8d'], nosched: ['…', '#7f8c8d'] };
/** v1.4: значок стопки — тёмный кружок с цифрой (атлас WebGL) */
function drawStackBadge(c: CanvasRenderingContext2D, n: number, z: number) {
  c.fillStyle = 'rgba(20,22,26,.85)'; c.beginPath(); c.arc(z / 2, z / 2, z * .48, 0, 6.283); c.fill();
  c.fillStyle = '#ffe9a0'; c.font = `bold ${Math.round(z * .8)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), z / 2, z * .54);
}
/** то же для Canvas2D: центр (x, y), s — размер клетки */
function stackBadge2d(c: CanvasRenderingContext2D, n: number, x: number, y: number, s: number): number {
  const r = s * .1; if (r < 2.5) return 0;
  c.fillStyle = 'rgba(20,22,26,.85)'; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
  c.fillStyle = '#ffe9a0'; c.font = `bold ${Math.round(r * 1.6)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), x, y + r * .08); return 1;
}
