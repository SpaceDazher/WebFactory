import { TICKS } from '../core/types';
import { noteBioGuideCollection } from './bioguide';
import type { Game, Player } from './game';
import { creepAt, harvestCreep, setCreepIntensity } from './enemies';

export const BIO_TICKS_PER_MINUTE = 60 * TICKS;
export const BIO_SAMPLE_RANGE = 2;
export const BIO_CELL_SIZE = 16;
export const BIO_CLEANUP_PER_TICK = 64;

export interface BioProfile { family: string; minutes: number; yield: number; sampleItem: string; }
export const BIO_PROFILES: Readonly<Record<string, BioProfile>> = Object.freeze({
  small: { family: 'crawler', minutes: 30, yield: 1, sampleItem: 'bio-sample-small' },
  medium: { family: 'crawler', minutes: 35, yield: 2, sampleItem: 'bio-sample-medium' },
  big: { family: 'crawler', minutes: 40, yield: 4, sampleItem: 'bio-sample-big' },
  spitter: { family: 'spitter', minutes: 35, yield: 2, sampleItem: 'bio-sample-spitter' },
  'spitter-big': { family: 'spitter', minutes: 40, yield: 4, sampleItem: 'bio-sample-spitter-big' },
  armored: { family: 'armored', minutes: 45, yield: 6, sampleItem: 'bio-sample-armored' },
  destroyer: { family: 'destroyer', minutes: 30, yield: 4, sampleItem: 'bio-sample-destroyer' },
  flyer: { family: 'flyer', minutes: 35, yield: 4, sampleItem: 'bio-sample-flyer' },
  brood: { family: 'brood', minutes: 45, yield: 8, sampleItem: 'bio-sample-brood' },
  giant: { family: 'giant', minutes: 45, yield: 10, sampleItem: 'bio-sample-giant' },
  queen: { family: 'queen', minutes: 50, yield: 24, sampleItem: 'bio-sample-queen' },
  'worm-small': { family: 'worm', minutes: 30, yield: 1, sampleItem: 'bio-sample-worm-small' },
  'worm-medium': { family: 'worm', minutes: 35, yield: 3, sampleItem: 'bio-sample-worm-medium' },
  'worm-big': { family: 'worm', minutes: 40, yield: 6, sampleItem: 'bio-sample-worm-big' },
  'worm-behemoth': { family: 'worm', minutes: 45, yield: 10, sampleItem: 'bio-sample-worm-behemoth' },
});
export function bioProfile(kind: string): BioProfile | undefined { return Object.prototype.hasOwnProperty.call(BIO_PROFILES, kind) ? BIO_PROFILES[kind] : undefined; }

export interface BioCorpse {
  id: number;
  sourceId: number;
  sourceType: 'unit' | 'worm';
  kind: string;
  family: string;
  x: number;
  y: number;
  deathTick: number;
  expiresTick: number;
  totalSamples: number;
  remainingSamples: number;
  selfDetonated?: true;
  burned?: true;
}
export type BioSampleMode = 'sample' | 'genetic' | 'cells';
export type BioSampling = ({ target: 'corpse'; id: number; left: number } | { target: 'slime'; x: number; y: number; left: number }) & { mode?: BioSampleMode };
export function bioLivingTicksLeft(g: Game, c: BioCorpse) {
  return c.burned || c.selfDetonated ? 0 : Math.max(0, Math.min(c.expiresTick, c.deathTick + 10 * BIO_TICKS_PER_MINUTE) - g.tick);
}
export function bioSampleProduct(c: BioCorpse, mode: BioSampleMode = 'sample') {
  return mode === 'genetic' ? 'genetic-probe-' + c.kind : mode === 'cells' ? 'viable-cell-' + c.kind : bioCorpseSampleItem(c);
}
export type BioTarget = { kind: 'corpse'; id: number } | { kind: 'slime'; x: number; y: number };
export type BioDelta = { upsert: BioCorpse[]; removed: number[] };
export interface BioRenderGroup { x: number; y: number; kind: string; count: number; remainingSamples: number; expiresTick: number; }
interface ExpiryBucket { count: number; x: number; y: number; remaining: number; }
interface BioGroupIndex { key: string; cell: string; kind: string; count: number; sumX: number; sumY: number; remaining: number; liveCount: number; liveX: number; liveY: number; liveRemaining: number; lastTick: number; buckets: Map<number, ExpiryBucket>; expiryHeap: number[]; }

