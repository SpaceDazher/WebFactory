// Рендер на Canvas2D (прототип по 14.1: «Canvas2D и одна нить»). Слои по 14.7.
import { CHUNK, DX, DY, TICKS, ckey, type Dir } from '../core/types';
import { hash2 } from '../core/rng';
import { PROTOS, FLOORS, FLOOR_BY_ITEM, brushOrigin, TurDef } from '../data/entities';
import { ITEMS } from '../data/items';
import { validNoteIcon } from '../sim/notes';
import { dayInfo } from '../sim/daytime';
import { RECIPES } from '../data/recipes';
import { Game, Entity } from '../sim/game';
import { Chunk, D_ROCK, D_TREE, RES_ITEMS, T_DEEP, T_SHALLOW } from '../sim/world';
import { beltItemPos } from '../sim/belts';
import { fluidConns } from '../sim/networks';
import { drawFluidPorts } from './fluidports';
import { wallConnAtlasKey, wallConnMask } from './wall-connections';
import { heatTemp, heatPorts, isHeatType } from '../sim/heat';
import { drawEntityArt, itemIcon, shade, wireColor, colorblind, ArtState } from './art';
import { drawRail, drawCar, drawSignal, railPaths } from './rails';
import { graph as railGraph, isChain } from '../sim/trains';
import { shapeOf } from '../sim/railgeo';
import { PROTOS as _P } from '../data/entities';
import { tr } from '../core/i18n';
import { BIO_V117_SOURCES } from '../data/biomaterials';
import { Batch, CanvasBatch, GLBatch, rgba } from './batch';
import { drawItemIcon, drone } from './art';
import { robotView, ROBOT_STRIDE } from '../sim/robots';
import { wireEnds, WIRE_SAG, termPos, WIRE_REACH } from '../sim/circuits';
import { ITEM_IDX } from '../data/items';
import { ITEM_IDS } from '../data/items';
import { buildGeo, drawGeo, terrainCacheKey, ChunkGeo } from './terrain';
import { oreSprite, treeSprite, rockSprite, oilSprite } from './sprites';
import { texReady } from './textures';
import { UNITS, Unit, unitMax } from '../sim/enemies';
import { drawHero, HeroLook } from './heroart';
import { drawSwarmStructure, drawSwarmUnit } from './swarmart';
import { drawItemIcon2 as _di2, floorPattern } from './art2';
import { curGun } from '../sim/combat';
import { World, R_OIL } from '../sim/world';
import { drawCreepTile } from './creep-art';
import type { Blueprint } from '../sim/blueprint';
import { bpEntDims } from '../sim/blueprint';
import { bioProfile, bioCorpseRenderGroups } from '../sim/bio';
import { DRONE_MODELS, bioFoodSeconds } from '../sim/v117';
import type { BioRenderGroup } from '../sim/bio';

