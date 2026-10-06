// Пакетный рендер спрайтов (14.1/14.7): процедурные рисунки один раз растеризуются в атлас,
// а каждый кадр рисуются готовые прямоугольники — одним вызовом WebGL2 (массив текстур)
// или drawImage из страниц атласа на Canvas2D, если WebGL2 нет.
export type Raster = (c: CanvasRenderingContext2D) => void;
interface Slot { page: number; x: number; y: number; w: number; h: number; used: number; }
const PAGE = 2048, GAP = 2;

/** Атлас: страницы 2048², полочная упаковка, вытеснение целой страницы по давности использования */
class Atlas {
  slots = new Map<string, Slot>(); byBase = new Map<string, string>();
  pages: { shelves: { y: number; h: number; x: number }[]; top: number; used: number; keys: string[] }[] = [];
  frame = 0; rastMs = 0; rastN = 0; evictions = 0; budgetMs = 8;
  constructor(public maxPages: number, private store: (p: number, x: number, y: number, w: number, h: number, r: Raster) => void, private clearPage: (p: number) => void) {}
  private alloc(w: number, h: number): Slot | null {
    for (let p = 0; p < this.pages.length; p++) { const s = this.place(p, w, h); if (s) return s; }
    if (this.pages.length < this.maxPages) { this.pages.push({ shelves: [], top: 0, used: this.frame, keys: [] }); return this.place(this.pages.length - 1, w, h); }
    // вытесняем самую давно использованную страницу (но не использованную в этом кадре)
    let best = -1, bu = Infinity; for (let p = 0; p < this.pages.length; p++) if (this.pages[p].used < bu) { bu = this.pages[p].used; best = p; }
    if (best < 0 || bu >= this.frame) return null;
    const pg = this.pages[best]; for (const k of pg.keys) this.slots.delete(k); pg.keys = []; pg.shelves = []; pg.top = 0; this.clearPage(best); this.evictions++;
    return this.place(best, w, h);
  }
  private place(p: number, w: number, h: number): Slot | null {
    const pg = this.pages[p]; if (w > PAGE || h > PAGE) return null;
    for (const sh of pg.shelves) if (h <= sh.h && h >= sh.h * .6 && sh.x + w <= PAGE) { const s = { page: p, x: sh.x, y: sh.y, w, h, used: this.frame }; sh.x += w + GAP; return s; }
    if (pg.top + h > PAGE) return null;
    const sh = { y: pg.top, h, x: w + GAP }; pg.shelves.push(sh); pg.top += h + GAP; return { page: p, x: 0, y: sh.y, w, h, used: this.frame };
  }
  /** найти или растеризовать спрайт; base — ключ без кадра/разрешения (для замены, если бюджет кадра исчерпан) */
  get(key: string, base: string, w: number, h: number, r: Raster, force = false): Slot | null {
    let s = this.slots.get(key);
    if (s && !force) { s.used = this.frame; this.pages[s.page].used = this.frame; return s; }
    if (!s && this.rastMs > this.budgetMs) { const k2 = this.byBase.get(base); const s2 = k2 ? this.slots.get(k2) : undefined; if (s2) { s2.used = this.frame; this.pages[s2.page].used = this.frame; } return s2 || null; }
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    if (!s || s.w < w || s.h < h) { s = this.alloc(w, h) || undefined; if (!s) return null; this.slots.set(key, s); this.pages[s.page].keys.push(key); }
    const t0 = performance.now(); this.store(s.page, s.x, s.y, s.w, s.h, r); this.rastMs += performance.now() - t0; this.rastN++;
    this.byBase.set(base, key); s.used = this.frame; this.pages[s.page].used = this.frame; return s;
  }
  begin() { this.frame++; this.rastMs = 0; this.rastN = 0; }
}

export interface Batch {
  kind: 'webgl' | 'canvas';
  atlas: Atlas; quads: number;
  begin(W: number, H: number): void;
  /** спрайт key размером w×h пикселей атласа, нарисовать в прямоугольник (dx,dy,dw,dh) экрана */
  sprite(key: string, base: string, w: number, h: number, r: Raster, dx: number, dy: number, dw: number, dh: number, alpha?: number, force?: boolean): boolean;
  rect(x: number, y: number, w: number, h: number, rgba: number): void;
  line(x0: number, y0: number, x1: number, y1: number, width: number, rgba: number): void;
  end(): void;
}
export const rgba = (hex: string, a = 1) => { const n = parseInt(hex.slice(1), 16); const r = hex.length === 4 ? ((n >> 8) & 15) * 17 : (n >> 16) & 255, g = hex.length === 4 ? ((n >> 4) & 15) * 17 : (n >> 8) & 255, b = hex.length === 4 ? (n & 15) * 17 : n & 255; return ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0; };
const css = (c: number) => `rgba(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255},${((c >>> 24) / 255).toFixed(3)})`;

