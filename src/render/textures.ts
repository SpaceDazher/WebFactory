// Процедурные бесшовные текстуры 2048×2048 (15.1: «детализированные текстуры поверхности»).
// Генерируются при запуске в параллельных Web Worker'ах (без внешних файлов — игра остаётся одним HTML).
// Для каждой текстуры строится цепочка mip-уровней, рендер выбирает уровень под текущий масштаб.
export type TexName = 'grass' | 'sand' | 'stone' | 'shallow' | 'deep' | 'caustics' | 'metal' | 'grime' | 'macro' | 'dirt';
export const TEX_NAMES: TexName[] = ['grass', 'sand', 'stone', 'shallow', 'deep', 'caustics', 'metal', 'grime', 'dirt', 'macro'];
/** сколько клеток мира покрывает одна текстура */
export const TEX_TILES: Record<TexName, number> = { grass: 16, sand: 16, stone: 16, shallow: 16, deep: 16, caustics: 8, metal: 4, grime: 8, dirt: 16, macro: 160 };

// ---------- код воркера (самодостаточная функция, превращается в Blob) ----------
function workerMain() {
  const H = (x: number, y: number, s: number) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const fade = (t: number) => t * t * (3 - 2 * t);
  /** периодический value-noise: период P ячеек на всю текстуру */
  function vnoise(N: number, P: number, seed: number): Float32Array {
    const out = new Float32Array(N * N); const cell = N / P;
    const lat = new Float32Array(P * P); for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) lat[y * P + x] = H(x, y, seed);
    const X0 = new Int32Array(N), X1 = new Int32Array(N), TX = new Float32Array(N);
    for (let x = 0; x < N; x++) { const fx = x / cell, ix = Math.floor(fx); X0[x] = ix % P; X1[x] = (ix + 1) % P; TX[x] = fade(fx - ix); }
    for (let y = 0; y < N; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fade(fy - iy), r0 = (iy % P) * P, r1 = ((iy + 1) % P) * P, o = y * N;
      for (let x = 0; x < N; x++) {
        const x0 = X0[x], x1 = X1[x], tx = TX[x];
        const a = lat[r0 + x0], b = lat[r0 + x1], c = lat[r1 + x0], d = lat[r1 + x1];
        const top = a + (b - a) * tx, bot = c + (d - c) * tx;
        out[o + x] = top + (bot - top) * ty;
      }
    }
    return out;
  }
  function fbm(N: number, P0: number, oct: number, seed: number, gain = 0.5): Float32Array {
    const out = new Float32Array(N * N); let amp = 1, tot = 0, P = P0;
    for (let o = 0; o < oct && P <= N / 2; o++) { const n = vnoise(N, P, seed + o * 101); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= gain; P *= 2; }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  /** периодический шум Ворлея: F1 и F2 */
  function worley(N: number, P: number, seed: number): [Float32Array, Float32Array] {
    const f1 = new Float32Array(N * N), f2 = new Float32Array(N * N); const cell = N / P;
    const px = new Float32Array(P * P), py = new Float32Array(P * P);
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) { px[y * P + x] = H(x, y, seed); py[y * P + x] = H(x, y, seed + 7); }
    for (let y = 0; y < N; y++) {
      const cy = Math.floor(y / cell), ly = y / cell - cy;
      for (let x = 0; x < N; x++) {
        const cx = Math.floor(x / cell), lx = x / cell - cx; let d1 = 9, d2 = 9;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const gx = (cx + ox + P) % P, gy = (cy + oy + P) % P; const k = gy * P + gx;
          const dx = ox + px[k] - lx, dy = oy + py[k] - ly; const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        f1[y * N + x] = Math.sqrt(d1); f2[y * N + x] = Math.sqrt(d2);
      }
    }
    return [f1, f2];
  }
  const cl = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
  const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sat = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
  function gen(name: string, N: number): Uint8ClampedArray {
    const img = new Uint8ClampedArray(N * N * 4); const S = N / 2048; // масштаб для размеров деталей
    const put = (i: number, c: number[], a = 255) => { img[i * 4] = cl(c[0]); img[i * 4 + 1] = cl(c[1]); img[i * 4 + 2] = cl(c[2]); img[i * 4 + 3] = a; };
    const P = (base: number) => Math.max(2, Math.round(base * S) || 2); // период шума с учётом разрешения
    switch (name) {
      case 'grass': {
        const big = fbm(N, 4, 5, 11), mid = fbm(N, 32, 4, 23), fine = fbm(N, P(256), 2, 37, 0.6), blades = vnoise(N, P(512), 41);
        const [w1, w2] = worley(N, P(96), 53);
        const dark = [52, 78, 34], lite = [98, 128, 56], dry = [128, 126, 66], moss = [40, 70, 38];
        for (let i = 0; i < N * N; i++) {
          let c = mix(dark, lite, sat(big[i] * 1.4 - 0.2));
          c = mix(c, dry, sat((mid[i] - 0.58) * 3) * 0.6);
          c = mix(c, moss, sat((0.42 - mid[i]) * 3) * 0.5);
          const b = (blades[i] - 0.5) * 46 + (fine[i] - 0.5) * 30;
          const clover = w1[i] < 0.16 ? (0.16 - w1[i]) * 160 : 0; // мелкие кустики
          const edge = sat((w2[i] - w1[i]) * 6);
          put(i, [c[0] + b - clover * 0.4, c[1] + b * 1.15 + clover * 0.5 - (1 - edge) * 6, c[2] + b * 0.5 - clover * 0.3]);
        }
        break;
      }
      case 'sand': {
        const big = fbm(N, 4, 4, 61), warp = fbm(N, 8, 3, 67), grain = vnoise(N, P(1024), 71), g2 = vnoise(N, P(512), 73);
        const [w1] = worley(N, P(128), 79);
        const a = [176, 148, 98], b = [214, 188, 136];
        for (let i = 0; i < N * N; i++) {
          const x = i % N, y = (i / N) | 0;
          const rip = Math.sin((x / N * 2 * Math.PI) * 24 + (y / N * 2 * Math.PI) * 6 + warp[i] * 14) * 0.5 + 0.5;
          let c = mix(a, b, sat(big[i] * 1.3 - 0.15));
          const k = (rip - 0.5) * 16 + (grain[i] - 0.5) * 34 + (g2[i] - 0.5) * 18;
          const peb = w1[i] < 0.09 ? 1 : 0;
          c = peb ? mix(c, [130, 118, 100], 0.55 + grain[i] * 0.3) : c;
          put(i, [c[0] + k, c[1] + k * 0.95, c[2] + k * 0.8]);
        }
        break;
      }
      case 'stone': {
        const big = fbm(N, 4, 5, 83), mid = fbm(N, 16, 4, 89), grain = vnoise(N, P(1024), 97);
        const [w1, w2] = worley(N, 12, 101); const [v1, v2] = worley(N, P(48), 103);
        const a = [104, 98, 88], b = [150, 142, 128];
        for (let i = 0; i < N * N; i++) {
          let c = mix(a, b, sat(big[i] * 1.3 - 0.15 + (mid[i] - 0.5) * 0.4));
          const crack = sat(1 - (w2[i] - w1[i]) * 9); const crack2 = sat(1 - (v2[i] - v1[i]) * 12) * 0.5;
          const k = (grain[i] - 0.5) * 30 - crack * 48 - crack2 * 22 + (1 - w1[i]) * 10;
          c = mix(c, [120, 104, 82], sat(mid[i] - 0.55) * 1.2);
          put(i, [c[0] + k, c[1] + k, c[2] + k * 0.95]);
        }
        break;
      }
      case 'dirt': {
        const big = fbm(N, 4, 5, 107), grain = vnoise(N, P(1024), 109); const [w1] = worley(N, P(160), 113);
        const a = [74, 58, 42], b = [112, 90, 64];
        for (let i = 0; i < N * N; i++) {
          let c = mix(a, b, sat(big[i] * 1.4 - 0.2)); const k = (grain[i] - 0.5) * 36; const peb = w1[i] < 0.12 ? 18 : 0;
          put(i, [c[0] + k + peb, c[1] + k + peb, c[2] + k * 0.9 + peb]);
        }
        break;
      }
      case 'shallow': case 'deep': {
        const big = fbm(N, 4, 5, name === 'deep' ? 127 : 131), mid = fbm(N, 16, 4, 137);
        const a = name === 'deep' ? [20, 52, 84] : [44, 106, 128], b = name === 'deep' ? [34, 74, 110] : [70, 140, 156];
        for (let i = 0; i < N * N; i++) { const c = mix(a, b, sat(big[i] * 1.5 - 0.25)); const k = (mid[i] - 0.5) * 22; put(i, [c[0] + k * 0.5, c[1] + k, c[2] + k]); }
        break;
      }
      case 'caustics': {
        const [w1, w2] = worley(N, 10, 149); const [u1, u2] = worley(N, 16, 157); const warp = fbm(N, 8, 3, 151);
        for (let i = 0; i < N * N; i++) {
          const e = (w2[i] - w1[i]) + (warp[i] - 0.5) * 0.25, e2 = (u2[i] - u1[i]) - (warp[i] - 0.5) * 0.2;
          const v = Math.pow(sat(1 - e * 7), 3) * (0.4 + warp[i] * 0.8) * 0.75 + Math.pow(sat(1 - e2 * 9), 3) * 0.35;
          put(i, [220, 245, 255], sat(v) * 255);
        }
        break;
      }
      case 'metal': {
        const big = fbm(N, 4, 4, 157), streak = new Float32Array(N * N); const row = vnoise(N, P(1024), 163); const sc = vnoise(N, P(256), 167);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) streak[y * N + x] = row[((y * 7) % N) * N + ((x >> 4) % N)];
        for (let i = 0; i < N * N; i++) {
          const v = 128 + (big[i] - 0.5) * 50 + (streak[i] - 0.5) * 34 + (sc[i] > 0.93 ? 30 : 0) - (sc[i] < 0.05 ? 25 : 0);
          put(i, [v, v, v]);
        }
        break;
      }
      case 'grime': {
        const big = fbm(N, 8, 5, 173), sp = vnoise(N, P(512), 179);
        for (let i = 0; i < N * N; i++) { const a = sat((big[i] - 0.45) * 2.4) * 0.8 + (sp[i] > 0.8 ? 0.3 : 0); put(i, [40, 32, 24], a * 255); }
        break;
      }
      case 'macro': {
        const big = fbm(N, 2, 4, 191);
        for (let i = 0; i < N * N; i++) { const v = 128 + (big[i] - 0.5) * 150; put(i, [v, v * 1.02, v * 0.96]); }
        break;
      }
    }
    return img;
  }
  (self as any).onmessage = (ev: MessageEvent) => {
    const { name, N } = ev.data; const t0 = performance.now(); const img = gen(name, N);
    (self as any).postMessage({ name, N, buf: img.buffer, ms: performance.now() - t0 }, [img.buffer]);
  };
}