interface BioIndex {
  backing: BioCorpse[];
  byId: Map<number, BioCorpse>;
  bySource: Map<string, number>;
  byCell: Map<string, Set<number>>;
  positions: Map<number, number>;
  expiry: { id: number; tick: number }[];
  groupById: Map<number, string>;
  groups: Map<string, BioGroupIndex>;
  groupsByCell: Map<string, Set<string>>;
}
type BioGame = Game & {
  bioCorpses: BioCorpse[];
  nextBioCorpseId: number;
  _bioIndex?: BioIndex;
  _bioPending?: { upsert: Map<number, BioCorpse>; removed: Set<number> };
  _bioTracking?: boolean;
};

const cellKey = (x: number, y: number) => `${Math.floor(Math.floor(x) / BIO_CELL_SIZE)},${Math.floor(Math.floor(y) / BIO_CELL_SIZE)}`;
const sourceKey = (type: BioCorpse['sourceType'], id: number) => `${type}:${id}`;
const compareExpiry = (a: { id: number; tick: number }, b: { id: number; tick: number }) => a.tick - b.tick || a.id - b.id;

function indexOf(g: Game): BioIndex {
  const b = g as BioGame;
  if (b._bioIndex?.backing === b.bioCorpses) return b._bioIndex;
  const ix: BioIndex = { backing: b.bioCorpses, byId: new Map(), bySource: new Map(), byCell: new Map(), positions: new Map(), expiry: [], groupById: new Map(), groups: new Map(), groupsByCell: new Map() };
  b._bioIndex = ix;
  for (let i = 0; i < b.bioCorpses.length; i++) indexRecord(ix, b.bioCorpses[i], i, g.tick);
  return ix;
}

function groupHeapPush(h: number[], tick: number) {
  h.push(tick); let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >>> 1; if (h[p] <= tick) break; h[i] = h[p]; i = p; }
  h[i] = tick;
}
function groupHeapPop(h: number[]) {
  const top = h[0], last = h.pop()!;
  if (h.length) { let i = 0; while (true) { const l = i * 2 + 1, r = l + 1; if (l >= h.length) break; const c = r < h.length && h[r] < h[l] ? r : l; if (last <= h[c]) break; h[i] = h[c]; i = c; } h[i] = last; }
  return top;
}
function groupAt(ix: BioIndex, c: BioCorpse, tick: number) {
  const cell = cellKey(c.x, c.y), tile = `${Math.floor(c.x)},${Math.floor(c.y)}`, key = `${cell}|${tile}|${c.kind}`;
  let group = ix.groups.get(key);
  if (!group) {
    group = { key, cell, kind: c.kind, count: 0, sumX: 0, sumY: 0, remaining: 0, liveCount: 0, liveX: 0, liveY: 0, liveRemaining: 0, lastTick: tick, buckets: new Map(), expiryHeap: [] };
    ix.groups.set(key, group); let set = ix.groupsByCell.get(cell); if (!set) ix.groupsByCell.set(cell, set = new Set()); set.add(key);
  }
  return group;
}
function updateGroupTick(group: BioGroupIndex, tick: number) {
  if (tick <= group.lastTick) return;
  while (group.expiryHeap.length && group.expiryHeap[0] <= tick) {
    const expiry = groupHeapPop(group.expiryHeap), bucket = group.buckets.get(expiry); if (!bucket) continue;
    group.liveCount -= bucket.count; group.liveX -= bucket.x; group.liveY -= bucket.y; group.liveRemaining -= bucket.remaining; group.buckets.delete(expiry);
  }
  group.lastTick = tick;
}
function indexRecord(ix: BioIndex, c: BioCorpse, pos: number, tick: number) {
  ix.byId.set(c.id, c); ix.bySource.set(sourceKey(c.sourceType, c.sourceId), c.id); ix.positions.set(c.id, pos);
  let set = ix.byCell.get(cellKey(c.x, c.y)); if (!set) ix.byCell.set(cellKey(c.x, c.y), set = new Set()); set.add(c.id);
  heapPush(ix.expiry, { id: c.id, tick: c.expiresTick });
  const group = groupAt(ix, c, tick); updateGroupTick(group, tick);
  group.count++; group.sumX += c.x; group.sumY += c.y; group.remaining += c.remainingSamples;
  if (c.expiresTick > tick) {
    let bucket = group.buckets.get(c.expiresTick);
    if (!bucket) { bucket = { count: 0, x: 0, y: 0, remaining: 0 }; group.buckets.set(c.expiresTick, bucket); groupHeapPush(group.expiryHeap, c.expiresTick); }
    group.liveCount++; group.liveX += c.x; group.liveY += c.y; group.liveRemaining += c.remainingSamples;
    bucket.count++; bucket.x += c.x; bucket.y += c.y; bucket.remaining += c.remainingSamples;
  }
  ix.groupById.set(c.id, group.key);
}
function heapPush(h: BioIndex['expiry'], e: { id: number; tick: number }) {
  h.push(e); let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >>> 1; if (compareExpiry(h[p], e) <= 0) break; h[i] = h[p]; i = p; }
  h[i] = e;
}
function heapPop(h: BioIndex['expiry']) {
  const top = h[0], last = h.pop()!;
  if (h.length) { let i = 0; while (true) { const l = i * 2 + 1, r = l + 1; if (l >= h.length) break; const c = r < h.length && compareExpiry(h[r], h[l]) < 0 ? r : l; if (compareExpiry(last, h[c]) <= 0) break; h[i] = h[c]; i = c; } h[i] = last; }
  return top;
}
function pendingOf(g: BioGame) { return g._bioPending ||= { upsert: new Map(), removed: new Set() }; }
function queueUpsert(g: BioGame, c: BioCorpse) { if (!g._bioTracking) return; const p = pendingOf(g); p.upsert.set(c.id, { ...c }); p.removed.delete(c.id); }
function queueRemove(g: BioGame, id: number) { if (!g._bioTracking) return; const p = pendingOf(g); p.upsert.delete(id); p.removed.add(id); }
export function setBioDeltaTracking(g: Game, tracking: boolean) { (g as BioGame)._bioTracking = tracking; if (!tracking) (g as BioGame)._bioPending = undefined; }

