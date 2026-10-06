// Электросети (8.5, union-find) и жидкостные сети (8.6, «одна сеть — один бак»).
import { DX, DY, rotLocal } from '../core/types';
import { PROTOS } from '../data/entities';
import type { Entity, Game } from './game';
import { energyMul } from './modules';
import { OPT, powerList } from './perf';

export interface PowerNet { id: number; poles: number[]; demand: number; supply: number; satisfaction: number; load: number; hist: { d: number; s: number }[];
  stored?: number; storeCap?: number; accFlow?: number; solar?: number; steam?: number; }
export interface FluidNet { id: number; fluid: string | null; amount: number; cap: number; nodes: [number, number][]; conflict: boolean; filtered?: boolean; }

export function isElectric(e: Entity) { const p = PROTOS[e.proto]; return p.energy?.kind === 'electric' || p.type === 'engine' || p.type === 'solar' || p.type === 'accumulator'; }

function find(par: Map<number, number>, a: number): number { while (par.get(a) !== a) { const p = par.get(par.get(a)!)!; par.set(a, p); a = p; } return a; }

export function rebuildPower(g: Game) {
  const poles: Entity[] = [];
  for (const e of g.ents.values()) { if (e.t === 'pole') poles.push(e); e._net = -1; }
  const par = new Map<number, number>();
  for (const p of poles) par.set(p.id, p.id);
  g.wires = []; g.powerVer++;
  const pair = (a: Entity, b: Entity) => {
    const reach = Math.min(PROTOS[a.proto].wire!, PROTOS[b.proto].wire!);
    if (Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) <= reach) {
      g.wires.push([a.id, b.id]);
      const ra = find(par, a.id), rb = find(par, b.id); if (ra !== rb) par.set(ra, rb);
    }
  };
  if (OPT.gridPoles && poles.length > 64) {
    // v1.9: те же пары (i < j) в том же порядке, но кандидаты — только из соседних ячеек сетки размером с самый длинный провод
    let R = 1; for (const p of poles) R = Math.max(R, PROTOS[p.proto].wire!);
    const C = Math.ceil(R) + 2, cell = new Map<number, number[]>();
    const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
    poles.forEach((p, i) => { const k = key(Math.floor(p.x / C), Math.floor(p.y / C)); const a = cell.get(k); if (a) a.push(i); else cell.set(k, [i]); });
    const cand: number[] = [];
    for (let i = 0; i < poles.length; i++) {
      const a = poles[i], cx = Math.floor(a.x / C), cy = Math.floor(a.y / C); cand.length = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = cell.get(key(cx + dx, cy + dy)); if (l) for (const j of l) if (j > i) cand.push(j); }
      cand.sort((x, y) => x - y);
      for (const j of cand) pair(a, poles[j]);
    }
  } else for (let i = 0; i < poles.length; i++) for (let j = i + 1; j < poles.length; j++) pair(poles[i], poles[j]);
  const old = g.powerNets; g.powerNets = new Map();
  for (const p of poles) {
    const r = find(par, p.id);
    let n = g.powerNets.get(r);
    if (!n) { const o = old.get(r); n = { id: r, poles: [], demand: 0, supply: 0, satisfaction: o ? o.satisfaction : 0, load: 0, hist: o ? o.hist : [] }; g.powerNets.set(r, n); }
    n.poles.push(p.id); p._net = r;
  }
  for (const p of poles) {
    const s = PROTOS[p.proto].supply!;
    for (let y = p.y - s; y <= p.y + p.h - 1 + s; y++) for (let x = p.x - s; x <= p.x + p.w - 1 + s; x++) {
      const e = g.entAt(x, y);
      if (e && e._net === -1 && isElectric(e)) e._net = p._net!;
    }
  }
}

/** Порядок за тик (8.5): спрос → солнце → аккумуляторы → пар. Излишек заряжает аккумуляторы,
 *  паровые двигатели работают только на «спрос + заряд» — топливо не тратится зря. */