/** Canvas2D: страницы атласа — обычные холсты, рисуем drawImage */
export class CanvasBatch implements Batch {
  kind = 'canvas' as const; atlas: Atlas; quads = 0; pages: HTMLCanvasElement[] = [];
  constructor(public ctx: CanvasRenderingContext2D) {
    this.atlas = new Atlas(6, (p, x, y, w, h, r) => {
      while (this.pages.length <= p) { const cv = document.createElement('canvas'); cv.width = cv.height = PAGE; this.pages.push(cv); }
      const c = this.pages[p].getContext('2d')!; c.save(); c.clearRect(x, y, w, h); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); r(c); c.restore();
    }, p => { this.pages[p]?.getContext('2d')!.clearRect(0, 0, PAGE, PAGE); });
  }
  begin() { this.atlas.begin(); this.quads = 0; }
  sprite(key: string, base: string, w: number, h: number, r: Raster, dx: number, dy: number, dw: number, dh: number, alpha = 1, force = false) {
    const s = this.atlas.get(key, base, w, h, r, force); if (!s) return false;
    const c = this.ctx; if (alpha !== 1) c.globalAlpha = alpha;
    c.drawImage(this.pages[s.page], s.x, s.y, w, h, dx, dy, dw, dh); if (alpha !== 1) c.globalAlpha = 1; this.quads++; return true;
  }
  rect(x: number, y: number, w: number, h: number, c: number) { this.ctx.fillStyle = css(c); this.ctx.fillRect(x, y, w, h); this.quads++; }
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: number) { const x = this.ctx; x.strokeStyle = css(c); x.lineWidth = width; x.lineCap = 'round'; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); this.quads++; }
  end() {}
}

const VS = `#version 300 es
in vec2 aPos; in vec3 aUV; in vec4 aCol; uniform vec2 uView; out vec3 vUV; out vec4 vCol;
void main() { vUV = aUV; vCol = aCol; gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; precision mediump sampler2DArray; uniform sampler2DArray uTex; in vec3 vUV; in vec4 vCol; out vec4 o;
void main() { o = texture(uTex, vUV) * vCol; }`;