function removeRecord(g: BioGame, ix: BioIndex, id: number, send = true) {
  const c = ix.byId.get(id), pos = ix.positions.get(id); if (!c || pos == null) return false;
  const set = ix.byCell.get(cellKey(c.x, c.y)); set?.delete(id); if (set?.size === 0) ix.byCell.delete(cellKey(c.x, c.y));
  ix.byId.delete(id); ix.bySource.delete(sourceKey(c.sourceType, c.sourceId)); ix.positions.delete(id);
  const groupKey = ix.groupById.get(id), group = groupKey ? ix.groups.get(groupKey) : undefined;
  if (group) {
    const bucket = group.buckets.get(c.expiresTick);
    group.count--; group.sumX -= c.x; group.sumY -= c.y; group.remaining -= c.remainingSamples;
    if (bucket) { bucket.count--; bucket.x -= c.x; bucket.y -= c.y; bucket.remaining -= c.remainingSamples; if (!bucket.count) group.buckets.delete(c.expiresTick); }
    if (c.expiresTick > group.lastTick) { group.liveCount--; group.liveX -= c.x; group.liveY -= c.y; group.liveRemaining -= c.remainingSamples; }
    ix.groupById.delete(id);
    if (!group.count) { ix.groups.delete(group.key); const cells = ix.groupsByCell.get(group.cell); cells?.delete(group.key); if (cells?.size === 0) ix.groupsByCell.delete(group.cell); }
  }
  const last = g.bioCorpses.pop()!;
  if (pos < g.bioCorpses.length) { g.bioCorpses[pos] = last; ix.positions.set(last.id, pos); }
  if (send) queueRemove(g, id);
  return true;
}

export function rebuildBioIndex(g: Game) { const b = g as BioGame; b._bioIndex = undefined; return indexOf(g); }