export function stepPower(g: Game) {
  const day = g.daylight();
  const per = new Map<number, { D: number; S: number; E: number; eng: Entity[]; acc: Entity[]; sol: Entity[] }>();
  for (const n of g.powerNets.values()) per.set(n.id, { D: 0, S: 0, E: 0, eng: [], acc: [], sol: [] });
  // v1.9: энергия для статистики (кДж за тик): потребление — по удовлетворённости сети на прошлом тике
  const ec = g.pstats.ec, ep = g.pstats.ep;
  for (const e of (OPT.powerLists ? powerList(g) : g.ents.values())) {
    if (e._net == null || e._net < 0) continue;
    const n = per.get(e._net); if (!n) continue;
    const p = PROTOS[e.proto];
    if (p.energy?.kind === 'electric') { const kw = e.active ? p.energy.kW * energyMul(g, e) : (p.energy.drainKW ?? p.energy.kW / 30); n.D += kw; ec[e.proto] = (ec[e.proto] || 0) + kw * (g.powerNets.get(e._net)?.satisfaction ?? 0) / 60; }
    if (p.buffer) { const need = Math.max(0, (p.buffer.MJ * 1e6 - (e.charge || 0)) * 60 / 1000); e._rq = Math.min(p.buffer.kW, need); n.D += e._rq; ec[e.proto] = (ec[e.proto] || 0) + e._rq * (g.powerNets.get(e._net)?.satisfaction ?? 0) / 60; } // v1.2: буфер робопорта
    else if (p.type === 'engine') {
      const fn = g.fluidNets[e._fn![0]];
      const steamPerTick = 0.5; // 30 пара/с при 900 кВт
      const avail = fn && fn.fluid === 'steam' && !fn.conflict ? fn.amount : 0;
      e._max = p.maxOut! * Math.min(1, avail / steamPerTick);
      n.E += e._max; n.eng.push(e);
    } else if (p.type === 'solar') { e._max = p.maxOut! * day; n.S += e._max; n.sol.push(e); }
    else if (p.type === 'accumulator') n.acc.push(e);
  }
  const J = (kW: number) => kW * 1000 / 60;
  for (const net of g.powerNets.values()) {
    const n = per.get(net.id)!;
    let disCap = 0, chCap = 0, stored = 0, cap = 0;
    for (const a of n.acc) { const A = PROTOS[a.proto].accum!; const c = a.charge || 0; stored += c; cap += A.MJ * 1e6; disCap += Math.min(A.kW, c / 1000 * 60); chCap += Math.min(A.kW, (A.MJ * 1e6 - c) / 1000 * 60); }
    let sat: number, solarUsed: number, accFlow = 0, eng = 0;
    if (n.S >= n.D) {
      const surplus = n.S - n.D; const ch = Math.min(chCap, surplus + n.E);
      eng = Math.max(0, ch - surplus); solarUsed = n.D + Math.min(surplus, ch); accFlow = ch; sat = n.D > 0 || n.S + n.E + disCap > 0 ? 1 : 0;
    } else {
      const need = n.D - n.S; const dis = Math.min(disCap, need); eng = Math.min(n.E, need - dis);
      solarUsed = n.S; accFlow = -dis; sat = n.D > 0 ? Math.min(1, (n.S + dis + eng) / n.D) : 0;
    }
    // заряд/разряд аккумуляторов пропорционально их возможностям
    if (accFlow > 0 && chCap > 0) for (const a of n.acc) { const A = PROTOS[a.proto].accum!; const c = a.charge || 0; const k = Math.min(A.kW, (A.MJ * 1e6 - c) / 1000 * 60) / chCap; a.charge = Math.min(A.MJ * 1e6, c + J(accFlow * k)); a._out = accFlow * k; }
    else if (accFlow < 0 && disCap > 0) for (const a of n.acc) { const A = PROTOS[a.proto].accum!; const c = a.charge || 0; const k = Math.min(A.kW, c / 1000 * 60) / disCap; a.charge = Math.max(0, c + J(accFlow * k)); a._out = accFlow * k; }
    else for (const a of n.acc) a._out = 0;
    const load = n.E > 0 ? eng / n.E : 0;
    for (const e of n.eng) { e._out = e._max! * load; const fn = g.fluidNets[e._fn![0]]; if (fn) fn.amount = Math.max(0, fn.amount - e._out / 900 * 0.5); }
    for (const e of n.sol) e._out = n.S > 0 ? e._max! * solarUsed / n.S : 0;
    for (const e of n.eng) if (e._out) ep[e.proto] = (ep[e.proto] || 0) + e._out / 60;
    for (const e of n.sol) if (e._out) ep[e.proto] = (ep[e.proto] || 0) + e._out / 60;
    for (const a of n.acc) if (a._out) { if (a._out > 0) ec[a.proto] = (ec[a.proto] || 0) + a._out / 60; else ep[a.proto] = (ep[a.proto] || 0) - a._out / 60; }
    net.demand = n.D; net.supply = n.S + n.E + disCap; net.satisfaction = sat;
    net.load = net.supply > 0 ? Math.min(1, n.D / net.supply) : 0;
    net.stored = stored; net.storeCap = cap; net.accFlow = accFlow; net.solar = solarUsed; net.steam = eng;
    if (g.tick % 6 === 0) { net.hist.push({ d: n.D, s: net.supply }); if (net.hist.length > 100) net.hist.shift(); }
  }
}

