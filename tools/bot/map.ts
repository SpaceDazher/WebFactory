// Бот-тест: карта планировщика — занятость (постройки в игре + запланированное), поиск места,
// путь пешком (A*), трассировка труб (обычные + подземные).
import type { Game } from '../../src/sim/game';
import { PROTOS } from '../../src/data/entities';
import { T_SHALLOW, TERRAIN_SPEED } from '../../src/sim/world';
import { DX, DY, rotLocal } from '../../src/core/types';

export const key = (x: number, y: number) => (x + 65536) * 131072 + (y + 65536);
export const unkey = (k: number): [number, number] => [Math.floor(k / 131072) - 65536, (k % 131072) - 65536];
export const dims = (p: string, d: number): [number, number] => { const q = PROTOS[p]; return d % 2 ? [q.h, q.w] : [q.w, q.h]; };

/** запланированная постройка в мировых координатах */
export interface PEnt { p: string; x: number; y: number; d: number; recipe?: string; }
/** порт жидкости: клетка порта, направление наружу, сеть (null — бак не используется) */
export interface Port { x: number; y: number; d: number; net: string | null; }

/** Порты постройки; fl — сети по входам/выходам рецепта (как setFluidFilters), fixed — сеть для баков без io (бойлер, насос) */
export function portsOf(e: PEnt, fl: { in?: string[]; out?: string[]; fixed?: (string | null)[] } = {}): Port[] {
  const p = PROTOS[e.p]; if (!p.fluid) return [];
  let a = 0, b = 0; const out: Port[] = [];
  p.fluid.forEach((box, bi) => {
    const net = box.io === 'in' ? fl.in?.[a++] ?? null : box.io === 'out' ? fl.out?.[b++] ?? null : fl.fixed?.[bi] ?? null;
    for (const c of box.conns) { const [lx, ly] = rotLocal(c.x, c.y, p.w, p.h, e.d); out.push({ x: e.x + lx, y: e.y + ly, d: (c.d + e.d) % 4, net }); }
  });
  return out;
}

export class Plan {
  /** клетка → запланированная постройка (у труб — сеть) */
  tile = new Map<number, { e: PEnt; net?: string }>();
  /** клетки над подземными трубами: туда нельзя ставить подземные трубы */
  tunnel = new Set<number>();
  /** клетка перед активным портом → сеть порта */
  front = new Map<number, string>();
  /** порты: `${key}:${d}` → сеть */
  ports = new Map<string, string | null>();
  /** не строить (проходы, места стоянки) */
  keep = new Set<number>();
  constructor(public g: Game) {}
  terrainOk(x: number, y: number) { return this.g.world.terrain(x, y) < T_SHALLOW; }
  freeTile(x: number, y: number) { const k = key(x, y); return this.terrainOk(x, y) && this.g.world.occ(x, y) < 0 && !this.tile.has(k) && !this.keep.has(k); }
  free(x: number, y: number, w: number, h: number, noOre = false) {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) { if (!this.freeTile(tx, ty)) return false; if (noOre && this.g.world.res(tx, ty)) return false; }
    return true;
  }
  /** внести постройку (и её порты) в план */
  add(e: PEnt, net?: string, ports?: Port[]) {
    const [w, h] = dims(e.p, e.d); for (let ty = e.y; ty < e.y + h; ty++) for (let tx = e.x; tx < e.x + w; tx++) this.tile.set(key(tx, ty), { e, net });
    for (const pt of ports || []) { this.ports.set(key(pt.x, pt.y) + ':' + pt.d, pt.net); if (pt.net) this.front.set(key(pt.x + DX[pt.d], pt.y + DY[pt.d]), pt.net); }
  }
  /** сеть порта в клетке (x,y), смотрящего в направлении d; undefined — порта нет */
  portAt(x: number, y: number, d: number) { const k = key(x, y) + ':' + d; return this.ports.has(k) ? this.ports.get(k)! : undefined; }
  reserve(x: number, y: number, w: number, h: number) { for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.keep.add(key(tx, ty)); }
  /** Свободный прямоугольник w×h как можно ближе к (ax, ay) */
  findRect(ax: number, ay: number, w: number, h: number, o: { noOre?: boolean; maxR?: number; margin?: number; step?: number; pred?: (x: number, y: number) => boolean } = {}): { x: number; y: number } | null {
    const m = o.margin ?? 0, R = o.maxR ?? 200, st = o.step ?? 1;
    for (let r = 0; r <= R; r += st) {
      const cand: [number, number][] = [];
      for (let dx = -r; dx <= r; dx += st) { cand.push([dx, -r]); if (r) cand.push([dx, r]); }
      for (let dy = -r + st; dy <= r - st; dy += st) { cand.push([-r, dy]); cand.push([r, dy]); }
      cand.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
      for (const [dx, dy] of cand) {
        const x = Math.round(ax - w / 2) + dx, y = Math.round(ay - h / 2) + dy;
        if (this.free(x - m, y - m, w + 2 * m, h + 2 * m, o.noOre) && (!o.pred || o.pred(x, y))) return { x, y };
      }
    }
    return null;
  }
}