export function createBioCorpse(g: Game, sourceType: BioCorpse['sourceType'], sourceId: number, kind: string, x: number, y: number, selfDetonated = false, burned = false): BioCorpse | null {
  const b = g as BioGame, p = bioProfile(kind);
  if (!p || (sourceType !== 'unit' && sourceType !== 'worm') || !Number.isSafeInteger(sourceId) || sourceId < 1 || !Number.isSafeInteger(b.nextBioCorpseId) || b.nextBioCorpseId < 1 || b.nextBioCorpseId >= Number.MAX_SAFE_INTEGER || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 65536 || Math.abs(y) > 65536 || selfDetonated && kind !== 'destroyer') return null;
  if ((sourceType === 'worm') !== kind.startsWith('worm-')) return null;
  const ix = indexOf(g), existing = ix.bySource.get(sourceKey(sourceType, sourceId));
  if (existing != null) {
    const prior = ix.byId.get(existing);
    if (prior && prior.expiresTick > g.tick) return prior;
    if (prior) removeRecord(b, ix, prior.id);
  }
  const n = kind === 'destroyer' && selfDetonated ? 2 : p.yield;
  const c: BioCorpse = { id: b.nextBioCorpseId++, sourceId, sourceType, kind, family: p.family, x, y, deathTick: g.tick, expiresTick: g.tick + p.minutes * BIO_TICKS_PER_MINUTE, totalSamples: n, remainingSamples: n, ...(selfDetonated ? { selfDetonated: true as const } : {}), ...(burned ? { burned: true as const } : {}) };
  const pos = b.bioCorpses.length; b.bioCorpses.push(c); indexRecord(ix, c, pos, g.tick); queueUpsert(b, c); return c;
}

export function findBioCorpse(g: Game, id: number): BioCorpse | undefined {
  const c = indexOf(g).byId.get(id); return c && c.expiresTick > g.tick ? c : undefined;
}

export function nearbyBioCorpses(g: Game, x: number, y: number, radius: number, limit = Number.MAX_SAFE_INTEGER, budget = Number.MAX_SAFE_INTEGER, family?: string | null, accept?: (c: BioCorpse) => boolean): BioCorpse[] {
  if (![x, y, radius, limit, budget].every(Number.isFinite) || radius < 0 || radius > 64 || limit < 1 || budget < 1) return [];
  limit = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(limit)); budget = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(budget));
  const ix = indexOf(g), out: BioCorpse[] = []; let inspected = 0;
  const x0 = Math.floor((x - radius) / BIO_CELL_SIZE), x1 = Math.floor((x + radius) / BIO_CELL_SIZE), y0 = Math.floor((y - radius) / BIO_CELL_SIZE), y1 = Math.floor((y + radius) / BIO_CELL_SIZE);
  scan: for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const id of ix.byCell.get(`${cx},${cy}`) || []) {
    // Expired records can remain in this spatial bucket while bounded cleanup
    // works through its queue. They are absent from canonical saves, so they
    // must not consume the live-candidate budget or change replay selection.
    const c = ix.byId.get(id); if (!c || c.expiresTick <= g.tick || c.remainingSamples < 1 || family && c.family !== family) continue;
    if (Math.hypot(c.x - x, c.y - y) > radius || accept && !accept(c)) continue;
    if (inspected++ >= budget) break scan;
    out.push(c);
    if (out.length > limit) { out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id); out.length = limit; }
  }
  out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id); return out;
}

/** Count active claims so manual and automatic sampling share one atomic reservation rule. */
export function bioTargetReservations(g: Game, target: BioTarget): number {
  let count = 0;
  const same = (other: any) => target.kind === 'corpse'
    ? other?.kind === 'corpse' && other.id === target.id
    : other?.kind === 'slime' && other.x === target.x && other.y === target.y;
  for (const robot of (g as any).bioRobots || []) if (robot.target && same(robot.target)) count++;
  const players = new Set<any>();
  players.add(g.player);
  for (const peer of g.peers || []) if (peer?.player) players.add(peer.player);
  for (const player of players) {
    const task = player?.bioSampling;
    if (target.kind === 'corpse' ? task?.target === 'corpse' && task.id === target.id
      : task?.target === 'slime' && task.x === target.x && task.y === target.y) count++;
  }
  return count;
}

