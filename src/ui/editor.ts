// v1.15: редактор карт. Полноэкранный; рисует на 2D-холсте (не трогает игровую отрисовку и симуляцию — партия на паузе).
// Модель: правки поверх генерации (или чистой карты) хранятся по клеткам, при сохранении сворачиваются в строки (Scenario.map.edits).
import { genFormHtml, readGen, refreshGenForm } from './genform';
import { GEN_LEGACY_VER, GEN_VER, GenSet, World } from '../sim/world';
import { Scenario, newScenario, checkScenario, canonScn, scnToText, parseScnText, GOAL_KINDS, goalText, NEST_PROTOS, ScnGoal, SCN_LIMITS } from '../sim/scenario';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { TECH_LIST, TECHS } from '../data/techs';
import { tr } from '../core/i18n';
import { BIO_V117_SOURCES } from '../data/biomaterials';
import { emptyScenarioBiology, hasScenarioBiology, type ScenarioBiology } from '../sim/scenario117';
import { UNITS } from '../sim/enemies';

const esc = (s: any) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const K = (x: number, y: number) => (x + 8192) * 16384 + (y + 8192);
const KX = (k: number) => Math.floor(k / 16384) - 8192, KY = (k: number) => (k % 16384) - 8192;
const TCOL = ['#4f7a3a', '#c9b36b', '#7d7d78', '#3f78a8', '#254a73'], TNAME = ['Трава', 'Песок', 'Камень', 'Мелкая вода', 'Глубокая вода'];
const RCOL = ['', '#7aa0c8', '#d8814a', '#262626', '#c8c8b8', '#8a3aa0', '#7ab83a'], RNAME = ['', 'Железо', 'Медь', 'Уголь', 'Камень', 'Нефть', 'Уран'];
const DCOL = ['', '#2d5a28', '#8b8b86'];
const newId = () => 'u-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const TRGB = TCOL.map(hex), RRGB = RCOL.map(c => c ? hex(c) : [0, 0, 0]), DRGB = DCOL.map(c => c ? hex(c) : [0, 0, 0]);
type Tool = 'terrain' | 'res' | 'decor' | 'nest' | 'ent' | 'ally' | 'enemy' | 'start' | 'reset' | 'pan';
type Tab = 'info' | 'map' | 'rules' | 'biology' | 'goals' | 'script';
const BAN_TYPES: [string, string][] = [['belt', 'Конвейеры'], ['underground', 'Подземные конвейеры'], ['splitter', 'Разветвители'], ['inserter', 'Манипуляторы'], ['rail', 'Рельсы'], ['loco', 'Локомотивы'], ['wagon', 'Вагоны'], ['stop', 'Станции'], ['signal', 'Светофоры'], ['roboport', 'Робопорты'], ['turret', 'Турели'], ['wall', 'Стены'], ['solar', 'Солнечные панели'], ['boiler', 'Бойлеры'], ['engine', 'Двигатели и генераторы'], ['assembler', 'Сборщики и заводы'], ['drill', 'Буры'], ['pumpjack', 'Нефтяные качалки'], ['lab', 'Лаборатории'], ['silo', 'Ракетная шахта']];
const ITEM_LIST = () => Object.values(ITEMS).filter(i => !(i as any).virtual).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const PROTO_LIST = () => Object.values(PROTOS).filter(p => p.buildable !== false && !['nest', 'rail', 'loco', 'wagon'].includes(p.type)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
export interface EdHooks {
  play(s: Scenario): void; closed(): void; download(name: string, text: string): void; pickFile(accept: string): Promise<string | null>; msg(t: string): void;
  saveStore(s: Scenario): Promise<void>; setPaused(p: boolean): void;
}
export class MapEditor {
  private biology: ScenarioBiology = emptyScenarioBiology();
  private allySpecies = 'small';
  private root: HTMLElement; private cv: HTMLCanvasElement; private cx2: CanvasRenderingContext2D; private side: HTMLElement; private bar: HTMLElement; private status: HTMLElement;
  isOpen = false;
  // модель
  private name = 'Моя карта'; private id = 'my-map'; private desc = ''; private author = ''; private seed = 1; private base: 'gen' | 'blank' = 'gen'; private bounds: { w: number; h: number } | null = null;
  private T = new Map<number, number>(); private R = new Map<number, [number, number]>(); private D = new Map<number, number>();
  private nests: { x: number; y: number; proto: string }[] = []; private ents: { proto: string; x: number; y: number; dir: number; recipe?: string | null }[] = []; private start = { x: 0, y: 0, w: 8, h: 8 };
  private rules!: Scenario['rules']; private goals: ScnGoal[] = []; private script = ''; private ver = 1; private gen: GenSet | null = null; private genv = GEN_VER;
  private techOn = new Set<string>(); private techAll = true; private techPre = new Set<string>(); private techQ = '';
  // вид и инструмент
  private v = { cx: 0, cy: 0, z: 6 }; private tool: Tool = 'terrain'; private tab: Tab = 'info';
  private p = { terrain: 0, res: 1, amt: 2500, grad: true, decor: 1, nest: 'biter-spawner', ent: 'wooden-chest', dir: 0, size: 3, circle: true };
  private world: World | null = null; private wseed = -1;
  private hover: [number, number] | null = null; private down: 'paint' | 'pan' | null = null; private last: [number, number] | null = null; private pan = { x: 0, y: 0, cx: 0, cy: 0 };
  private cur: [number, number, any][] | null = null; private undo: [number, number, any][][] = []; private redo: [number, number, any][][] = []; // слой: 0 T, 1 R, 2 D
  private raf = 0; private dirty = true; private info = '';
  constructor(private h: EdHooks) {
    this.rules = newScenario().rules; this.goals = [{ k: 'rocket', n: 1 }];
    const r = document.createElement('div'); r.id = 'editor'; r.style.display = 'none';
    r.innerHTML = '<div class="edbar"></div><div class="edmain"><canvas class="edcv"></canvas><div class="edside"></div></div><div class="edstatus"></div>';
    document.body.appendChild(r); this.root = r;
    this.cv = r.querySelector('canvas')!; this.cx2 = this.cv.getContext('2d')!; this.side = r.querySelector('.edside')!; this.bar = r.querySelector('.edbar')!; this.status = r.querySelector('.edstatus')!;
    this.bindCanvas(); this.bindUI();
    window.addEventListener('keydown', ev => { if (!this.isOpen) return; this.onKey(ev); }, true);
    window.addEventListener('keyup', ev => { if (this.isOpen) ev.stopImmediatePropagation(); }, true);
    window.addEventListener('resize', () => { if (this.isOpen) this.resize(); });
  }
  // ---------- открытие и закрытие ----------
  open(s?: Scenario) {
    if (s) this.load(s); else if (!this.world && this.T.size === 0 && !this.nests.length) this.fresh();
    this.isOpen = true; this.root.style.display = 'flex'; this.h.setPaused(true); this.resize(); this.renderBar(); this.renderSide(); this.dirty = true; this.loop();
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.root.style.display = 'none'; cancelAnimationFrame(this.raf); this.h.setPaused(false); void this.h.saveStore(this.build()).catch(() => { /* хранилище недоступно */ }); this.h.closed(); }
  private fresh() { this.load(newScenario(newId(), 'Моя карта')); }
  private loop = () => { if (!this.isOpen) return; if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(this.loop); };
  private resize() { const m = this.root.querySelector('.edmain') as HTMLElement; const w = m.clientWidth - 330, hh = m.clientHeight; this.cv.width = Math.max(200, w); this.cv.height = Math.max(200, hh); this.dirty = true; }
  // ---------- модель ----------
  load(s0: Scenario) {
    const s = canonScn(s0) || newScenario(); this.name = s.name; this.id = s.id.startsWith('z7-') ? newId() : s.id; this.desc = s.desc; this.author = s.author; this.seed = s.seed; this.base = s.map.base; this.bounds = s.map.bounds ? { ...s.map.bounds } : null; this.ver = s.ver;
    this.T.clear(); this.R.clear(); this.D.clear();
    for (const r of s.map.edits.terrain) for (let x = r[1]; x <= r[2]; x++) this.T.set(K(x, r[0]), r[3]);
    for (const r of s.map.edits.res) for (let x = r[1]; x <= r[2]; x++) this.R.set(K(x, r[0]), [r[3], r[4]]);
    for (const r of s.map.edits.decor) for (let x = r[1]; x <= r[2]; x++) this.D.set(K(x, r[0]), r[3]);
    this.nests = s.map.nests.map(n => ({ ...n })); this.ents = s.map.ents.map(e => ({ ...e })); this.start = { ...s.map.start };
    this.biology = s.biology ? JSON.parse(JSON.stringify(s.biology)) : emptyScenarioBiology();
    this.rules = JSON.parse(JSON.stringify(s.rules)); this.goals = JSON.parse(JSON.stringify(s.goals)); this.script = s.script;
    this.techAll = s.rules.techs === null; this.techOn = new Set(s.rules.techs || TECH_LIST.map(t => t.id)); this.techPre = new Set(s.rules.preTech); this.gen = s.gen ? JSON.parse(JSON.stringify(s.gen)) : null; this.genv = s.genv ?? (s.gen ? GEN_LEGACY_VER : GEN_VER);
    this.undo = []; this.redo = []; this.world = null; this.wseed = -1; this.v = { cx: s.map.start.x, cy: s.map.start.y, z: s.map.bounds ? Math.max(3, Math.min(8, Math.floor(Math.min(this.cv.width || 700, this.cv.height || 600) / Math.max(s.map.bounds.w, s.map.bounds.h)))) : 6 };
    this.dirty = true;
  }
  private runs(m: Map<number, any>, same: (a: any, b: any) => boolean, emit: (y: number, x0: number, x1: number, v: any) => void) {
    const keys = [...m.keys()].map(k => [KY(k), KX(k), m.get(k)] as [number, number, any]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let i = 0; while (i < keys.length) { let j = i; while (j + 1 < keys.length && keys[j + 1][0] === keys[i][0] && keys[j + 1][1] === keys[j][1] + 1 && same(keys[j + 1][2], keys[i][2])) j++; emit(keys[i][0], keys[i][1], keys[j][1], keys[i][2]); i = j + 1; }
  }
  /** собрать сценарий из модели (очищенный) */
  build(): Scenario {
    const s = newScenario(this.id, this.name); s.desc = this.desc; s.author = this.author; s.seed = this.seed; s.ver = this.ver; s.map.base = this.base; s.map.bounds = this.bounds ? { ...this.bounds } : null;
    const blank = this.base === 'blank';
    this.runs(this.T, (a, b) => a === b, (y, x0, x1, v) => { if (!(blank && v === 0)) s.map.edits.terrain.push([y, x0, x1, v]); });
    this.runs(this.R, (a, b) => a[0] === b[0] && a[1] === b[1], (y, x0, x1, v) => { if (!(blank && v[0] === 0)) s.map.edits.res.push([y, x0, x1, v[0], v[1]]); });
    this.runs(this.D, (a, b) => a === b, (y, x0, x1, v) => { if (!(blank && v === 0)) s.map.edits.decor.push([y, x0, x1, v]); });
    s.map.nests = this.nests.map(n => ({ ...n })); s.map.ents = this.ents.map(e => ({ proto: e.proto, x: e.x, y: e.y, dir: e.dir, recipe: e.recipe || null })); s.map.start = { ...this.start };
    if (hasScenarioBiology(this.biology)) s.biology = JSON.parse(JSON.stringify(this.biology));
    s.rules = JSON.parse(JSON.stringify(this.rules)); s.rules.techs = this.techAll ? null : [...this.techOn]; s.rules.preTech = [...this.techPre]; s.goals = JSON.parse(JSON.stringify(this.goals)); s.script = this.script; s.gen = this.gen; s.genv = this.genv;
    return canonScn(s) || s;
  }
  // ---------- значения клетки ----------
  private ensureWorld() { if (this.base === 'gen' && (!this.world || this.wseed !== this.seed)) { this.world = new World(this.seed, null, this.gen, this.genv); this.wseed = this.seed; } }
  private inside(x: number, y: number) { const b = this.bounds; if (!b) return true; const x0 = -Math.floor(b.w / 2), y0 = -Math.floor(b.h / 2); return x >= x0 && x < x0 + b.w && y >= y0 && y < y0 + b.h; }
  private tile(x: number, y: number): [number, number, number, number] { // terrain, res, amt, decor
    if (!this.inside(x, y)) return [4, 0, 0, 0];
    let t = 0, r = 0, a = 0, d = 0; if (this.base === 'gen' && this.world) { t = this.world.terrain(x, y); r = this.world.res(x, y); a = this.world.amt(x, y); d = this.world.decor(x, y); }
    const k = K(x, y); const et = this.T.get(k); if (et != null) { t = et; if (t >= 3) { r = 0; a = 0; d = 0; } }
    if (t < 3) { const er = this.R.get(k); if (er) { r = er[0]; a = er[0] ? er[1] : 0; if (r) d = 0; } const ed = this.D.get(k); if (ed != null && !r) d = ed; }
    return [t, r, a, d];
  }
  // ---------- рисование ----------
  private draw() {
    const cv = this.cv, c = this.cx2, W = cv.width, H = cv.height, z = this.v.z; this.ensureWorld();
    const x0 = this.v.cx - W / 2 / z, y0 = this.v.cy - H / 2 / z; const img = c.createImageData(W, H), d = img.data;
    const tx0 = Math.floor(x0), ty0 = Math.floor(y0), nx = Math.ceil(W / z) + 2, ny = Math.ceil(H / z) + 2;
    const cache = new Int32Array(nx * ny * 4);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const t = this.tile(tx0 + i, ty0 + j); const o = (j * nx + i) * 4; cache[o] = t[0]; cache[o + 1] = t[1]; cache[o + 2] = t[2]; cache[o + 3] = t[3]; }
    for (let py = 0; py < H; py++) {
      const wy = y0 + py / z, j = Math.floor(wy) - ty0;
      for (let px = 0; px < W; px++) {
        const wx = x0 + px / z, i = Math.floor(wx) - tx0, o = (j * nx + i) * 4; const t = cache[o], r = cache[o + 1], a = cache[o + 2], de = cache[o + 3];
        let col = TRGB[t]; const fx = wx - Math.floor(wx), fy = wy - Math.floor(wy);
        if (r) { const k = Math.min(1, 0.45 + a / 6000); const q = RRGB[r]; col = r === 5 ? (Math.hypot(fx - 0.5, fy - 0.5) < 0.35 ? q : col) : [col[0] + (q[0] - col[0]) * k, col[1] + (q[1] - col[1]) * k, col[2] + (q[2] - col[2]) * k]; }
        else if (de) { if (de === 1 ? Math.hypot(fx - 0.5, fy - 0.5) < 0.38 : Math.abs(fx - 0.5) + Math.abs(fy - 0.5) < 0.5) col = DRGB[de]; }
        if (z >= 10 && (fx < 0.04 || fy < 0.04)) col = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8];
        const p = (py * W + px) * 4; d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    const sx = (x: number) => (x - x0) * z, sy = (y: number) => (y - y0) * z;
    c.lineWidth = 1;
    if (this.bounds) { const b = this.bounds, bx = -Math.floor(b.w / 2), by = -Math.floor(b.h / 2); c.strokeStyle = '#fff'; c.setLineDash([6, 4]); c.strokeRect(sx(bx), sy(by), b.w * z, b.h * z); c.setLineDash([]); }
    c.strokeStyle = '#ffffff55'; c.beginPath(); c.moveTo(sx(0), 0); c.lineTo(sx(0), H); c.moveTo(0, sy(0)); c.lineTo(W, sy(0)); c.stroke();
    for (const e of this.ents) { const p = PROTOS[e.proto]; if (!p) continue; const [w, h] = e.dir % 2 ? [p.h, p.w] : [p.w, p.h]; let bad = false; for (let yy = e.y; yy < e.y + h && !bad; yy++) for (let xx = e.x; xx < e.x + w; xx++) if (this.tile(xx, yy)[0] >= 3) { bad = true; break; }
      c.fillStyle = bad ? '#e04040cc' : '#e8c060cc'; c.fillRect(sx(e.x), sy(e.y), w * z, h * z); c.strokeStyle = '#000'; c.strokeRect(sx(e.x), sy(e.y), w * z, h * z); if (z >= 9) { c.fillStyle = '#000'; c.font = Math.min(14, z) + 'px sans-serif'; c.fillText(tr(p.name).slice(0, Math.max(2, Math.floor(w * z / 7))), sx(e.x) + 2, sy(e.y) + Math.min(14, z)); } }
    for (const n of this.nests) { const p = PROTOS[n.proto]; const w = p?.w || 3, h = p?.h || 3; c.fillStyle = '#b02020cc'; c.fillRect(sx(n.x), sy(n.y), w * z, h * z); c.strokeStyle = '#fff'; c.strokeRect(sx(n.x), sy(n.y), w * z, h * z); if (z >= 7) { c.fillStyle = '#fff'; c.font = '12px sans-serif'; c.fillText(n.proto.startsWith('worm') ? '🐛' : '🥚', sx(n.x) + 2, sy(n.y) + 13); } }
    for (const ally of [...this.biology.allies, ...this.biology.enemies]) {
      const enemy = this.biology.enemies.includes(ally);
      const size = Math.max(.7, UNITS[ally.species]?.size || PROTOS[ally.species]?.w || 1), r = size / 2;
      c.fillStyle = enemy ? '#d64343cc' : '#40c6edaa'; c.strokeStyle = enemy ? '#ffb9b9' : '#c5f7ff';
      c.fillRect(sx(ally.x + .5 - r), sy(ally.y + .5 - r), size * z, size * z); c.strokeRect(sx(ally.x + .5 - r), sy(ally.y + .5 - r), size * z, size * z);
      if (z >= 9) { c.fillStyle = '#fff'; c.font = '11px sans-serif'; c.fillText(tr(enemy ? 'Враг' : 'Союзник'), sx(ally.x), sy(ally.y) - 2); }
    }
    const st = this.start; c.strokeStyle = '#ffe45a'; c.setLineDash([4, 3]); c.lineWidth = 2; c.strokeRect(sx(st.x - Math.floor(st.w / 2)), sy(st.y - Math.floor(st.h / 2)), st.w * z, st.h * z); c.setLineDash([]); c.fillStyle = '#ffe45a'; c.fillRect(sx(st.x) + z * 0.25, sy(st.y) + z * 0.25, Math.max(3, z * 0.5), Math.max(3, z * 0.5));
    c.lineWidth = 1;
    if (this.hover) { // контур кисти / предварительный вид постройки
      const [hx, hy] = this.hover; c.strokeStyle = '#fff'; c.fillStyle = '#ffffff30';
      if (this.tool === 'ally' || this.tool === 'enemy') { const size = Math.max(.7, UNITS[this.allySpecies]?.size || PROTOS[this.allySpecies]?.w || 1); c.strokeStyle = this.tool === 'ally' ? '#c5f7ff' : '#ffb9b9'; c.strokeRect(sx(hx + .5 - size / 2), sy(hy + .5 - size / 2), size * z, size * z); }
      else if (this.tool === 'ent' || this.tool === 'nest') { const p = PROTOS[this.tool === 'ent' ? this.p.ent : this.p.nest]; const [w, h] = this.tool === 'ent' && this.p.dir % 2 ? [p.h, p.w] : [p.w, p.h]; c.fillRect(sx(hx), sy(hy), w * z, h * z); c.strokeRect(sx(hx), sy(hy), w * z, h * z); }
      else if (this.tool !== 'start' && this.tool !== 'pan') { const s = this.p.size, hh = Math.floor(s / 2); if (this.p.circle && s > 1) { c.beginPath(); c.arc(sx(hx + 0.5), sy(hy + 0.5), s / 2 * z, 0, 7); c.fill(); c.stroke(); } else { c.fillRect(sx(hx - hh), sy(hy - hh), s * z, s * z); c.strokeRect(sx(hx - hh), sy(hy - hh), s * z, s * z); } }
      else c.strokeRect(sx(hx), sy(hy), z, z);
    }
    const t = this.hover ? this.tile(this.hover[0], this.hover[1]) : null;
    this.info = this.hover ? `(${this.hover[0]}, ${this.hover[1]}) ${tr(TNAME[t![0]])}${t![1] ? ' · ' + tr(RNAME[t![1]]) + ' ' + t![2] : ''}${t![3] ? ' · ' + (t![3] === 1 ? tr('дерево') : tr('скала')) : ''} · ×${z.toFixed(1)}` : '';
    this.status.textContent = this.info + (this.msg ? '   ' + this.msg : '');
  }
  private msg = '';
  private say(t: string) { this.msg = tr(t); this.status.textContent = this.info + '   ' + this.msg; }
  // ---------- правки ----------
  private setT(x: number, y: number, v: number | null) { this.set(0, K(x, y), v); }
  private set(layer: number, k: number, v: any) {
    const m = layer === 0 ? this.T : layer === 1 ? this.R : this.D; const old = m.has(k) ? m.get(k) : undefined; if (JSON.stringify(old) === JSON.stringify(v ?? undefined)) return;
    if (this.cur) this.cur.push([layer, k, old]); if (v === null || v === undefined) m.delete(k); else m.set(k, v);
  }
  private brush(tx: number, ty: number, fn: (x: number, y: number, d: number) => void) {
    const s = this.p.size, h = Math.floor(s / 2);
    if (s <= 1) { fn(tx, ty, 0); return; }
    for (let dy = -h; dy < s - h; dy++) for (let dx = -h; dx < s - h; dx++) { const d = Math.hypot(dx + (s % 2 ? 0 : 0.5), dy + (s % 2 ? 0 : 0.5)); if (this.p.circle && d > s / 2) continue; if (!this.inside(tx + dx, ty + dy)) continue; fn(tx + dx, ty + dy, d / (s / 2)); }
  }
  private apply(tx: number, ty: number) {
    switch (this.tool) {
      case 'terrain': this.brush(tx, ty, (x, y) => this.setT(x, y, this.p.terrain)); break;
      case 'res': this.brush(tx, ty, (x, y, d) => { const t = this.tile(x, y)[0]; if (t >= 3) return; const r = this.p.res; const amt = r === 0 ? 0 : r === 5 ? this.p.amt : Math.max(50, Math.round(this.p.amt * (this.p.grad && this.p.size > 1 ? Math.max(0.15, 1.2 - d) : 1))); this.set(1, K(x, y), r === 0 ? [0, 0] : [r, r === 5 ? Math.min(Math.max(30, this.p.amt), 3000) : amt]); }); break;
      case 'decor': this.brush(tx, ty, (x, y) => { if (this.tile(x, y)[0] < 3) this.set(2, K(x, y), this.p.decor); }); break;
      case 'reset': this.brush(tx, ty, (x, y) => { this.set(0, K(x, y), null); this.set(1, K(x, y), null); this.set(2, K(x, y), null); }); break;
    }
    this.dirty = true;
  }
  private click(tx: number, ty: number, right: boolean) {
    if (this.tool === 'enemy') {
      if (right) { const i = this.biology.enemies.findIndex(a => a.x === tx && a.y === ty); if (i >= 0) this.biology.enemies.splice(i, 1); }
      else if (UNITS[this.allySpecies] && this.inside(tx, ty) && this.biology.enemies.length < 600) this.biology.enemies.push({ species: this.allySpecies, x: tx, y: ty });
      this.dirty = true; this.renderSide(); return;
    }
    if (this.tool === 'ally') {
      if (right) { const i = this.biology.allies.findIndex(a => a.x === tx && a.y === ty); if (i >= 0) this.biology.allies.splice(i, 1); }
      else {
        const s = BIO_V117_SOURCES.find(s => s.kind === this.allySpecies);
        const weight = this.biology.allies.reduce((n, a) => n + (BIO_V117_SOURCES.find(s => s.kind === a.species)?.w || 0), 0);
        if (!s || !this.inside(tx, ty)) return;
        if (weight + s.w > 24 || this.biology.allies.length >= 24) { this.say('Начальная биоармия превышает 24 W или лимит одной Королевы'); return; }
        this.biology.allies.push({ species: s.kind, x: tx, y: ty });
      }
      this.dirty = true; this.renderSide(); return;
    }
    if (this.tool === 'start') { this.start.x = tx; this.start.y = ty; this.dirty = true; this.renderSide(); return; }
    if (this.tool === 'nest') {
      if (right) { this.removeAt(tx, ty, 'nest'); return; }
      if (!this.inside(tx, ty)) return; if (this.nests.length >= SCN_LIMITS.nests) { this.say('Слишком много гнёзд'); return; }
      this.nests.push({ x: tx, y: ty, proto: this.p.nest }); this.dirty = true; return;
    }
    if (this.tool === 'ent') {
      if (right) { this.removeAt(tx, ty, 'ent'); return; }
      const p = PROTOS[this.p.ent]; const [w, h] = this.p.dir % 2 ? [p.h, p.w] : [p.w, p.h];
      for (const e of this.ents) { const q = PROTOS[e.proto]; const [ew, eh] = e.dir % 2 ? [q.h, q.w] : [q.w, q.h]; if (tx < e.x + ew && tx + w > e.x && ty < e.y + eh && ty + h > e.y) { this.say('Место занято другой постройкой'); return; } }
      if (this.ents.length >= SCN_LIMITS.ents) { this.say('Слишком много построек'); return; }
      this.ents.push({ proto: this.p.ent, x: tx, y: ty, dir: this.p.dir }); this.dirty = true;
    }
  }
  private removeAt(tx: number, ty: number, what: 'nest' | 'ent') {
    if (what === 'nest') { const i = this.nests.findIndex(n => { const p = PROTOS[n.proto]; return tx >= n.x && tx < n.x + (p?.w || 3) && ty >= n.y && ty < n.y + (p?.h || 3); }); if (i >= 0) { this.nests.splice(i, 1); this.dirty = true; } }
    else { const i = this.ents.findIndex(e => { const q = PROTOS[e.proto]; const [w, h] = e.dir % 2 ? [q.h, q.w] : [q.w, q.h]; return tx >= e.x && tx < e.x + w && ty >= e.y && ty < e.y + h; }); if (i >= 0) { this.ents.splice(i, 1); this.dirty = true; } }
  }
  private toTile(ev: MouseEvent): [number, number] { const r = this.cv.getBoundingClientRect(); const px = (ev.clientX - r.left) * (this.cv.width / r.width), py = (ev.clientY - r.top) * (this.cv.height / r.height); return [Math.floor(this.v.cx + (px - this.cv.width / 2) / this.v.z), Math.floor(this.v.cy + (py - this.cv.height / 2) / this.v.z)]; }
  private bindCanvas() {
    const cv = this.cv; cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', ev => {
      ev.preventDefault(); const [tx, ty] = this.toTile(ev);
      if (ev.button === 1 || this.tool === 'pan' || (ev.button === 2 && !['nest', 'ent', 'ally', 'enemy'].includes(this.tool))) { this.down = 'pan'; this.pan = { x: ev.clientX, y: ev.clientY, cx: this.v.cx, cy: this.v.cy }; return; }
      if (ev.button === 2) { this.click(tx, ty, true); return; }
      if (ev.button !== 0) return;
      if (['terrain', 'res', 'decor', 'reset'].includes(this.tool)) { this.down = 'paint'; this.cur = []; this.last = [tx, ty]; this.apply(tx, ty); } else this.click(tx, ty, false);
    });
    window.addEventListener('mousemove', ev => {
      if (!this.isOpen) return;
      if (this.down === 'pan') { const dx = (ev.clientX - this.pan.x) / this.v.z, dy = (ev.clientY - this.pan.y) / this.v.z; this.v.cx = this.pan.cx - dx; this.v.cy = this.pan.cy - dy; this.dirty = true; return; }
      if (ev.target !== cv && this.down !== 'paint') return;
      const [tx, ty] = this.toTile(ev); if (!this.hover || this.hover[0] !== tx || this.hover[1] !== ty) { this.hover = [tx, ty]; this.dirty = true; }
      if (this.down === 'paint' && this.last) { let [x, y] = this.last; const n = Math.max(Math.abs(tx - x), Math.abs(ty - y)); for (let i = 1; i <= n; i++) this.apply(Math.round(x + (tx - x) * i / n), Math.round(y + (ty - y) * i / n)); this.last = [tx, ty]; }
    });
    window.addEventListener('mouseup', () => { if (this.down === 'paint' && this.cur) { if (this.cur.length) { this.undo.push(this.cur); if (this.undo.length > 60) this.undo.shift(); this.redo = []; } this.cur = null; } this.down = null; });
    cv.addEventListener('mouseleave', () => { if (this.down !== 'paint') { this.hover = null; this.dirty = true; } });
    cv.addEventListener('wheel', ev => { ev.preventDefault(); const z0 = this.v.z, z = Math.max(1, Math.min(48, z0 * (ev.deltaY < 0 ? 1.2 : 1 / 1.2))); const [tx, ty] = [this.v.cx, this.v.cy]; void tx; void ty; this.v.z = z; this.dirty = true; }, { passive: false });
  }
  private onKey(ev: KeyboardEvent) {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName);
    if (typing) { ev.stopPropagation(); if (ev.key === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
    ev.stopImmediatePropagation();
    if (ev.code === 'Escape') { this.close(); ev.preventDefault(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') { this.doUndo(ev.shiftKey); ev.preventDefault(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyY') { this.doUndo(true); ev.preventDefault(); return; }
    if (ev.code === 'KeyR') { this.p.dir = (this.p.dir + (ev.shiftKey ? 3 : 1)) % 4; this.dirty = true; this.renderSide(); return; }
    const step = 30 / this.v.z * (ev.shiftKey ? 3 : 1);
    if (ev.code === 'KeyW' || ev.code === 'ArrowUp') this.v.cy -= step; else if (ev.code === 'KeyS' || ev.code === 'ArrowDown') this.v.cy += step; else if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') this.v.cx -= step; else if (ev.code === 'KeyD' || ev.code === 'ArrowRight') this.v.cx += step;
    else if (ev.code === 'BracketLeft') { this.p.size = Math.max(1, this.p.size - 1); this.renderSide(); } else if (ev.code === 'BracketRight') { this.p.size = Math.min(40, this.p.size + 1); this.renderSide(); }
    this.dirty = true;
  }
  private doUndo(redo: boolean) {
    const from = redo ? this.redo : this.undo, to = redo ? this.undo : this.redo; const b = from.pop(); if (!b) return; const inv: [number, number, any][] = [];
    for (let i = b.length - 1; i >= 0; i--) { const [layer, k, old] = b[i]; const m = layer === 0 ? this.T : layer === 1 ? this.R : this.D; inv.push([layer, k, m.has(k) ? m.get(k) : undefined]); if (old === undefined) m.delete(k); else m.set(k, old); }
    to.push(inv); this.dirty = true;
  }
  // ---------- панели ----------
  private bindUI() {
    const R = this.root;
    R.addEventListener('click', async ev => {
      const el = (ev.target as HTMLElement).closest('[data-ed]') as HTMLElement | null; if (!el) return; const a = el.dataset.ed!, v = el.dataset.v || '';
      switch (a) {
        case 'bio-genome-add': { const kind = this.side.querySelector<HTMLSelectElement>('#ed-bio-genome')?.value; if (kind && BIO_V117_SOURCES.some(s => s.kind === kind) && !this.biology.genomes.includes(kind) && this.biology.genomes.length < 15) this.biology.genomes.push(kind); this.renderSide(); break; }
        case 'bio-ally-tool': { const kind = this.side.querySelector<HTMLSelectElement>('#ed-bio-ally')?.value; if (kind && BIO_V117_SOURCES.some(s => s.kind === kind)) { this.allySpecies = kind; this.tool = 'ally'; this.dirty = true; this.renderBar(); this.renderSide(); } break; }
        case 'bio-enemy-tool': { const kind = this.side.querySelector<HTMLSelectElement>('#ed-bio-enemy')?.value; if (kind && BIO_V117_SOURCES.some(s => s.kind === kind)) { this.allySpecies = kind; if (UNITS[kind]) this.tool = 'enemy'; else { this.tool = 'nest'; this.p.nest = kind; } this.dirty = true; this.renderBar(); this.renderSide(); } break; }
        case 'bio-delete-genome': this.biology.genomes = this.biology.genomes.filter(k => k !== v); this.renderSide(); break;
        case 'bio-delete-ally': { const i = Number(v); if (Number.isInteger(i) && i >= 0 && i < this.biology.allies.length) this.biology.allies.splice(i, 1); this.dirty = true; this.renderSide(); break; }
        case 'bio-delete-enemy': { const i = Number(v); if (Number.isInteger(i) && i >= 0 && i < this.biology.enemies.length) this.biology.enemies.splice(i, 1); this.dirty = true; this.renderSide(); break; }
        case 'bio-delete-line': { const i = Number(v); if (Number.isInteger(i) && i >= 0 && i < this.biology.cultures.length) this.biology.cultures.splice(i, 1); this.renderSide(); break; }
        case 'bio-line-add': {
          const species = this.side.querySelector<HTMLSelectElement>('#ed-bio-line')?.value;
          const lab = this.side.querySelector<HTMLSelectElement>('#ed-bio-lab')?.value.split(',').map(Number), bank = this.side.querySelector<HTMLSelectElement>('#ed-bio-bank')?.value.split(',').map(Number);
          const cells = this.side.querySelector<HTMLInputElement>('#ed-bio-cells')?.valueAsNumber;
          if (species && BIO_V117_SOURCES.some(s => s.kind === species) && lab?.length === 2 && bank?.length === 2 && [...lab, ...bank].every(Number.isSafeInteger) && Number.isSafeInteger(cells) && cells! >= 1 && cells! <= 100 && this.biology.cultures.length < 64 && !this.biology.cultures.some(c => c.species === species && c.bankX === bank[0] && c.bankY === bank[1])) this.biology.cultures.push({ species, labX: lab[0], labY: lab[1], bankX: bank[0], bankY: bank[1], cells: cells! });
          this.renderSide(); break;
        }
        case 'tool': this.tool = v as Tool; if (v === 'ally' || v === 'enemy') this.tab = 'biology'; this.dirty = true; this.renderSide(); this.renderBar(); break;
        case 'tab': this.tab = v as Tab; this.renderSide(); break;
        case 'terrain': this.p.terrain = +v; this.tool = 'terrain'; this.renderSide(); this.renderBar(); break;
        case 'res': this.p.res = +v; this.tool = 'res'; if (+v === 5 && this.p.amt > 3000) this.p.amt = 200; else if (+v > 0 && +v !== 5 && this.p.amt < 500) this.p.amt = 2500; this.renderSide(); this.renderBar(); break;
        case 'decor': this.p.decor = +v; this.tool = 'decor'; this.renderSide(); this.renderBar(); break;
        case 'nest': this.p.nest = v; this.tool = 'nest'; this.renderSide(); this.renderBar(); break;
        case 'shape': this.p.circle = v === 'c'; this.renderSide(); break;
        case 'grad': this.p.grad = !this.p.grad; this.renderSide(); break;
        case 'rot': this.p.dir = (this.p.dir + 1) % 4; this.renderSide(); break;
        case 'new': if (confirm(tr('Начать новую карту? Несохранённые правки пропадут.'))) { this.fresh(); this.renderBar(); this.renderSide(); } break;
        case 'undo': this.doUndo(false); break;
        case 'redo': this.doUndo(true); break;
        case 'clear': if (confirm(tr('Стереть все нарисованные правки карты?'))) { this.T.clear(); this.R.clear(); this.D.clear(); this.undo = []; this.redo = []; this.dirty = true; } break;
        case 'center': this.v.cx = this.start.x; this.v.cy = this.start.y; this.dirty = true; break;
        case 'save': { const s = this.build(); await this.h.saveStore(s); this.say('Сохранено в этом браузере: «' + s.name + '»'); break; }
        case 'export': { const s = this.build(); const c = checkScenario(s); if (!c.ok) { this.say(c.errors[0]); break; } this.h.download(`${s.id}.z7scn`, scnToText(s)); this.say('Сценарий записан в файл'); break; }
        case 'import': { const t = await this.h.pickFile('.z7scn,.json,application/json'); if (!t) break; const r = parseScnText(t); if (!r.scn) { this.say(r.errors[0] || 'Файл не открылся'); break; } this.load(r.scn); this.renderBar(); this.renderSide(); this.say('Открыто: «' + r.scn.name + '»' + (r.warns.length ? ' · предупреждений: ' + r.warns.length : '')); break; }
        case 'play': { const s = this.build(); const c = checkScenario(s); if (!c.ok) { this.say(c.errors[0]); break; } await this.h.saveStore(s).catch(() => { /* */ }); this.isOpen = false; this.root.style.display = 'none'; cancelAnimationFrame(this.raf); this.h.setPaused(false); this.h.play(c.scn!); break; }
        case 'close': this.close(); break;
        case 'itemadd': { const sel = this.root.querySelector('#ed-si') as HTMLSelectElement, n = this.root.querySelector('#ed-sn') as HTMLInputElement; if (!this.rules.startItems) this.rules.startItems = {}; if (sel?.value) this.rules.startItems[sel.value] = Math.max(1, Math.min(100000, +n.value || 1)); this.renderSide(); break; }
        case 'itemdel': if (this.rules.startItems) { delete this.rules.startItems[v]; this.renderSide(); } break;
        case 'kit': this.rules.startItems = v === 'default' ? null : v === 'empty' ? {} : { 'iron-plate': 200, 'copper-plate': 100, 'stone-furnace': 6, 'burner-mining-drill': 6, 'electric-mining-drill': 4, 'small-electric-pole': 20, 'transport-belt': 100, inserter: 20, wood: 50, pistol: 1, 'firearm-magazine': 20 }; this.renderSide(); break;
        case 'ban': { const i = this.rules.ban.indexOf(v); if (i >= 0) this.rules.ban.splice(i, 1); else this.rules.ban.push(v); this.renderSide(); break; }
        case 'banitem': { const sel = this.root.querySelector('#ed-bi') as HTMLSelectElement; if (sel?.value && !this.rules.ban.includes(sel.value)) this.rules.ban.push(sel.value); this.renderSide(); break; }
        case 'techall': this.techAll = true; this.techOn = new Set(TECH_LIST.map(t => t.id)); this.renderSide(); break;
        case 'technone': this.techAll = false; this.techOn = new Set(); this.techPre = new Set(); this.renderSide(); break;
        case 'tech': this.toggleTech(v, 'allow'); break;
        case 'pretech': this.toggleTech(v, 'pre'); break;
        case 'goaladd': this.goals.push({ k: 'produce', item: 'iron-plate', n: 100 }); this.renderSide(); break;
        case 'goaldel': this.goals.splice(+v, 1); this.renderSide(); break;
        case 'goalup': { const i = +v; if (i > 0) { [this.goals[i - 1], this.goals[i]] = [this.goals[i], this.goals[i - 1]]; this.renderSide(); } break; }
        case 'example': this.script = '// Scenario script example (API v1.11). Win: game.scenario.win(), lose: game.scenario.fail().\nvar start = null;\ngame.on_tick(function (e) {\n  if (start === null) start = e.tick;\n  if (e.tick - start === 60 * 60) game.print(\'One minute has passed\');\n  // game.scenario.win(\'done!\');\n}, 60);\n'; this.renderSide(); break;
        case 'nestdel': this.nests = []; this.dirty = true; this.renderSide(); break;
        case 'entdel': this.ents = []; this.dirty = true; this.renderSide(); break;
      }
    });
    R.addEventListener('change', ev => {
      const el = ev.target as HTMLInputElement; if (el.id?.startsWith('edg-')) { if (el.id.startsWith('edg-f')) refreshGenForm('edg', this.root); this.gen = readGen('edg', this.root); this.genv = GEN_VER; this.world = null; this.wseed = -1; this.dirty = true; return; } const k = el.dataset.f; if (!k) return; const v = el.type === 'checkbox' ? el.checked : el.value; const n = (lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(+v) || lo));
      switch (k) {
        case 'name': this.name = String(v).slice(0, SCN_LIMITS.name) || 'Моя карта'; break; // id не меняется: переименование не создаёт копию
        case 'author': this.author = String(v).slice(0, SCN_LIMITS.author); break; case 'desc': this.desc = String(v).slice(0, SCN_LIMITS.desc); break;
        case 'seed': this.seed = n(1, 2147483647); this.world = null; this.dirty = true; break;
        case 'base': this.base = v === 'blank' ? 'blank' : 'gen'; this.dirty = true; break;
        case 'bounds': this.bounds = v ? { w: 100, h: 100 } : null; this.renderSide(); this.dirty = true; break;
        case 'bw': if (this.bounds) this.bounds.w = n(24, 512); this.dirty = true; break; case 'bh': if (this.bounds) this.bounds.h = n(24, 512); this.dirty = true; break;
        case 'size': this.p.size = n(1, 40); this.renderSide(); break; case 'amt': this.p.amt = n(this.p.res === 5 ? 30 : 100, this.p.res === 5 ? 3000 : 20000); break;
        case 'sw': this.start.w = n(2, 64); this.dirty = true; break; case 'sh': this.start.h = n(2, 64); this.dirty = true; break; case 'sx': this.start.x = n(-4000, 4000); this.dirty = true; break; case 'sy': this.start.y = n(-4000, 4000); this.dirty = true; break;
        case 'ent': this.p.ent = String(v); this.tool = 'ent'; this.renderSide(); this.renderBar(); break;
        case 'enemies': this.rules.enemies = String(v) as any; break; case 'nests': this.rules.nests = String(v) as any; break;
        case 'nmin': this.rules.nestMin = n(40, 2000); break; case 'ndens': this.rules.nestDens = Math.max(0.2, Math.min(4, +v || 1)); break; case 'tl': this.rules.timeLimit = n(0, 100000); break;
        case 'script': this.script = String(v).slice(0, SCN_LIMITS.script); break;
        case 'techq': this.techQ = String(v); this.renderSide(); break;
        case 'gk': { const i = +el.dataset.i!; const g = this.goals[i]; if (!g) break; const kk = String(v) as ScnGoal['k']; this.goals[i] = kk === 'produce' ? { k: kk, item: 'iron-plate', n: 100 } : kk === 'build' ? { k: kk, proto: 'wooden-chest', n: 1 } : kk === 'research' ? { k: kk, tech: 'automation' } : kk === 'survive' ? { k: kk, min: 30 } : kk === 'power' ? { k: kk, min: 40 } : kk === 'consume' ? { k: kk, item: 'used-nuclear-fuel-cell', n: 5 } : { k: kk, n: 1 }; this.renderSide(); break; }
        case 'gi': { const g = this.goals[+el.dataset.i!]; if (g) g.item = String(v); this.renderSide(); break; } case 'gp': { const g = this.goals[+el.dataset.i!]; if (g) g.proto = String(v); this.renderSide(); break; } case 'gt': { const g = this.goals[+el.dataset.i!]; if (g) g.tech = String(v); this.renderSide(); break; }
        case 'gn': { const g = this.goals[+el.dataset.i!]; if (g) g.n = n(1, 1e9); break; } case 'gm': { const g = this.goals[+el.dataset.i!]; if (g) g.min = n(1, 100000); break; }
        case 'si': { if (this.rules.startItems && el.dataset.id) this.rules.startItems[el.dataset.id] = n(1, 100000); break; }
      }
    });
    R.addEventListener('input', ev => { const el = ev.target as HTMLInputElement; if (el.dataset.f === 'script') this.script = el.value.slice(0, SCN_LIMITS.script); });
  }
  private toggleTech(id: string, what: 'allow' | 'pre') {
    const deps = (t: string, out = new Set<string>()) => { for (const x of TECH_LIST) if (x.prereq.includes(t) && !out.has(x.id)) { out.add(x.id); deps(x.id, out); } return out; };
    const pre = (t: string, out = new Set<string>()) => { for (const p of TECHS[t].prereq) if (!out.has(p)) { out.add(p); pre(p, out); } return out; };
    if (what === 'allow') { this.techAll = false; if (this.techOn.has(id)) { this.techOn.delete(id); this.techPre.delete(id); for (const d of deps(id)) { this.techOn.delete(d); this.techPre.delete(d); } } else { this.techOn.add(id); for (const p of pre(id)) this.techOn.add(p); } }
    else { this.techAll = this.techAll && true; if (this.techPre.has(id)) { this.techPre.delete(id); for (const d of deps(id)) this.techPre.delete(d); } else { this.techPre.add(id); this.techOn.add(id); for (const p of pre(id)) { this.techPre.add(p); this.techOn.add(p); } if (this.techOn.size < TECH_LIST.length) this.techAll = false; } }
    if (this.techOn.size === TECH_LIST.length) this.techAll = true; this.renderSide();
  }
  private renderBar() {
    const t = (id: Tool, label: string) => `<button data-ed="tool" data-v="${id}" class="${this.tool === id ? 'on' : ''}">${label}</button>`;
    this.bar.innerHTML = tr(`<b class="edtitle">Редактор карт</b>
      <button data-ed="new">Новая</button><button data-ed="save">Сохранить</button><button data-ed="export">Экспорт в файл</button><button data-ed="import">Импорт из файла</button>
      <span class="edsep"></span>${t('terrain', '🟩 Поверхность')}${t('res', '⛏ Ресурс')}${t('decor', '🌲 Деревья и скалы')}${t('nest', '🥚 Гнёзда')}${t('ent', '🏭 Постройки')}${t('ally', '🧬 Союзники')}${t('start', '⭐ Старт')}${t('reset', '🧽 Сбросить правки')}${t('pan', '✋ Двигать')}
      <span class="edsep"></span><button data-ed="undo" title="Ctrl+Z">Шаг назад</button><button data-ed="redo" title="Ctrl+Y">Шаг вперёд</button><button data-ed="center">К старту</button>
      <span class="edsep"></span><button data-ed="play" class="go">▶ Проверить игрой</button><button data-ed="close">Закрыть</button>`);
  }
  private biologyHTML() {
    const b = this.biology;
    const label = (kind: string) => esc(BIO_V117_SOURCES.find(s => s.kind === kind)?.label || kind);
    const species = (selected = 'small') => this.opts(BIO_V117_SOURCES.map(s => ({ id: s.kind, name: s.label })), selected);
    const buildings = (proto: string) => this.ents.filter(e => e.proto === proto).map(e => `<option value="${e.x},${e.y}">${e.x}, ${e.y}</option>`).join('');
    const weight = b.allies.reduce((n, a) => n + (BIO_V117_SOURCES.find(s => s.kind === a.species)?.w || 0), 0);
    let h = `<p class="small">Начальные биоданные используют формат сценария 3. Враги, союзники, библиотека и живые линии задаются отдельно: одно не выдаёт другое.</p>`;
    h += `<div class="lbl">Изученные геномы (${b.genomes.length}/15)</div>${b.genomes.map(k => `<div class="edrow"><span class="edgrow">${label(k)}</span><button data-ed="bio-delete-genome" data-v="${esc(k)}">✕</button></div>`).join('')}<div class="edrow"><select id="ed-bio-genome">${species()}</select><button data-ed="bio-genome-add">Добавить геном</button></div>`;
    h += `<div class="lbl">Живые культуры (${b.cultures.length}/64)</div><p class="dim small">Сначала разместите генолабораторию и банк культур. Линия хранит реальные порции, требует питания и может погибнуть. Экспорт не создаёт новый геном.</p>`;
    h += b.cultures.map((c, i) => `<div class="edrow"><span class="edgrow">${label(c.species)} · ${c.cells}/100<br>Лаборатория: ${c.labX}, ${c.labY} · банк: ${c.bankX}, ${c.bankY}</span><button data-ed="bio-delete-line" data-v="${i}">✕</button></div>`).join('');
    h += `<label class="edf">Вид культуры<select id="ed-bio-line">${species()}</select></label><label class="edf">Лаборатория<select id="ed-bio-lab">${buildings('genetic-lab')}</select></label><label class="edf">Банк<select id="ed-bio-bank">${buildings('bio-culture-bank')}</select></label><div class="edrow"><label class="edf">Порции<input id="ed-bio-cells" type="number" min="1" max="100" value="2"></label><button data-ed="bio-line-add"${!buildings('genetic-lab') || !buildings('bio-culture-bank') ? ' disabled' : ''}>Добавить культуру</button></div>`;
    h += `<div class="lbl">Союзная биоармия · ${weight}/24 W</div><p class="dim small">Владелец — стартовый инженер. Синие тела на карте: стойка и бой включён; начальное питание на 5 игровых минут. Технологии и геномы не выдаются.</p><div class="edrow"><select id="ed-bio-ally">${species(this.allySpecies)}</select><button data-ed="bio-ally-tool">Размещать союзника</button></div>`;
    h += b.allies.map((a, i) => `<div class="edrow"><span class="edgrow">${label(a.species)} · ${a.x}, ${a.y}</span><button data-ed="bio-delete-ally" data-v="${i}">✕</button></div>`).join('');
    h += `<div class="lbl">Исходные враги Роя</div><p class="dim small">Красные — враги. Черви размещаются инструментом гнёзд; подвижные враги хранятся отдельно от союзной армии.</p><div class="edrow"><select id="ed-bio-enemy">${species(this.allySpecies)}</select><button data-ed="bio-enemy-tool">Размещать врага</button></div>`;
    h += b.enemies.map((a, i) => `<div class="edrow"><span class="edgrow">${label(a.species)} · ${a.x}, ${a.y}</span><button data-ed="bio-delete-enemy" data-v="${i}">✕</button></div>`).join('');
    const check = checkScenario(this.build());
    if (!check.ok) h += `<p class="err small">${esc(check.errors[0])}</p>`;
    return h;
  }
  private opts(list: { id: string; name: string }[], cur: string) { return list.map(o => `<option value="${o.id}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join(''); }
  private renderSide() {
    const keep = this.side.scrollTop; const tabs: [Tab, string][] = [['info', 'Карта'], ['map', 'Кисть'], ['rules', 'Правила'], ['biology', 'Биология'], ['goals', 'Цели'], ['script', 'Скрипт']];
    let h = `<div class="edtabs">${tabs.map(([k, n]) => `<button data-ed="tab" data-v="${k}" class="${this.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const f = (k: string, label: string, val: any, extra = '') => `<label class="edf">${label}<input data-f="${k}" value="${esc(val)}" ${extra}></label>`;
    if (this.tab === 'info') {
      h += f('name', 'Название', this.name, 'maxlength="60"') + f('author', 'Автор', this.author, 'maxlength="40"') + `<label class="edf">Описание<textarea data-f="desc" rows="3" maxlength="800">${esc(this.desc)}</textarea></label>`;
      h += `<div class="lbl">Основа карты</div><label class="edf">Seed<input data-f="seed" type="number" value="${this.seed}"></label>
        <label class="edf">Мир<select data-f="base"><option value="gen" ${this.base === 'gen' ? 'selected' : ''}>Генерируется по seed (рисуем поверх)</option><option value="blank" ${this.base === 'blank' ? 'selected' : ''}>Чистая трава (рисуем всё сами)</option></select></label>
        <label class="edf row"><input type="checkbox" data-f="bounds" ${this.bounds ? 'checked' : ''}> Ограничить карту (за краем — глубокая вода)</label>
        ${this.bounds ? `<div class="edrow"><label class="edf">Ширина<input data-f="bw" type="number" value="${this.bounds.w}"></label><label class="edf">Высота<input data-f="bh" type="number" value="${this.bounds.h}"></label></div>` : ''}
        <details class="genbox"><summary>Вода и ресурсы${this.gen ? ' ✔' : ''}</summary>${genFormHtml('edg', this.gen)}<div class="dim small">Записывается в файл сценария (формат 2). Такой сценарий не откроется в 1.15.</div></details>
        <div class="lbl">Старт</div><div class="edrow"><label class="edf">X<input data-f="sx" type="number" value="${this.start.x}"></label><label class="edf">Y<input data-f="sy" type="number" value="${this.start.y}"></label><label class="edf">Ширина<input data-f="sw" type="number" value="${this.start.w}"></label><label class="edf">Высота<input data-f="sh" type="number" value="${this.start.h}"></label></div>
        <div class="dim small">Инженер появляется в центре области старта. Инструмент «⭐ Старт» — щелчок по карте.</div>
        <div class="lbl">Содержимое</div><div class="small">Гнёзд: ${this.nests.length} · построек: ${this.ents.length} · правок клеток: ${this.T.size + this.R.size + this.D.size}</div>
        <div class="row2"><button data-ed="clear">Стереть все правки</button><button data-ed="nestdel">Убрать гнёзда</button><button data-ed="entdel">Убрать постройки</button></div>`;
    } else if (this.tab === 'map') {
      const sw = (v: number, cls: string, col: string, name: string, a: string, cur: boolean) => `<button data-ed="${a}" data-v="${v}" class="${cur ? 'on' : ''} edsw" title="${name}"><i style="background:${col}"></i>${name}</button>`;
      h += `<div class="lbl">Кисть</div><div class="edrow"><label class="edf">Размер<input data-f="size" type="number" min="1" max="40" value="${this.p.size}"></label><button data-ed="shape" data-v="c" class="${this.p.circle ? 'on' : ''}">● круг</button><button data-ed="shape" data-v="s" class="${!this.p.circle ? 'on' : ''}">■ квадрат</button></div><div class="dim small">Клавиши [ и ] — размер, R — поворот постройки, колесо — масштаб, правая кнопка — двигать карту (у гнёзд и построек — удалить).</div>`;
      h += `<div class="lbl">Поверхность</div><div class="edsws">${TNAME.map((n, i) => sw(i, '', TCOL[i], n, 'terrain', this.tool === 'terrain' && this.p.terrain === i)).join('')}</div>`;
      h += `<div class="lbl">Ресурс</div><div class="edsws">${[1, 2, 3, 4, 5, 6].map(i => sw(i, '', RCOL[i], RNAME[i], 'res', this.tool === 'res' && this.p.res === i)).join('')}${sw(0, '', '#000', 'Убрать ресурс', 'res', this.tool === 'res' && this.p.res === 0)}</div>
        <div class="edrow"><label class="edf">${this.p.res === 5 ? 'Дебит скважины (30…3000)' : 'Запас на клетку (100…20000)'}<input data-f="amt" type="number" value="${this.p.amt}"></label>${this.p.res !== 5 ? `<button data-ed="grad" class="${this.p.grad ? 'on' : ''}">К краям беднее</button>` : ''}</div>`;
      h += `<div class="lbl">Деревья и скалы</div><div class="edsws">${sw(1, '', DCOL[1], 'Дерево', 'decor', this.tool === 'decor' && this.p.decor === 1)}${sw(2, '', DCOL[2], 'Скала', 'decor', this.tool === 'decor' && this.p.decor === 2)}${sw(0, '', '#000', 'Убрать', 'decor', this.tool === 'decor' && this.p.decor === 0)}</div>`;
      h += `<div class="lbl">Гнёзда (правая кнопка — удалить)</div><div class="edsws">${NEST_PROTOS.map(n => `<button data-ed="nest" data-v="${n}" class="edsw ${this.tool === 'nest' && this.p.nest === n ? 'on' : ''}">${esc(PROTOS[n].name)}</button>`).join('')}</div>`;
      h += `<div class="lbl">Постройки</div><label class="edf"><select data-f="ent">${this.opts(PROTO_LIST().map(p => ({ id: p.id, name: p.name })), this.p.ent)}</select></label><div class="edrow"><button data-ed="rot">Поворот (R): ${['↑', '→', '↓', '←'][this.p.dir]}</button></div>`;
    } else if (this.tab === 'biology') {
      h += this.biologyHTML();
    } else if (this.tab === 'rules') {
      const r = this.rules; const sel = (k: string, cur: string, o: [string, string][]) => `<select data-f="${k}">${o.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
      h += `<label class="edf">Рой${sel('enemies', r.enemies, [['none', 'Нет врагов'], ['peaceful', 'Мирный'], ['normal', 'Обычный'], ['deathworld', 'Мир смерти']])}</label>
        <label class="edf">Гнёзда${sel('nests', r.nests, [['auto', 'Как в обычной игре'], ['custom', 'Только расставленные'], ['none', 'Нет']])}</label>
        <div class="edrow"><label class="edf">Ближайшие гнёзда от старта, клеток<input data-f="nmin" type="number" value="${r.nestMin}"></label><label class="edf">Густота ×<input data-f="ndens" type="number" step="0.1" value="${r.nestDens}"></label></div>
        <label class="edf">Лимит времени, минут (0 — нет)<input data-f="tl" type="number" value="${r.timeLimit}"></label>`;
      h += `<div class="lbl">Стартовый инвентарь</div><div class="row2"><button data-ed="kit" data-v="default" class="${r.startItems === null ? 'on' : ''}">Обычный (обломки корабля)</button><button data-ed="kit" data-v="empty" class="${r.startItems && !Object.keys(r.startItems).length ? 'on' : ''}">Пустой</button><button data-ed="kit" data-v="rich">Щедрый</button></div>`;
      if (r.startItems) { h += Object.entries(r.startItems).map(([id, n]) => `<div class="edrow"><span class="edgrow">${esc(ITEMS[id]?.name || id)}</span><input data-f="si" data-id="${id}" type="number" value="${n}" style="width:80px"><button data-ed="itemdel" data-v="${id}">✕</button></div>`).join('');
        h += `<div class="edrow"><select id="ed-si">${this.opts(ITEM_LIST(), 'iron-plate')}</select><input id="ed-sn" type="number" value="100" style="width:70px"><button data-ed="itemadd">Добавить</button></div>`; }
      h += `<div class="lbl">Запреты (нельзя ставить и делать)</div><div class="edchecks">${BAN_TYPES.map(([t, n]) => `<label><input type="checkbox" data-ed="ban" data-v="type:${t}" ${r.ban.includes('type:' + t) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
        ${r.ban.filter(b => !b.startsWith('type:')).map(b => `<div class="edrow"><span class="edgrow">${esc(ITEMS[b]?.name || b)}</span><button data-ed="ban" data-v="${b}">✕</button></div>`).join('')}
        <div class="edrow"><select id="ed-bi">${this.opts(ITEM_LIST(), 'transport-belt')}</select><button data-ed="banitem">Запретить предмет</button></div>`;
      const q = this.techQ.trim().toLowerCase(); const list = TECH_LIST.filter(t => !q || t.name.toLowerCase().includes(q) || tr(t.name).toLowerCase().includes(q));
      h += `<div class="lbl">Технологии ${this.techAll ? '(все разрешены)' : `(разрешено ${this.techOn.size} из ${TECH_LIST.length})`}</div><div class="row2"><button data-ed="techall">Разрешить все</button><button data-ed="technone">Запретить все</button><input data-f="techq" placeholder="поиск" value="${esc(this.techQ)}" style="width:110px"></div>
        <div class="dim small">Первая галочка — можно исследовать; вторая — изучено в начале. Отключение технологии отключает и те, что от неё зависят.</div>
        <div class="edtechs">${list.map(t => `<div class="edtech"><input type="checkbox" data-ed="tech" data-v="${t.id}" ${this.techOn.has(t.id) ? 'checked' : ''}><input type="checkbox" data-ed="pretech" data-v="${t.id}" ${this.techPre.has(t.id) ? 'checked' : ''}> <span>${esc(t.name)}</span></div>`).join('')}</div>`;
    } else if (this.tab === 'goals') {
      h += `<div class="dim small">Победа — когда выполнены все цели. Цели видны игроку слева сверху.</div>`;
      h += this.goals.map((g, i) => {
        const ks: [string, string][] = [['produce', 'Произвести'], ['build', 'Построить'], ['research', 'Изучить'], ['survive', 'Выжить (минут)'], ['rocket', 'Запустить ракет'], ['kills', 'Убить существ'], ['power', 'Станция, МВт'], ['consume', 'Переработать']];
        let p = '';
        if (g.k === 'produce' || g.k === 'consume') p = `<select data-f="gi" data-i="${i}">${this.opts(ITEM_LIST(), g.item || '')}</select><input data-f="gn" data-i="${i}" type="number" value="${g.n}" style="width:80px">`;
        else if (g.k === 'build') p = `<select data-f="gp" data-i="${i}">${BAN_TYPES.map(([t, n]) => `<option value="type:${t}" ${g.proto === 'type:' + t ? 'selected' : ''}>${n}</option>`).join('')}${this.opts(PROTO_LIST().map(x => ({ id: x.id, name: x.name })), g.proto || '')}</select><input data-f="gn" data-i="${i}" type="number" value="${g.n}" style="width:80px">`;
        else if (g.k === 'research') p = `<select data-f="gt" data-i="${i}">${this.opts(TECH_LIST.map(t => ({ id: t.id, name: t.name })), g.tech || '')}</select>`;
        else if (g.k === 'survive' || g.k === 'power') p = `<input data-f="gm" data-i="${i}" type="number" value="${g.min}" style="width:90px">`;
        else p = `<input data-f="gn" data-i="${i}" type="number" value="${g.n}" style="width:90px">`;
        return `<div class="edgoal"><select data-f="gk" data-i="${i}">${ks.map(([v, n]) => `<option value="${v}" ${g.k === v ? 'selected' : ''}>${n}</option>`).join('')}</select>${p}<button data-ed="goalup" data-v="${i}">↑</button><button data-ed="goaldel" data-v="${i}">✕</button><div class="dim small">${esc(tr(goalText(g)))}</div></div>`;
      }).join('') + `<div class="row2"><button data-ed="goaladd">+ Добавить цель</button></div>`;
    } else {
      h += `<div class="dim small">Скрипт — обычный control.js мода (API v1.11): game.on_tick, game.print, game.scenario.win() / fail(). Работает в песочнице, как скрипты модов. До ${SCN_LIMITS.script / 1000} КБ.</div><div class="row2"><button data-ed="example">Вставить пример</button></div><textarea data-f="script" class="edscript" spellcheck="false">${esc(this.script)}</textarea>`;
    }
    this.side.innerHTML = tr(h); this.side.scrollTop = keep;
  }
}
