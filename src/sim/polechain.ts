import type { Game } from './game';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { CHUNK, type Dir } from '../core/types';

export const POLE_BATCH = 16;
export interface PoleRef { id: number; ghost: boolean; }
export interface PoleNode extends PoleRef { proto: string; x: number; y: number; w: number; h: number; dir: Dir; wire: number; }
export interface PoleRequest {
  t: 'poleChain'; gesture: number; seq: number; op: 'start' | 'extend' | 'cancel';
  proto: string; dir: Dir; ghost: boolean; x: number; y: number; anchor?: PoleRef;
  origin?: { x: number; y: number };
}
/** A bounded receipt/high-water mark; it never schedules construction or restores held input. */
export interface PoleReceipt { gesture: number; seq: number; closed: boolean; anchor: PoleRef | null; reason: string; }
export type PoleReceipts = Record<string, PoleReceipt>;
export interface PoleStep { x: number; y: number; reached: boolean; ok: boolean; reason: string; shortened: boolean; existing?: PoleNode; }
export interface PoleCheck { ok: boolean; reason?: string; existing?: PoleNode; terminal?: boolean; }
const coord = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -65_536 && n <= 65_535;
const refOk = (r: any): r is PoleRef => !!r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).sort().join(',') === 'ghost,id' && Number.isSafeInteger(r.id) && r.id > 0 && typeof r.ghost === 'boolean';
export const poleOwner = (g: Game) => g.v117.playerIds[g.pl] || `player-${g.pl + 1}`;

export function poleNode(g: Game, ref: PoleRef): PoleNode | null {
  const e = ref.ghost ? g.ghosts.get(ref.id) : g.ents.get(ref.id), p = e && PROTOS[e.proto];
  return e && p?.type === 'pole' && Number.isFinite(p.wire) && p.wire! > 0 ? { id: e.id, ghost: ref.ghost, proto: e.proto, x: e.x, y: e.y, w: e.w, h: e.h, dir: e.dir, wire: p.wire! } : null;
}
export function poleLink(a: PoleNode, b: { x: number; y: number; w: number; h: number; wire: number }) {
  return Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) <= Math.min(a.wire, b.wire);
}
/** DDA grid line: dominant axis advances one tile; .5 ties round toward +infinity.
 * Find the wire boundary by binary search, then inspect candidates farthest-first.
 * Both prediction and authority call this function; no state or world generation here. */
