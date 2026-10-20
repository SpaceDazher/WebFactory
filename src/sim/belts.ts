// Конвейеры (8.1): 2 дорожки, по 4 предмета на клетку, позиции в целых 1/256 клетки.
import { DX, DY } from '../core/types';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import type { Entity, Game } from './game';
import { beltPulse } from './circuits';
import { OPT } from './perf';
import { beltLanePos } from './beltgeom';

// ---------- v1.9: спящие конвейеры ----------
// Лента, на которой за тик ничего не сдвинулось (пустая или забитая), засыпает: её updateBelt даст тот же результат,
// пока не изменится её содержимое или хвост ленты, куда она подаёт. Будят: вставка/перенос предмета (beltInsert,
// tryTransfer), забор манипулятором (Game.takeHand/takeOne), движение ленты ниже по течению (будит своих «подающих»),
// любая перестройка (beltVer — эпоха сна). Разделители не спят.
/** подпись содержимого спящей ленты: число предметов на дорожках (страховка от изменений мимо API — тесты, будущие моды) */
const lsig = (e: Entity) => { const l = e.lanes![0]; return l[0].length + l[1].length * 64; };
/** спит ли лента в этой эпохе (и её не меняли в обход beltTouched) */
export const asleep = (g: Game, e: Entity) => e._sl === g.beltVer + 1 && e._sn === lsig(e);
/** ленты, чей поток уходит на e (кэш по beltVer) */
export function feeders(g: Game, e: Entity): Entity[] {
  if (e._fdv === g.beltVer && e._fd) return e._fd;
  const out: Entity[] = [];
  const seen = (n: Entity) => out.includes(n);
  const test = (n: Entity | null) => {
    if (!n || n === e || !isBeltLike(n) || seen(n)) return;
    for (let s = 0; s < n.lanes!.length; s++) for (let L = 0; L < 2; L++) { const t = targetOf(g, n, s, L); if (t && t.e === e) { out.push(n); return; } }
  };
  for (let s = 0; s < e.lanes!.length; s++) { const [tx, ty] = segTile(e, s); for (let d = 0; d < 4; d++) test(g.entAt(tx + DX[d], ty + DY[d])); }
  if (e.t === 'underground' && e.ug === 'out' && e.partner != null) test(g.ents.get(e.partner) || null);
  e._fd = out; e._fdv = g.beltVer; return out;
}
/** содержимое ленты изменилось: разбудить её и тех, кто на неё подаёт */
export function beltTouched(g: Game, e: Entity) {
  e._sl = 0;
  const f = feeders(g, e); for (let i = 0; i < f.length; i++) f[i]._sl = 0;
}

export const LEN = 256, GAP = 64, MID = 128, END_STOP = 224;
/** n — размер стопки (v1.4, 1..4): стопочный манипулятор кладёт до 4 предметов на одно место ленты.
 *  Стопка едет как один предмет: разделитель и подземный конвейер её не делят, манипулятор забирает целиком. */
export interface BeltItem { item: string; pos: number; n: number; m?: number; instance?: import('./inventory').DroneStackState; }
export const BELT_STACK_MAX = 4;
export interface Target { e: Entity; seg: number; lane: number; mode: 'straight' | 'side'; }