const TS = 16; // пикселей на клетку в кеше поверхности
const recipeArtItem = (rid: string | null | undefined) => rid ? RECIPES[rid]?.out[0]?.[0] || RECIPES[rid]?.in[0]?.[0] : undefined;
const TERRAIN_COL = ['#56703a', '#c4a86e', '#857b6c', '#3f7898', '#275475'];
/** v1.9: порог масштаба карты издалека (LOD) — тот же, что у прежнего «режима карты» */
export const LOD_ZOOM = 0.3;
const rgbCache = new Map<string, number[]>();
const lodRgb = (h: string) => { let c = rgbCache.get(h); if (!c) { const n = parseInt(h.slice(1), 16); c = [n >> 16, (n >> 8) & 255, n & 255]; rgbCache.set(h, c); } return c; };
const LOD_T = TERRAIN_COL.map(lodRgb), LOD_TREE = [40, 72, 32], LOD_NEST = [220, 40, 90], LOD_UNK = [140, 140, 140];
const BIO_ART_COLORS: Record<string, string> = { crawler: '#8d7654', spitter: '#8da34e', armored: '#60777a', destroyer: '#b74e3b', flyer: '#788bd0', brood: '#b45c94', giant: '#657f4e', queen: '#bf4d99', worm: '#a5a84f' };
function paintBioRemains(c: CanvasRenderingContext2D, x: number, y: number, s: number, kind: string, count: number, mapMode = false) {
  const family = bioProfile(kind)?.family || 'crawler', color = BIO_ART_COLORS[family] || '#8d7654';
  if (mapMode || s < 5) { c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(1.5, s * .18), 0, Math.PI * 2); c.fill(); return; }
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = 'rgba(8,10,9,.45)'; c.beginPath(); c.ellipse(.02, .16, .37, .17, -.08, 0, Math.PI * 2); c.fill();
  c.fillStyle = color; c.strokeStyle = '#242724'; c.lineWidth = .055; c.lineCap = 'round';
  if (family === 'flyer') {
    c.beginPath(); c.moveTo(-.05, -.05); c.lineTo(-.44, -.31); c.lineTo(-.29, .09); c.lineTo(.04, .12); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(.06, -.04); c.lineTo(.44, -.29); c.lineTo(.31, .1); c.lineTo(.01, .12); c.closePath(); c.fill(); c.stroke();
  } else {
    c.beginPath(); c.ellipse(0, 0, family === 'giant' || family === 'queen' ? .37 : .31, .21, -.08, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(.23, -.06, .13, .115, -.2, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  if (family === 'armored') { c.strokeStyle = 'rgba(25,32,37,.9)'; c.lineWidth = .045; for (const q of [-.17, -.02, .13]) { c.beginPath(); c.moveTo(q, -.17); c.lineTo(q + .03, .16); c.stroke(); } }
  if (family === 'queen' || family === 'brood') { c.fillStyle = family === 'queen' ? '#e194bd' : '#e29ac1'; for (const q of [-.2, 0, .2]) { c.beginPath(); c.arc(q, -.25, .075, 0, Math.PI * 2); c.fill(); } }
  if (family === 'worm') { c.strokeStyle = '#454c2a'; c.lineWidth = .055; for (const q of [-.16, -.02, .12]) { c.beginPath(); c.moveTo(q, -.13); c.lineTo(q + .02, .13); c.stroke(); } }
  if (family === 'destroyer') { c.fillStyle = '#e99b50'; c.beginPath(); c.arc(-.04, -.02, .085, 0, Math.PI * 2); c.fill(); }
  c.restore();
}
function bioBadge(c: CanvasRenderingContext2D, x: number, y: number, s: number, count: number) {
  if (count < 2 || s < 12) return;
  const label = `×${count}`; c.save(); c.font = `bold ${Math.max(9, Math.min(14, s * .48))}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(label).width + 6, h = Math.max(13, s * .48); c.fillStyle = 'rgba(12,16,13,.88)'; c.fillRect(x - w / 2, y - h / 2, w, h);
  c.fillStyle = '#f2e8c7'; c.fillText(label, x, y); c.restore();
}
import { STATUS_TEXT } from '../data/statusText'; export { STATUS_TEXT };
/** v1.6: короткая запись значения сигнала: 1234, 12.3k, −4.5M */
export function fmtSig(v: number) { const a = Math.abs(v), m = v < 0 ? '−' : ''; return a < 10000 ? m + a : a < 1e6 ? m + (a / 1000).toFixed(a < 1e5 ? 1 : 0) + 'k' : m + (a / 1e6).toFixed(a < 1e8 ? 1 : 0) + 'M'; }
/** v1.16: значки статуса — задержка показа и минимальный интервал смены, тиков; всегда видимые (критические) статусы */
const STAT_HOLD = 60;
const CRIT_STATUS = new Set(['no-power', 'emergency', 'overheat']);
export interface View {
  fluidSelection?: number;
  fluidFocus?: { entity: number; tank: number } | null;
  /** v1.16: слой радиусов турелей: 0 — выкл., 1 — наведённая турель, 2 — все видимые */ ranges?: 0 | 1 | 2;
  /** Сторона станции относительно направления движения при размещении. */
  stationLeft?: boolean;
  zoom: number; cursor: string | null; rot: number; alt: boolean; mouseX: number; mouseY: number; mouseIn: boolean;
  /** v1.16: bounded wall-grid drag preview */
  wallPlan?: { proto: string; positions: { x: number; y: number; ok: boolean | null; reason?: string }[]; overflow: boolean; ghost: boolean; label: string } | null;
  polePlan?: { anchor: import('../sim/polechain').PoleNode | null; next: { x: number; y: number; w: number; h: number; proto: string; dir: Dir; ok: boolean; ghost: boolean; shortened: boolean } | null; label: string } | null;
  hoverEnt: Entity | null; ghostOk: { ok: boolean; reason?: string } | null; ghostPos: [number, number] | null; debug: boolean;
  /** 1.17: active friendly actors under the pointer and the last world-selected combat drone. */
  hoverDroneId?: number | null; selectedDroneId?: number | null;
  /** v1.16: план 1–4 железнодорожных линий: узлы, доступность и прогноз призрачных сегментов */
  railPlan?: { pieces: { proto: string; x: number; y: number; dir: number; have?: boolean; valid?: boolean; ghost?: boolean }[]; lanes?: { sx: number; sy: number; ex: number; ey: number }[]; start: [number, number] | null; end: [number, number]; ok: boolean; label?: string; hint?: string } | null;
  carGhost?: { proto: string; x: number; y: number; dx: number; dy: number; ok: boolean; reason?: string } | null;
  pollution?: boolean; smoke?: boolean; noNight?: boolean;
  /** чертёж в руке и его позиция; инструмент выделения и текущая рамка */
  bp?: Blueprint | null; bpPos?: [number, number] | null;
  /** v1.5: первая постройка провода (провод в руке) */ wireFrom?: number | null; /** v1.6: клемма первой постройки; провод под курсором (индекс g.cw) */ wireFromT?: 0 | 1; hoverWire?: number;
  /** v1.2: показать зоны робопортов (выбран робопорт или призрак, открыто окно робопорта) */ zones?: boolean;
  /** v1.4: размер кисти покрытий (когда в руке бетон / кирпич) */ brush?: number;
  /** v1.16: подсветка прямоугольников на карте (до момента until, мс) */ hl?: { x: number; y: number; w: number; h: number; until: number }[] | null;
  tool?: 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel' | 'group' | null; sel?: { x0: number; y0: number; x1: number; y1: number; cancel?: boolean } | null;
}
const TOOL_COL: Record<string, [string, string]> = { copy: ['rgba(80,170,255,.15)', '#58b0ff'], cut: ['rgba(255,170,60,.15)', '#ffaa3c'], decon: ['rgba(240,60,60,.15)', '#f04848'], upgrade: ['rgba(80,220,110,.15)', '#4be36b'], cancel: ['rgba(120,190,255,.12)', '#9ac8ff'], group: ['rgba(255,220,80,.14)', '#ffd84a'] };
export class Renderer {
  ctx: CanvasRenderingContext2D; mainCtx: CanvasRenderingContext2D; dark: HTMLCanvasElement;
  /** режим среднего слоя: webgl — WebGL2-пакет, canvas — спрайты из атласа на Canvas2D, legacy — векторная отрисовка каждый кадр */
  mode: 'webgl' | 'canvas' | 'legacy' = 'legacy'; modeNote = ''; batch: Batch | null = null; glCanvas: HTMLCanvasElement | null = null; topCanvas: HTMLCanvasElement | null = null; topCtx: CanvasRenderingContext2D | null = null;
  private webglEvents: { canvas: HTMLCanvasElement; lost: (event: Event) => void; restored: () => void } | null = null;
  /** для замеров: 1 — не рисовать поверхность, 2 — не рисовать верхний слой */
  skip = 0;
  stat = { mid: 0, quads: 0, rast: 0, rastMs: 0, evict: 0, robots: 0, badges: 0, floors: 0, cwires: 0, conds: 0, rails: 0, cars: 0, blk: 0, sigs: 0, ticons: 0, lod: 0 };
  cache = new Map<number, { cv: HTMLCanvasElement; ver: number; terrainKey?: string; used: number }>();
  private bioBadges: BioRenderGroup[] = [];
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
    if (!g || g.ver !== c.version || g.terrainKey !== terrainCacheKey(w, c)) { g = buildGeo(w, c); this.geo.set(k, g); if (this.geo.size > 200) { let oldK = -1, oldU = Infinity; for (const [kk, v] of this.geo) if (v.used < oldU) { oldU = v.used; oldK = kk; } this.geo.delete(oldK); } }
    g.used = this.frame; return g;
  }
  /** v1.9: карта издалека (LOD) — при масштабе < LOD_ZOOM чанк рисуется одной картинкой 32×32 (1 пиксель = клетка: земля,
   *  руда, деревья, постройки цветом прототипа), пересобирается по версии чанка (постройка/снос меняют occ и версию).
   *  Постройки по одной не перебираются, предметы на лентах и быстрые поля Worker в этом режиме не присылает. */
  lod = true; lodCache = new Map<number, { cv: HTMLCanvasElement; ver: number; ov: number; av: number; cvv: number; ev: number; ids: number[]; esig: string; used: number; miss: boolean }>(); lodBuilt = 0;
  private lodWorld: World | null = null;
  private lodEntitySignature(g: Game, ids: number[]) {
    return ids.map(id => {
      const e = g.ents.get(id);
      return e ? `${id}:${e.proto}:${e.t}:${e.x}:${e.y}:${e.w}:${e.h}` : `${id}:?`;
    }).join(';');
  }
  private lodCanvas(g: Game, ch: Chunk): HTMLCanvasElement {
    if (this.lodWorld !== g.world) { this.lodWorld = g.world; this.lodCache.clear(); }
    const k = ckey(ch.cx, ch.cy); let e = this.lodCache.get(k);
    const ov = ch.ov || 0, av = ch.av || 0, cvv = ch.cv || 0, ev = (g.ents as any).ver || 0;
    let entitiesChanged = false;
    if (e && e.ev !== ev) {
      const esig = this.lodEntitySignature(g, e.ids);
      entitiesChanged = esig !== e.esig;
      if (!entitiesChanged) e.ev = ev;
    }
    if (e && e.ver === ch.version && e.ov === ov && e.av === av && e.cvv === cvv && !entitiesChanged && !(e.miss && (this.frame + k) % 30 === 0)) { e.used = this.frame; return e.cv; }
    const cv = e?.cv || document.createElement('canvas'); cv.width = cv.height = CHUNK;
    const x = cv.getContext('2d')!; const img = x.createImageData(CHUNK, CHUNK); const d = img.data; let miss = false; const entityIds = new Set<number>();
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      let c = LOD_T[ch.terrain[i]] || LOD_T[0]; const id = ch.occ[i];
      if (id >= 0) { entityIds.add(id); const en = g.ents.get(id); if (en) c = en.t === 'nest' ? LOD_NEST : lodRgb(PROTOS[en.proto]?.color || '#888888'); else { miss = true; c = LOD_UNK; } }
      else if (ch.amt[i] > 0 && ch.res[i]) c = lodRgb(ITEMS[RES_ITEMS[ch.res[i]]]?.color || '#000000');
      else if (ch.decor[i] === D_TREE) c = LOD_TREE;
      const o = i * 4, strength = id < 0 ? ch.creep?.[i] || 0 : 0;
      if (strength) {
        const blend = .42 + .28 * (strength / 255);
        d[o] = c[0] * (1 - blend) + 112 * blend | 0;
        d[o + 1] = c[1] * (1 - blend) + 58 * blend | 0;
        d[o + 2] = c[2] * (1 - blend) + 105 * blend | 0;
      } else { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; }
      d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0); this.lodBuilt++;
    const ids = [...entityIds];
    this.lodCache.set(k, { cv, ver: ch.version, ov, av, cvv, ev, ids, esig: this.lodEntitySignature(g, ids), used: this.frame, miss });
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
  private clearWebGLSurfaces() {
    const glCanvas = this.glCanvas;
    const events = this.webglEvents;
    if (events) {
      events.canvas.removeEventListener('webglcontextlost', events.lost);
      events.canvas.removeEventListener('webglcontextrestored', events.restored);
      this.webglEvents = null;
    }
    if (glCanvas) {
      try {
        const gl = glCanvas.getContext('webgl2');
        if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* снятие поверхности не должно блокировать переход режима */ }
      glCanvas.remove(); this.glCanvas = null;
    }
    if (this.topCanvas) { this.topCanvas.remove(); this.topCanvas = null; this.topCtx = null; }
  }
  private watchWebGL(glCanvas: HTMLCanvasElement, topCanvas: HTMLCanvasElement) {
    const lost = (event: Event) => {
      if (this.glCanvas !== glCanvas || this.webglEvents?.canvas !== glCanvas) return;
      event.preventDefault(); // разрешить браузеру восстановить этот же context
      this.mode = 'canvas'; this.modeNote = 'lost'; this.batch = new CanvasBatch(this.mainCtx); this.ctx = this.mainCtx;
      glCanvas.style.display = 'none'; topCanvas.style.display = 'none';
      if (this.topCtx) this.topCtx.clearRect(0, 0, topCanvas.width, topCanvas.height);
    };
    const restored = () => {
      if (this.glCanvas !== glCanvas || this.webglEvents?.canvas !== glCanvas || this.modeNote !== 'lost') return;
      try {
        const gl = glCanvas.getContext('webgl2');
        if (!gl || gl.isContextLost()) throw new Error('restored WebGL2 context is unavailable');
        // All GL objects, the array texture, the VAO and the atlas slots were invalidated by loss.
        // A new batch rebuilds them as a single operation; game and Worker state stay untouched.
        this.batch = new GLBatch(gl); this.mode = 'webgl'; this.modeNote = '';
        glCanvas.style.display = 'block'; topCanvas.style.display = 'block';
      } catch (error) {
        console.warn('WebGL восстановить не удалось; используется Canvas2D', error);
        this.mode = 'canvas'; this.modeNote = 'restore-failed'; this.batch = new CanvasBatch(this.mainCtx); this.ctx = this.mainCtx;
        this.clearWebGLSurfaces();
      }
    };
    glCanvas.addEventListener('webglcontextlost', lost);
    glCanvas.addEventListener('webglcontextrestored', restored);
    this.webglEvents = { canvas: glCanvas, lost, restored };
  }
  /** выбрать рендер среднего слоя; WebGL2 недоступен — откат на Canvas2D-атлас */
  setMode(m: 'auto' | 'webgl' | 'canvas' | 'legacy'): string {
    this.modeNote = ''; const auto = m === 'auto'; if (auto) m = 'webgl';
    this.clearWebGLSurfaces();
    this.batch = null; this.mode = m as any;
    if (m === 'webgl') {
      const mk = () => { const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none'; this.canvas.after(cv); return cv; };
      const top = mk(), gl = mk(); // порядок в DOM: game, gl, top
      top.remove(); gl.after(top);
      let b: GLBatch | null = null; try { b = GLBatch.create(gl); } catch (e) { console.warn('WebGL2 недоступен', e); b = null; }
      if (b && auto && GLBatch.isSoftware(b.gl)) { this.modeNote = 'soft'; b.gl.getExtension('WEBGL_lose_context')?.loseContext(); b = null; }
      if (b) { this.batch = b; this.glCanvas = gl; this.topCanvas = top; this.topCtx = top.getContext('2d')!; this.watchWebGL(gl, top); }
      else { if (!this.modeNote) this.modeNote = 'nogl'; gl.remove(); top.remove(); this.mode = m = 'canvas'; }
    }
    if (m === 'canvas') this.batch = new CanvasBatch(this.mainCtx);
    return this.mode;
  }
  private stSt = new Map<number, { sh: string | null; c: string | null; cs: number; ss: number }>();
  /** стабилизация значка статуса: кандидат должен продержаться STAT_HOLD тиков, а показанное значение — не меняться чаще STAT_HOLD тиков */
  private stableStatus(g: Game, id: number, cand: string | null): string | null {
    let o = this.stSt.get(id); if (!o) { o = { sh: cand, c: cand, cs: g.tick, ss: g.tick }; this.stSt.set(id, o); return cand; }
    if (o.c !== cand) { o.c = cand; o.cs = g.tick; }
    if (o.sh !== o.c && g.tick - o.cs >= STAT_HOLD && g.tick - o.ss >= STAT_HOLD) { o.sh = o.c; o.ss = g.tick; }
    if (this.frame % 900 === 0 && this.stSt.size > 2000) for (const k of this.stSt.keys()) if (!g.ents.has(k)) this.stSt.delete(k);
    return o.sh;
  }
  /** v1.16: Alt-режим тепла. Цвет — температура (синий → красный), штриховка от 500 °C и ▲ от 900 °C различимы без цвета;
   *  кольца портов: зелёное — связь есть, красное — сосед есть, но порт не совпал, серое — свободный порт. */
  private drawHeatAlt(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, v: View) {
    const col = (T: number) => { const k = Math.max(0, Math.min(1, (T - 15) / 1185)); return `hsla(${Math.round(220 - 220 * k)},90%,55%,.42)`; };
    const portRing = (p: { x: number; y: number; d: number }, ghost: boolean) => {
      const nx = p.x + DX[p.d], ny = p.y + DY[p.d], n = g.entAt(nx, ny); let st = 0; // 0 свободно, 1 связь, 2 не совпало
      if (n && isHeatType(n.t)) st = heatPorts(n).some(q => q.x === nx && q.y === ny && q.d === (p.d + 2) % 4) ? 1 : 2;
      const px = sx(p.x + .5 + DX[p.d] * .5), py = sy(p.y + .5 + DY[p.d] * .5), r = Math.max(2.5, s * .13);
      c.lineWidth = Math.max(1.5, s * .06); c.strokeStyle = st === 1 ? '#3fe06a' : st === 2 ? '#ff4a3a' : ghost ? '#cfd6dd' : 'rgba(180,190,200,.7)'; c.fillStyle = st === 1 ? 'rgba(63,224,106,.5)' : 'rgba(0,0,0,.35)';
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill(); c.stroke();
      if (st === 2) { c.beginPath(); c.moveTo(px - r, py - r); c.lineTo(px + r, py + r); c.moveTo(px + r, py - r); c.lineTo(px - r, py + r); c.stroke(); }
    };
    c.save(); let n = 0;
    for (const e of g.ents.values()) {
      if (!isHeatType(e.t) || e.x + e.w < x0 || e.x > x1 || e.y + e.h < y0 || e.y > y1) continue; if (++n > 400) break;
      const T = heatTemp(e); c.fillStyle = col(T); c.fillRect(sx(e.x), sy(e.y), e.w * s, e.h * s);
      if (T >= 500) { c.save(); c.beginPath(); c.rect(sx(e.x), sy(e.y), e.w * s, e.h * s); c.clip(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; const st = Math.max(5, s * .3); for (let k = -e.h * s; k < e.w * s + e.h * s; k += st) { c.beginPath(); c.moveTo(sx(e.x) + k, sy(e.y) + e.h * s); c.lineTo(sx(e.x) + k + e.h * s, sy(e.y)); c.stroke(); } c.restore(); }
      for (const p of heatPorts(e)) portRing(p, false);
      if (s >= 14 || e.w * s >= 40) { c.font = `bold ${Math.max(9, Math.min(15, s * .42))}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; const lab = `${T >= 900 ? '▲' : ''}${Math.round(T)}°`; const cx = sx(e.x + e.w / 2), cy = sy(e.y + e.h / 2); c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(lab, cx, cy); c.fillStyle = T >= 900 ? '#ffd24a' : '#fff'; c.fillText(lab, cx, cy); }
    }
    // призрак: порты и разрывы до постановки
    if (v.cursor && PROTOS[v.cursor] && isHeatType(PROTOS[v.cursor].type) && v.ghostPos) for (const p of heatPorts({ proto: v.cursor, t: PROTOS[v.cursor].type, x: v.ghostPos[0], y: v.ghostPos[1], dir: v.rot as any })) portRing(p, true);
    c.restore();
  }
  /** v1.16: диагностика рендера для F3 — какой режим выбран и почему (наличие видеокарты режим не доказывает) */
  gameGL(): WebGL2RenderingContext | null { return this.batch?.kind === 'webgl' ? (this.batch as GLBatch).gl : null; }
  gpuNote(): string {
    const gl = this.gameGL(); let name = '', known = false, software = false;
    if (gl) { try { if (!gl.isContextLost()) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); const raw = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); known = !!ext && !!raw && raw !== 'null' && raw !== 'undefined' && !/^(webgl|generic|unknown|default|mozilla|webkit)(\s|$)/i.test(raw.trim()); if (known) name = raw; software = GLBatch.isSoftware(gl); } } catch { /* контекст потерян или имя недоступно */ } }
    const why = this.modeNote === 'soft' ? 'WebGL есть, но программный (SwiftShader/llvmpipe) — выбран Canvas' : this.modeNote === 'nogl' ? 'WebGL2 недоступен — выбран Canvas' : this.modeNote === 'lost' ? 'контекст WebGL потерян; Canvas2D работает до восстановления' : this.modeNote === 'restore-failed' ? 'WebGL восстановить не удалось; используется Canvas2D' : '';
    return gl ? software ? ` (${known ? name.slice(0, 60) + ', ' : ''}программный)` : known ? ` (${name.slice(0, 60)}, аппаратный)` : ' (GPU не определён)' : this.mode === 'canvas' ? ` (Canvas2D; WebGL не активен${why ? `; ${why}` : ''})` : why ? ` (${why})` : '';
  }
  screenToWorld(px: number, py: number): [number, number] { return [(px - this.W / 2) / this.s + this.camX, (py - this.H / 2) / this.s + this.camY]; }
  /** кеш чанка для мелкого масштаба (16 px/клетку): та же поверхность, что и вблизи, плюс запечённые руда и декор */
  private chunkCanvas(w: World, c: Chunk): HTMLCanvasElement {
    const k = ckey(c.cx, c.cy); let e = this.cache.get(k);
    const terrainKey = terrainCacheKey(w, c);
    if (e && e.ver === c.version && e.terrainKey === terrainKey) { e.used = this.frame; return e.cv; }
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
    this.cache.set(k, { cv, ver: c.version, terrainKey, used: this.frame });
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
    this.bioBadges = [];
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
    // v1.14: слизь Роя — по чанкам, картинка 32×32 кешируется по версии слизи и сглаживается при растяжении
    if (!lod && g.creepSet.size) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      const ch = g.world.chunks.get(ckey(cx, cy)); if (!this.hasCreep(ch)) continue;
      const cv = this.creepCanvas(g.world, ch); const was = c.imageSmoothingEnabled, alpha = c.globalAlpha; c.imageSmoothingEnabled = true;
      c.globalAlpha = 1; c.drawImage(cv, sx(cx * CHUNK), sy(cy * CHUNK), CHUNK * s, CHUNK * s); c.globalAlpha = alpha; c.imageSmoothingEnabled = was;
    }
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
    // v1.16: заражение после аварии реактора — граница, затухающая заливка и время до исчезновения (всегда видно, независимо от слоя загрязнения)
    if (g.nuc.zones.length) for (const z of g.nuc.zones) {
      if (z.x + z.r < x0 || z.x - z.r > x1 || z.y + z.r < y0 || z.y - z.r > y1) continue;
      const left = z.dur - (g.tick - z.t); if (left <= 0) continue; const k = left / z.dur, px = sx(z.x), py = sy(z.y), R = z.r * s;
      const gr = c.createRadialGradient(px, py, 0, px, py, R); gr.addColorStop(0, `rgba(190,230,40,${0.38 * k + 0.06})`); gr.addColorStop(1, 'rgba(190,230,40,0.02)');
      c.fillStyle = gr; c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.fill();
      c.save(); c.setLineDash([s * 0.6, s * 0.4]); c.lineDashOffset = -(g.tick * 0.05) * s; c.strokeStyle = `rgba(230,240,60,${0.5 + 0.3 * Math.sin(g.tick / 20)})`; c.lineWidth = Math.max(1.5, s * 0.12); c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.stroke(); c.restore();
      if (s >= 6) { const sec = Math.ceil(left / 60); c.fillStyle = '#f2f6a0'; c.font = `bold ${Math.max(10, Math.min(20, s * 0.9))}px sans-serif`; c.textAlign = 'center'; c.fillText(`☢ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, px, py - R - 4); c.textAlign = 'left'; }
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
    type Obj = { y: number; k: 0 | 1 | 2 | 3; e?: Entity; tx?: number; ty?: number; u?: Unit; bio?: BioRenderGroup };
    const objs: Obj[] = [];
    for (const e of tall) objs.push({ y: e.y + e.h, k: 0, e });
    for (const [tx, ty] of trees) objs.push({ y: ty + .8, k: 1, tx, ty });
    if (!mapMode) for (const u of g.units) if (u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) objs.push({ y: u.y + .2, k: 2, u });
    for (const bio of bioCorpseRenderGroups(g, x0 - 1, y0 - 1, x1 + 1, y1 + 1)) if (g.world.hasChunk(Math.floor(bio.x / CHUNK), Math.floor(bio.y / CHUNK))) objs.push({ y: bio.y + .15, k: 3, bio });
    objs.sort((a, b) => a.y - b.y);
    let playerDrawn = false;
    const drawPlayer = () => { playerDrawn = true; if (!g.player.dead && g.player.veh == null) this.drawPlayer(g, sx(px), sy(py), s); };
    for (const o of objs) {
      if (!playerDrawn && o.y > py + 0.3) drawPlayer();
      if (o.k === 1) { this.drawTree(c, o.tx!, o.ty!, sx(o.tx!), sy(o.ty!), s, false); continue; }
      if (o.k === 2) { this.drawUnit(c, o.u!, sx(o.u!.x), sy(o.u!.y), s, t, undefined, Math.min(3, g.mut)); continue; }
      if (o.k === 3) { const b = o.bio!; paintBioRemains(c, sx(b.x), sy(b.y), s, b.kind, b.count, mapMode); bioBadge(c, sx(b.x), sy(b.y) - s * .25, s, b.count); continue; }
      const e = o.e!;
      if (mapMode) { c.fillStyle = PROTOS[e.proto].color; c.fillRect(sx(e.x), sy(e.y), e.w * s, e.h * s); continue; }
      const st: any = { t, seed: e.id, working: e.status === 'working' || e.status === 'low-power', recipeColor: ITEMS[recipeArtItem(e.recipe) || '']?.color };
      if (e.t === 'turret' || (e.t === 'nest' && PROTOS[e.proto].enemy?.worm)) { st.aim = e.aim; st.flash = (e.fireCd || 0) >= 4; }
      if (e.t === 'gate') st.open = !!e.open;
      if (e.t === 'lamp') { st.lit = e.active; st.lampColor = e.ccol; }
      if (e.modules) st.mods = e.modules;
      if (e.t === 'beacon') st.working = !!e._on;
      if (e.t === 'accumulator') st.fill = (e.charge || 0) / (PROTOS[e.proto].accum!.MJ * 1e6);
      if (e.t === 'silo') { st.parts = e.parts || 0; st.launch = e.launchT ? 1 - e.launchT / 900 : 0; st.working = e.status === 'working' || e.status === 'launching'; }
      if (e.t === 'radar') st.working = e.status === 'working';
      if (e.t === 'tpump') (st as any).drain = e.pm === 1;
      if (e.t === 'reactor' || e.t === 'hexch' || e.t === 'hpipe') this.nucArt(g, e, st);
      if (e.t === 'tank' && e._fn) { const n = g.fluidNets[e._fn[0]]; if (n) { st.fill = n.cap ? Math.min(1, n.amount / n.cap) : 0; st.fluidColor = n.fluid ? ITEMS[n.fluid]?.color : undefined; } }
      if (e.t === 'car' && e.vehicleState) { st.angle = e.vehicleState.angle; st.mounts = e.vehicleState.mounts.filter(Boolean).map(m => ({ proto: m!.proto, aim: m!.aim, fireCd: m!.fireCd })); drawEntityArt(c, e.proto, sx(e.vehicleState.x - PROTOS.car.w / 2), sy(e.vehicleState.y - PROTOS.car.h / 2), s, 0, st); }
      else { if (e.t === 'wall') st.conn = wallConnMask(g, e.proto, e.x, e.y); drawEntityArt(c, e.proto, sx(e.x), sy(e.y), s, e.dir, st); }
      if (e.t === 'inserter') this.drawArm(g, e, sx, sy, s);
    }
    if (!playerDrawn) drawPlayer();
    }
    if (this.skip & 2) { this.ctx = this.mainCtx; return; }
    // верхний слой: при WebGL — отдельный прозрачный холст поверх
    if (batch && batch.kind === 'webgl') { c = this.topCtx!; this.ctx = c; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); for (const bio of this.bioBadges) bioBadge(c, sx(bio.x), sy(bio.y) - s * .25, s, bio.count); }
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
    // v1.16: слой радиусов турелей и радиус ставимой турели (не часть симуляции).
    this.drawTurretRanges(g, c, v, sx, sy, s, x0, y0, x1, y1, mapMode);
    this.drawBioRange(g, c, v, sx, sy, s, mapMode);
    // призраки (чертежи) и метки сноса/улучшения
    if (!mapMode) {
      for (const gh of g.ghosts.values()) {
        if (gh.x + gh.w < x0 || gh.x > x1 || gh.y + gh.h < y0 || gh.y > y1) continue;
        if (_P[gh.proto]?.type === 'rail') { const sh = shapeOf(gh.proto, gh.dir); drawRail(c, gh.proto, gh.dir, sx(gh.x + sh.ox), sy(gh.y + sh.oy), s, { ghost: true }); continue; }
        c.globalAlpha = .42; drawEntityArt(c, gh.proto, sx(gh.x), sy(gh.y), s, gh.dir, { t: 0, ug: 'in', ghost: true, conn: wallConnMask(g, gh.proto, gh.x, gh.y, undefined, true) }); c.globalAlpha = 1;
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
    this.drawV117Actors(g, c, v, sx, sy, s, x0, y0, x1, y1, t, mapMode, dpr);
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
        const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr); const far = Math.hypot(wx - (A.x + A.w / 2), wy - (A.y + A.h / 2)) > WIRE_REACH + .5;
        c.strokeStyle = far ? 'rgba(255,255,255,.5)' : v.cursor === 'green-wire' ? '#3fd04f' : '#e8433a'; c.lineWidth = Math.max(1.5, s * .05); c.setLineDash([s * .2, s * .12]);
        const [tpx, tpy] = termPos(A, v.wireFromT || 0); c.beginPath(); c.moveTo(sx(tpx), sy(tpy - .15)); c.lineTo(v.mouseX * dpr, v.mouseY * dpr); c.stroke(); c.setLineDash([]);
        c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.beginPath(); c.arc(sx(A.x + A.w / 2), sy(A.y + A.h / 2), WIRE_REACH * s, 0, 7); c.stroke();
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
        if ((e.t === 'assembler' || e.t === 'furnace') && e.recipe) { const ri = recipeArtItem(e.recipe); if (ri) { c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(ex, ey, s * .42, 0, 7); c.fill(); c.drawImage(itemIcon(ri), ex - s * .35, ey - s * .35, s * .7, s * .7); } }
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
      // v1.16: обычные значки — только в Alt-режиме (критические видны всегда); новый статус держится ≈1 с до показа, показанный не меняется чаще раза в секунду
      const want = bad ? e.status! : e.lst ? (e.lst === 'noitem' ? 'no-input' : 'no-robots') : null;
      const shown = this.stableStatus(g, e.id, want && (v.alt || CRIT_STATUS.has(want)) ? want : null);
      if (shown) this.statusIcon(shown, ex, ey - (v.alt ? s * .5 : 0), s);
    }
    // полосы прочности
    if (!mapMode) {
      for (const e of tall) { const max = PROTOS[e.proto].hp; if (e.hp != null && e.hp < max) this.hpBar(c, sx(e.x + e.w / 2), sy(e.y) - s * .1, e.w * s * .8, e.hp / max, e.t === 'nest'); }
      for (const u of g.units) { const max = unitMax(u); if (u.hp < max && u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) this.hpBar(c, sx(u.x), sy(u.y) - UNITS[u.k].size * s * .7, UNITS[u.k].size * s, u.hp / max, true); }
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
    // v1.16: Alt-режим тепла — соединения, градиент температуры, числа; порты призрака до постановки
    if (!mapMode && (v.alt || (v.cursor && PROTOS[v.cursor] && isHeatType(PROTOS[v.cursor].type)))) this.drawHeatAlt(g, c, sx, sy, s, x0, y0, x1, y1, v);
    // v1.16: радиус ядерного взрыва вокруг курсора (предупреждение перед выстрелом)
    if (v.mouseIn && !v.cursor && !mapMode) {
      const kk = g.player.kit; const gi = kk ? (kk.guns[kk.sel] ? kk.sel : kk.guns.findIndex(Boolean)) : -1;
      const ai = gi >= 0 && kk ? ((kk.rnd[gi] > 0 ? kk.rt[gi] : null) || kk.ammo[gi]?.item || null) : null;
      const nk = ai ? ITEMS[ai]?.am : null;
      if (nk?.nuke && nk.aoe) {
        const [wx, wy] = this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr);
        c.save(); c.lineWidth = 2; c.strokeStyle = 'rgba(160,255,80,.85)'; c.fillStyle = 'rgba(160,255,80,.08)'; c.setLineDash([8, 6]);
        c.beginPath(); c.arc(sx(wx), sy(wy), nk.aoe * s, 0, Math.PI * 2); c.fill(); c.stroke();
        c.strokeStyle = 'rgba(255,200,60,.85)'; c.beginPath(); c.arc(sx(wx), sy(wy), nk.nuke.tr * s, 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
    // v1.7: план пути (рельсы в руке) и вагон на рельсах
    if (v.railPlan && v.mouseIn) {
      const rp = v.railPlan;
      for (const pc of rp.pieces) {
        const sh = shapeOf(pc.proto, pc.dir); c.globalAlpha = pc.have ? .35 : pc.ghost ? .52 : .9;
        drawRail(c, pc.proto, pc.dir, sx(pc.x + sh.ox), sy(pc.y + sh.oy), s, { ghost: true, map: mapMode }); c.globalAlpha = 1;
        if (pc.valid === false) { c.save(); c.translate(sx(pc.x + sh.ox), sy(pc.y + sh.oy)); c.scale(s, s); c.strokeStyle = '#f04848'; c.lineWidth = Math.max(.12, 2 / s); c.stroke(railPaths(pc.proto, pc.dir).axis); c.restore(); }
      }
      const lanes = rp.lanes?.length ? rp.lanes : rp.start ? [{ sx: rp.start[0], sy: rp.start[1], ex: rp.end[0], ey: rp.end[1] }] : [];
      for (const lane of lanes) {
        c.strokeStyle = rp.ok ? '#4be36b' : '#f04848'; c.lineWidth = 2; c.beginPath(); c.arc(sx(lane.ex), sy(lane.ey), Math.max(4, s * .5), 0, 7); c.stroke();
        c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(sx(lane.sx), sy(lane.sy), Math.max(3, s * .3), 0, 7); c.fill();
      }
      const [ex, ey] = rp.end; const label = rp.label;
      if (label) { c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle'; const tw = c.measureText(label).width, hint = rp.hint || '', hw = hint ? c.measureText(hint).width : 0; const x = sx(ex) + 12, y = sy(ey) - (hint ? 20 : 10); c.fillStyle = 'rgba(0,0,0,.76)'; c.fillRect(x, y - 10, Math.max(tw, hw) + 10, hint ? 40 : 20); c.fillStyle = rp.ok ? '#e8f0d8' : '#ff9a8a'; c.fillText(label, x + 5, y); if (hint) { c.font = `${Math.round(10 * dpr)}px system-ui,sans-serif`; c.fillStyle = '#cad2d9'; c.fillText(hint, x + 5, y + 15); } }
    } else if (v.polePlan && v.mouseIn && !mapMode) {
      const plan = v.polePlan, a = plan.anchor, q = plan.next;
      const zone = (node: { proto: string; x: number; y: number; w: number; h: number }, color: string) => {
        const r = PROTOS[node.proto]?.supply || 0; c.fillStyle = color;
        c.fillRect(sx(node.x - r), sy(node.y - r), (node.w + 2 * r) * s, (node.h + 2 * r) * s);
      };
      if (a) { zone(a, 'rgba(80,200,255,.12)'); c.strokeStyle = '#78cde6'; c.lineWidth = 2 * dpr; c.strokeRect(sx(a.x), sy(a.y), a.w * s, a.h * s); }
      if (q) {
        zone(q, 'rgba(80,200,255,.09)');
        c.globalAlpha = .6; drawEntityArt(c, q.proto, sx(q.x), sy(q.y), s, q.dir, { t: 0 }); c.globalAlpha = 1;
        c.strokeStyle = !q.ok ? '#f04848' : q.shortened ? '#e6c348' : q.ghost ? '#bca7ff' : '#4be36b'; c.lineWidth = 2 * dpr;
        c.strokeRect(sx(q.x), sy(q.y), q.w * s, q.h * s);
        if (a) { c.save(); c.setLineDash([5 * dpr, 4 * dpr]); c.strokeStyle = q.ghost ? '#bca7ff' : '#ffd094'; c.beginPath(); c.moveTo(sx(a.x + a.w / 2), sy(a.y + a.h / 2)); c.lineTo(sx(q.x + q.w / 2), sy(q.y + q.h / 2)); c.stroke(); c.restore(); }
      }
      c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
      const tw = c.measureText(plan.label).width, x = Math.max(4 * dpr, Math.min(c.canvas.width - tw - 16 * dpr, v.mouseX * dpr + 14 * dpr)), y = Math.max(16 * dpr, v.mouseY * dpr - 12 * dpr);
      c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(x, y - 10 * dpr, tw + 12 * dpr, 20 * dpr); c.fillStyle = q && !q.ok ? '#ff9a8a' : '#e8f0d8'; c.fillText(plan.label, x + 6 * dpr, y);
    } else if (v.wallPlan && v.mouseIn && !mapMode) {
      const wp = v.wallPlan;
      const plannedWalls = new Set(wp.positions.map(q => `${q.x}:${q.y}`));
      if (!wp.overflow) for (const q of wp.positions) {
        const col = q.ok === null ? '#e6c348' : q.ok ? '#4be36b' : '#f04848';
        c.globalAlpha = .55; drawEntityArt(c, wp.proto, sx(q.x), sy(q.y), s, 0, { t: 0, ug: 'in', conn: wallConnMask(g, wp.proto, q.x, q.y, plannedWalls, true) }); c.globalAlpha = 1;
        c.fillStyle = q.ok === null ? 'rgba(230,195,72,.14)' : q.ok ? 'rgba(60,220,90,.24)' : 'rgba(240,60,60,.3)'; c.fillRect(sx(q.x), sy(q.y), s, s);
        c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(sx(q.x), sy(q.y), s, s);
      }
      const label = wp.label; c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
      const tw = c.measureText(label).width, x = Math.max(4 * dpr, Math.min(c.canvas.width - tw - 16 * dpr, v.mouseX * dpr + 14 * dpr)), y = Math.max(16 * dpr, v.mouseY * dpr - 12 * dpr);
      c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(x, y - 10 * dpr, tw + 12 * dpr, 20 * dpr); c.fillStyle = wp.overflow ? '#ff9a8a' : '#e8f0d8'; c.fillText(label, x + 6 * dpr, y);
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
        c.globalAlpha = .6; drawEntityArt(c, pid, sx(gx), sy(gy), s, v.rot, { t: 0, ug: 'in', conn: wallConnMask(g, pid, gx, gy, undefined, true) }); c.globalAlpha = 1;
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
      const plannedBlueprintWalls = new Set(v.bp.entities.filter(be => PROTOS[be.p]?.type === 'wall').map(be => `${bx + be.x}:${by + be.y}`));
      for (const be of v.bp.entities) {
        const [w, h] = bpEntDims(be); const x = bx + be.x, y = by + be.y;
        if (x + w < x0 || x > x1 || y + h < y0 || y > y1) continue;
        const ok = g.canPlace(be.p, x, y, be.d, false).ok || !!g.replaceTarget(be.p, x, y, be.d);
        c.globalAlpha = .5; if (PROTOS[be.p].type === 'pipe' || PROTOS[be.p].type === 'belt' || !mapMode) drawEntityArt(c, be.p, sx(x), sy(y), s, be.d, { t: 0, ug: 'in', conn: wallConnMask(g, be.p, x, y, plannedBlueprintWalls, true) }); c.globalAlpha = 1;
        c.fillStyle = ok ? 'rgba(80,170,255,.18)' : 'rgba(240,60,60,.35)'; c.fillRect(sx(x), sy(y), w * s, h * s);
        if (be.recipe && s > 20) { const ri = recipeArtItem(be.recipe) || be.p; if (ri) c.drawImage(itemIcon(ri), sx(x + w / 2) - s * .3, sy(y + h / 2) - s * .3, s * .6, s * .6); }
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
    if (v.hl && v.hl.length) { const t = performance.now(); v.hl = v.hl.filter(h => h.until > t); const a = 0.55 + 0.35 * Math.sin(t / 150); c.strokeStyle = `rgba(255,216,74,${a})`; c.lineWidth = 3; for (const h of v.hl) c.strokeRect(sx(h.x) - 1, sy(h.y) - 1, h.w * s + 2, h.h * s + 2); }
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
    drawFluidPorts(g, c, v, sx, sy, s, v.mouseX * dpr, v.mouseY * dpr, dpr);
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
    type Obj = { y: number; k: 0 | 1 | 2 | 3; e?: Entity; tx?: number; ty?: number; u?: Unit; bio?: BioRenderGroup };
    const objs: Obj[] = [];
    for (const e of tall) objs.push({ y: e.y + e.h, k: 0, e });
    for (const [tx, ty] of trees) objs.push({ y: ty + .8, k: 1, tx, ty });
    if (!mapMode) for (const u of g.units) if (u.x > x0 && u.x < x1 && u.y > y0 && u.y < y1) objs.push({ y: u.y + .2, k: 2, u });
    for (const bio of bioCorpseRenderGroups(g, x0 - 1, y0 - 1, x1 + 1, y1 + 1)) if (g.world.hasChunk(Math.floor(bio.x / CHUNK), Math.floor(bio.y / CHUNK))) objs.push({ y: bio.y + .15, k: 3, bio });
    this.bioBadges = objs.filter(o => o.k === 3).map(o => o.bio!);
    objs.sort((a, b2) => a.y - b2.y);
    let playerDrawn = false;
    const drawPlayer = () => { playerDrawn = true; if (g.player.dead || g.player.veh != null) return;
      const col = g.mpv?.peers[g.mpv.mp?.me ?? 0]?.color || '#d2782e'; const pl = g.player;
      const wq = pl.walking ? Math.floor(((g.tick * .4 / (Math.PI * 2)) % 1) * 4) / 4 : 0; const lk = this.heroLook(g, pl, col, wq);
      if (lk.aim != null) lk.aim = Math.round(lk.aim / (Math.PI * 2) * 16) * Math.PI * 2 / 16;
      const pk = `player|${col}|${lk.armor || ''}|${lk.gun || ''}|${lk.facing}|${wq}|${lk.aim == null ? '-' : Math.round(lk.aim / (Math.PI * 2) * 16)}`;
      b.sprite(`${pk}@${R}`, 'player', 1.6 * R, 1.6 * R, c => this.drawPlayer(g, .8 * R, 1.05 * R, R, c, pl, col, lk), sx(px) - .8 * s, sy(py) - 1.05 * s, 1.6 * s, 1.6 * s, 1, true); };
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
        const mq = Math.min(3, g.mut), K = UNITS[u.k].boss ? 2.2 : UNITS[u.k].fly ? 1.9 : 1.5; const base = `unit|${u.k}|${aq}|${u.el ? 1 : 0}|${mq}`;
        b.sprite(`${base}|${pq}@${R}`, base, K * LR, K * LR, c => this.drawUnit(c, { ...u, ang: aq * Math.PI * 2 / 16 } as Unit, K / 2 * LR, K / 2 * LR, R, 0, pq * Math.PI * 2 / 8, mq), sx(u.x) - K / 2 * L, sy(u.y) - K / 2 * L, K * L, K * L);
        continue;
      }
      if (o.k === 3) {
        const bio = o.bio!, bw = 1.1 * R, bh = .8 * R;
        const key = `bio|${bio.kind}|${R}|${mapMode ? 1 : 0}`;
        b.sprite(key, key, bw, bh, c => paintBioRemains(c, bw / 2, bh / 2, R, bio.kind, bio.count, mapMode), sx(bio.x) - .55 * s, sy(bio.y) - .4 * s, 1.1 * s, .8 * s);
        continue;
      }
      const e = o.e!;
      if (mapMode) { b.rect(sx(e.x), sy(e.y), e.w * s, e.h * s, this.col(PROTOS[e.proto].color)); continue; }
      const working = e.status === 'working' || e.status === 'low-power';
      const st: ArtState = { t: 0, seed: (e.id & 1) * 7 + 3, working, recipeColor: ITEMS[recipeArtItem(e.recipe) || '']?.color };
      let key = `${working ? 1 : 0}|${st.recipeColor || ''}|${e.id & 1}`; let anim = working, force = false;
      if (e.t === 'wall') { st.conn = wallConnMask(g, e.proto, e.x, e.y); key += wallConnAtlasKey(st.conn); }
      if (e.t === 'turret' || (e.t === 'nest' && PROTOS[e.proto].enemy?.worm)) { const q = Math.round((e.aim || 0) / (Math.PI * 2) * 32); st.aim = q * Math.PI * 2 / 32; st.flash = (e.fireCd || 0) >= 4; key += `|${q}|${st.flash ? 1 : 0}`; }
      if (e.t === 'gate') { st.open = !!e.open; key += `|${e.open ? 1 : 0}`; }
      if (e.t === 'flare' || (e.t === 'engine' && PROTOS[e.proto].burnFluid)) anim = working;
      if (e.t === 'lamp') { st.lit = e.active; st.lampColor = e.ccol; key += `|${e.active ? 1 : 0}|${e.ccol || ''}`; }
      if (e.modules) { st.mods = e.modules; key += `|${e.modules.join(',')}`; }
      if (e.t === 'beacon') { st.working = anim = !!e._on; key += `|${e._on ? 1 : 0}`; }
      if (e.t === 'accumulator') { const f = Math.round((e.charge || 0) / (PROTOS[e.proto].accum!.MJ * 1e6) * 10) / 10; st.fill = f; key += `|${f}`; }
      if (e.t === 'silo') { st.parts = Math.floor((e.parts || 0) / 5) * 5; st.launch = e.launchT ? 1 - e.launchT / 900 : 0; st.working = anim = e.status === 'working' || e.status === 'launching'; key += `|${st.parts}`; if (e.launchT) { force = true; key += `|L${e.id}`; st.t = t; } }
      if (e.t === 'radar') { st.working = anim = e.status === 'working'; }
      if (e.t === 'reactor' || e.t === 'hexch' || e.t === 'hpipe') { key += this.nucArt(g, e, st); if (e.t === 'reactor') anim = !!st.rod; }
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
        // v1.14: новый манипулятор — двухзвенная рука с обводкой, шарниры и захват-клешня
        const ol = this.col('#1c1e21', .85), ac = this.col(shade(p.color, -.15)), hl = this.col(shade(p.color, .35), .8);
        b.line(bx, by, mx, my, s * .17, ol); b.line(mx, my, ex, ey, s * .14, ol); b.line(bx, by, mx, my, s * .11, ac); b.line(mx, my, ex, ey, s * .085, ac); b.line(bx, by, mx, my, s * .03, hl);
        const jk = `joint@${R}`; const joint = (x: number, y: number, r: number) => b.sprite(jk, 'joint', R * .4, R * .4, c => { c.fillStyle = '#2a2d31'; c.beginPath(); c.arc(R * .2, R * .2, R * .18, 0, 7); c.fill(); c.fillStyle = '#8a9198'; c.beginPath(); c.arc(R * .2, R * .2, R * .1, 0, 7); c.fill(); }, x - s * r, y - s * r, s * r * 2, s * r * 2);
        joint(bx, by, .15); joint(mx, my, .11);
        const cq = ((Math.round(a / (Math.PI * 2) * 16) % 16) + 16) % 16; const ck = `claw|${cq}|${e.hand ? 1 : 0}@${R}`;
        b.sprite(ck, 'claw', R * .6, R * .6, c => { c.translate(R * .3, R * .3); c.rotate(cq * Math.PI * 2 / 16); c.strokeStyle = '#2a2d31'; c.lineWidth = R * .07; c.lineCap = 'round'; const o = e.hand ? .08 : .14;
          c.beginPath(); c.moveTo(-R * .08, 0); c.lineTo(-R * o, -R * .18); c.lineTo(-R * .03, -R * .26); c.moveTo(R * .08, 0); c.lineTo(R * o, -R * .18); c.lineTo(R * .03, -R * .26); c.stroke();
          c.fillStyle = '#4a4f55'; c.beginPath(); c.arc(0, 0, R * .1, 0, 7); c.fill(); }, ex - s * .3, ey - s * .3, s * .6, s * .6);
        if (e.hand) icon(e.hand, ex - s * .18, ey - s * .18, s * .36);
      }
    }
    if (!playerDrawn) drawPlayer();
    b.end();
    const A = b.atlas; this.stat.mid = performance.now() - T0; this.stat.quads = b.quads; this.stat.rast = A.rastN; this.stat.rastMs = A.rastMs; this.stat.evict = A.evictions;
  }
  /** v1.16: состояние ядерных построек для рисунка: нагрев (0…1,2, шаг 0,1), стержень, соседи, соединения трубы; возвращает ключ кэша */
  nucArt(g: Game, e: Entity, st: ArtState): string {
    if (e.t === 'reactor') { st.heat = Math.round(Math.max(0, Math.min(1.2, (heatTemp(e) - 15) / 985)) * 10) / 10; st.rod = (e.rt || 0) > 0; st.nb = e.rn || 0; st.working = st.rod; return `|h${st.heat}|${st.rod ? 1 : 0}|${st.nb}`; }
    if (e.t === 'hexch') { st.heat = Math.round(Math.max(0, Math.min(1.2, (heatTemp(e) - 15) / 985)) * 10) / 10; return `|h${st.heat}`; }
    if (e.t === 'hpipe') {
      st.heat = Math.round(Math.max(0, Math.min(1.2, (heatTemp(e) - 15) / 985)) * 10) / 10; let m = 0;
      for (let d = 0; d < 4; d++) { const b = g.entAt(e.x + DX[d], e.y + DY[d]); if (b && isHeatType(b.t) && heatPorts(b).some(q => q.x === e.x + DX[d] && q.y === e.y + DY[d] && q.d === (d + 2) % 4)) m |= 1 << d; }
      st.mask = m; return `|h${st.heat}|m${m}`;
    }
    return '';
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
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(28,30,33,.85)'; c.lineWidth = s * .16; c.beginPath(); c.moveTo(bx, by); c.lineTo(mx, my); c.lineTo(ex, ey); c.stroke();
    c.strokeStyle = shade(p.color, -.15); c.lineWidth = s * .1; c.stroke();
    c.strokeStyle = shade(p.color, .35); c.lineWidth = s * .03; c.beginPath(); c.moveTo(bx, by); c.lineTo(mx, my); c.stroke();
    for (const [jx, jy, r] of [[bx, by, .14], [mx, my, .1]]) { c.fillStyle = '#2a2d31'; c.beginPath(); c.arc(jx, jy, s * r, 0, 7); c.fill(); c.fillStyle = '#8a9198'; c.beginPath(); c.arc(jx, jy, s * r * .55, 0, 7); c.fill(); }
    c.save(); c.translate(ex, ey); c.rotate(a); c.strokeStyle = '#2a2d31'; c.lineWidth = s * .06; const o = e.hand ? .08 : .14;
    c.beginPath(); c.moveTo(-s * .08, 0); c.lineTo(-s * o, -s * .18); c.lineTo(-s * .03, -s * .26); c.moveTo(s * .08, 0); c.lineTo(s * o, -s * .18); c.lineTo(s * .03, -s * .26); c.stroke(); c.fillStyle = '#4a4f55'; c.beginPath(); c.arc(0, 0, s * .09, 0, 7); c.fill(); c.restore();
    if (e.hand) c.drawImage(itemIcon(e.hand), ex - s * .18, ey - s * .18, s * .36, s * .36);
  }
  /** v1.4: покрытия. Плитки по виду и размеру клетки кешируются; при большом обзоре обходим словарь покрытий, а не клетки экрана */
  private floorTiles = new Map<string, HTMLCanvasElement>();
  private floorTile(f: number, z: number) {
    const k = f + '|' + z; let cv = this.floorTiles.get(k); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = z; const c = cv.getContext('2d')!; const F = FLOORS[f - 1];
    c.fillStyle = F.color; c.fillRect(0, 0, z, z);
    if (z >= 12 && floorPattern(c, F.id, z, F.color)) { /* v1.14: декоративные покрытия */ }
    else if (z >= 12) {
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
    if (this.floorTiles.size > 160) this.floorTiles.clear();
    this.floorTiles.set(k, cv); return cv;
  }
  private drawFloors(g: Game, c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, sx: (n: number) => number, sy: (n: number) => number, s: number) {
    const z = Math.max(4, Math.min(64, Math.round(s))); const tiles: (HTMLCanvasElement | null)[] = [null]; for (let i = 1; i <= FLOORS.length; i++) tiles.push(FLOORS[i - 1].land ? null : this.floorTile(i, z));
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
  /** Радиусы выбранных турелей и призрака установки; центры совпадают с симуляцией машины. */
  private drawTurretRanges(g: Game, c: CanvasRenderingContext2D, v: View, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, mapMode: boolean) {
    if (!v.ranges || mapMode) return;
    const hasCarTurret = (e: Entity) => e.t === 'car' && !!e.vehicleState?.mounts.some(m => !!m);
    const list: Entity[] = v.ranges === 1 ? (v.hoverEnt && (PROTOS[v.hoverEnt.proto]?.tur || hasCarTurret(v.hoverEnt)) ? [v.hoverEnt] : []) : [];
    if (v.ranges === 2) for (const e of g.ents.values()) {
      if (list.length >= 60) break;
      if (e.t !== 'turret' && !hasCarTurret(e) || e.x + e.w < x0 || e.x > x1 || e.y + e.h < y0 || e.y > y1) continue;
      list.push(e);
    }
    c.save(); c.lineWidth = 1.5;
    const draw = (T: TurDef, wx: number, wy: number, label: boolean) => {
      const R = T.kind === 'art' ? T.range * (1 + g.bonus('ar')) : T.range, px = sx(wx), py = sy(wy);
      c.fillStyle = 'rgba(255,170,40,.05)'; c.strokeStyle = 'rgba(255,170,40,.75)'; c.setLineDash([]); c.beginPath(); c.arc(px, py, R * s, 0, Math.PI * 2); c.fill(); c.stroke();
      if (T.min) { c.fillStyle = 'rgba(230,60,50,.12)'; c.strokeStyle = 'rgba(230,60,50,.8)'; c.setLineDash([6, 5]); c.beginPath(); c.arc(px, py, T.min * s, 0, Math.PI * 2); c.fill(); c.stroke(); }
      if (label && s >= 8) { c.setLineDash([]); c.fillStyle = '#ffd890'; c.font = '12px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(tr(`дальность ${R.toFixed(R % 1 ? 1 : 0)}${T.min ? ` · мёртвая зона ${T.min}` : ''}`), px, py - R * s - 6); }
    };
    for (const e of list) {
      if (e.t === 'car') for (let slot = 0; slot < (e.vehicleState?.mounts.length || 0); slot++) {
        const m = e.vehicleState!.mounts[slot]; if (!m) continue;
        const T = PROTOS[m.proto]?.tur; if (T) draw(T, e.vehicleState!.x + (slot ? 0.55 : -0.55), e.vehicleState!.y + (slot ? -0.2 : 0.2), v.ranges === 1);
      }
      else { const T = PROTOS[e.proto]?.tur; if (T) draw(T, e.x + e.w / 2, e.y + e.h / 2, v.ranges === 1); }
    }
    if (v.cursor && v.ghostPos) {
      const proto = ITEMS[v.cursor]?.place, p = proto ? PROTOS[proto] : undefined, T = p?.tur;
      if (p && T) { const w = v.rot % 2 ? p.h : p.w, h = v.rot % 2 ? p.w : p.h; draw(T, v.ghostPos[0] + w / 2, v.ghostPos[1] + h / 2, v.ranges === 1); }
    }
    c.restore();
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
  /** Stateful 1.17 combat drones and engineered bioforms; kept on this shared layer so all renderers show the same actors. */
  private drawV117Actors(g: Game, c: CanvasRenderingContext2D, v: View, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, t: number, mapMode: boolean, dpr: number) {
    const mouse = v.mouseIn ? this.screenToWorld(v.mouseX * dpr, v.mouseY * dpr) : null;
    if (v.selectedDroneId != null && !g.v117.drones.instances.some(d => d.id === v.selectedDroneId)) v.selectedDroneId = null;
    const sourceWeight = (family: string) => BIO_V117_SOURCES.find(x => x.form === family)?.w || 0;
    const worldW = g.v117.genetics.forms.reduce((sum, f) => sum + (!f.dead ? sourceWeight(f.family) : 0), 0);
    const worldWCap = g.dedicatedServer ? 256 : g.nPlayers > 1 ? 128 : 24;
    v.hoverDroneId = null;
    let hoverLabel: string | null = null, hoverAt: [number, number] | null = null;
    const palette: Record<string, string> = { gunner: '#63b7ff', interceptor: '#72f4ee', rocket: '#ff9858', tesla: '#f7df5b', flame: '#ff684d', repair: '#83e98c' };
    const symbols: Record<string, string> = { gunner: '•', interceptor: '›', rocket: '▲', tesla: 'ϟ', flame: '♨', repair: '+' };
    for (const d of g.v117.drones.instances) {
      if (d.hp <= 0) continue;
      if (d.x < x0 - 1 || d.x > x1 + 1 || d.y < y0 - 2 || d.y > y1 + 2) continue;
      const def = DRONE_MODELS[d.model]; if (!def) continue;
      const radius = Math.max(.3, def.air ? .48 : .4), hovered = !!mouse && Math.hypot(mouse[0] - d.x, mouse[1] - d.y) <= radius;
      if (hovered) v.hoverDroneId = d.id;
      const X = sx(d.x), groundY = sy(d.y), airborne = d.mode !== 'landed' && d.mode !== 'disabled';
      const bob = airborne ? Math.sin((t + d.id * 11) * .13) * s * .035 : 0, Y = groundY - (airborne ? s * (d.mode === 'repair' ? .15 : .46) : 0) + bob;
      const size = Math.max(8, s * (d.model === 'rocket' || d.model === 'tesla' ? .86 : .72));
      if (mapMode) { c.fillStyle = palette[d.model]; c.beginPath(); c.arc(X, Y, Math.max(2, size * .16), 0, Math.PI * 2); c.fill(); }
      else {
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(X + size * .2, groundY + s * .08, size * .34, size * .14, 0, 0, Math.PI * 2); c.fill();
        if (d.mode === 'landed' || d.mode === 'disabled') { c.strokeStyle = d.mode === 'disabled' ? '#ef6d5b' : '#d6d6a0'; c.lineWidth = Math.max(1, s * .035); c.setLineDash([Math.max(2, s * .08), Math.max(2, s * .06)]); c.beginPath(); c.ellipse(X, groundY, size * .45, size * .23, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
        drone(c, X, Y, size, true, (t >> 3) & 1, d.model === 'repair' || d.model === 'tesla');
        c.save(); c.translate(X, Y); c.rotate(d.cooldown ? Math.PI / 10 : 0); c.strokeStyle = palette[d.model]; c.fillStyle = palette[d.model]; c.lineWidth = Math.max(1.5, size * .12); c.lineCap = 'round';
        if (d.model === 'gunner') { c.beginPath(); c.moveTo(size * .12, 0); c.lineTo(size * .48, 0); c.stroke(); c.beginPath(); c.arc(-size * .05, 0, size * .08, 0, Math.PI * 2); c.fill(); }
        else if (d.model === 'interceptor') { c.beginPath(); c.moveTo(-size * .1, 0); c.lineTo(-size * .43, -size * .28); c.lineTo(-size * .28, 0); c.lineTo(-size * .43, size * .28); c.closePath(); c.fill(); }
        else if (d.model === 'rocket') { c.beginPath(); c.moveTo(size * .36, 0); c.lineTo(size * .05, -size * .2); c.lineTo(size * .12, 0); c.lineTo(size * .05, size * .2); c.closePath(); c.fill(); }
        else if (d.model === 'tesla') { c.beginPath(); c.moveTo(size * .17, -size * .25); c.lineTo(-size * .04, 0); c.lineTo(size * .12, 0); c.lineTo(-size * .15, size * .27); c.stroke(); }
        else if (d.model === 'flame') { c.beginPath(); c.moveTo(-size * .2, -size * .12); c.quadraticCurveTo(-size * .5, 0, -size * .2, size * .18); c.stroke(); }
        else { c.beginPath(); c.moveTo(-size * .16, 0); c.lineTo(size * .16, 0); c.moveTo(0, -size * .16); c.lineTo(0, size * .16); c.stroke(); }
        c.restore();
        this.hpBar(c, X, Y - size * .62, size * .8, d.hp / d.maxHp, false);
      }
      if (hovered || v.selectedDroneId === d.id) {
        const selected = v.selectedDroneId === d.id;
        c.strokeStyle = selected ? '#fff1a6' : '#b9eeff'; c.lineWidth = Math.max(1.5, s * .045); c.beginPath(); c.arc(X, Y, Math.max(size * .62, 6), 0, Math.PI * 2); c.stroke();
        if (selected || !hoverLabel) {
          const item = ITEMS[`combat-drone-${d.model}`];
          hoverLabel = `${tr(item?.name || d.model)} #${d.id} · ${Math.ceil(d.hp)}/${d.maxHp} HP · ${(d.charge / 1e6).toFixed(2)} МДж${d.ammoType ? ` · ${d.ammo}` : ''}${selected ? ` · ${tr(d.mode === 'landed' || d.mode === 'disabled' ? 'Shift+F — забрать' : 'Shift+F — вернуть')}` : ''}`;
          hoverAt = [d.x, d.y];
        }
      }
    }
    for (const f of g.v117.genetics.forms) {
      if (f.dead || f.x < x0 - 2 || f.x > x1 + 2 || f.y < y0 - 2 || f.y > y1 + 2) continue;
      const isWorm = f.family.startsWith('worm-'), wormProto = PROTOS[f.family], wormSize = isWorm ? Math.max(wormProto?.w || 2, wormProto?.h || 2) : 0;
      const art = f.family, unit = UNITS[art] || UNITS.small, bodySize = isWorm ? wormSize : unit.size, radius = Math.max(.35, bodySize * .48), X = sx(f.x), Y = sy(f.y);
      const hovered = !!mouse && Math.hypot(mouse[0] - f.x, mouse[1] - f.y) <= radius;
      const target = f.target == null ? null : g.ents.get(f.target), wp = f.order.waypoints[0];
      const angle = target ? Math.atan2(target.y + target.h / 2 - f.y, target.x + target.w / 2 - f.x) : wp ? Math.atan2(wp.y + .5 - f.y, wp.x + .5 - f.x) : 0;
      if (mapMode) { c.fillStyle = '#43d0a5'; c.fillRect(X - bodySize * s / 2, Y - bodySize * s / 2, bodySize * s, bodySize * s); }
      else {
        if (f.sterile) { c.fillStyle = 'rgba(80,255,200,.12)'; c.beginPath(); c.arc(X, Y, bodySize * s * .58, 0, Math.PI * 2); c.fill(); }
        if (isWorm && f.wormStage === 'deployed') {
          c.save(); c.translate(sx(f.x - wormSize / 2), sy(f.y - wormSize / 2));
          drawSwarmStructure(c, f.family, wormSize * s, wormSize * s, s, t, f.id, false, angle);
          c.restore();
          c.strokeStyle = 'rgba(72,235,190,.88)'; c.lineWidth = Math.max(1.5, s * .045); c.strokeRect(X - wormSize * s / 2 + 1, Y - wormSize * s / 2 + 1, wormSize * s - 2, wormSize * s - 2);
        } else if (isWorm) {
          // During the five-second fold/unfold or travel phase the paid carrier
          // is visible as a compact mechanical sled carrying the folded worm.
          const carrierSize = Math.max(10, s * 1.05);
          c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(X + s * .12, Y + s * .24, carrierSize * .52, carrierSize * .2, 0, 0, Math.PI * 2); c.fill();
          c.save(); c.translate(X, Y); c.rotate(angle);
          c.fillStyle = '#52666c'; c.strokeStyle = '#b6d9c8'; c.lineWidth = Math.max(1, s * .035); c.fillRect(-carrierSize * .42, -carrierSize * .18, carrierSize * .84, carrierSize * .36); c.strokeRect(-carrierSize * .42, -carrierSize * .18, carrierSize * .84, carrierSize * .36);
          for (const side of [-1, 1]) { c.fillStyle = '#20292c'; c.beginPath(); c.arc(side * carrierSize * .28, carrierSize * .2, carrierSize * .12, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#9cb2a8'; c.stroke(); }
          c.fillStyle = '#73c895'; c.beginPath(); c.ellipse(0, -carrierSize * .06, carrierSize * .22, carrierSize * .19, 0, 0, Math.PI * 2); c.fill();
          c.restore();
          c.save(); c.translate(X - carrierSize * .2, Y - carrierSize * .42);
          drawSwarmStructure(c, f.family, carrierSize * .42, carrierSize * .42, carrierSize * .21, t, f.id, false, angle);
          c.restore();
        } else drawSwarmUnit(c, art, X, Y, s * .67, angle, t * .12 + f.id, false, 0);
        this.hpBar(c, X, Y - bodySize * s * .58, bodySize * s * .8, f.hp / f.maxHp, false);
        if (f.detonationTicks !== undefined) {
          c.strokeStyle = '#ff854d'; c.lineWidth = Math.max(1.5, s * .04); c.beginPath(); c.arc(X, Y, (UNITS.destroyer.boom || 2.5) * s, 0, Math.PI * 2); c.stroke();
          c.fillStyle = '#ffb482'; c.font = `bold ${Math.max(10, Math.round(s * .3))}px system-ui`; c.textAlign = 'center'; c.fillText(`${(f.detonationTicks / TICKS).toFixed(1)} s`, X, Y - bodySize * s * .9);
        }
        const foodSeconds = bioFoodSeconds(f);
        if (foodSeconds <= 120) { c.fillStyle = '#ffcc55'; c.font = `bold ${Math.max(9, Math.round(s * .25))}px system-ui`; c.textAlign = 'center'; c.fillText('!', X, Y - bodySize * s * .75); }
      }
      if (hovered) {
        const source = BIO_V117_SOURCES.find(x => x.kind === f.family), weight = sourceWeight(f.family), minutes = (bioFoodSeconds(f) / 60).toFixed(1);
        const wormState = isWorm ? ` · ${tr(f.wormStage === 'deployed' ? 'Развёрнут' : f.wormStage === 'travelling' ? 'Транспортируется' : 'Складывается/разворачивается')}` : '';
        hoverLabel = `${tr('Биоотряд')} ${tr(source?.label || f.family)}${wormState} · ${Math.ceil(f.hp)}/${f.maxHp} HP · ${tr('Питание')} ${minutes} ${tr('мин')} · W ${weight} (${worldW}/${worldWCap})`;
        hoverAt = [f.x, f.y];
      }
    }
    if (hoverLabel && hoverAt && !mapMode) {
      c.save(); c.font = `${Math.round(11 * dpr)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      const x = sx(hoverAt[0]), y = sy(hoverAt[1]) - Math.max(14, s * .55), w = c.measureText(hoverLabel).width + 10 * dpr;
      c.fillStyle = 'rgba(5,10,14,.84)'; c.fillRect(x - w / 2, y - 17 * dpr, w, 18 * dpr); c.fillStyle = '#eaf4e8'; c.fillText(hoverLabel, x, y - 2 * dpr); c.restore();
    }
  }
  /** роботы из буфера x, y, груз, флаги (sim/robots.ts robotBuffer) */
  private drawRobots(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, t: number, mapMode: boolean) {
    const a = robotView(g, ITEM_IDX).buf; const n = a.length / ROBOT_STRIDE; if (!n && !g.bioRobots.length) return;
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
    for (const r of g.bioRobots) {
      if (r.x < x0 || r.x > x1 || r.y < y0 - 2 || r.y > y1 + 2) continue;
      this.stat.robots++;
      const X = sx(r.x), Y = sy(r.y) - s * .48, radius = Math.max(2.5, sz * .38);
      if (mapMode) { c.fillStyle = '#38d8c3'; c.fillRect(X - 2, Y - 2, 4, 4); continue; }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(X + s * .18, sy(r.y) + s * .12, radius * .95, radius * .38, 0, 0, 7); c.fill();
      c.fillStyle = '#167e79'; c.strokeStyle = '#9dfff0'; c.lineWidth = Math.max(1, s * .035); c.beginPath(); c.arc(X, Y, radius, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#d7fff7'; c.fillRect(X - radius * .35, Y - radius * .2, radius * .7, radius * .4);
      if (r.cargo && s >= 13) { c.fillStyle = '#ffc65c'; c.beginPath(); c.arc(X + radius * .8, Y + radius * .7, Math.max(2, s * .08), 0, 7); c.fill(); }
      if (r.charge < 300_000) { c.fillStyle = '#242424'; c.fillRect(X - radius, Y + radius + 1, radius * 2, Math.max(2, s * .05)); c.fillStyle = '#edb74e'; c.fillRect(X - radius, Y + radius + 1, radius * 2 * Math.max(0, r.charge / 300_000), Math.max(2, s * .05)); }
    }
  }
  private drawBioRange(g: Game, c: CanvasRenderingContext2D, v: View, sx: (n: number) => number, sy: (n: number) => number, s: number, mapMode: boolean) {
    const e = v.hoverEnt; if (mapMode || e?.t !== 'bioport') return;
    c.save(); c.strokeStyle = 'rgba(69,224,203,.72)'; c.fillStyle = 'rgba(69,224,203,.055)'; c.lineWidth = Math.max(1, s * .035); c.setLineDash([Math.max(3, s * .22), Math.max(2, s * .12)]);
    const x = sx(e.x + e.w / 2), y = sy(e.y + e.h / 2), r = (PROTOS[e.proto].bio?.range || 24) * s;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); c.restore();
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
  /** юнит Роя (v1.14: облик по виду, элита, мутации) */
  private drawUnit(c: CanvasRenderingContext2D, u: Unit, x: number, y: number, s: number, t: number, phOverride?: number, mut = 0) {
    const d = UNITS[u.k] || UNITS.small; const ph = phOverride ?? (t + u.id * 7) * (0.35 + d.speed);
    drawSwarmUnit(c, u.k, x, y, s, u.ang, ph, !!u.el, mut);
  }
  private creepCv = new Map<number, { ch: Chunk; v: number; around: number[]; cv: HTMLCanvasElement; used: number }>();
  private creepWorld: World | null = null;
  private hasCreep(ch: Chunk | undefined | null): ch is Chunk { return !!ch?.creep; }
  private creepCanvas(w: World, ch: Chunk): HTMLCanvasElement {
    if (this.creepWorld !== w) { this.creepWorld = w; this.creepCv.clear(); }
    const key = ckey(ch.cx, ch.cy);
    const around: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = w.chunks.get(ckey(ch.cx + dx, ch.cy + dy)); around.push(neighbor ? 1 : 0, neighbor?.cv || 0);
    }
    const r = this.creepCv.get(key);
    if (r && r.ch === ch && r.v === (ch.cv || 0) && r.around.every((v, i) => v === around[i])) { r.used = this.frame; return r.cv; }
    const pxPerTile = 8, cv = r?.cv || document.createElement('canvas'); cv.width = cv.height = CHUNK * pxPerTile;
    const x = cv.getContext('2d')!, cr = ch.creep!;
    const strengthAt = (tx: number, ty: number) => {
      const ccx = Math.floor(tx / CHUNK), ccy = Math.floor(ty / CHUNK), c = w.chunks.get(ckey(ccx, ccy));
      if (!c?.creep) return 0;
      const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
      return c.creep[ly * CHUNK + lx] || 0;
    };
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const strength = cr[i]; if (!strength) continue;
      const lx = i % CHUNK, ly = Math.floor(i / CHUNK), tx = ch.cx * CHUNK + lx, ty = ch.cy * CHUNK + ly;
      let mask = 0; for (let bit = 0; bit < dirs.length; bit++) if (strengthAt(tx + dirs[bit][0], ty + dirs[bit][1])) mask |= 1 << bit;
      const seed = (hash2(tx, ty, w.seed) * 0x100000000) | 0;
      drawCreepTile(x, lx * pxPerTile, ly * pxPerTile, pxPerTile, strength, mask, seed);
    }
    this.creepCv.set(key, { ch, v: ch.cv || 0, around, cv, used: this.frame });
    if (this.creepCv.size > 64) {
      let oldestKey = key, oldest = Infinity;
      for (const [cacheKey, entry] of this.creepCv) if (entry.used < oldest) { oldest = entry.used; oldestKey = cacheKey; }
      this.creepCv.delete(oldestKey);
    }
    return cv;
  }
  private drawFx(g: Game, c: CanvasRenderingContext2D, sx: (n: number) => number, sy: (n: number) => number, s: number) {
    const T = g.tick;
    // v1.14: лужи кислоты, пламя, ракеты и снаряды
    for (const a of g.acids) { const x = sx(a.x), y = sy(a.y), R = a.r * s; const al = Math.min(1, a.t / 60) * .55;
      const gr = c.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, a.owner === undefined ? `rgba(170,240,70,${al})` : `rgba(70,240,195,${al})`); gr.addColorStop(.7, a.owner === undefined ? `rgba(110,190,40,${al * .8})` : `rgba(35,175,160,${al * .8})`); gr.addColorStop(1, a.owner === undefined ? 'rgba(80,140,30,0)' : 'rgba(25,145,130,0)');
      c.fillStyle = gr; c.beginPath(); c.ellipse(x, y, R, R * .8, 0, 0, 7); c.fill();
      c.fillStyle = `rgba(220,255,160,${al})`; for (let i = 0; i < 3; i++) { const ph = (T * .05 + i * 2.1 + a.x) % 1; c.beginPath(); c.arc(x + Math.cos(i * 2.1 + a.y) * R * .5, y + Math.sin(i * 2.1 + a.x) * R * .35, s * .06 * (1 + ph), 0, 7); c.fill(); } }
    for (const f of g.fires) { const x = sx(f.x), y = sy(f.y), R = f.r * s; const al = Math.min(1, f.t / 40);
      const gr = c.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(255,230,120,${al * .8})`); gr.addColorStop(.5, `rgba(255,120,30,${al * .55})`); gr.addColorStop(1, 'rgba(120,30,10,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
      for (let i = 0; i < 4; i++) { const ph = ((T * .07 + i * .27 + f.x * .13) % 1); const fx = x + Math.sin(i * 1.7 + f.y) * R * .5, fy = y - ph * s * .9; c.fillStyle = `rgba(255,${160 - ph * 100 | 0},40,${(1 - ph) * al * .8})`; c.beginPath(); c.arc(fx, fy, s * .16 * (1 - ph * .5), 0, 7); c.fill(); } }
    for (const p of g.shots) { const x = sx(p.x), y = sy(p.y); const a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
      if (p.k === 'rocket' || p.k === 'prock') { c.strokeStyle = 'rgba(200,200,200,.45)'; c.lineWidth = s * .12; c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.cos(a) * s * .9, y - Math.sin(a) * s * .9); c.stroke();
        c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = '#c8ccd0'; c.fillRect(-s * .22, -s * .05, s * .32, s * .1); c.fillStyle = '#d83a2a'; c.beginPath(); c.moveTo(s * .1, -s * .05); c.lineTo(s * .2, 0); c.lineTo(s * .1, s * .05); c.fill(); c.fillStyle = 'rgba(255,200,80,.9)'; c.beginPath(); c.arc(-s * .26, 0, s * .07, 0, 7); c.fill(); c.restore(); }
      else if (p.k === 'flame') { c.fillStyle = 'rgba(255,150,40,.7)'; c.beginPath(); c.arc(x, y, s * .22, 0, 7); c.fill(); }
      else { const D = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1, k = Math.min(1, Math.hypot(p.x - p.sx, p.y - p.sy) / D); const hgt = Math.sin(k * Math.PI) * Math.min(6, D * .25) * s;
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x, y, s * .12, s * .07, 0, 0, 7); c.fill();
        c.fillStyle = p.k === 'art' ? '#e8d070' : '#b8b0a0'; c.beginPath(); c.arc(x, y - hgt, s * (p.k === 'art' ? .16 : .12), 0, 7); c.fill(); c.strokeStyle = 'rgba(255,220,140,.4)'; c.lineWidth = s * .05; c.beginPath(); c.moveTo(x, y - hgt); c.lineTo(x - Math.cos(a) * s * .5, y - hgt - Math.sin(a) * s * .5 + s * .1); c.stroke(); } }
    for (const p of g.projectiles) {
      const x = sx(p.x), y = sy(p.y); const gr = c.createRadialGradient(x, y, 0, x, y, s * .3); gr.addColorStop(0, p.owner === undefined ? 'rgba(220,255,120,1)' : 'rgba(120,255,220,1)'); gr.addColorStop(1, p.owner === undefined ? 'rgba(120,200,40,0)' : 'rgba(40,200,175,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, s * .3, 0, 7); c.fill();
    }
    for (const f of g.fx) {
      const x = sx(f.x), y = sy(f.y);
      if (f.k === 'tracer') { c.strokeStyle = `rgba(255,230,140,${f.t / 4})`; c.lineWidth = Math.max(1, s * .05); c.beginPath(); c.moveTo(x, y); c.lineTo(sx(f.x2!), sy(f.y2!)); c.stroke(); c.fillStyle = 'rgba(255,240,180,.9)'; c.beginPath(); c.arc(sx(f.x2!), sy(f.y2!), s * .08, 0, 7); c.fill(); }
      else if (f.k === 'boom') {
        const k = Math.max(0, Math.min(1, 1 - f.t / (f.life ?? 40))), R = Math.max(0, s * (f.s || 1) * (.4 + k * 1.1));
        const gr = c.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(255,240,180,${(1 - k) * .95})`); gr.addColorStop(.4, `rgba(255,140,40,${(1 - k) * .8})`); gr.addColorStop(1, 'rgba(60,40,30,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
        c.fillStyle = `rgba(50,45,40,${k * .5})`; for (let i = 0; i < 5; i++) { const a = i * 1.26 + f.x; c.beginPath(); c.arc(x + Math.cos(a) * R * .5, y + Math.sin(a) * R * .5 - k * s * .5, R * .35, 0, 7); c.fill(); }
      } else if (f.k === 'acid') { c.fillStyle = `rgba(150,220,60,${f.t / 40 * .55})`; c.beginPath(); c.ellipse(x, y, s * 1.1, s * .8, 0, 0, 7); c.fill(); }
      else if (f.k === 'laser') { const al = Math.min(1, f.t / 6); c.lineCap = 'round'; c.strokeStyle = `rgba(255,60,60,${al * .5})`; c.lineWidth = s * .22; c.beginPath(); c.moveTo(x, y); c.lineTo(sx(f.x2!), sy(f.y2!)); c.stroke(); c.strokeStyle = `rgba(255,220,220,${al})`; c.lineWidth = s * .06; c.stroke(); c.lineCap = 'butt'; }
      else if (f.k === 'rail') { const al = Math.min(1, f.t / 20); c.strokeStyle = `rgba(120,200,255,${al * .4})`; c.lineWidth = s * .35 * al; c.beginPath(); c.moveTo(x, y); c.lineTo(sx(f.x2!), sy(f.y2!)); c.stroke(); c.strokeStyle = `rgba(230,250,255,${al})`; c.lineWidth = s * .08; c.stroke(); }
      else if (f.k === 'arc') { const al = Math.min(1, f.t / 8); const pts = f.pts || [f.x, f.y, f.x2!, f.y2!]; c.strokeStyle = `rgba(150,200,255,${al})`; c.lineWidth = Math.max(1, s * .07); c.beginPath();
        for (let i = 0; i + 3 < pts.length; i += 2) { const ax = sx(pts[i]), ay = sy(pts[i + 1]), bx = sx(pts[i + 2]), by = sy(pts[i + 3]); if (i === 0) c.moveTo(ax, ay); for (let j = 1; j <= 4; j++) { const k = j / 4, jit = j < 4 ? (hash2(i * 7 + j, f.t, 3) - .5) * s * .6 : 0; c.lineTo(ax + (bx - ax) * k + jit, ay + (by - ay) * k - jit); } } c.stroke(); }
      else if (f.k === 'flame') { const al = Math.min(1, f.t / 10); c.fillStyle = `rgba(255,140,40,${al * .6})`; c.beginPath(); c.arc(sx(f.x2 ?? f.x), sy(f.y2 ?? f.y), s * .3, 0, 7); c.fill(); }
      else if (f.k === 'blast') { const k = Math.max(0, Math.min(1, 1 - f.t / (f.life ?? 30))), R = Math.max(0, s * (f.s || 2) * (.3 + k * .9)); c.strokeStyle = `rgba(255,220,160,${(1 - k) * .9})`; c.lineWidth = s * .15 * (1 - k) + 1; c.beginPath(); c.arc(x, y, R, 0, 7); c.stroke(); }
      else if (f.k === 'regrow') { const al = f.t / 60; c.strokeStyle = `rgba(190,90,200,${al * .7})`; c.lineWidth = 2; c.beginPath(); c.arc(x, y, s * (2 - al) * 1.5, 0, 7); c.stroke(); }
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
      if (p.x < x0 - 2 || p.x > x1 + 2 || p.y < y0 - 2 || p.y > y1 + 2 || p.off === 2) return; // v1.13: ушедший больше 5 мин назад — не виден
      const x = sx(p.x), y = sy(p.y); const off = !!p.off && i !== me;
      if (off) c.globalAlpha = .45; // v1.13: нет связи — персонаж полупрозрачный и ждёт
      if (i !== me && !p.dead && p.veh == null) this.drawPlayer(g, x, y, s, c, p as any, p.color);
      c.globalAlpha = 1;
      if (i === me) return;
      const t = (p.name || '') + (p.dead ? ' ✝' : '') + (off ? tr(' (нет связи)') : '') + (p.role === 'admin' ? ' ★' : ''); const w = c.measureText(t).width + 8, hy = y - s * .8;
      c.fillStyle = 'rgba(15,18,22,.7)'; c.fillRect(x - w / 2, hy - s * .4 - 2, w, s * .4 + 4); c.fillStyle = p.color; c.fillText(t, x, hy + 1);
    });
  }
  /** v1.14: облик игрока — броня и оружие в руках (своё — из набора, чужое — из снимка) */
  private heroLook(g: Game, pl: any, color: string, walkQ?: number): HeroLook {
    let gun: string | null = pl.gun ?? null, armor: string | null = pl.arm ?? null;
    if (pl.kit) { const j = curGun(pl.kit); gun = j >= 0 && !pl.kit.hid ? pl.kit.guns[j] : null; armor = pl.kit.armor || null; }
    const walk = pl.walking ? (walkQ ?? ((g.tick * .4 / (Math.PI * 2)) % 1)) : 0;
    return { color, facing: pl.facing, walk, aim: pl.shootCd > 0 ? pl.aim : null, gun, armor, shooting: pl.shootCd > 0 };
  }
  private drawPlayer(g: Game, x: number, y: number, s: number, c: CanvasRenderingContext2D = this.ctx, pl: any = g.player, color = g.mpv?.peers[g.mpv.mp?.me ?? 0]?.color || '#d2782e', look?: HeroLook) {
    drawHero(c, x, y, s, look || this.heroLook(g, pl, color));
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
      const ic = n.icon && ITEMS[n.icon] ? Math.max(12 * dpr, Math.min(22 * dpr, s * .5)) : 0;
      if (ic) { c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(px + r * 2.4, py - r * 3 - 2, ic + 4, 16 * dpr); c.drawImage(itemIcon(n.icon!), px + r * 2.4 + 2, py - r * 3 - 1, ic, ic); }
      c.font = `${Math.round(12 * dpr)}px system-ui,sans-serif`; const t = n.title; const tx = px + r * 2.4 + (ic ? ic + 8 : 4), tw = c.measureText(t).width;
      c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(tx - 4, py - r * 3 - 2, tw + 8, 16 * dpr); c.fillStyle = '#ffe9a0'; c.fillText(t, tx, py - r * 3 + 13 * dpr);
      if (s >= 24 && n.text) { c.font = `${Math.round(11 * dpr)}px system-ui,sans-serif`; const L = n.text.split('\n').slice(0, 6); const w = Math.max(...L.map(l => c.measureText(l).width)) + 10;
        c.fillStyle = 'rgba(10,12,14,.82)'; c.fillRect(px + r * 2.4, py - r * 3 + 16 * dpr, w, (L.length * 14 + 6) * dpr); c.fillStyle = '#dfe6ea'; L.forEach((l, i) => c.fillText(l, px + r * 2.4 + 5, py - r * 3 + (16 + 17 + i * 14) * dpr)); }
    }
    c.restore();
  }
  /** v1.11: карта — местность выборкой по пикселям, постройки прямоугольниками прямо в буфер (конвейеры и трубы не пропадают
   *  при отдалении), загрязнение — плавно (билинейно между центрами чанков) и шкалой как у слоя U */
  drawMap(g: Game, cv: HTMLCanvasElement, cx: number, cy: number, tilesPerPx: number, pollution = false) {
    const W = cv.width, H = cv.height; const x = cv.getContext('2d')!; const img = x.createImageData(W, H); const d = img.data;
    const col = TERRAIN_COL.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    const resCol = RES_ITEMS.map(r => r ? (() => { const n = parseInt(ITEMS[r].color.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; })() : [0, 0, 0]);
    const x0 = cx - W / 2 * tilesPerPx, y0 = cy - H / 2 * tilesPerPx;
    let lastK = NaN, ch: any = null;
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const wx = Math.floor(x0 + px * tilesPerPx), wy = Math.floor(y0 + py * tilesPerPx); const o = (py * W + px) * 4;
      const ccx = Math.floor(wx / CHUNK), ccy = Math.floor(wy / CHUNK); const k = ccx * 100003 + ccy;
      if (k !== lastK) { lastK = k; ch = g.world.hasChunk(ccx, ccy) ? g.world.getChunk(ccx, ccy) : null; }
      if (!ch) { d[o] = 8; d[o + 1] = 10; d[o + 2] = 14; d[o + 3] = 255; continue; }
      const i = g.world.idx(wx, wy);
      let c = col[ch.terrain[i]];
      if (ch.amt[i] > 0 && ch.res[i]) c = resCol[ch.res[i]];
      else if (ch.decor[i] === D_TREE) c = [40, 72, 32];
      if (ch.creep && ch.creep[i]) { d[o] = c[0] * .5 + 50; d[o + 1] = c[1] * .5 + 14; d[o + 2] = c[2] * .5 + 52; d[o + 3] = 255; continue; } // v1.14: слизь Роя
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    // постройки: прямоугольник не меньше 1 пикселя
    const x1 = x0 + W * tilesPerPx, y1 = y0 + H * tilesPerPx; const pc = new Map<string, number[]>();
    for (const e of g.ents.values()) {
      if (e.x + e.w < x0 || e.y + e.h < y0 || e.x > x1 || e.y > y1) continue;
      let c = pc.get(e.proto); if (!c) { const pr = PROTOS[e.proto]; const n = e.t === 'nest' ? 0xdc285a : parseInt((pr?.color || '#888888').slice(1), 16); c = [n >> 16, (n >> 8) & 255, n & 255]; pc.set(e.proto, c); }
      const ax = Math.floor((e.x - x0) / tilesPerPx), ay = Math.floor((e.y - y0) / tilesPerPx);
      const bx = Math.max(ax + 1, Math.floor((e.x + e.w - x0) / tilesPerPx)), by = Math.max(ay + 1, Math.floor((e.y + e.h - y0) / tilesPerPx));
      for (let py = Math.max(0, ay); py < Math.min(H, by); py++) for (let px = Math.max(0, ax); px < Math.min(W, bx); px++) { const o = (py * W + px) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; }
    }
    if (pollution) {
      // значение в центре каждого чанка, между центрами — билинейно
      const pv = (ccx: number, ccy: number) => { const c = g.world.chunks.get(ckey(ccx, ccy)); return c ? c.pollution : 0; };
      const pc0 = Math.floor(x0 / CHUNK - 0.5) - 1, pr0 = Math.floor(y0 / CHUNK - 0.5) - 1, pcw = Math.ceil(W * tilesPerPx / CHUNK) + 3, prh = Math.ceil(H * tilesPerPx / CHUNK) + 3;
      const grid = new Float32Array(pcw * prh); for (let r = 0; r < prh; r++) for (let q = 0; q < pcw; q++) grid[r * pcw + q] = pv(pc0 + q, pr0 + r);
      for (let py = 0; py < H; py++) { const fy = (y0 + (py + 0.5) * tilesPerPx) / CHUNK - 0.5 - pr0; const r = Math.floor(fy), ty = fy - r;
        for (let px = 0; px < W; px++) { const fx = (x0 + (px + 0.5) * tilesPerPx) / CHUNK - 0.5 - pc0; const q = Math.floor(fx), tx = fx - q;
          if (q < 0 || r < 0 || q + 1 >= pcw || r + 1 >= prh) continue;
          const v = (grid[r * pcw + q] * (1 - tx) + grid[r * pcw + q + 1] * tx) * (1 - ty) + (grid[(r + 1) * pcw + q] * (1 - tx) + grid[(r + 1) * pcw + q + 1] * tx) * ty;
          if (v <= 0.05) continue; const kk = Math.min(0.7, Math.log10(1 + v) * 0.22); const o = (py * W + px) * 4;
          d[o] = d[o] + (190 - d[o]) * kk; d[o + 1] = d[o + 1] * (1 - kk) + 40 * kk; d[o + 2] = d[o + 2] + (150 - d[o + 2]) * kk; } }
    }
    x.putImageData(img, 0, 0);
    const mx = (wx: number) => W / 2 + (wx - cx) / tilesPerPx, my = (wy: number) => H / 2 + (wy - cy) / tilesPerPx;
    // Remains stay visible on the map without scanning each body or revealing unexplored chunks.
    for (const bio of bioCorpseRenderGroups(g, x0, y0, x1, y1)) {
      if (!g.world.hasChunk(Math.floor(bio.x / CHUNK), Math.floor(bio.y / CHUNK))) continue;
      paintBioRemains(x, mx(bio.x), my(bio.y), Math.max(3, 6 / Math.max(1, tilesPerPx)), bio.kind, bio.count, true);
      bioBadge(x, mx(bio.x), my(bio.y), Math.max(12, 18 / Math.max(1, tilesPerPx)), bio.count);
    }
    // v1.16: заражение и аварийные реакторы на карте (значки видны и при далёком масштабе)
    for (const z of g.nuc.zones) { const left = z.dur - (g.tick - z.t); if (left <= 0) continue; const px = mx(z.x), py = my(z.y), R = Math.max(3, z.r / tilesPerPx); if (px + R < 0 || py + R < 0 || px - R > W || py - R > H) continue; x.save(); x.fillStyle = `rgba(200,235,40,${0.12 + 0.25 * left / z.dur})`; x.strokeStyle = 'rgba(230,240,60,.9)'; x.lineWidth = 1.5; x.setLineDash([4, 3]); x.beginPath(); x.arc(px, py, R, 0, Math.PI * 2); x.fill(); x.stroke(); x.restore(); x.fillStyle = '#f2f6a0'; x.font = 'bold 11px sans-serif'; x.textAlign = 'center'; x.fillText('☢', px, py + 4); x.textAlign = 'left'; }
    for (const e of g.ents.values()) { if (e.t !== 'reactor') continue; const T = heatTemp(e); const px = mx(e.x + 2.5), py = my(e.y + 2.5); if (px < -8 || py < -8 || px > W + 8 || py > H + 8) continue; if (T >= 900) { x.fillStyle = T >= 1000 ? '#ff3a2a' : '#ffd23a'; x.beginPath(); x.moveTo(px, py - 7); x.lineTo(px + 6, py + 5); x.lineTo(px - 6, py + 5); x.closePath(); x.fill(); x.fillStyle = '#000'; x.fillRect(px - 0.8, py - 3, 1.6, 4.5); x.fillRect(px - 0.8, py + 2, 1.6, 1.6); } else if (tilesPerPx >= 2) { x.fillStyle = '#ffe75a'; x.fillRect(px - 2, py - 2, 4, 4); } }
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
    // v1.14: атаки Роя — значок «клыки» в точке атаки и стрелка от гнезда; идущие атаки мигают
    for (const a of g.sw.att) { const age = g.tick - a.t; if (a.end != null && g.tick - a.end > 5 * 3600) continue; const live = a.end == null; const px = mx(a.tx), py = my(a.ty); if (px < -10 || py < -10 || px > W + 10 || py > H + 10) continue;
      x.globalAlpha = live ? ((g.tick >> 3) % 2 ? 1 : .55) : .5; x.strokeStyle = '#ff5a3a'; x.lineWidth = 1.5; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(mx(a.x), my(a.y)); x.lineTo(px, py); x.stroke(); x.setLineDash([]);
      x.fillStyle = a.q ? '#c040ff' : live ? '#e8302a' : '#7a3a34'; x.beginPath(); x.moveTo(px, py - 7); x.lineTo(px + 6, py + 4); x.lineTo(px - 6, py + 4); x.closePath(); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke();
      x.fillStyle = '#fff'; x.fillRect(px - .5, py - 3, 1.5, 4); x.fillRect(px - .5, py + 2, 1.5, 1.5); x.globalAlpha = 1; void age; }
    // v1.16: находки радара — уран (зелёный), нефть (чёрный), гнёзда (красный ромб)
    for (const f of g.x.rs.finds) { if (!g.x.rs.flt[f.k]) continue; const px = mx(f.x), py = my(f.y); if (px < -10 || py < -10 || px > W + 10 || py > H + 10) continue;
      x.lineWidth = 1.5; x.strokeStyle = '#000';
      if (f.k === 'nest') { x.fillStyle = '#e8302a'; x.beginPath(); x.moveTo(px, py - 6); x.lineTo(px + 5, py); x.lineTo(px, py + 6); x.lineTo(px - 5, py); x.closePath(); x.fill(); x.stroke(); }
      else { x.fillStyle = f.k === 'uranium' ? '#6dff4a' : '#2a2a2e'; x.beginPath(); x.arc(px, py, 5, 0, 7); x.fill(); x.stroke(); if (f.k === 'uranium') { x.fillStyle = '#000'; x.fillRect(px - 1, py - 3, 2, 6); } else { x.strokeStyle = '#c8a050'; x.beginPath(); x.arc(px, py, 2, 0, 7); x.stroke(); } } }
    for (const cp of g.corpses) { x.fillStyle = '#ffcc66'; x.fillRect(mx(cp.x) - 2, my(cp.y) - 2, 4, 4); }
    // v1.9: заметки — жёлтые флажки с заголовком
    if (g.notes.length) { x.font = '11px system-ui,sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; for (const n of g.notes) { const px = mx(n.x), py = my(n.y); if (px < -40 || py < -10 || px > W + 40 || py > H + 10) continue; x.fillStyle = '#ffd54a'; x.fillRect(px - 2, py - 2, 5, 5); const icon = validNoteIcon(n.icon) ? 16 : 0; if (icon) { x.fillStyle = 'rgba(0,0,0,.72)'; x.fillRect(px + 5, py - 9, icon + 3, 18); x.drawImage(itemIcon(n.icon!), px + 6, py - 8, icon, icon); } if (W > 300) { x.fillStyle = 'rgba(0,0,0,.6)'; const tx = px + 5 + (icon ? icon + 5 : 0), tw = x.measureText(n.title).width; x.fillRect(tx - 3, py - 7, tw + 6, 13); x.fillStyle = '#ffe9a0'; x.fillText(n.title, tx, py); } } }
    // v1.12: другие игроки — точки их цвета, метки — кольца
    const mv = g.mpv; if (mv) { const me = mv.mp?.me ?? 0;
      mv.peers.forEach((p, i) => { if (i === me || p.dead || p.off === 2) return; x.fillStyle = p.color; x.fillRect(mx(p.x) - 2.5, my(p.y) - 2.5, 5, 5); x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(mx(p.x) - 2.5, my(p.y) - 2.5, 5, 5); });
      for (const m of g.marks) if (g.tick - m.tick < 3600) { x.strokeStyle = mv.peers[m.pl]?.color || '#fc3'; x.lineWidth = 2; x.beginPath(); x.arc(mx(m.x), my(m.y), 5, 0, 7); x.stroke(); } }
    // v1.16: «День/Ночь» и время до следующего перехода — из тика игры, одинаково у всех клиентов и после загрузки
    { const dt = dayInfo(g.tick); const lab = `${tr(dt.name)} · ${tr(dt.next)} ${Math.floor(dt.left / 60)}:${String(Math.floor(dt.left % 60)).padStart(2, '0')}`;
      x.font = '11px system-ui,sans-serif'; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; const tw = x.measureText(lab).width;
      x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(3, H - 17, tw + 10, 14); x.fillStyle = dt.name === 'Ночь' ? '#9ab8ff' : dt.name === 'День' ? '#ffe28a' : '#ffb27a'; x.fillText(lab, 8, H - 6); }
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