/** Commit one corpse sample only when delivery can be committed in the same synchronous turn. */
export function commitBioCorpseSample(g: Game, id: number, deliver: (item: string, commit: boolean) => boolean, mode: BioSampleMode = 'sample'): string | null {
  const c = findBioCorpse(g, id);
  if (!c || c.expiresTick <= g.tick + 1 || c.remainingSamples < 1) return null;
  if (mode !== 'sample' && mode !== 'genetic' && mode !== 'cells' || mode === 'cells' && bioLivingTicksLeft(g, c) <= 0) return null;
  const item = bioSampleProduct(c, mode);
  if (!item || !deliver(item, false) || !deliver(item, true)) return null;
  const before = c.remainingSamples; c.remainingSamples--; refreshRenderGroup(g, c, before); queueUpsert(g as BioGame, c);
  return item;
}

/** Remove one true sample of slime, or clean a sub-capsule film without creating an item. */
export function commitBioSlimeSample(g: Game, x: number, y: number, deliver: (item: string, commit: boolean) => boolean): string | null | undefined {
  const intensity = creepAt(g, x, y); if (intensity < 1) return undefined;
  const amount = Math.min(64, intensity), product = amount === 64;
  if (product && !deliver('raw-slime-capsule', false)) return undefined;
  const removed = harvestCreep(g, x, y, amount);
  if (removed !== amount) return undefined;
  if (product && !deliver('raw-slime-capsule', true)) { setCreepIntensity(g, x, y, intensity); return undefined; }
  return product ? 'raw-slime-capsule' : null;
}

/** Query aggregated art without walking each corpse; exact selection can still page the ID index on demand. */
export function bioCorpseRenderGroups(g: Game, x0: number, y0: number, x1: number, y1: number, limit = 640): BioRenderGroup[] {
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 < x0 || y1 < y0 || limit < 1) return [];
  const ix = indexOf(g), out: BioRenderGroup[] = [];
  const cx0 = Math.floor(x0 / BIO_CELL_SIZE), cx1 = Math.floor(x1 / BIO_CELL_SIZE), cy0 = Math.floor(y0 / BIO_CELL_SIZE), cy1 = Math.floor(y1 / BIO_CELL_SIZE);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const cell = `${cx},${cy}`;
    for (const key of ix.groupsByCell.get(cell) || []) {
      const group = ix.groups.get(key); if (!group) continue; updateGroupTick(group, g.tick); if (!group.liveCount) continue;
      while (group.expiryHeap.length && !group.buckets.has(group.expiryHeap[0])) groupHeapPop(group.expiryHeap);
      const expiresTick = group.expiryHeap[0] ?? Number.MAX_SAFE_INTEGER;
      out.push({ x: group.liveX / group.liveCount, y: group.liveY / group.liveCount, kind: group.kind, count: group.liveCount, remainingSamples: Math.max(0, group.liveRemaining), expiresTick });
    }
  }
  if (out.length > limit) { out.sort((a, b) => b.count - a.count || a.expiresTick - b.expiresTick || a.kind.localeCompare(b.kind)); out.length = limit; }
  return out;
}

/** Refresh group-level sample counts after a partial harvest. */
function refreshRenderGroup(g: Game, c: BioCorpse, before: number) {
  const ix = indexOf(g), key = ix.groupById.get(c.id), group = key ? ix.groups.get(key) : undefined;
  if (!group) return;
  const diff = c.remainingSamples - before, bucket = group.buckets.get(c.expiresTick);
  group.remaining += diff; group.liveRemaining += c.expiresTick > g.tick ? diff : 0; if (bucket) bucket.remaining += diff;
}

export function clearBioCorpse(g: Game, id: number): boolean {
  const b = g as BioGame, c = findBioCorpse(g, id); if (!c) return false;
  return removeRecord(b, indexOf(g), id);
}

/** Expiry is observable at its exact tick; bounded physical cleanup keeps maintenance predictable. */
export function expireBioCorpses(g: Game, budget = BIO_CLEANUP_PER_TICK): number {
  const b = g as BioGame, ix = indexOf(g); let n = 0;
  let inspected = 0;
  while (inspected < budget && ix.expiry.length && ix.expiry[0].tick <= g.tick) {
    const e = heapPop(ix.expiry); inspected++; if (ix.byId.has(e.id)) { removeRecord(b, ix, e.id); n++; }
  }
  return n;
}

