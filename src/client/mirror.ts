// Главный поток в режиме Worker: зеркало состояния игры, собираемое из снимков (14.10).
// Зеркало — обычный объект Game без симуляции: рендер и интерфейс читают его как раньше,
// а команды (enqueue) и сообщения (msg) уходят в Worker.
import type { SlotInfo } from '../sim/slotinfo';
import { Game, Command } from '../sim/game';
import { Inventory } from '../sim/inventory';
import { CHUNK, ckey, tkey } from '../core/types';
import type { Chunk } from '../sim/world';
import type { Snapshot, ToWorker } from '../sim/protocol';
import { DYN_STRIDE } from '../sim/protocol';
import { ITEM_IDS } from '../data/items';
import type { EnemyMode } from '../sim/enemies';
import { railCellsAdd } from '../sim/trains';

const N = CHUNK * CHUNK;
const EMPTY: Chunk = { cx: 0, cy: 0, terrain: new Uint8Array(N), res: new Uint8Array(N), amt: new Uint32Array(N), decor: new Uint8Array(N), occ: new Int32Array(N).fill(-1), mods: new Map(), decorRemoved: new Set(), version: 0, pollution: 0, absorb: 0 };
const revInv = (o: any) => { if (o && !(o instanceof Inventory)) Object.setPrototypeOf(o, Inventory.prototype); return o; };