/** Мировые клетки и направления всех соединений жидкостного бака */
export function fluidConns(e: Entity, b: number): { x: number; y: number; d: number }[] {
  const p = PROTOS[e.proto]; const box = p.fluid![b];
  return box.conns.map(c => { const [lx, ly] = rotLocal(c.x, c.y, p.w, p.h, e.dir); return { x: e.x + lx, y: e.y + ly, d: (c.d + e.dir) % 4 }; });
}
/** фильтр бака: у машин с рецептом — по рецепту; null у io-бака = бак не используется */
export function boxFilter(e: Entity, b: number): string | null | false {
  const box = PROTOS[e.proto].fluid![b];
  const f = e.ffilter?.[b] ?? box.filter ?? null;
  if (box.io && !f) return false;
  return f;
}
/** соседние баки, соединённые с баком b сущности e */
export function boxNeighbors(g: Game, e: Entity, b: number): [Entity, number][] {
  const r: [Entity, number][] = [];
  if (boxFilter(e, b) === false) return r;
  for (const c of fluidConns(e, b)) {
    const nx = c.x + DX[c.d], ny = c.y + DY[c.d];
    const o = g.entAt(nx, ny); if (!o || o === e) continue;
    const op = PROTOS[o.proto]; if (!op.fluid) continue;
    for (let ob = 0; ob < op.fluid.length; ob++) {
      if (boxFilter(o, ob) === false) continue;
      if (fluidConns(o, ob).some(oc => oc.x === nx && oc.y === ny && oc.d === (c.d + 2) % 4)) r.push([o, ob]);
    }
  }
  const p = PROTOS[e.proto];
  if (p.ugReach) { // подземная труба: ищем пару впереди
    for (let i = 1; i <= p.ugReach; i++) {
      const o = g.entAt(e.x + DX[e.dir] * i, e.y + DY[e.dir] * i);
      if (o && o.proto === e.proto) { if (o.dir === (e.dir + 2) % 4) r.push([o, 0]); break; }
    }
  }
  return r;
}
export function connectedNets(g: Game, e: Entity, b: number): number[] {
  return boxNeighbors(g, e, b).map(([o, ob]) => o._fn?.[ob] ?? -1).filter(n => n >= 0);
}
export function rebuildFluids(g: Game) {
  // собрать доли старых сетей
  const share = new Map<string, { amt: number; fluid: string | null }>();
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    p.fluid.forEach((box, b) => {
      let amt = 0, fluid: string | null = null;
      if (e._clearFluid) { amt = 0; }
      else if (e._fn && e._fn[b] != null && g.fluidNets[e._fn[b]]) { const n = g.fluidNets[e._fn[b]]; amt = n.cap > 0 ? n.amount * box.cap / n.cap : 0; fluid = n.fluid; }
      else if (e.famt) { amt = e.famt[b] || 0; fluid = e.ffluid?.[b] ?? box.filter ?? null; }
      share.set(e.id + ':' + b, { amt, fluid });
    });
    e.famt = undefined; e.ffluid = undefined; e._clearFluid = undefined;
  }
  const nets: FluidNet[] = [];
  const seen = new Set<string>();
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    e._fn = p.fluid.map(() => -1);
  }
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    for (let b = 0; b < p.fluid.length; b++) {
      const k = e.id + ':' + b; if (seen.has(k)) continue;
      if (boxFilter(e, b) === false) continue;
      const net: FluidNet = { id: nets.length, fluid: null, amount: 0, cap: 0, nodes: [], conflict: false };
      const filters = new Set<string>(); let anyFluid: string | null = null; let bestAmt = 0;
      const stack: [Entity, number][] = [[e, b]]; seen.add(k);
      while (stack.length) {
        const [ce, cb] = stack.pop()!;
        const cp = PROTOS[ce.proto]; const box = cp.fluid![cb];
        net.nodes.push([ce.id, cb]); net.cap += box.cap; ce._fn![cb] = net.id;
        const bf = boxFilter(ce, cb); if (bf) filters.add(bf);
        const sh = share.get(ce.id + ':' + cb); if (sh) { net.amount += sh.amt; if (sh.amt > 0.01 && sh.fluid) { if (!anyFluid || sh.amt > bestAmt) { anyFluid = sh.fluid; bestAmt = sh.amt; } } }
        for (const [o, ob] of boxNeighbors(g, ce, cb)) { const kk = o.id + ':' + ob; if (!seen.has(kk)) { seen.add(kk); stack.push([o, ob]); } }
      }
      if (filters.size > 1) net.conflict = true;
      net.fluid = filters.size ? [...filters][0] : anyFluid; net.filtered = filters.size > 0;
      if (filters.size === 1 && anyFluid && anyFluid !== net.fluid) net.amount = 0; // смена рецепта: старая жидкость сливается
      net.amount = Math.round(Math.min(net.amount, net.cap) * 1e6) / 1e6; // сетка 1e-6: пересборка идемпотентна (сохранение → загрузка без дрейфа)
      nets.push(net);
    }
  }
  g.fluidNets = nets;
}
export function fluidSnapshot(g: Game, e: Entity) {
  const p = PROTOS[e.proto]; if (!p.fluid || !e._fn) return;
  e.famt = p.fluid.map((box, b) => { const n = g.fluidNets[e._fn![b]]; return n && n.cap ? n.amount * box.cap / n.cap : 0; });
  e.ffluid = p.fluid.map((_, b) => g.fluidNets[e._fn![b]]?.fluid ?? null);
}