export function takeBioDelta(g: Game): BioDelta | null {
  const b = g as BioGame, p = pendingOf(b); if (!p.upsert.size && !p.removed.size) return null;
  const delta: BioDelta = { upsert: [...p.upsert.values()].sort((a, c) => a.id - c.id), removed: [...p.removed].sort((a, c) => a - c) };
  p.upsert.clear(); p.removed.clear(); return delta;
}

/** Restore an unacknowledged Worker snapshot delta so a failed structured clone is retried. */
export function restoreBioDelta(g: Game, delta: BioDelta) {
  const b = g as BioGame;
  for (const id of delta.removed) queueRemove(b, id);
  for (const c of delta.upsert) queueUpsert(b, c);
}

export function applyBioDelta(g: Game, delta: BioDelta) {
  const b = g as BioGame, ix = indexOf(g);
  for (const id of delta.removed) removeRecord(b, ix, id, false);
  for (const c of delta.upsert) {
    if (c.expiresTick <= g.tick) continue;
    const old = ix.byId.get(c.id); if (old) removeRecord(b, ix, c.id, false);
    const pos = b.bioCorpses.length; b.bioCorpses.push({ ...c }); indexRecord(ix, b.bioCorpses[pos], pos, g.tick);
    b.nextBioCorpseId = Math.max(b.nextBioCorpseId, c.id + 1);
  }
}

export function bioCorpseSampleItem(c: BioCorpse) { return bioProfile(c.kind)?.sampleItem || ''; }
export function bioTicksLeft(g: Game, c: BioCorpse) { return Math.max(0, c.expiresTick - g.tick); }

function say(g: Game, key: string) { g.msg(key); }
function sampleReason(g: Game, item: string, sample: string, mode: BioSampleMode = 'sample') {
  if (g.inv.count('empty-bio-capsule') < 1) return 'Нет пустой капсулы';
  // Removing the last capsule can open a slot; account for that before deciding
  // whether the output fits. Completion still repeats the check transactionally.
  const freesSlot = g.inv.slots.some(s => (s?.item === item || mode !== 'sample' && s?.item === 'culture-preservation-kit') && s.count === 1);
  if (g.inv.spaceFor(sample) < 1 && !freesSlot) return 'Инвентарь полон';
  return '';
}
function validResearch(g: Game) { return g.research.done.has('bio-sampling'); }
function hasSampler(g: Game) { return g.inv.count('bio-sampler') > 0; }