// ---------- ходьба ----------
export function walkable(g: Game, x: number, y: number, allowDecor = false) {
  if (TERRAIN_SPEED[g.world.terrain(x, y)] === 0) return false;
  const id = g.world.occ(x, y); if (id >= 0) { const e = g.ents.get(id); if (e && PROTOS[e.proto].solid) return false; }
  if (!allowDecor && g.world.decor(x, y)) return false;
  return true;
}
class Heap { a: [number, number][] = [];
  push(f: number, v: number) { const a = this.a; a.push([f, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop()!; if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
  reprioritize(priority: (value: number) => number) {
    const entries = this.a; this.a = [];
    for (const [, value] of entries) this.push(priority(value), value);
  }
}
/** A* по клеткам от (sx,sy) до клетки с goal(x,y). allowDecor — деревья и скалы проходимы (их вырубают по пути). */
export function findPath(g: Game, sx: number, sy: number, goal: (x: number, y: number) => boolean, hx: number, hy: number, o: { allowDecor?: boolean; limit?: number } = {}): [number, number][] | null {
  const came = new Map<number, number>(); const gs = new Map<number, number>(); const H = new Heap(); const xy = new Map<number, [number, number]>();
  const h = (x: number, y: number) => Math.max(0, Math.hypot(x - hx, y - hy) - 2);
  const sk = key(sx, sy); gs.set(sk, 0); xy.set(sk, [sx, sy]); H.push(h(sx, sy), sk);
  const limit = o.limit ?? 120000; let n = 0;
  const cost = (x: number, y: number) => { if (walkable(g, x, y)) return 1; if (o.allowDecor && walkable(g, x, y, true)) return 8; return -1; };
  while (H.size && n++ < limit) {
    const [, k] = H.pop(); const [x, y] = xy.get(k)!; const cg = gs.get(k)!;
    if (goal(x, y)) { const path: [number, number][] = [[x, y]]; let c = k; while (came.has(c)) { c = came.get(c)!; path.push(xy.get(c)!); } return path.reverse(); }
    for (let d = 0; d < 8; d++) {
      const dx = [0, 1, 0, -1, 1, 1, -1, -1][d], dy = [-1, 0, 1, 0, -1, 1, 1, -1][d];
      const nx = x + dx, ny = y + dy; const c = cost(nx, ny); if (c < 0) continue;
      if (d >= 4 && (cost(x + dx, y) !== 1 || cost(x, y + dy) !== 1 || c !== 1)) continue;
      const ng = cg + c * (d >= 4 ? 1.414 : 1); const nk = key(nx, ny);
      if (ng < (gs.get(nk) ?? Infinity)) { gs.set(nk, ng); came.set(nk, k); xy.set(nk, [nx, ny]); H.push(ng + h(nx, ny), nk); }
    }
  }
  return null;
}

// ---------- трубы ----------
/** Можно ли положить обычную трубу сети net в (x,y): ни один сосед не принадлежит другой сети */
export function pipeOk(pl: Plan, x: number, y: number, net: string): boolean {
  const k = key(x, y);
  const t = pl.tile.get(k); if (t) return t.e.p === 'pipe' && t.net === net;
  if (!pl.freeTile(x, y)) return false;
  const f = pl.front.get(k); if (f !== undefined && f !== net) return false;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d], ny = y + DY[d];
    const nt = pl.tile.get(key(nx, ny));
    if (nt && nt.e.p === 'pipe' && nt.net !== net) return false;
    const pn = pl.portAt(nx, ny, (d + 2) % 4);
    if (pn != null && pn !== net) return false;
    const nf = pl.front.get(key(nx, ny)); if (nf !== undefined && nf !== net && !nt) return false; // туда потом ляжет чужая труба
  }
  return true;
}
export interface Route { ents: PEnt[]; }
export interface RouteSearchStats { visited: number; generated: number; reason: 'empty-targets' | 'blocked-start' | 'found' | 'limit' | 'exhausted'; tightened?: boolean; }
/**
 * Трасса сети net от клетки (sx,sy) (обычно — перед портом) до любой клетки из targets (клетки с трубой этой сети
 * или перед её портами). Ходы: обычная труба на соседнюю клетку (цена 1) или подземная пара по прямой до 10 клеток,
 * за которой обычная труба (дешевле на длинных участках и оставляет проход).
 */
export function routePipe(pl: Plan, net: string, sx: number, sy: number, targets: Set<number>, o: { maxNodes?: number; stats?: RouteSearchStats } = {}): Route | null {
  let tightened = false;
  const finish = (reason: RouteSearchStats['reason'], route: Route | null, visited = 0, generated = 0) => {
    if (o.stats) Object.assign(o.stats, { reason, visited, generated, tightened });
    return route;
  };
  if (!targets.size) return finish('empty-targets', null);
  if (targets.has(key(sx, sy))) return finish('found', { ents: pl.tile.get(key(sx, sy))?.net === net ? [] : [{ p: 'pipe', x: sx, y: sy, d: 0 }] });
  if (!pipeOk(pl, sx, sy, net)) return finish('blocked-start', null);
  const tl = [...targets].map(unkey);
  // A length-k underground transition advances k+2 cells for 2.6+0.3*k.
  // Its cheapest cost/cell is at k=10: 5.6/12. Ordinary pipe costs 1.
  // Keep the established 0.4 ordering for ordinary routes. After one third
  // of the existing budget, tighten only this search's remaining frontier.
  // No restart, extra expansions or changes to connection rules are needed.
  const MIN_COST_PER_CELL = (2.6 + 0.3 * 10) / 12;
  let costPerCell = 0.4;
  const h = (x: number, y: number) => { let m = Infinity; for (const [a, b] of tl) m = Math.min(m, Math.abs(a - x) + Math.abs(b - y)); return m * costPerCell; };
  type Node = { x: number; y: number; g: number; prev: number; via: 'p' | 'u' | 's'; d: number; k: number };
  const nodes: Node[] = [{ x: sx, y: sy, g: 0, prev: -1, via: 's', d: 0, k: 0 }];
  const best = new Map<number, number>([[key(sx, sy), 0]]); const H = new Heap(); H.push(h(sx, sy), 0);
  const ptgFree = (x: number, y: number) => { const k = key(x, y); return pl.freeTile(x, y) && !pl.tunnel.has(k) && !pl.front.has(k); };
  const used = (i: number) => { const s = new Set<number>(); for (let j = i; j >= 0; j = nodes[j].prev) { const n = nodes[j]; s.add(key(n.x, n.y)); if (n.via === 'u') { const p = nodes[n.prev]; s.add(key(p.x + DX[n.d], p.y + DY[n.d])); s.add(key(p.x + DX[n.d] * (n.k + 1), p.y + DY[n.d] * (n.k + 1))); } } return s; };
  let iter = 0; const maxN = o.maxNodes ?? 300000;
  while (H.size && iter++ < maxN) {
    if (!tightened && iter >= Math.max(1, Math.floor(maxN / 3))) {
      tightened = true; costPerCell = MIN_COST_PER_CELL;
      H.reprioritize(i => nodes[i].g + h(nodes[i].x, nodes[i].y));
    }
    const [, i] = H.pop(); const n = nodes[i]; const k0 = key(n.x, n.y);
    if (n.g > (best.get(k0) ?? Infinity)) continue;
    if (targets.has(k0) && n.via !== 's') {
      const ents: PEnt[] = [];
      for (let j = i; j >= 0; j = nodes[j].prev) {
        const c = nodes[j];
        if (pl.tile.get(key(c.x, c.y))?.net !== net) ents.push({ p: 'pipe', x: c.x, y: c.y, d: 0 });
        if (c.via === 'u') { const p0 = nodes[c.prev]; ents.push({ p: 'pipe-to-ground', x: p0.x + DX[c.d], y: p0.y + DY[c.d], d: c.d }, { p: 'pipe-to-ground', x: p0.x + DX[c.d] * (c.k + 1), y: p0.y + DY[c.d] * (c.k + 1), d: (c.d + 2) % 4 }); }
      }
      return finish('found', { ents }, iter, nodes.length);
    }
    const mine = used(i);
    for (let d = 0; d < 4; d++) {
      const nx = n.x + DX[d], ny = n.y + DY[d], nk = key(nx, ny);
      if (mine.has(nk) || !pipeOk(pl, nx, ny, net)) continue;
      // не касаться своих же клеток пути, кроме предыдущей (иначе — лишние петли, но не ошибка)
      const ng = n.g + 1;
      if (ng < (best.get(nk) ?? Infinity)) { best.set(nk, ng); nodes.push({ x: nx, y: ny, g: ng, prev: i, via: 'p', d, k: 0 }); H.push(ng + h(nx, ny), nodes.length - 1); }
    }
    if (n.via === 'u') continue; // подземная пара сразу после подземной — через обычную трубу (она уже есть: n)
    for (let d = 0; d < 4; d++) {
      const ax = n.x + DX[d], ay = n.y + DY[d]; if (!ptgFree(ax, ay) || mine.has(key(ax, ay))) continue;
      for (let k = 1; k <= 10; k++) {
        const mx = n.x + DX[d] * k, my = n.y + DY[d] * k; // k>1 — клетка над тоннелем
        if (k > 1) { const mt = pl.tile.get(key(mx, my)); if (mt && mt.e.p === 'pipe-to-ground') break; if (mine.has(key(mx, my)) && false) break; }
        if (k < 2) continue;
        const bx = n.x + DX[d] * (k + 1), by = n.y + DY[d] * (k + 1);
        if (!ptgFree(bx, by) || mine.has(key(bx, by))) continue;
        const cx = bx + DX[d], cy = by + DY[d], ck = key(cx, cy);
        if (mine.has(ck) || !pipeOk(pl, cx, cy, net)) continue;
        const ng = n.g + 2.6 + k * 0.3;
        if (ng < (best.get(ck) ?? Infinity)) { best.set(ck, ng); nodes.push({ x: cx, y: cy, g: ng, prev: i, via: 'u', d, k }); H.push(ng + h(cx, cy), nodes.length - 1); }
      }
    }
  }
  return finish(H.size ? 'limit' : 'exhausted', null, Math.min(iter, maxN), nodes.length);
}
/** Внести трассу в план: трубы с сетью, подземные — и клетки над их тоннелями */
export function commitRoute(pl: Plan, net: string, r: Route) {
  for (const e of r.ents) pl.add(e, net);
  for (const a of r.ents) {
    if (a.p !== 'pipe-to-ground') continue;
    // вход смотрит по ходу трассы; ищем выход впереди
    for (let k = 1; k <= 10; k++) {
      const b = r.ents.find(e => e.p === 'pipe-to-ground' && e.x === a.x + DX[a.d] * k && e.y === a.y + DY[a.d] * k && e.d === (a.d + 2) % 4);
      if (b) { for (let j = 1; j < k; j++) pl.tunnel.add(key(a.x + DX[a.d] * j, a.y + DY[a.d] * j)); break; }
    }
  }
}
