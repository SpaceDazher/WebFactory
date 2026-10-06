// Поверхность высокого разрешения: контуры типов почвы строятся «марширующими квадратами»
// по сглаженному полю, заливаются 2K-текстурами; берег — пена и мокрый песок, вода — анимированные каустики.
import { CHUNK } from '../core/types';
import { World, Chunk, T_SAND, T_STONE, T_SHALLOW, T_DEEP } from '../sim/world';
import { pattern } from './textures';

export interface Layer { fill: Path2D; soft: Path2D; edge: Path2D; any: boolean; }
export interface ChunkGeo { ver: number; sand: Layer; stone: Layer; water: Layer; deep: Layer; used: number; }

/** сглаженное поле принадлежности (значения в центрах клеток), с полем 2 клетки вокруг чанка */
function field(w: World, c: Chunk, pred: (t: number) => boolean): Float32Array {
  const R = CHUNK + 6; const raw = new Float32Array(R * R); const ox = c.cx * CHUNK - 3, oy = c.cy * CHUNK - 3;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    let wx = ox + x, wy = oy + y;
    const ccx = Math.floor(wx / CHUNK), ccy = Math.floor(wy / CHUNK);
    if (!w.hasChunk(ccx, ccy)) { wx = Math.max(c.cx * CHUNK, Math.min(c.cx * CHUNK + CHUNK - 1, wx)); wy = Math.max(c.cy * CHUNK, Math.min(c.cy * CHUNK + CHUNK - 1, wy)); }
    raw[y * R + x] = pred(w.terrain(wx, wy)) ? 1 : 0;
  }
  const f = new Float32Array(R * R);
  for (let y = 1; y < R - 1; y++) for (let x = 1; x < R - 1; x++) {
    const i = y * R + x;
    f[i] = (raw[i] * 4 + (raw[i - 1] + raw[i + 1] + raw[i - R] + raw[i + R]) * 1.5 + (raw[i - R - 1] + raw[i - R + 1] + raw[i + R - 1] + raw[i + R + 1]) * 0.5) / 12;
  }
  return f;
}
/** марширующие квадраты: заливка (полигоны ячеек) и линия контура; координаты — клетки относительно чанка */
function march(f: Float32Array, thr: number, fill: Path2D, edge: Path2D | null): boolean {
  const R = CHUNK + 6; let any = false;
  // ячейки между центрами клеток: углы в (x+.5, y+.5) мира; диапазон перекрывает чанк на полклетки
  for (let y = 1; y < CHUNK + 4; y++) {
    let run = -1;
    const flush = (xe: number) => { if (run >= 0) { fill.rect(run - 3 + 0.5, y - 3 + 0.5, xe - run, 1); run = -1; } };
    for (let x = 1; x < CHUNK + 4; x++) {
      const a = f[y * R + x], b = f[y * R + x + 1], c = f[(y + 1) * R + x + 1], d = f[(y + 1) * R + x];
      const ia = a >= thr, ib = b >= thr, ic = c >= thr, id = d >= thr;
      const n = +ia + +ib + +ic + +id;
      if (n === 4) { if (run < 0) run = x; any = true; continue; }
      flush(x);
      if (n === 0) continue;
      any = true;
      const X = x - 3 + 0.5, Y = y - 3 + 0.5;
      const corners: [number, number, number, boolean][] = [[X, Y, a, ia], [X + 1, Y, b, ib], [X + 1, Y + 1, c, ic], [X, Y + 1, d, id]];
      const pts: [number, number][] = []; const cross: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const [x0, y0, v0, i0] = corners[k], [x1, y1, v1, i1] = corners[(k + 1) & 3];
        if (i0) pts.push([x0, y0]);
        if (i0 !== i1) { const t = (thr - v0) / (v1 - v0); const p: [number, number] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]; pts.push(p); cross.push(p); }
      }
      fill.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) fill.lineTo(pts[k][0], pts[k][1]); fill.closePath();
      if (edge) for (let k = 0; k + 1 < cross.length; k += 2) { edge.moveTo(cross[k][0], cross[k][1]); edge.lineTo(cross[k + 1][0], cross[k + 1][1]); }
    }
    flush(CHUNK + 4);
  }
  return any;
}
function layer(w: World, c: Chunk, pred: (t: number) => boolean, thr = 0.5, softThr = 0.3): Layer {
  const f = field(w, c, pred); const L: Layer = { fill: new Path2D(), soft: new Path2D(), edge: new Path2D(), any: false };
  L.any = march(f, thr, L.fill, L.edge); if (L.any || softThr < thr) march(f, softThr, L.soft, null);
  return L;
}
export function buildGeo(w: World, c: Chunk): ChunkGeo {
  return {
    ver: c.version, used: 0,
    sand: layer(w, c, t => t === T_SAND), stone: layer(w, c, t => t === T_STONE),
    water: layer(w, c, t => t >= T_SHALLOW, 0.5, 0.25), deep: layer(w, c, t => t === T_DEEP, 0.55, 0.3),
  };
}
/** Нарисовать поверхность чанка. Контекст уже переведён в координаты клеток чанка (1 ед. = 1 клетка). s — пикселей на клетку (для mip). */
export function drawGeo(c: CanvasRenderingContext2D, g: ChunkGeo, ch: Chunk, s: number, time: number, animate: boolean) {
  const P = (n: Parameters<typeof pattern>[1], ox = 0, oy = 0) => pattern(c, n, s, ox, oy);
  c.save(); const E = 0.04; c.beginPath(); c.rect(-E, -E, CHUNK + 2 * E, CHUNK + 2 * E); c.clip();
  const grass = P('grass'); c.fillStyle = grass || '#56703a'; c.fillRect(-E, -E, CHUNK + 2 * E, CHUNK + 2 * E);
  const land = (L: Layer, name: 'sand' | 'stone', col: string) => {
    if (!L.any) return; const p = P(name); c.fillStyle = p || col;
    c.globalAlpha = 0.55; c.fill(L.soft); c.globalAlpha = 1; c.fill(L.fill);
  };
  land(g.sand, 'sand', '#c4a86e'); land(g.stone, 'stone', '#857b6c');
  // макро-вариация против повторяемости
  const mac = P('macro', -ch.cx * CHUNK, -ch.cy * CHUNK);
  if (mac) { c.globalCompositeOperation = 'soft-light'; c.globalAlpha = 0.7; c.fillStyle = mac; c.fillRect(0, 0, CHUNK, CHUNK); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
  if (g.water.any) {
    // мокрый песок
    c.lineCap = 'round'; c.strokeStyle = 'rgba(40,30,15,.28)'; c.lineWidth = 0.9; c.stroke(g.water.edge);
    c.strokeStyle = 'rgba(40,30,15,.25)'; c.lineWidth = 0.45; c.stroke(g.water.edge);
    const sh = P('shallow'); c.fillStyle = sh || '#3f7898';
    c.globalAlpha = 0.6; c.fill(g.water.soft); c.globalAlpha = 1; c.fill(g.water.fill);
    if (g.deep.any) { const dp = P('deep'); c.fillStyle = dp || '#275475'; c.globalAlpha = 0.55; c.fill(g.deep.soft); c.globalAlpha = 0.92; c.fill(g.deep.fill); c.globalAlpha = 1; }
    // каустики: два слоя, движущиеся в разные стороны
    const t = animate ? time : 0;
    const k1 = P('caustics', t * 0.011, t * 0.007), k2 = P('caustics', -t * 0.008 + 3.3, t * 0.012 + 1.7);
    if (k1 && k2) {
      c.globalCompositeOperation = 'screen';
      c.globalAlpha = 0.11; c.fillStyle = k1; c.fill(g.water.fill); c.globalAlpha = 0.08; c.fillStyle = k2; c.fill(g.water.fill);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    }
    // пена у берега
    const foam = 0.32 + (animate ? Math.sin(time * 0.05) * 0.12 : 0);
    c.strokeStyle = `rgba(235,245,250,${foam})`; c.lineWidth = 0.14; c.stroke(g.water.edge);
    c.strokeStyle = `rgba(235,245,250,${foam * 0.4})`; c.lineWidth = 0.4; c.stroke(g.water.edge);
  }
  c.restore();
}