export const isBeltLike = (e: Entity | null | undefined) => !!e && (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter');

/** номер сегмента сущности-конвейера, который лежит на клетке */
export function segAt(e: Entity, tx: number, ty: number) {
  if (e.t !== 'splitter') return 0;
  return (e.dir === 0 || e.dir === 2) ? tx - e.x : ty - e.y;
}
export function segTile(e: Entity, s: number): [number, number] {
  if (e.t !== 'splitter') return [e.x, e.y];
  return (e.dir === 0 || e.dir === 2) ? [e.x + s, e.y] : [e.x, e.y + s];
}
/** Куда уходит поток с клетки (tx,ty), которая смотрит в сторону d */
export function forwardTarget(g: Game, tx: number, ty: number, d: number, lane: number): Target | null {
  const nx = tx + DX[d], ny = ty + DY[d];
  const e = g.entAt(nx, ny);
  if (!e) return null;
  if (e.t === 'belt') {
    if (e.dir === d || e.curve === d) return { e, seg: 0, lane, mode: 'straight' };
    if (e.dir === (d + 2) % 4) return null;
    return { e, seg: 0, lane: (d + 2) % 4 === (e.dir + 3) % 4 ? 0 : 1, mode: 'side' };
  }
  if (e.t === 'underground') {
    if (e.ug !== 'in') return null;
    if (e.dir === d) return { e, seg: 0, lane, mode: 'straight' };
    if (e.dir === (d + 2) % 4) return null;
    return { e, seg: 0, lane: (d + 2) % 4 === (e.dir + 3) % 4 ? 0 : 1, mode: 'side' };
  }
  if (e.t === 'splitter' && e.dir === d) return { e, seg: segAt(e, nx, ny), lane, mode: 'straight' };
  return null;
}
function targetOf(g: Game, e: Entity, s: number, lane: number): Target | null {
  if (e._tgv !== g.beltVer || !e._tg) { e._tg = []; e._tgv = g.beltVer; }
  const k = s * 2 + lane; const c = e._tg[k];
  if (c !== undefined) return c;
  return (e._tg[k] = targetOfRaw(g, e, s, lane));
}
function targetOfRaw(g: Game, e: Entity, s: number, lane: number): Target | null {
  if (e.t === 'underground' && e.ug === 'in') {
    const p = e.partner != null ? g.ents.get(e.partner) : null;
    return p ? { e: p, seg: 0, lane, mode: 'straight' } : null;
  }
  const [tx, ty] = segTile(e, s);
  return forwardTarget(g, tx, ty, e.dir, lane);
}
/** Пересчитать «поворот» у конвейера по соседям */
export function updateCurve(g: Game, e: Entity) {
  if (e.t !== 'belt') return;
  e.curve = -1;
  const bx = e.x - DX[e.dir], by = e.y - DY[e.dir];
  const back = g.entAt(bx, by);
  if (isBeltLike(back) && back!.dir === e.dir && !(back!.t === 'underground' && back!.ug === 'in')) return;
  let feeders: number[] = [];
  for (const s of [(e.dir + 1) % 4, (e.dir + 3) % 4]) {
    const n = g.entAt(e.x + DX[s], e.y + DY[s]);
    if (isBeltLike(n) && n!.dir === (s + 2) % 4 && !(n!.t === 'underground' && n!.ug === 'in')) feeders.push(n!.dir);
  }
  if (feeders.length === 1) e.curve = feeders[0];
}
function findInsertPos(arr: BeltItem[]): number | null {
  let best = -1, distance = Infinity;
  const consider = (lo: number, hi: number) => {
    lo = Math.max(GAP, lo); hi = Math.min(LEN - GAP, hi);
    if (lo > hi) return;
    const pos = Math.max(lo, Math.min(MID, hi)), d = Math.abs(pos - MID);
    if (d < distance || (d === distance && pos < best)) { best = pos; distance = d; }
  };
  if (!arr.length) return MID;
  consider(arr[0].pos + GAP, LEN - GAP);
  for (let i = 0; i + 1 < arr.length; i++) consider(arr[i + 1].pos + GAP, arr[i].pos - GAP);
  consider(GAP, arr[arr.length - 1].pos - GAP);
  return best < 0 ? null : best;
}
function insertSorted(arr: BeltItem[], it: BeltItem) {
  let i = 0; while (i < arr.length && arr[i].pos > it.pos) i++; arr.splice(i, 0, it);
}
/** Положить предмет на дорожку (манипулятор/бур) в середину клетки */
export function beltInsert(e: Entity, s: number, lane: number, item: string, n = 1, g?: Game, instance?: import('./inventory').DroneStackState): boolean {
  if (ITEMS[item]?.droneModel ? (!instance || n !== 1) : !!instance) return false;
  const arr = e.lanes![s][lane];
  const pos = findInsertPos(arr); if (pos == null) return false;
  insertSorted(arr, { item, pos, n, ...(instance ? { instance: { ...instance } } : {}) }); if (e.cc) beltPulse(e, item, n);
  if (g) beltTouched(g, e); else e._sl = 0;
  return true;
}
export function beltSegLane(e: Entity, tx: number, ty: number) { return e.lanes![segAt(e, tx, ty)]; }

/** Дальняя дорожка относительно стороны k (направление от клетки конвейера к источнику) */
export function farLane(beltDir: number, k: number) {
  if (k === (beltDir + 3) % 4) return 1; // источник слева -> кладём направо
  if (k === (beltDir + 1) % 4) return 0;
  return 1;
}
export function nearLane(beltDir: number, k: number) { return 1 - farLane(beltDir, k); }

function tryTransfer(g: Game, t: Target, it: BeltItem, over: number): boolean {
  const arr = t.e.lanes![t.seg][t.lane];
  if (t.mode === 'straight') {
    const last = arr[arr.length - 1];
    if (last && last.pos - over < GAP) return false;
    arr.push({ item: it.item, pos: over, n: it.n, m: g.tick, ...(it.instance ? { instance: { ...it.instance } } : {}) }); if (t.e.cc) beltPulse(t.e, it.item, it.n); beltTouched(g, t.e); return true;
  }
  const pos = findInsertPos(arr); if (pos == null) return false;
  insertSorted(arr, { item: it.item, pos, n: it.n, m: g.tick, ...(it.instance ? { instance: { ...it.instance } } : {}) }); if (t.e.cc) beltPulse(t.e, it.item, it.n); beltTouched(g, t.e); return true;
}
/**
 * Обновить конвейер и всё, что ниже по течению, начиная с самого дальнего (1.0: раньше порядок был порядком постройки,
 * и при постройке «по течению» каждый стык клеток добавлял лишний тик зазора — пропускная способность была на
 * 11–27% ниже расчётной). Обход — итеративный DFS с пометкой тика, петли разрываются там, где обход в них вошёл.
 */
const dfs: Entity[] = [], dfsI: number[] = [], chain: Entity[] = [];
const hasItems = (e: Entity) => { for (const seg of e.lanes!) if (seg[0].length || seg[1].length) return true; return false; };
export function updateBeltChain(g: Game, e: Entity) {
  if (e._bt === g.tick) return;

  // пустой конвейер никого не ждёт, и порядок для него не важен
  if (!hasItems(e)) { e._bt = g.tick; upd(g, e); return; }
  if (e.t !== 'splitter') {
    // частый случай — цепочка обычных конвейеров: идём вниз по течению без стека обхода
    let n = 0, cur: Entity = e; e._bt = g.tick; chain[n++] = e;
    for (;;) {
      const t = targetOf(g, cur, 0, 0);
      if (!t || t.e._bt === g.tick || !t.e.lanes || !hasItems(t.e)) break;
      if (t.e.t === 'splitter') { updateBeltChain(g, t.e); break; }
      t.e._bt = g.tick; cur = t.e; chain[n++] = cur;
    }
    for (let i = n - 1; i >= 0; i--) upd(g, chain[i]);
    chain.length = 0; return;
  }
  e._bt = g.tick; dfs.length = 0; dfsI.length = 0; dfs.push(e); dfsI.push(0);
  while (dfs.length) {
    const top = dfs[dfs.length - 1], k = dfsI[dfs.length - 1];
    const nseg = top.lanes!.length;
    if (k < nseg) {
      dfsI[dfs.length - 1] = k + 1;
      const t = targetOf(g, top, k, 0);
      if (t && t.e._bt !== g.tick && t.e.lanes && hasItems(t.e)) { t.e._bt = g.tick; dfs.push(t.e); dfsI.push(0); }
      continue;
    }
    dfs.pop(); dfsI.pop(); upd(g, top);
  }
}
/** v1.9: обновить ленту в её очередь обхода; спящая — пропускается (её обновление ничего бы не изменило: всё, что могло
 *  на неё повлиять раньше в этом тике, уже разбудило её — порядок обхода и цепочки «вниз по течению» те же, что в v1.8) */
function upd(g: Game, e: Entity) {
  if (OPT.sleepBelts && asleep(g, e)) { g.prof.sleeping++; return; }
  g.prof.belts++; updateBelt(g, e);
}
export function updateBelt(g: Game, e: Entity) {
  if (e.coff) { e.moving = false; return; } // v1.5: выключен условием схемотехники
  let speed = e._spd!; if (e._spm !== g.beltSpeedMul) { speed = e._spd = Math.round((PROTOS[e.proto].speed || 8) * g.beltSpeedMul); e._spm = g.beltSpeedMul; }
  let moved = false, fresh0 = false; const tick = g.tick, lanes = e.lanes!, nseg = lanes.length, isSpl = e.t === 'splitter';
  for (let s = 0; s < nseg; s++) for (let L = 0; L < 2; L++) {
    const arr = lanes[s][L], n = arr.length;
    if (!n) continue;
    // головной предмет
    const head = arr[0];
    const fresh = head.m === tick; // уже сдвинут в этом тике (перешёл с предыдущей клетки)
    if (fresh) fresh0 = true;
    if (fresh) { /* ждём следующий тик */ } else if (isSpl) {
      if (head.pos < LEN) { const np = Math.min(LEN, head.pos + speed); if (np !== head.pos) moved = true; head.pos = np; }
      if (head.pos >= LEN) {
        const tog = e.toggle![L];
        const order = tog ? [1 - s, s] : [s, 1 - s];
        for (const o of order) {
          const t = targetOf(g, e, o, L);
          if (t && tryTransfer(g, t, head, 0)) { arr.shift(); e.toggle![L] = o === s ? 1 : 0; moved = true; break; }
        }
      }
    } else {
      const t = targetOf(g, e, s, L);
      let maxPos = END_STOP;
      if (t) {
        if (t.mode === 'straight') {
          const tarr = t.e.lanes![t.seg][t.lane];
          const last = tarr[tarr.length - 1];
          maxPos = last ? LEN + last.pos - GAP : LEN + speed;
          if (t.e === e && t.seg === s && t.lane === L) maxPos = LEN; // петля из одной клетки
        } else maxPos = LEN;
      }
      const np = Math.max(head.pos, Math.min(head.pos + speed, maxPos));
      if (np !== head.pos) moved = true;
      head.pos = np;
      if (head.pos >= LEN && t) {
        const over = head.pos - LEN;
        if (tryTransfer(g, t, head, over)) { arr.shift(); moved = true; }
        else head.pos = LEN;
      }
    }
    // остальные
    const n2 = arr.length; let i = arr[0] === head ? 1 : 0, prev = i ? head.pos : LEN + GAP;
    for (; i < n2; i++) {
      const it = arr[i], p = it.pos;
      if (it.m === tick) { fresh0 = true; prev = p; continue; }
      const lim = prev - GAP;
      if (p < lim) { const np = p + speed < lim ? p + speed : lim; it.pos = np; moved = true; prev = np; } else prev = p;
    }
  }
  e.moving = moved;
  // v1.9: сдвинулась — будим подающих (у них мог освободиться хвост); стоит — засыпает (кроме разделителя и свежих предметов)
  if (OPT.sleepBelts) { if (moved) { const f = feeders(g, e); for (let i = 0; i < f.length; i++) f[i]._sl = 0; } else if (!fresh0 && e.t !== 'splitter') { e._sl = g.beltVer + 1; e._sn = lsig(e); } }
}

/** позиция предмета на конвейере (центр, в клетках мира): сегмент s, полоса L, позиция 0..255 */
export function beltItemPos(e: Entity, s: number, L: number, pos: number): [number, number] {
  const [tx, ty] = segTile(e, s);
  return beltLanePos(tx, ty, e.dir, e.curve ?? -1, L, pos);
}

/** v1.16: подбор с обычного конвейера (действие «Подобрать»): предметы обеих дорожек в радиусе r от инженера, в устойчивом порядке
 *  «расстояние → id конвейера → дорожка → позиция»; забирается только то, что помещается в инвентарь, остаток остаётся на ленте */
export function beltPickup(g: Game, px: number, py: number, r: number): number {
  const c: { d: number; id: number; lane: number; pos: number; e: Entity; it: BeltItem }[] = [];
  for (let ty = Math.floor(py - r) - 1; ty <= Math.floor(py + r) + 1; ty++) for (let tx = Math.floor(px - r) - 1; tx <= Math.floor(px + r) + 1; tx++) {
    const e = g.entAt(tx, ty); if (!e || e.t !== 'belt' || e.x !== tx || e.y !== ty || !e.lanes) continue;
    const dx = DX[e.dir], dy = DY[e.dir], ox = -dy, oy = dx;
    for (let L = 0; L < 2; L++) for (const it of e.lanes[0][L]) {
      const t = it.pos / LEN - 0.5, o = L === 0 ? -0.25 : 0.25;
      const ix = e.x + 0.5 + dx * t + ox * o, iy = e.y + 0.5 + dy * t + oy * o, d = Math.hypot(ix - px, iy - py);
      if (d < r) c.push({ d, id: e.id, lane: L, pos: it.pos, e, it });
    }
  }
  c.sort((a, b) => a.d - b.d || a.id - b.id || a.lane - b.lane || a.pos - b.pos);
  let got = 0; const touched = new Set<Entity>();
  for (const q of c) {
    const n = q.it.n || 1;
    if (q.it.instance) {
      if (n !== 1 || !g.inv.addStack({ item: q.it.item, count: 1, instance: { ...q.it.instance } })) continue;
      got++; touched.add(q.e); const lane = q.e.lanes![0][q.lane], i = lane.indexOf(q.it); if (i >= 0) lane.splice(i, 1); continue;
    }
    const left = g.inv.add(q.it.item, n); if (left === n) continue;
    got += n - left; touched.add(q.e);
    if (left) q.it.n = left; else { const l = q.e.lanes![0][q.lane]; const i = l.indexOf(q.it); if (i >= 0) l.splice(i, 1); }
  }
  for (const e of touched) beltTouched(g, e);
  return got;
}
