// v1.16: радар с измеримой пользой. Постоянный обзор 7×7 чанков, дальний скан — один сектор раз в 30 с до радиуса 14 чанков:
// сначала неизвестные сектора, затем самая устаревшая разведка; несколько радаров не берут один сектор. Находки (уран, нефть, гнёзда)
// — метки карты и одно уведомление на находку. Состояние лежит в g.x.rs (сохраняется, входит в хеши и снимки).
import { R_OIL, R_URAN } from './world';
import { CHUNK } from '../core/types';
import { nestList } from './enemies';
import type { Game, Entity } from './game';

export const RADAR_R = 14, RADAR_VIEW = 3, RADAR_SECS = 30, RADAR_KW = 300, STALE_TICKS = 5 * 60 * 60, FIND_MAX = 64, SCAN_MAX = 20000;
export type FindKind = 'uranium' | 'oil' | 'nest';
export const FIND_KINDS: FindKind[] = ['uranium', 'oil', 'nest'];
export const FIND_NAME: Record<FindKind, string> = { uranium: 'уран', oil: 'нефть', nest: 'гнездо Роя' };
export interface RFind { k: FindKind; x: number; y: number; t: number; cx: number; cy: number; }
export interface RadarState { scan: Record<string, number>; finds: RFind[]; fresh: number; upd: number; flt: Record<FindKind, boolean>; }
export const newRadar = (): RadarState => ({ scan: {}, finds: [], fresh: 0, upd: 0, flt: { uranium: true, oil: true, nest: true } });
const nn = (v: any, lo: number, hi: number, d = 0) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function loadRadar(raw: any): RadarState {
  const r = newRadar(); if (!raw || typeof raw !== 'object') return r;
  if (raw.scan && typeof raw.scan === 'object') { let n = 0; for (const [k, v] of Object.entries(raw.scan)) { if (n >= SCAN_MAX) break; if (/^-?\d+,-?\d+$/.test(k)) { r.scan[k] = Math.floor(nn(v, 0, 1e12)); n++; } } }
  if (Array.isArray(raw.finds)) for (const f of raw.finds.slice(0, FIND_MAX)) if (f && FIND_KINDS.includes(f.k)) r.finds.push({ k: f.k, x: nn(f.x, -1e7, 1e7), y: nn(f.y, -1e7, 1e7), t: Math.floor(nn(f.t, 0, 1e12)), cx: Math.floor(nn(f.cx, -1e6, 1e6)), cy: Math.floor(nn(f.cy, -1e6, 1e6)) });
  r.fresh = Math.floor(nn(raw.fresh, 0, 1e9)); r.upd = Math.floor(nn(raw.upd, 0, 1e9));
  if (raw.flt && typeof raw.flt === 'object') for (const k of FIND_KINDS) if (raw.flt[k] === false) r.flt[k] = false;
  return r;
}
const key = (cx: number, cy: number) => cx + ',' + cy;
const SP: [number, number][] = []; for (let y = -RADAR_R; y <= RADAR_R; y++) for (let x = -RADAR_R; x <= RADAR_R; x++) SP.push([x, y]);
SP.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));

const LISTS = new WeakMap<Game, { ver: number; l: Entity[] }>();
function radars(g: Game): Entity[] {
  const c = LISTS.get(g); if (c && c.ver === g.ents.ver) return c.l;
  const l: Entity[] = []; for (const e of g.ents.values()) if (e.t === 'radar') l.push(e);
  LISTS.set(g, { ver: g.ents.ver, l }); return l;
}
export const chunkOf = (e: Entity) => [Math.floor((e.x + 1) / CHUNK), Math.floor((e.y + 1) / CHUNK)] as const;