export class WorkerSim {
  w: Worker; g: Game; tickMs = 0; ups = 0; lastSnap = 0; snaps = 0; errors: string[] = [];
  private nid = 1; private pending = new Map<number, (v: any) => void>(); private inflight = false;
  private prev = { x: 0, y: 0, t: 0 }; private cur = { x: 0, y: 0, t: 0 };
  onReset: ((keepUi?: boolean) => void) | null = null;
  /** v1.12: сообщения сеанса совместной игры из Worker (кадры, контрольные суммы, сохранения) */ onMp: ((m: any) => void) | null = null;
  constructor(src: string) {
    this.w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.g = this.blank(1);
    this.w.onmessage = ev => { const t0 = performance.now(); const d = ev.data; const t1 = performance.now(); this.onMsg(d); if (d && d.t === 'snap') { this.cloneMs = t1 - t0; this.recvMs = performance.now() - t0; } };
    this.w.onerror = ev => { this.errors.push(String(ev.message)); console.error('worker:', ev.message); };
  }
  post(m: ToWorker) { this.w.postMessage(m); }
  private blank(seed: number): Game {
    const g = new Game(seed, false); const W = g.world; W.onChunkGen = null;
    W.getChunk = (cx: number, cy: number) => W.chunks.get(ckey(cx, cy)) || EMPTY; // зеркало не генерирует мир само
    g.enqueue = (c: Command) => this.post({ t: 'cmd', c });
    g.msg = (text: string) => this.post({ t: 'cmd', c: { t: 'msg', text } });
    g.step = () => { /* шаги делает Worker */ };
    return g;
  }
  newGame(seed: number, mode: EnemyMode) { this.g = this.blank(seed); this.post({ t: 'new', seed, mode }); }
  load(data: any) { this.g = this.blank(data.seed || 1); this.post({ t: 'load', data }); }
  /** v1.9: замер «мегабаза» — Worker строит её сам из эталонной базы (base — упакованное сохранение) и n ячеек */
  mega(base: string, cells: number): Promise<any> { this.g = this.blank(1); return this.call({ t: 'mega', base, cells }); }
  private call<T>(m: any): Promise<T> { const id = this.nid++; m.id = id; return new Promise(res => { this.pending.set(id, res); this.post(m); }); }
  save(ui: any): Promise<{ str: string; tick: number; info?: SlotInfo }> { return this.call({ t: 'save', ui }); }
  /** статистика партии (бета-тест) из настоящей игры в Worker */
  /** v1.10: применить набор модов в Worker (файлы модов, приоритет порядка, версия игры) */
  mods(mods: Record<string, Uint8Array>[], prio: string[], game: string): Promise<any> { return this.call({ t: 'mods', mods, prio, game }); }
  teleReport(): Promise<any> { return this.call({ t: 'tele' }); }
  /** v1.9: данные окна статистики 2.0 (считаются в Worker) */
  statsView(tier: number, tab: string, sel: string | null): Promise<any> { return this.call({ t: 'pstats', tier, tab, sel }); }
  /** выполнить код над настоящей игрой в Worker (для тестов и отладки) */
  eval(code: string): Promise<any> { return this.call({ t: 'eval', code }); }
  request(vp: { x0: number; y0: number; x1: number; y1: number }, focus: number[], allChunks: boolean, lod = false) {
    if (this.inflight && performance.now() - this.lastSnap < 500) return; this.inflight = true;
    this.post({ t: 'frame', vp, focus, allChunks, nopack: this.nopack || undefined, lod: lod || undefined });
  }
  /** интерполированная позиция инженера между двумя последними снимками */
  playerPos(now: number): [number, number] {
    const d = Math.max(8, this.cur.t - this.prev.t); const k = Math.min(1, (now - this.cur.t) / d);
    return [this.prev.x + (this.cur.x - this.prev.x) * k, this.prev.y + (this.cur.y - this.prev.y) * k];
  }
  private onMsg(m: any) {
    switch (m.t) {
      case 'snap': this.inflight = false; this.lastSnap = performance.now(); this.snaps++; this.apply(m.s); break;
      case 'reset': { const g = this.blank(m.seed); g.world.lake = m.lake; g.world.oil = m.oil; this.g = g; this.inflight = false; this.onReset?.(!!m.keepUi); break; }
      case 'mp': this.onMp?.(m); break;
      case 'saved': case 'evald': { const r = this.pending.get(m.id); this.pending.delete(m.id); r?.(m.t === 'saved' ? { str: m.str, tick: m.tick, info: m.info } : m.r); break; }
      case 'error': { this.errors.push(m.msg); console.error('worker:', m.msg); const r = this.pending.get(m.id); if (r) { this.pending.delete(m.id); r(undefined); } break; }
    }
  }
  stab: string[] = ['']; beltItems: { tick: number; n: number; data: Float32Array } | null = null;
  /** для сравнения: отправлять видимые постройки целиком, как в v1.0-rc1 */
  nopack = false;
  /** время в главном потоке на снимок: распаковка structured clone (cloneMs) и всё вместе с применением (recvMs) */
  cloneMs = 0; recvMs = 0; postMs = 0; private rv = -1;
  applyMs = 0; snapMs = 0; nFull = 0; nDyn = 0; nItems = 0; itemBytes = 0;
  private apply(s: Snapshot) {
    const T0 = performance.now();
    const g = this.g; const W = g.world;
    g.tick = s.tick; this.tickMs = s.tickMs; this.ups = s.ups;
    this.prev = this.cur.t ? this.cur : { x: s.player.x, y: s.player.y, t: performance.now() - 16 }; this.cur = { x: s.player.x, y: s.player.y, t: performance.now() };
    g.player = s.player; g.inv = revInv(s.inv); g.queue = s.queue; g.messages = s.messages; g.units = s.units; g.projectiles = s.projectiles; g.fx = s.fx;
    g.sfx.push(...s.sfx); if (g.sfx.length > 96) g.sfx.splice(0, g.sfx.length - 96);
    g.evolution = s.evolution; g.rockets = s.rockets; g.goalIdx = s.goalIdx; g.fxVer = s.fxVer; g.settings = s.settings; g.corpses = s.corpses; g.alerts = s.alerts;
    (g as any).groups = { length: s.nGroups };
    g.research.current = s.research.current; g.research.progress = s.research.progress; g.research.done = new Set(s.research.done); g.research.levels = s.research.levels;
    let railCh = s.full.some(e => e.t === 'rail'); for (const id of s.removed) if (g.ents.get(id)?.t === 'rail') railCh = true;
    for (const id of s.removed) g.ents.delete(id);
    for (const e of s.full) { revInv(e.inv); g.ents.set(e.id, e); }
    if (s.stabAdd) this.stab.push(...s.stabAdd);
    if (s.dyn) {
      const d = s.dyn, st = this.stab; const U = (v: number) => Number.isNaN(v) ? undefined : v;
      for (let o = 0; o < d.length; o += DYN_STRIDE) {
        const e = g.ents.get(d[o]); if (!e) continue; const f = d[o + 2];
        e.status = st[d[o + 1]] || undefined; e.moving = f & 8 ? undefined : !!(f & 1); e.active = f & 16 ? undefined : !!(f & 2); e._on = !!(f & 4);
        e.progress = U(d[o + 3]); e.aim = U(d[o + 4]); e.fireCd = U(d[o + 5]); e.charge = U(d[o + 6]); e.parts = U(d[o + 7]); e.launchT = U(d[o + 8]);
        e.ist = U(d[o + 9]); e.itimer = U(d[o + 10]); e.hand = d[o + 11] >= 0 ? ITEM_IDS[d[o + 11]] : null; e.hp = U(d[o + 12]); e.rounds = U(d[o + 13]);
      }
      this.nDyn = d.length / DYN_STRIDE;
    }
    this.nFull = s.full.length;
    if (s.beltItems) {
      let data = s.beltItems as Float32Array; this.itemBytes = s.beltItems.byteLength;
      if (s.beltOrg) { // v1.9: упакованные Int16 → Float32 для рендера
        const p = s.beltItems as Int16Array, u = new Uint16Array(p.buffer, p.byteOffset, p.length), [ox, oy] = s.beltOrg; data = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) { data[i] = ox + p[i] / 64; data[i + 1] = oy + p[i + 1] / 64; data[i + 2] = u[i + 2]; }
      }
      this.beltItems = { tick: s.tick, n: data.length / 3, data }; this.nItems = this.beltItems.n;
    }
    this.snapMs = s.snapMs || 0; this.postMs = s.postMs || 0;
    for (const c of s.chunks) {
      const k = ckey(c.cx, c.cy); const old = W.chunks.get(k);
      if (old) { old.terrain = c.terrain; old.res = c.res; old.amt = c.amt; old.decor = c.decor; old.occ = c.occ; old.version = c.version; old.pollution = c.pollution; }
      else { const ch: Chunk = { ...c, mods: new Map(), decorRemoved: new Set(), absorb: 0 }; W.chunks.set(k, ch); W.onAnyGen?.(ch); }
    }
    if (s.robots) g.rview = { buf: s.robots, nets: s.roboNets || g.rview?.nets || [], ms: s.robMs || 0 };
    if (s.roboNets && g.rview) g.rview.nets = s.roboNets;
    g.held = s.held ?? null; g.equip = s.equip ?? null; if (s.preq) g.preq = s.preq; g.preqOff = !!s.preqOff;
    if (s.stats) g.stats = s.stats;
    if (s.powerNets) { g.powerNets = new Map(s.powerNets.map(n => [n.id, n])); }
    if (s.fluidNets) g.fluidNets = s.fluidNets;
    if (s.ground) g.ground = new Map(s.ground);
    if (s.pollution) for (let i = 0; i < s.pollution.length; i += 3) { const c = W.chunks.get(ckey(s.pollution[i], s.pollution[i + 1])); if (c) c.pollution = s.pollution[i + 2]; }
    if (s.hist) g.hist = s.hist; if (s.histMin) g.histMin = s.histMin;
    if (s.ghosts) { g.ghosts = new Map(s.ghosts.map(x => [x.id, x])); g.ghostTiles.clear(); for (const gh of s.ghosts) for (let y = gh.y; y < gh.y + gh.h; y++) for (let x = gh.x; x < gh.x + gh.w; x++) g.ghostTiles.set(tkey(x, y), gh.id); }
    if (s.floors) { g.floors = new Map(s.floors); g.tileMarks = new Map(s.tileMarks || []); g.floorVer++; }
    if (s.marked) g.marked = new Set(s.marked); if (s.treeMarks) g.treeMarks = new Set(s.treeMarks);
    if (s.enabled) g.enabled = new Set(s.enabled);
    if (s.wires) g.wires = s.wires;
    if (s.cw) { g.cw = s.cw; g.cwVer++; }
    if (s.notes) { g.notes = s.notes; g.noteVer++; }
    if (s.prof) g.prof.last = s.prof;
    g.csig = s.csig || {}; g.cco = s.cco || {}; if (s.cstat) g.cstat = s.cstat;
    // v1.7: рельсы — клетки пересобираются при смене версии путей; поезда и позы вагонов
    if ((s.rv != null && s.rv !== this.rv) || railCh) { this.rv = s.rv ?? this.rv; g.railVer = this.rv; g.railCells.clear(); for (const e of g.ents.values()) if (e.t === 'rail') railCellsAdd(g, e); g.stopVer++; }
    else if (s.full.some(e => e.t === 'stop') || s.removed.length) g.stopVer++;
    if (s.full.some(e => e.t === 'signal' && !g.sigSeen?.has(e.id)) || s.removed.length) { g.sigVer++; for (const e of s.full) if (e.t === 'signal') (g.sigSeen || (g.sigSeen = new Set())).add(e.id); } // v1.8: блоки путей
    if (s.tl) { g.trains = s.tl; g.trainVer++; }
    if (s.tv) { const v = s.tv; g.tview = v; for (let i = 0; i < v.length; i += 6) { const e = g.ents.get(v[i]); if (e) { e._cx = v[i + 1]; e._cy = v[i + 2]; e._dx = v[i + 3]; e._dy = v[i + 4]; e.tr = v[i + 5]; } } }
    else if (g.tview) { g.tview = null; g.trains = []; }
    if (s.tstat) g.tstat = s.tstat;
    g.mpv = s.peers || s.mp ? { peers: s.peers || [], mp: s.mp || null } : null; g.chat = s.chat || []; g.marks = s.marks || [];
    this.applyMs = performance.now() - T0;
  }
}