export function startBioSampling(g: Game, target: { id: number } | { x: number; y: number } | null, cancel = false, mode: 'sample' | 'genetic' | 'cells' = 'sample'): boolean {
  const pl = g.player as Player & { bioSampling?: BioSampling | null };
  if (cancel) { if (pl.bioSampling) { pl.bioSampling = null; say(g, 'Забор биоматериала отменён'); } return true; }
  if (pl.dead) { say(g, 'Нельзя собирать биоматериал после гибели инженера'); return false; }
  if (!validResearch(g)) { say(g, 'Требуется исследование «Биосбор Роя»'); return false; }
  if (mode !== 'sample' && mode !== 'genetic' && mode !== 'cells') { say(g, 'Неизвестный режим биосбора'); return false; }
  if (mode === 'genetic' && !g.research.done.has('swarm-genomics')) { say(g, 'Для отбора генетической пробы нужна «Геномика Роя»'); return false; }
  if (mode === 'cells' && !g.research.done.has('cellular-sampling')) { say(g, 'Для живых клеток требуется «Сохранение живых клеток»'); return false; }
  if (!hasSampler(g)) { say(g, 'Нужен биосборник в инвентаре'); return false; }
  if (!target || typeof target !== 'object' || Array.isArray(target) || !((Object.keys(target).length === 1 && 'id' in target && Number.isSafeInteger(target.id) && target.id > 0) || (Object.keys(target).length === 2 && 'x' in target && 'y' in target && Number.isSafeInteger(target.x) && Number.isSafeInteger(target.y) && Math.abs(target.x) <= 65536 && Math.abs(target.y) <= 65536))) { say(g, 'Цель биосбора недоступна'); return false; }
  // Competing samplers may start together. The shared commit helpers below
  // choose the winner and refund a physical empty capsule to any loser.
  if ('id' in target) {
    const c = findBioCorpse(g, target.id);
    if (!c) { say(g, 'Останки уже исчезли'); return false; }
    if (Math.hypot(c.x - pl.x, c.y - pl.y) > BIO_SAMPLE_RANGE) { say(g, 'Подойдите к останкам ближе'); return false; }
    if (c.remainingSamples < 1) { say(g, 'В останках больше нет проб'); return false; }
    if (mode !== 'sample' && g.inv.count('culture-preservation-kit') < 1) { say(g, 'Нужен набор консервации культур'); return false; }
    if (mode === 'cells' && (c.selfDetonated || c.burned || g.tick - c.deathTick >= 10 * BIO_TICKS_PER_MINUTE)) { say(g, 'Жизнеспособность донорских клеток уже утрачена'); return false; }
    const output = bioSampleProduct(c, mode);
    const reason = sampleReason(g, 'empty-bio-capsule', output, mode); if (reason) { say(g, reason); return false; }
    if (pl.bioSampling?.target === 'corpse' && pl.bioSampling.id === c.id && (pl.bioSampling.mode || 'sample') === mode) return true;
    pl.bioSampling = { target: 'corpse', id: c.id, left: 3 * TICKS, ...(mode !== 'sample' ? { mode } : {}) };
  } else {
    if (mode !== 'sample') { say(g, 'Генетические и клеточные пробы собираются только с останков Роя'); return false; }
    if (Math.hypot(Math.floor(target.x) + 0.5 - pl.x, Math.floor(target.y) + 0.5 - pl.y) > BIO_SAMPLE_RANGE) { say(g, 'Подойдите к клетке слизи ближе'); return false; }
    if (creepAt(g, target.x, target.y) < 1) { say(g, 'В этой клетке нет слизи'); return false; }
    const intensity = creepAt(g, target.x, target.y);
    if (intensity >= 64) { const reason = sampleReason(g, 'empty-bio-capsule', 'raw-slime-capsule'); if (reason) { say(g, reason); return false; } }
    if (pl.bioSampling?.target === 'slime' && pl.bioSampling.x === target.x && pl.bioSampling.y === target.y) return true;
    pl.bioSampling = { target: 'slime', x: target.x, y: target.y, left: 2 * TICKS };
  }
  say(g, 'Забор биоматериала начат'); return true;
}