// ---------- главный поток ----------
interface Tex { mips: HTMLCanvasElement[]; } // mips[0] — полное разрешение
const TEX: Partial<Record<TexName, Tex>> = {};
let patCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
export let texReady = false; export let texSize = 0;
export function texQuality(): number { const v = +(localStorage.getItem('zavod7:tex') || 2048); return [512, 1024, 2048].includes(v) ? v : 2048; }
export function setTexQuality(n: number) { localStorage.setItem('zavod7:tex', String(n)); }

function buildMips(base: HTMLCanvasElement): HTMLCanvasElement[] {
  const m = [base]; let cur = base;
  while (cur.width > 128) {
    const n = document.createElement('canvas'); n.width = n.height = cur.width / 2;
    const x = n.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, n.width, n.height); m.push(n); cur = n;
  }
  return m;
}
/** Запуск генерации; onProgress(готово, всего) */
export async function generateTextures(N: number, onProgress: (done: number, total: number, name: string) => void): Promise<number> {
  const t0 = performance.now(); texReady = false; texSize = N; patCache = new WeakMap();
  for (const k of TEX_NAMES) delete TEX[k];
  const names = TEX_NAMES; let done = 0;
  const src = '(' + workerMain.toString() + ')()';
  let url: string | null = null; try { url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); } catch { url = null; }
  const nWorkers = Math.max(1, Math.min(names.length, (navigator.hardwareConcurrency || 4) - 1, 6));
  const queue = [...names];
  const finish = (name: TexName, n: number, buf: ArrayBuffer) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = n;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), n, n), 0, 0);
    TEX[name] = { mips: buildMips(cv) }; done++; onProgress(done, names.length, name);
  };
  const sizeOf = (name: TexName) => name === 'macro' ? Math.min(512, N) : name === 'metal' || name === 'grime' || name === 'caustics' ? Math.min(1024, N) : N;
  const runWorker = (w: Worker) => new Promise<void>(res => {
    const next = () => { const name = queue.shift(); if (!name) { w.terminate(); res(); return; } w.postMessage({ name, N: sizeOf(name) }); };
    w.onmessage = ev => { finish(ev.data.name, ev.data.N, ev.data.buf); next(); };
    w.onerror = () => { w.terminate(); res(); };
    next();
  });
  let workers: Worker[] = [];
  try { if (url) workers = Array.from({ length: nWorkers }, () => new Worker(url!)); } catch { workers = []; }
  if (workers.length) await Promise.all(workers.map(runWorker));
  // запасной путь (нет воркеров): генерация в основном потоке в пониженном разрешении
  const left = names.filter(n => !TEX[n]);
  if (left.length) {
    const fake: any = { postMessage: (d: any) => finish(d.name, d.N, d.buf) };
    new Function('self', src)(fake);
    for (const name of left) { await new Promise(r => setTimeout(r, 0)); fake.onmessage({ data: { name, N: Math.min(512, sizeOf(name)) } }); }
  }
  if (url) URL.revokeObjectURL(url);
  texReady = true;
  return performance.now() - t0;
}
/** Паттерн текстуры для контекста; s — пикселей на клетку (для выбора mip) */
export function pattern(c: CanvasRenderingContext2D, name: TexName, s: number, ox = 0, oy = 0): CanvasPattern | null {
  const t = TEX[name]; if (!t) return null;
  const tiles = TEX_TILES[name]; const want = s * tiles; // пикселей экрана на одну текстуру
  let L = 0; while (L + 1 < t.mips.length && t.mips[L + 1].width >= want) L++;
  let m = patCache.get(c); if (!m) patCache.set(c, m = new Map());
  const key = name + L; let p = m.get(key);
  if (!p) { p = c.createPattern(t.mips[L], 'repeat')!; m.set(key, p); }
  const k = tiles / t.mips[L].width; // единицы пользователя — клетки
  p.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  return p;
}
/** Паттерн в пиксельных координатах (для спрайтов, где 1 клетка = s пикселей) */
export function pixPattern(c: CanvasRenderingContext2D, name: TexName, s: number, ox = 0, oy = 0): CanvasPattern | null {
  const t = TEX[name]; if (!t) return null;
  const tiles = TEX_TILES[name]; const want = s * tiles;
  let L = 0; while (L + 1 < t.mips.length && t.mips[L + 1].width >= want) L++;
  let m = patCache.get(c); if (!m) patCache.set(c, m = new Map());
  const key = 'px' + name + L; let p = m.get(key);
  if (!p) { p = c.createPattern(t.mips[L], 'repeat')!; m.set(key, p); }
  const k = want / t.mips[L].width;
  p.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  return p;
}
export function texCanvas(name: TexName, minSize = 0): HTMLCanvasElement | null { const t = TEX[name]; if (!t) return null; let L = t.mips.length - 1; while (L > 0 && t.mips[L].width < minSize) L--; return t.mips[L]; }