export function nextPole(a: PoleNode, w: number, h: number, wire: number, tx: number, ty: number,
  inspect: (x: number, y: number) => PoleCheck, origin?: { x: number; y: number }): PoleStep | null {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, ox = origin?.x ?? cx, oy = origin?.y ?? cy, dx = tx + w / 2 - ox, dy = ty + h / 2 - oy;
  const major = Math.max(Math.abs(dx), Math.abs(dy)), len = Math.hypot(dx, dy), limit = Math.min(a.wire, wire);
  if (!major || !Number.isFinite(limit) || limit <= 0) return null;
  const point = (i: number) => ({ x: Math.round(ox - w / 2 + i * dx / major), y: Math.round(oy - h / 2 + i * dy / major) });
  const along = (q: { x: number; y: number }) => ((q.x + w / 2 - cx) * dx + (q.y + h / 2 - cy) * dy) / len;
  const anchorIndex = Math.max(0, Math.floor(((cx - ox) * dx + (cy - oy) * dy) / len * (major / len)));
  let lo = anchorIndex, hi = Math.min(262_148, anchorIndex + Math.ceil((limit + 1) * (major / len)) + 2);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2), q = point(mid); if (poleLink(a, { ...q, w, h, wire })) lo = mid; else hi = mid - 1; }
  const boundary = point(lo), cursorProgress = ((tx + w / 2 - cx) * dx + (ty + h / 2 - cy) * dy) / len;
  const reached = cursorProgress >= along(boundary) && along(boundary) > 0;
  if (!reached) {
    const check: PoleCheck = poleLink(a, { ...boundary, w, h, wire }) ? inspect(boundary.x, boundary.y) : { ok: false, reason: 'Нет связанной доступной позиции' };
    return { ...boundary, reached: false, ok: check.ok, reason: check.reason || '', shortened: false, existing: check.existing };
  }
  let reason = 'Нет связанной доступной позиции';
  // Vanilla rays have at most 32 cells. The finite map-span bound above also
  // bounds mod rays, without dropping a valid shorter candidate after 512 cells.
  for (let i = lo; i >= anchorIndex; i--) {
    const q = point(i); if (along(q) <= .001 || !coord(q.x) || !coord(q.y)) continue;
    if (!poleLink(a, { ...q, w, h, wire })) continue;
    const check = inspect(q.x, q.y);
    if (check.terminal) return { ...q, reached: true, ok: false, reason: check.reason || reason, shortened: false };
    if (i === lo && !check.ok) reason = check.reason || reason;
    if (check.existing && (!poleLink(a, check.existing) ||
        ((check.existing.x + check.existing.w / 2 - cx) * dx + (check.existing.y + check.existing.h / 2 - cy) * dy) / len <= .001)) continue;
    if (check.ok) return { ...q, reached: true, ok: true, reason: i < lo ? reason : '', shortened: i < lo, existing: check.existing };
  }
  return { ...boundary, reached: true, ok: false, reason, shortened: false };
}
export function inspectPole(g: Game, proto: string, dir: Dir, ghost: boolean, x: number, y: number): PoleCheck {
  const p = PROTOS[proto], w = dir % 2 ? p.h : p.w, h = dir % 2 ? p.w : p.h;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++)
    if (!g.world.hasChunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) return { ok: false, reason: 'Участок карты не разведан' };
  const e = g.entAt(x, y), gh = ghost ? g.ghostAt(x, y) : null;
  const found = e?.t === 'pole' && e.x === x && e.y === y ? poleNode(g, { id: e.id, ghost: false }) :
    gh && gh.x === x && gh.y === y ? poleNode(g, { id: gh.id, ghost: true }) : null;
  if (found) return { ok: true, existing: found };
  if (g.ghostAt(x, y)) return { ok: false, reason: 'Место занято призраком' };
  if (!ghost && g.inv.count(proto) < 1) return { ok: false, reason: 'Нет предмета в инвентаре', terminal: true };
  const check = g.canPlace(proto, x, y, dir, !ghost);
  return check.replace ? { ok: false, reason: 'Место занято постройкой' } : { ...check, terminal: check.reason === 'Слишком далеко' || check.reason === 'Запрещено правилами испытания' };
}
export function applyPoleRequest(g: Game, c: PoleRequest) {
  const p = typeof c.proto === 'string' && PROTOS[c.proto];
  if (!p || p.type !== 'pole' || p.buildable === false || ITEMS[c.proto]?.place !== c.proto ||
      !Number.isFinite(p.wire) || p.wire! <= 0 || !Number.isSafeInteger(c.gesture) || c.gesture < 1 ||
      !Number.isSafeInteger(c.seq) || c.seq < 0 || c.seq > 1_000_000 || !['start', 'extend', 'cancel'].includes(c.op) ||
      !Number.isInteger(c.dir) || c.dir < 0 || c.dir > 3 || typeof c.ghost !== 'boolean' || !coord(c.x) || !coord(c.y) ||
      c.origin !== undefined && (!c.origin || !coord(c.origin.x) || !coord(c.origin.y) || Object.keys(c.origin).sort().join(',') !== 'x,y')) return;
  const owner = poleOwner(g);
  for (const key of Object.keys(g.poleReceipts)) if (!g.v117.playerIds.includes(key)) delete g.poleReceipts[key];
  const prev = Object.prototype.hasOwnProperty.call(g.poleReceipts, owner) ? g.poleReceipts[owner] : undefined;
  if (prev && (c.gesture < prev.gesture || c.gesture === prev.gesture && (c.seq <= prev.seq || prev.closed))) return;
  if ((!prev || c.gesture > prev.gesture) ? c.op !== 'start' || c.seq !== 0 : c.seq !== prev.seq + 1 || c.op === 'start') return;
  const receipt: PoleReceipt = { gesture: c.gesture, seq: c.seq, closed: false, anchor: prev?.gesture === c.gesture ? prev.anchor : null, reason: '' };
  g.poleReceipts[owner] = receipt;
  const stop = (reason: string) => { receipt.closed = true; receipt.reason = reason.slice(0, 256); if (reason) g.msg(receipt.reason); };
  if (c.op === 'cancel') return stop('');
  if (c.ghost && !g.mayBp()) return stop('Хост разрешил ставить чертежи только админам');
  const w = c.dir % 2 ? p.h : p.w, h = c.dir % 2 ? p.w : p.h;
  const place = (x: number, y: number, existing?: PoleNode): PoleNode | null => {
    if (existing) return existing;
    const e = c.ghost ? g.placeGhost(c.proto, x, y, c.dir) : g.build(c.proto, x, y, c.dir, true);
    return e ? poleNode(g, { id: e.id, ghost: c.ghost }) : null;
  };
  if (c.op === 'start') {
    if (!Number.isSafeInteger(c.x) || !Number.isSafeInteger(c.y)) return stop('Для опоры нужны целые координаты');
    const check = inspectPole(g, c.proto, c.dir, c.ghost, c.x, c.y);
    if (!check.ok) return stop(check.reason || 'Нельзя поставить опору');
    if (!c.ghost && check.existing && Math.hypot(check.existing.x + check.existing.w / 2 - g.player.x, check.existing.y + check.existing.h / 2 - g.player.y) > g.reach() + Math.max(check.existing.w, check.existing.h) / 2) return stop('Слишком далеко');
    const anchor = place(c.x, c.y, check.existing);
    if (!anchor) return stop('Не удалось поставить опору');
    receipt.anchor = { id: anchor.id, ghost: anchor.ghost }; return;
  }
  if (!refOk(c.anchor) || !receipt.anchor || c.anchor.id !== receipt.anchor.id || c.anchor.ghost !== receipt.anchor.ghost) return stop('Якорь цепочки изменился');
  let anchor = poleNode(g, c.anchor);
  if (!anchor) return stop('Якорь цепочки удалён');
  for (let n = 0; n < POLE_BATCH; n++) {
    const step = nextPole(anchor, w, h, p.wire!, c.x, c.y, (x, y) => inspectPole(g, c.proto, c.dir, c.ghost, x, y), c.origin);
    if (!step || !step.reached) return;
    if (!step.ok) return stop(step.reason);
    if (!poleLink(anchor, step.existing || { x: step.x, y: step.y, w, h, wire: p.wire! })) return stop('Нет связанной доступной позиции');
    const placed = place(step.x, step.y, step.existing);
    if (!placed || !poleLink(anchor, placed)) return stop('Не удалось продолжить связанную цепочку');
    anchor = placed; receipt.anchor = { id: anchor.id, ghost: anchor.ghost };
    if (step.shortened) receipt.reason = ('Укороченный шаг: ' + step.reason).slice(0, 256);
  }
}
export function validatePoleReceipts(value: unknown): asserts value is PoleReceipts {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) throw new Error('Некорректные подтверждения укладки опор');
  for (const [owner, r] of Object.entries(value as PoleReceipts)) {
    if (!/^player-[1-9][0-9]{0,12}$/.test(owner) || !r || Object.keys(r).sort().join(',') !== 'anchor,closed,gesture,reason,seq' ||
        !Number.isSafeInteger(r.gesture) || r.gesture < 1 || !Number.isSafeInteger(r.seq) || r.seq < 0 || r.seq > 1_000_000 ||
        typeof r.closed !== 'boolean' || typeof r.reason !== 'string' || r.reason.length > 256 || r.anchor !== null && !refOk(r.anchor)) throw new Error('Некорректные подтверждения укладки опор');
  }
}