function finishCorpseSample(g: Game, p: BioSampling & { target: 'corpse' }) {
  const c = findBioCorpse(g, p.id); if (!c || c.expiresTick <= g.tick + 1) return 'Останки истекли до завершения забора';
  if (Math.hypot(c.x - g.player.x, c.y - g.player.y) > BIO_SAMPLE_RANGE) return 'Забор остановлен: цель слишком далеко';
  if (c.remainingSamples < 1) return 'Цель уже собрана';
  const mode = p.mode || 'sample';
  if (mode !== 'sample' && mode !== 'genetic' && mode !== 'cells') return 'Неизвестный режим биосбора';
  if (mode === 'cells' && (c.selfDetonated || c.burned || g.tick - c.deathTick >= 10 * BIO_TICKS_PER_MINUTE)) return 'Жизнеспособность донорских клеток утрачена до завершения забора';
  if (mode !== 'sample' && !g.research.done.has(mode === 'genetic' ? 'swarm-genomics' : 'cellular-sampling')) return 'Исследование режима биосбора недоступно';
  const output = bioSampleProduct(c, mode);
  if (mode !== 'sample' && g.inv.count('culture-preservation-kit') < 1) return 'Нужен набор консервации культур';
  const reason = sampleReason(g, 'empty-bio-capsule', output, mode);
  if (reason) return reason;
  if (mode !== 'sample' && g.inv.remove('culture-preservation-kit', 1) !== 1) return 'Нет набора консервации культур';
  if (g.inv.remove('empty-bio-capsule', 1) !== 1) { if (mode !== 'sample') g.inv.add('culture-preservation-kit', 1); return 'Нет пустой капсулы'; }
  const committed = commitBioCorpseSample(g, c.id, (_product, commit) => {
    if (!commit) return g.inv.spaceFor(output) > 0;
    return g.inv.add(output, 1) === 0;
  }, mode);
  if (!committed) {
    g.inv.add('empty-bio-capsule', 1);
    if (mode !== 'sample') g.inv.add('culture-preservation-kit', 1);
    return 'Проба уже собрана или инвентарь полон';
  }
  g.cons('empty-bio-capsule');
  if (mode !== 'sample') g.cons('culture-preservation-kit');
  g.prod(output);
  if (mode === 'sample' && c.kind === 'small') noteBioGuideCollection(g, 'small');
  return mode === 'genetic' ? 'Генетическая проба собрана' : mode === 'cells' ? 'Донорские клетки законсервированы' : 'Проба собрана';
}
function finishSlimeSample(g: Game, p: BioSampling & { target: 'slime' }) {
  if (Math.hypot(Math.floor(p.x) + 0.5 - g.player.x, Math.floor(p.y) + 0.5 - g.player.y) > BIO_SAMPLE_RANGE) return 'Забор остановлен: цель слишком далеко';
  const intensity = creepAt(g, p.x, p.y); if (intensity < 1) return 'В этой клетке больше нет слизи';
  const amount = Math.min(64, intensity), product = amount === 64;
  if (product) { const reason = sampleReason(g, 'empty-bio-capsule', 'raw-slime-capsule'); if (reason) return reason; }
  if (product && g.inv.remove('empty-bio-capsule', 1) !== 1) return 'Нет пустой капсулы';
  const result = commitBioSlimeSample(g, p.x, p.y, (item, commit) => {
    if (!commit) return g.inv.spaceFor(item) > 0;
    return g.inv.add(item, 1) === 0;
  });
  if (result === undefined) { if (product) g.inv.add('empty-bio-capsule', 1); return 'Слизь изменилась или инвентарь полон'; }
  if (product) { g.cons('empty-bio-capsule'); g.prod('raw-slime-capsule'); noteBioGuideCollection(g, 'slime'); }
  return product ? 'Капсула сырой слизи собрана' : 'Остаток слизи очищен без пробы';
}

export function stepBioSampling(g: Game) {
  const pl = g.player as Player & { bioSampling?: BioSampling | null }, task = pl.bioSampling;
  if (!task) return;
  if (pl.dead) { pl.bioSampling = null; say(g, 'Забор остановлен: инженер погиб'); return; }
  if (!validResearch(g)) { pl.bioSampling = null; say(g, 'Забор остановлен: исследование недоступно'); return; }
  if (!hasSampler(g)) { pl.bioSampling = null; say(g, 'Забор остановлен: биосборник убран'); return; }
  if (task.target === 'corpse') {
    const c = findBioCorpse(g, task.id);
    if (!c) { pl.bioSampling = null; say(g, 'Забор остановлен: останки истекли'); return; }
    if (Math.hypot(c.x - pl.x, c.y - pl.y) > BIO_SAMPLE_RANGE) { pl.bioSampling = null; say(g, 'Забор остановлен: цель слишком далеко'); return; }
  } else {
    if (Math.hypot(Math.floor(task.x) + 0.5 - pl.x, Math.floor(task.y) + 0.5 - pl.y) > BIO_SAMPLE_RANGE) { pl.bioSampling = null; say(g, 'Забор остановлен: цель слишком далеко'); return; }
  }
  task.left--;
  if (task.left > 0) return;
  const message = task.target === 'corpse' ? finishCorpseSample(g, task) : finishSlimeSample(g, task);
  pl.bioSampling = null; say(g, message);
}

/** Drop corpse jobs that became impossible during this tick before a save or snapshot can observe them. */
export function cancelUnavailableBioSampling(g: Game) {
  g.eachPl(() => {
    const pl = g.player as Player & { bioSampling?: BioSampling | null }, task = pl.bioSampling;
    if (task?.target !== 'corpse') return;
    const corpse = findBioCorpse(g, task.id);
    if (corpse && corpse.remainingSamples > 0) return;
    pl.bioSampling = null;
    say(g, corpse ? 'Цель уже собрана' : 'Останки уже исчезли');
  });
}



