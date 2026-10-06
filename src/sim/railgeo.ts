// v1.7: геометрия рельсов — фиксированный набор кусков на решётке узлов 2×2 (как в Factorio, без произвольных дуг).
// Узлы — углы клеток с чётными координатами. Направления 0..7: С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ.
// Прямой кусок (straight-rail): вариант 0..3 — направление С / СВ / В / ЮВ, длина 2 клетки (диагональ — 2√2).
// Кривой кусок (curved-rail): вариант 0..7 — из прямого направления h = 2·(v>>1) поворот на 45° вправо (v чётный)
// или влево (v нечётный): 10 клеток вперёд и 4 вбок, радиус дуги ≈ 13,7 клетки (короткая прямая + дуга).
// Все числа считаются только сложением, умножением, делением и корнем — одинаково во всех браузерах (детерминизм).
export const UX = [0, 1, 1, 1, 0, -1, -1, -1], UY = [-1, -1, 0, 1, 1, 1, 0, -1];
/** длина в единицах: 1 клетка = 1000 */
export const U = 1000;
export interface RailShape {
  proto: string; v: number; curve: boolean;
  /** ломаная оси (клетки, от узла-якоря), накопленная длина (единицы) */
  pts: number[]; cum: number[]; len: number;
  /** клетки под рельсом (от якоря) */ cells: [number, number][];
  /** якорь относительно левого верхнего угла рамки; размер рамки */ ox: number; oy: number; w: number; h: number;
  /** концы: [dx, dy] от якоря и направление движения: h0 — выезд из якоря (проход 0), h1 — направление в конце прохода 0 */
  b: [number, number]; h0: number; h1: number;
}
const SQ = Math.SQRT1_2;
function mkShape(proto: string, v: number, pts: number[], h0: number, h1: number): RailShape {
  const cum = [0]; for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.sqrt((pts[i] - pts[i - 2]) ** 2 + (pts[i + 1] - pts[i - 1]) ** 2) * U);
  const len = Math.ceil(cum[cum.length - 1] - 1e-6);
  const b: [number, number] = [Math.round(pts[pts.length - 2]), Math.round(pts[pts.length - 1])];
  pts[pts.length - 2] = b[0]; pts[pts.length - 1] = b[1];
  // клетки: центр ближе 1 клетки к оси; у прямых — проекция на отрезок (диагонали на стыках делят по две клетки)
  const cells: [number, number][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  for (let cy = Math.floor(y0) - 2; cy <= Math.ceil(y1) + 1; cy++) for (let cx = Math.floor(x0) - 2; cx <= Math.ceil(x1) + 1; cx++) {
    const px = cx + .5, py = cy + .5; let ok = false;
    if (pts.length === 4) {
      const dx = pts[2], dy = pts[3], L2 = dx * dx + dy * dy, t = (px * dx + py * dy) / L2, perp = Math.abs(px * dy - py * dx) / Math.sqrt(L2);
      ok = t >= -1e-9 && t <= 1 + 1e-9 && perp < 1 - 1e-9;
    } else for (let i = 0; i + 2 < pts.length && !ok; i += 2) {
      const ax = pts[i], ay = pts[i + 1], dx = pts[i + 2] - ax, dy = pts[i + 3] - ay, L2 = dx * dx + dy * dy;
      let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - px, qy = ay + dy * t - py; ok = qx * qx + qy * qy < 0.9 * 0.9;
    }
    if (ok) cells.push([cx, cy]);
  }
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const [x, y] of cells) { mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x); My = Math.max(My, y); }
  return { proto, v, curve: proto === 'curved-rail', pts, cum, len, cells, ox: 0 - mx || 0, oy: 0 - my || 0, w: Mx - mx + 1, h: My - my + 1, b, h0, h1 };
}
export const CURVE_R = 4 / (1 - SQ);
function curvePts(h: number, right: boolean): number[] {
  const s = right ? (h + 2) % 8 : (h + 6) % 8, s0 = 10 - CURVE_R * SQ, N = 16, tm = Math.SQRT2 - 1;
  const loc: number[] = [0, 0, s0, 0];
  for (let k = 1; k <= N; k++) { const t = tm * k / N, d = 1 + t * t; loc.push(s0 + CURVE_R * (2 * t / d), CURVE_R * (1 - (1 - t * t) / d)); }
  const out: number[] = [];
  for (let i = 0; i < loc.length; i += 2) { const f = loc[i], q = loc[i + 1]; out.push(f * UX[h] + q * UX[s], f * UY[h] + q * UY[s]); }
  return out;
}
export const SHAPES: Record<string, RailShape[]> = {
  'straight-rail': [0, 1, 2, 3].map(h => mkShape('straight-rail', h, [0, 0, 2 * UX[h], 2 * UY[h]], h, h)),
  'curved-rail': [0, 1, 2, 3, 4, 5, 6, 7].map(v => { const h = 2 * (v >> 1), r = (v & 1) === 0; return mkShape('curved-rail', v, curvePts(h, r), h, r ? (h + 1) % 8 : (h + 7) % 8); }),
};
export const isRailProto = (p: string) => p === 'straight-rail' || p === 'curved-rail';
export const shapeOf = (proto: string, v: number): RailShape => SHAPES[proto][v & (proto === 'curved-rail' ? 7 : 3)];
/** якорь (узел) рельса по рамке */
export const anchorOf = (proto: string, x: number, y: number, v: number): [number, number] => { const s = shapeOf(proto, v); return [x + s.ox, y + s.oy]; };
/** рамка по якорю */
export const boxOf = (proto: string, ax: number, ay: number, v: number): [number, number, number, number] => { const s = shapeOf(proto, v); return [ax - s.ox, ay - s.oy, s.w, s.h]; };
/** точка оси на расстоянии d (единицы) от якоря: [x, y, угол направления (рад, 0 — восток)] — для рендера и попаданий */
export function pointOn(s: RailShape, d: number): [number, number, number] {
  const c = s.cum, p = s.pts; if (d <= 0) d = 0; if (d >= s.len) d = s.len;
  let i = 1; while (i < c.length - 1 && c[i] < d) i++;
  const seg = c[i] - c[i - 1] || 1, t = Math.min(1, (d - c[i - 1]) / seg);
  const ax = p[2 * i - 2], ay = p[2 * i - 1], bx = p[2 * i], by = p[2 * i + 1];
  return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
}
/** поворот направления h на 45° (k = ±1) */
export const rot8 = (h: number, k: number) => ((h + k) % 8 + 8) % 8;
/** поворот варианта рельса на 90° по часовой (чертежи) */
export function rotVariant(proto: string, v: number, q: number): number {
  q = ((q % 4) + 4) % 4; if (!q) return v;
  if (proto === 'straight-rail') return (v + 2 * q) % 4; // С→В→Ю(=С)…: 0→2→0, 1(СВ)→3(ЮВ)→1
  const h = 2 * (v >> 1), r = v & 1; return ((h + 2 * q) % 8) + r;
}
/** отражение варианта: horiz — слева направо (x → −x), иначе сверху вниз */
export function mirrorVariant(proto: string, v: number, horiz: boolean): number {
  const m = (h: number) => horiz ? (8 - h) % 8 : (12 - h) % 8;
  if (proto === 'straight-rail') return m(v) % 4;
  const h = 2 * (v >> 1), r = v & 1; return m(h) + (1 - r);
}