/** выбрать следующий сектор: неизвестный, иначе самый устаревший (старше STALE_TICKS); чужие цели исключены */
export function radarPick(g: Game, e: Entity): boolean {
  const [ccx, ccy] = chunkOf(e); const R = g.x.rs; const taken = new Set<string>();
  for (const o of radars(g)) if (o !== e && o.tx !== undefined && o.ty !== undefined) taken.add(key(o.tx, o.ty));
  let best: [number, number] | null = null, bestT = Infinity;
  for (const [dx, dy] of SP) {
    const cx = ccx + dx, cy = ccy + dy, k = key(cx, cy); if (taken.has(k)) continue;
    if (!g.world.hasChunk(cx, cy)) { best = [cx, cy]; break; }
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= RADAR_VIEW) continue;
    const t = R.scan[k] ?? -1; if (g.tick - t < STALE_TICKS && t >= 0) continue;
    if (t < bestT) { bestT = t; best = [cx, cy]; }
  }
  if (!best) { e.tx = undefined; e.ty = undefined; return false; }
  e.tx = best[0]; e.ty = best[1]; return true;
}
/** разведка сектора: ресурсы и гнёзда → метки; устаревшие метки снимаются */
function detect(g: Game, cx: number, cy: number, notify: boolean) {
  const R = g.x.rs; const c = g.world.getChunk(cx, cy);
  let u = 0, ux = 0, uy = 0, o = 0, ox = 0, oy = 0;
  for (let i = 0; i < CHUNK * CHUNK; i++) { const r = c.res[i]; if (!r || !c.amt[i]) continue; const x = cx * CHUNK + (i % CHUNK) + .5, y = cy * CHUNK + Math.floor(i / CHUNK) + .5; if (r === R_URAN) { u++; ux += x; uy += y; } else if (r === R_OIL) { o++; ox += x; oy += y; } }
  let nx = 0, ny = 0, nc = 0; for (const e of nestList(g).nests) if (Math.floor(e.x / CHUNK) === cx && Math.floor(e.y / CHUNK) === cy) { nx += e.x + e.w / 2; ny += e.y + e.h / 2; nc++; }
  const seen: Record<FindKind, [number, number] | null> = { uranium: u ? [ux / u, uy / u] : null, oil: o ? [ox / o, oy / o] : null, nest: nc ? [nx / nc, ny / nc] : null };
  for (const k of FIND_KINDS) {
    const here = R.finds.filter(f => f.k === k && f.cx === cx && f.cy === cy);
    if (!seen[k]) { if (here.length) { R.finds = R.finds.filter(f => !here.includes(f)); g.xv++; } continue; }
    if (here.length) continue;
    const [x, y] = seen[k]!; const R2 = (k === 'nest' ? 40 : 34) ** 2;
    if (R.finds.some(f => f.k === k && (f.x - x) ** 2 + (f.y - y) ** 2 < R2)) continue;
    R.finds.push({ k, x, y, t: g.tick, cx, cy }); if (R.finds.length > FIND_MAX) R.finds.shift(); g.xv++;
    if (notify && R.flt[k]) g.msg(`Радар: найдено — ${FIND_NAME[k]} (${Math.round(x)}, ${Math.round(y)}), метка на карте`);
  }
}
/** шаг радара под питанием: s — доля питания; вызывается из game.stepRadar */
export function radarStep(g: Game, e: Entity, s: number) {
  const [ccx, ccy] = chunkOf(e); const R = g.x.rs;
  // постоянный обзор: чанк за чанком раз в 2 с — разведка находок без метки возраста дальнего скана
  const n = (RADAR_VIEW * 2 + 1) ** 2; if ((g.tick + e.id) % 120 === 0) { const i = (e.vc = ((e.vc ?? -1) + 1) % n); detect(g, ccx + (i % 7) - 3, ccy + Math.floor(i / 7) - 3, true); }
  if (e.tx === undefined || e.ty === undefined) { if (e.cursor === 0) { e.cursor = 1; radarPick(g, e); } else if ((g.tick + e.id) % 300 === 0) radarPick(g, e); if (e.tx === undefined) { e.progress = 0; return; } }
  e.progress! += s / (RADAR_SECS * 60);
  if (e.progress! < 1 - 1e-9) return;
  e.progress = 0; const cx = e.tx!, cy = e.ty!, k = key(cx, cy), had = g.world.hasChunk(cx, cy);
  detect(g, cx, cy, true);
  if (had) R.upd++; else R.fresh++;
  R.scan[k] = g.tick; g.xv++;
  if (Object.keys(R.scan).length > SCAN_MAX) { const keep = Object.entries(R.scan).sort((a, b) => b[1] - a[1]).slice(0, SCAN_MAX / 2); R.scan = Object.fromEntries(keep); }
  radarPick(g, e);
}
export function radarCmd(g: Game, c: { op: string; k?: string; on?: boolean }): boolean {
  if (c.op === 'rflt' && FIND_KINDS.includes(c.k as FindKind)) { g.x.rs.flt[c.k as FindKind] = !!c.on; g.xv++; return true; }
  if (c.op === 'rfdel' && FIND_KINDS.includes(c.k as FindKind)) { g.x.rs.finds = g.x.rs.finds.filter(f => f.k !== c.k); g.xv++; return true; }
  return false;
}