/** WebGL2: все страницы атласа — слои одной TEXTURE_2D_ARRAY, весь средний слой — один drawElements */
export class GLBatch implements Batch {
  kind = 'webgl' as const; atlas: Atlas; quads = 0;
  gl: WebGL2RenderingContext; prog: WebGLProgram; tex: WebGLTexture; vbo: WebGLBuffer; ibo: WebGLBuffer; uView: WebGLUniformLocation;
  f32 = new Float32Array(4 * 7 * 4096); u32 = new Uint32Array(this.f32.buffer); n = 0; idxCap = 0;
  tmp = document.createElement('canvas'); W = 1; H = 1; drawMs = 0; layers: number;
  /** программная реализация (SwiftShader, llvmpipe): WebGL есть, но рисует процессор — Canvas2D-атлас тогда быстрее */
  static isSoftware(gl: WebGL2RenderingContext) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); return /swiftshader|llvmpipe|software|softpipe|basic render/i.test(r); }
  static create(cv: HTMLCanvasElement): GLBatch | null {
    try { const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false }); return gl ? new GLBatch(gl) : null; } catch { return null; }
  }
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV'); gl.bindAttribLocation(p, 2, 'aCol'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    this.prog = p; this.uView = gl.getUniformLocation(p, 'uView')!;
    this.layers = Math.max(2, Math.min(8, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)));
    this.tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, PAGE, PAGE, this.layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.vbo = gl.createBuffer()!; this.ibo = gl.createBuffer()!;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 28, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const tmpc = this.tmp.getContext('2d', { willReadFrequently: false })!; void tmpc;
    this.atlas = new Atlas(this.layers, (pg, x, y, w, h, r) => {
      const t = this.tmp; if (t.width < w || t.height < h) { t.width = Math.max(t.width, w); t.height = Math.max(t.height, h); }
      const c = t.getContext('2d')!; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip(); r(c); c.restore();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, pg, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, c.getImageData(0, 0, w, h));
    }, pg => { const z = new Uint8Array(PAGE * 64 * 4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex); for (let y = 0; y < PAGE; y += 64) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, y, pg, PAGE, 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, z); });
    // белый пиксель для сплошных прямоугольников и линий
    this.white = this.atlas.get('#white', '#white', 4, 4, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 4); })!;
  }
  white: Slot;
  begin(W: number, H: number) {
    this.atlas.begin(); this.n = 0; this.quads = 0; this.W = W; this.H = H;
    const gl = this.gl; const cv = gl.canvas as HTMLCanvasElement; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.atlas.get('#white', '#white', 4, 4, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 4); });
  }
  private grow() { const f = new Float32Array(this.f32.length * 2); f.set(this.f32); this.f32 = f; this.u32 = new Uint32Array(f.buffer); }
  private quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, u0: number, v0: number, u1: number, v1: number, layer: number, col: number) {
    if ((this.n + 1) * 28 > this.f32.length) this.grow();
    const f = this.f32, u = this.u32; let o = this.n * 28;
    f[o] = x0; f[o + 1] = y0; f[o + 2] = u0; f[o + 3] = v0; f[o + 4] = layer; u[o + 6] = col; o += 7;
    f[o] = x1; f[o + 1] = y1; f[o + 2] = u1; f[o + 3] = v0; f[o + 4] = layer; u[o + 6] = col; o += 7;
    f[o] = x2; f[o + 1] = y2; f[o + 2] = u1; f[o + 3] = v1; f[o + 4] = layer; u[o + 6] = col; o += 7;
    f[o] = x3; f[o + 1] = y3; f[o + 2] = u0; f[o + 3] = v1; f[o + 4] = layer; u[o + 6] = col;
    this.n++; this.quads++;
  }
  sprite(key: string, base: string, w: number, h: number, r: Raster, dx: number, dy: number, dw: number, dh: number, alpha = 1, force = false) {
    const s = this.atlas.get(key, base, w, h, r, force); if (!s) return false;
    const u0 = s.x / PAGE, v0 = s.y / PAGE, u1 = (s.x + Math.ceil(w)) / PAGE, v1 = (s.y + Math.ceil(h)) / PAGE;
    const a = Math.round(alpha * 255); const col = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0; // премультиплицированный белый
    this.quad(dx, dy, dx + dw, dy, dx + dw, dy + dh, dx, dy + dh, u0, v0, u1, v1, s.page, col); return true;
  }
  private solid(c: number) { const a = (c >>> 24) / 255; return (((c >>> 24) << 24) | (Math.round(((c >> 16) & 255) * a) << 16) | (Math.round(((c >> 8) & 255) * a) << 8) | Math.round((c & 255) * a)) >>> 0; }
  rect(x: number, y: number, w: number, h: number, c: number) { const s = this.white, u = (s.x + 2) / PAGE, v = (s.y + 2) / PAGE; this.quad(x, y, x + w, y, x + w, y + h, x, y + h, u, v, u, v, s.page, this.solid(c)); }
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: number) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * width / 2, ny = dx / L * width / 2, ex = dx / L * width / 2, ey = dy / L * width / 2;
    const s = this.white, u = (s.x + 2) / PAGE, v = (s.y + 2) / PAGE;
    this.quad(x0 + nx - ex, y0 + ny - ey, x1 + nx + ex, y1 + ny + ey, x1 - nx + ex, y1 - ny + ey, x0 - nx - ex, y0 - ny - ey, u, v, u, v, s.page, this.solid(c));
  }
  end() {
    const gl = this.gl; const t0 = performance.now();
    gl.viewport(0, 0, this.W, this.H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n) {
      if (this.idxCap < this.n) { let cap = Math.max(4096, this.idxCap); while (cap < this.n) cap *= 2; const idx = new Uint32Array(cap * 6); for (let i = 0; i < cap; i++) { const b = i * 4, o = i * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; } gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); this.idxCap = cap; }
      gl.useProgram(this.prog); gl.uniform2f(this.uView, this.W, this.H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.f32.subarray(0, this.n * 28), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_INT, 0);
    }
    this.drawMs = performance.now() - t0;
  }
}
