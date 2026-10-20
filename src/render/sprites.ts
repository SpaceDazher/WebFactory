// Спрайты высокого разрешения (256 px на клетку): руда, деревья, скалы, нефть. Рисуются один раз при запуске.
import { RNG } from '../core/rng';
import { shade } from './art';
type C = CanvasRenderingContext2D;
export const SPR = 256; // пикселей на клетку в исходнике спрайта
const mk = (w: number, h: number) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };

function rock(c: C, x: number, y: number, r: number, col: string, rng: RNG, gloss = 0.35, facet = 7) {
  // тень
  const sh = c.createRadialGradient(x + r * 0.25, y + r * 0.35, r * 0.2, x + r * 0.25, y + r * 0.35, r * 1.25);
  sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sh; c.beginPath(); c.arc(x + r * 0.25, y + r * 0.35, r * 1.25, 0, 7); c.fill();
  // многоугольник-камень
  const pts: [number, number][] = [];
  for (let i = 0; i < facet; i++) { const a = i / facet * Math.PI * 2 + rng.float() * 0.5; const rr = r * (0.75 + rng.float() * 0.3); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]); }
  const g = c.createLinearGradient(x - r, y - r, x + r, y + r); g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.45));
  c.fillStyle = g; c.beginPath(); pts.forEach(([px, py], i) => i ? c.lineTo(px, py) : c.moveTo(px, py)); c.closePath(); c.fill();
  c.strokeStyle = shade(col, -0.6); c.lineWidth = r * 0.06; c.stroke();
  // грани
  c.save(); c.clip();
  for (let i = 0; i < facet; i += 2) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % facet]; c.fillStyle = i % 4 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.16)'; c.beginPath(); c.moveTo(x - r * 0.1, y - r * 0.15); c.lineTo(ax, ay); c.lineTo(bx, by); c.closePath(); c.fill(); }
  const hl = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r * 0.7); hl.addColorStop(0, `rgba(255,255,255,${gloss})`); hl.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hl; c.fillRect(x - r, y - r, r * 2, r * 2);
  // крапинки
  for (let i = 0; i < 14; i++) { const a = rng.float() * 7, d = rng.float() * r * 0.8; c.fillStyle = rng.float() > 0.5 ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.22)'; c.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.06, r * 0.06); }
  c.restore();
}
const ORE_STYLE: Record<string, { col: string; vein?: string; gloss: number }> = {
  'iron-ore': { col: '#6f8399', vein: '#aac0d6', gloss: 0.4 },
  'copper-ore': { col: '#b0603a', vein: '#5fbf9a', gloss: 0.3 },
  'coal': { col: '#2a2a2e', vein: '#55585e', gloss: 0.55 },
  'stone': { col: '#a8987c', gloss: 0.25 },
  'uranium-ore': { col: '#7ab83a', vein: '#b6e873', gloss: 0.35 },
};
const oreCache = new Map<string, HTMLCanvasElement[]>();
/** 4 уровня богатства × 4 варианта */
export function oreSprite(item: string, rich: number, variant: number): HTMLCanvasElement {
  let arr = oreCache.get(item);
  if (!arr) {
    arr = []; const st = ORE_STYLE[item] || { col: '#888', gloss: 0.3 };
    for (let lvl = 0; lvl < 4; lvl++) for (let v = 0; v < 4; v++) {
      const cv = mk(SPR, SPR); const c = cv.getContext('2d')!; const rng = new RNG(lvl * 31 + v * 7 + item.length * 1013);
      // тёмное пятно грунта под рудой
      const tint = shade(st.col, -0.55); const tn = parseInt(tint.slice(4, -1).split(',').map(v => (+v).toString(16).padStart(2, '0')).join(''), 16);
      const gr = c.createRadialGradient(SPR / 2, SPR / 2, SPR * 0.1, SPR / 2, SPR / 2, SPR * 0.62); gr.addColorStop(0, `rgba(${tn >> 16},${(tn >> 8) & 255},${tn & 255},${0.4 + lvl * 0.1})`); gr.addColorStop(1, `rgba(${tn >> 16},${(tn >> 8) & 255},${tn & 255},0)`);
      c.fillStyle = gr; c.fillRect(0, 0, SPR, SPR);
      const n = 2 + lvl;
      const rocks: [number, number, number][] = [];
      for (let i = 0; i < n; i++) rocks.push([SPR * (0.25 + rng.float() * 0.5), SPR * (0.25 + rng.float() * 0.5), SPR * (0.13 + rng.float() * 0.08 + (i === 0 ? 0.06 : 0))]);
      rocks.sort((a, b) => a[1] - b[1]);
      for (const [x, y, r] of rocks) {
        rock(c, x, y, r, shade(st.col, (rng.float() - 0.5) * 0.25), rng, st.gloss, 6 + rng.int(3));
        if (st.vein) { c.strokeStyle = st.vein; c.globalAlpha = 0.75; c.lineWidth = r * 0.09; c.beginPath(); c.moveTo(x - r * 0.4, y - r * 0.1); c.quadraticCurveTo(x, y + r * 0.2 * (rng.float() - 0.5), x + r * 0.45, y + r * 0.05); c.stroke(); c.globalAlpha = 1; }
      }
      arr.push(cv);
    }
    oreCache.set(item, arr);
  }
  return arr[Math.min(3, rich) * 4 + (variant & 3)];
}
const treeCache: HTMLCanvasElement[] = []; const treeShadow: HTMLCanvasElement[] = [];
/** Дерево: спрайт 2×2.5 клетки, точка опоры — низ ствола в (1, 2.1) клетки */
export function treeSprite(v: number): { img: HTMLCanvasElement; shadow: HTMLCanvasElement } {
  if (!treeCache.length) for (let k = 0; k < 6; k++) {
    const W = SPR * 2, H = SPR * 2.5; const cv = mk(W, H); const c = cv.getContext('2d')!; const rng = new RNG(900 + k * 17);
    const bx = W / 2, by = SPR * 2.1;
    // ствол
    const tg = c.createLinearGradient(bx - 12, 0, bx + 12, 0); tg.addColorStop(0, '#3a2614'); tg.addColorStop(0.5, '#6b4a2a'); tg.addColorStop(1, '#2e1e10');
    c.fillStyle = tg; c.beginPath(); c.moveTo(bx - 20, by); c.lineTo(bx - 11, by - SPR * 0.6); c.lineTo(bx + 11, by - SPR * 0.6); c.lineTo(bx + 20, by); c.closePath(); c.fill();
    // крона: слои шаров
    const hue = [[38, 78, 34], [46, 88, 38], [58, 96, 40], [34, 70, 40], [64, 90, 36], [44, 82, 46]][k];
    const cy = by - SPR * 0.95; const R = SPR * (0.72 + rng.float() * 0.14);
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < 30; i++) { const a = rng.float() * Math.PI * 2, d = rng.float() * R * 0.6; blobs.push([bx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, R * (0.3 + rng.float() * 0.22)]); }
    blobs.sort((a, b) => a[1] - b[1]);
    for (const [x, y, r] of blobs) {
      const lit = 1 - (y - (cy - R)) / (2 * R);
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      const f = (m: number) => `rgb(${hue[0] * m | 0},${hue[1] * m | 0},${hue[2] * m | 0})`;
      g.addColorStop(0, f(1.35 + lit * 0.4)); g.addColorStop(0.7, f(0.95 + lit * 0.2)); g.addColorStop(1, f(0.55));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    // листья-крапинки
    for (let i = 0; i < 700; i++) {
      const a = rng.float() * Math.PI * 2, d = Math.sqrt(rng.float()) * R * 0.95; const x = bx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.85;
      const up = (cy - y) / R; c.fillStyle = up > 0.1 && rng.float() > 0.4 ? `rgba(190,230,140,${0.25 + up * 0.2})` : 'rgba(10,30,10,.28)';
      c.beginPath(); c.ellipse(x, y, 4 + rng.float() * 4, 2.5 + rng.float() * 2, rng.float() * 3, 0, 7); c.fill();
    }
    treeCache.push(cv);
    const sh = mk(W, H); const s2 = sh.getContext('2d')!; const sg = s2.createRadialGradient(bx + SPR * 0.35, by - SPR * 0.1, 0, bx + SPR * 0.35, by - SPR * 0.1, R * 1.05);
    sg.addColorStop(0, 'rgba(0,0,0,.42)'); sg.addColorStop(0.7, 'rgba(0,0,0,.25)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    s2.fillStyle = sg; s2.beginPath(); s2.ellipse(bx + SPR * 0.35, by - SPR * 0.1, R * 1.05, R * 0.6, 0, 0, 7); s2.fill(); treeShadow.push(sh);
  }
  return { img: treeCache[v % 6], shadow: treeShadow[v % 6] };
}
const rockCache: HTMLCanvasElement[] = [];
export function rockSprite(v: number): HTMLCanvasElement {
  if (!rockCache.length) for (let k = 0; k < 4; k++) {
    const cv = mk(SPR * 1.5, SPR * 1.5); const c = cv.getContext('2d')!; const rng = new RNG(500 + k * 13); const S = SPR * 1.5;
    rock(c, S * 0.5, S * 0.52, S * 0.33, ['#8b8378', '#7d776e', '#968c7c', '#857f78'][k], rng, 0.3, 9);
    rock(c, S * (0.28 + rng.float() * 0.1), S * 0.66, S * 0.14, '#8a8172', rng, 0.25, 7);
    if (k % 2) rock(c, S * 0.72, S * 0.7, S * 0.12, '#90887a', rng, 0.25, 6);
    // мох
    for (let i = 0; i < 60; i++) { const a = rng.float() * 7, d = rng.float() * S * 0.3; c.fillStyle = 'rgba(80,110,50,.35)'; c.beginPath(); c.arc(S * 0.5 + Math.cos(a) * d, S * 0.4 + Math.sin(a) * d * 0.5, 3 + rng.float() * 4, 0, 7); c.fill(); }
    rockCache.push(cv);
  }
  return rockCache[v & 3];
}
let oilSpr: HTMLCanvasElement | null = null;
export function oilSprite(): HTMLCanvasElement {
  if (oilSpr) return oilSpr;
  const S = SPR * 2; const cv = mk(S, S); const c = cv.getContext('2d')!; const rng = new RNG(77);
  const g = c.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.48); g.addColorStop(0, 'rgba(10,6,12,.95)'); g.addColorStop(0.55, 'rgba(25,18,28,.85)'); g.addColorStop(1, 'rgba(25,18,28,0)');
  c.fillStyle = g; c.beginPath(); for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, r = S * (0.36 + rng.float() * 0.12); c.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } c.closePath(); c.fill();
  // радужные разводы
  for (let i = 0; i < 5; i++) { const hue = 180 + i * 40; c.strokeStyle = `hsla(${hue},70%,60%,.18)`; c.lineWidth = 6; c.beginPath(); c.ellipse(S / 2 + (rng.float() - 0.5) * 30, S / 2 + (rng.float() - 0.5) * 30, S * (0.12 + i * 0.04), S * (0.08 + i * 0.03), rng.float(), 0, 5); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.ellipse(S * 0.42, S * 0.42, S * 0.07, S * 0.03, -0.5, 0, 7); c.fill();
  oilSpr = cv; return cv;
}
