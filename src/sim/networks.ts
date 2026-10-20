// Электросети (8.5, union-find) и жидкостные сети (8.6, «одна сеть — один бак»).
import { DX, DY, TICKS, rotLocal } from '../core/types';
import { PROTOS } from '../data/entities';
import { powerLevel } from './mgmt';
import type { Entity, Game } from './game';
import { energyMul } from './modules';
import { fluidConnections } from './fluidports';
import { OPT, powerList } from './perf';
import { SE_BOILER, SE_HOT } from './steam-energy';

export interface PowerNet { id: number; poles: number[]; demand: number; supply: number; satisfaction: number; /** v1.16: удовлетворённость по уровням приоритета [критический, обычный, второстепенный] и спрос уровней, кВт (нет приоритетов — undefined) */ sl?: [number, number, number]; dl?: [number, number, number]; load: number; hist: { d: number; s: number }[];
  stored?: number; storeCap?: number; accFlow?: number; solar?: number; steam?: number; }
export interface FluidNet { id: number; fluid: string | null; amount: number; cap: number; nodes: [number, number][]; conflict: boolean; filtered?: boolean;
  /** v1.16: удельная энергия пара, кДж/ед (165 °C = 30, 500 °C = 97); у пустого бака не используется */ se: number; }
/** обычный пар бойлера (165 °C) — кДж на единицу */
export { SE_BOILER, SE_HOT } from './steam-energy';
/** добавить u единиц пара с удельной энергией se в сеть net (энергия суммируется, температура — средневзвешенная по объёму) */
export function addSteam(net: FluidNet, u: number, se: number) {
  if (u <= 0) return;
  const cur = net.fluid === 'steam' ? net.amount : 0;
  net.se = Math.round((cur * (cur > 0 ? net.se : 0) + u * se) / (cur + u) * 1e6) / 1e6;
  net.amount += u; net.fluid = 'steam';
}

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
  g.world.withOccChunkCache(() => {
    for (const p of poles) {
      const s = PROTOS[p.proto].supply!;
      for (let y = p.y - s; y <= p.y + p.h - 1 + s; y++) for (let x = p.x - s; x <= p.x + p.w - 1 + s; x++) {
        const e = g.entAt(x, y);
        if (e && e._net === -1 && isElectric(e)) e._net = p._net!;
      }
    }
  });
}

/** Порядок за тик (8.5): спрос → солнце → аккумуляторы → пар. Излишек заряжает аккумуляторы,
 *  паровые двигатели работают только на «спрос + заряд» — топливо не тратится зря. */
/** v1.16: электрическая мощность паровых турбин за последний тик, кВт */
let TKW = 0; export const turbineKW = () => TKW;
interface PowerWork { D: number; S: number; E: number; eng: Entity[]; acc: Entity[]; sol: Entity[]; L: [number, number, number]; loads: Entity[]; loadKW: number[]; }
interface PowerScratch {
  powerVer: number; per: Map<number, PowerWork>; engs: Entity[]; needByFluid: Map<number, number>;
}
const powerScratch = new WeakMap<Game, PowerScratch>();
function scratchFor(g: Game): PowerScratch {
  let s = powerScratch.get(g);
  if (!s || s.powerVer !== g.powerVer) {
    s = { powerVer: g.powerVer, per: new Map(), engs: [], needByFluid: new Map() };
    powerScratch.set(g, s);
  }
  return s;
}
function workFor(s: PowerScratch, id: number): PowerWork {
  let n = s.per.get(id);
  if (!n) { n = { D: 0, S: 0, E: 0, eng: [], acc: [], sol: [], L: [0, 0, 0], loads: [], loadKW: [] }; s.per.set(id, n); }
  else { n.D = 0; n.S = 0; n.E = 0; n.eng.length = 0; n.acc.length = 0; n.sol.length = 0; n.L[0] = n.L[1] = n.L[2] = 0; n.loads.length = 0; n.loadKW.length = 0; }
  return n;
}
export function stepPower(g: Game) {
  TKW = 0;
  const day = g.daylight();
  const scratch = scratchFor(g), per = scratch.per, engs = scratch.engs;
  engs.length = 0;
  for (const net of g.powerNets.values()) workFor(scratch, net.id);
  // v1.16: потребление попадёт в статистику после расчёта фактической выдачи и доли каждого уровня приоритета.
  const ec = g.pstats.ec, ep = g.pstats.ep;
  for (const e of (OPT.powerLists ? powerList(g) : g.ents.values())) {
    const p = PROTOS[e.proto];
    if (e.t === 'bioport') e._bioKW = 0;
    if (e._net == null || e._net < 0) continue;
    const n = per.get(e._net); if (!n) continue;
    let load = false, kw = 0, bufferKW = 0, lv = 1;
    if (p.energy?.kind === 'electric') {
      const bioLabState = e.proto === 'genetic-lab' ? g.v117?.genetics?.labs?.[String(e.id)] : undefined;
      const bioLabActive = !!bioLabState?.activity && bioLabState.progress < (bioLabState.activity.kind === 'found' ? 60 : 20) * TICKS;
      kw = e.active || e._cut || bioLabActive || e.proto === 'programmable-speaker' && e._speakerRequested ? p.energy.kW * energyMul(g, e) : (p.energy.drainKW ?? p.energy.kW / 30);
      if (e.proto === 'genetic-lab') kw += Object.values(g.v117?.genetics?.banks || {}).filter(b => b.labId === e.id && b.cells > 0).length * 5;
      n.D += kw; lv = e.pp !== undefined || e.grp !== undefined ? powerLevel(g, e) : 1; e._lv = lv; n.L[lv] += kw; load = true;
    }
    if (p.buffer) { const need = Math.max(0, (p.buffer.MJ * 1e6 - (e.charge || 0)) * 60 / 1000); e._rq = Math.min(p.buffer.kW, need); n.D += e._rq; bufferKW = e._rq; load = true; } // v1.2: буфер робопорта
    if (load) {
      n.loads.push(e); n.loadKW.push(kw);
    }
    else if (p.type === 'engine') { engs.push(e); n.eng.push(e);
    } else if (p.type === 'solar') { e._max = p.maxOut! * day; n.S += e._max; n.sol.push(e); }
    else if (p.type === 'accumulator') n.acc.push(e);
  }
  // v1.16: генераторы одной сети жидкости делят её запас — единицу пара нельзя выдать каждому как независимый резерв
  genLimits(g, engs, scratch.needByFluid);
  for (const e of engs) { if (e._net == null || e._net < 0) continue; const n = per.get(e._net); if (n) n.E += e._max!; }
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
    for (const e of n.eng) { e._out = e._max! * load; const fn = g.fluidNets[e._fn![0]]; if (fn) { const bf = PROTOS[e.proto].burnFluid; const mj = bf && fn.fluid ? bf.fuels[fn.fluid] || 0 : 0; const seU = bf ? 0 : steamUse(e, fn); e._wk = !bf && e._out > 0 && seU > 0 ? e._out / seU * Math.max(0, fn.se - seU) : 0; fn.amount = Math.max(0, fn.amount - (bf ? (mj ? e._out / (mj * bf.eff * 1000) / 60 : 0) : seU > 0 ? e._out / 60 / seU : 0)); } }
    for (const e of n.sol) e._out = n.S > 0 ? e._max! * solarUsed / n.S : 0;
    for (const e of n.eng) if (e._out) { ep[e.proto] = (ep[e.proto] || 0) + e._out / 60; if (PROTOS[e.proto].turbine) { TKW += e._out; g.nuc.st.turbJ = (g.nuc.st.turbJ || 0) + e._out / 60; } }
    for (const e of n.sol) if (e._out) ep[e.proto] = (ep[e.proto] || 0) + e._out / 60;
    for (const a of n.acc) if (a._out) { if (a._out > 0) ec[a.proto] = (ec[a.proto] || 0) + a._out / 60; else ep[a.proto] = (ep[a.proto] || 0) - a._out / 60; }
    net.demand = n.D; net.supply = n.S + n.E + disCap; net.satisfaction = sat;
    // v1.16: приоритеты — сначала критический спрос, затем обычный, затем второстепенный; внутри уровня поровну (пропорционально запросу)
    if (n.L[0] > 0 || n.L[2] > 0) { let rem = sat * n.D; const sl: [number, number, number] = [1, 1, 1]; const D1 = n.D - n.L[0] - n.L[2]; const lvD = [n.L[0], D1, n.L[2]]; for (let i = 0; i < 3; i++) { const give = Math.min(lvD[i], rem); sl[i] = lvD[i] > 1e-9 ? give / lvD[i] : 1; rem -= give; } net.sl = sl; net.dl = [lvD[0], lvD[1], lvD[2]]; } else { net.sl = undefined; net.dl = undefined; }
    net.load = net.supply > 0 ? Math.min(1, n.D / net.supply) : 0;
    net.stored = stored; net.storeCap = cap; net.accFlow = accFlow; net.solar = solarUsed; net.steam = eng;
    for (let i = 0; i < n.loads.length; i++) {
      const e = n.loads[i], p = PROTOS[e.proto], kw = n.loadKW[i];
      if (kw) { const share = net.sl ? net.sl[e._lv ?? 1] : sat; const actualKW = kw * share; ec[e.proto] = (ec[e.proto] || 0) + actualKW / 60; if (e.t === 'bioport') e._bioKW = actualKW; }
      if (p.buffer && e._rq) {
        const share = net.sl ? net.sl[1] : sat;
        ec[e.proto] = (ec[e.proto] || 0) + e._rq * share / 60;
      }
    }
    if (g.tick % 6 === 0) { net.hist.push({ d: n.D, s: net.supply }); if (net.hist.length > 100) net.hist.shift(); }
  }
}

/** v1.16: сколько кДж пара превращается в электричество с единицы: двигатель — не больше 30, турбина — не больше 97 */
export function steamUse(e: Entity, fn: FluidNet) { return Math.min(fn.se || SE_BOILER, PROTOS[e.proto].turbine ? SE_HOT : SE_BOILER); }
function genLimits(g: Game, engs: Entity[], needByFluid: Map<number, number>) {
  needByFluid.clear();
  for (const e of engs) {
    const id = e._fn?.[0] ?? -1, fn = id >= 0 ? g.fluidNets[id] : undefined;
    let um = 0;
    if (fn && !fn.conflict && fn.fluid) {
      const p = PROTOS[e.proto], bf = p.burnFluid;
      if (bf) { const mj = bf.fuels[fn.fluid] || 0; if (mj) um = p.maxOut! / (mj * bf.eff * 1000) / 60; }
      else if (fn.fluid === 'steam') um = p.maxOut! / (60 * (p.turbine ? SE_HOT : SE_BOILER));
    }
    needByFluid.set(id, (needByFluid.get(id) || 0) + um);
  }
  for (const e of engs) {
    const id = e._fn?.[0] ?? -1, fn = id >= 0 ? g.fluidNets[id] : undefined;
    let pw = 0;
    if (fn && !fn.conflict && fn.fluid) {
      const p = PROTOS[e.proto], bf = p.burnFluid;
      if (bf) { const mj = bf.fuels[fn.fluid] || 0; if (mj) pw = p.maxOut!; }
      else if (fn.fluid === 'steam') { const um = p.maxOut! / (60 * (p.turbine ? SE_HOT : SE_BOILER)); pw = 60 * um * steamUse(e, fn); }
    }
    const need = needByFluid.get(id) || 0;
    e._max = pw * (need > 0 && fn ? Math.min(1, fn.amount / need) : 0);
  }
}
/** Мировые клетки и направления всех соединений жидкостного бака */
export function fluidConns(e: Entity, b: number): { x: number; y: number; d: number }[] {
  return fluidConnections(e, b);
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
      if (o && o.proto === e.proto && o.dir % 2 === e.dir % 2) {
        if (o.dir === (e.dir + 2) % 4) r.push([o, 0]);
        break;
      }
    }
  }
  return r;
}
export function connectedNets(g: Game, e: Entity, b: number): number[] {
  return boxNeighbors(g, e, b).map(([o, ob]) => o._fn?.[ob] ?? -1).filter(n => n >= 0);
}
export function rebuildFluids(g: Game) {
  // собрать доли старых сетей
  const share = new Map<number, { amt: number; fluid: string | null; se: number }>();
  // v1.16 heat-17: numeric box keys and per-rebuild packed connection cache;
  // triples retain the public fluidConns coordinate/direction arithmetic.
  const connCache = new Map<number, (number | undefined)[]>();
  const conns = (o: Entity, ob: number) => {
    const k = o.id * 64 + ob;
    let packed = connCache.get(k);
    if (!packed) {
      const p = PROTOS[o.proto], list = p.fluid![ob].conns;
      packed = [];
      // Array#map skips sparse source entries. Keep a marker for those slots:
      // the consuming traversal then preserves map/for-of's prior error point.
      for (let i = 0; i < list.length; i++) {
        if (!(i in list)) { packed.push(undefined, undefined, undefined); continue; }
        const c = list[i], [lx, ly] = rotLocal(c.x, c.y, p.w, p.h, o.dir);
        packed.push(o.x + lx, o.y + ly, (c.d + o.dir) % 4);
      }
      connCache.set(k, packed);
    }
    return packed;
  };
  const neighbors = (ce: Entity, cb: number, outEntities: Entity[], outBoxes: number[]) => {
    outEntities.length = 0; outBoxes.length = 0;
    if (boxFilter(ce, cb) === false) return;
    const cs = conns(ce, cb);
    for (let ci = 0; ci < cs.length; ci += 3) {
      const cx = cs[ci], cy = cs[ci + 1], cd = cs[ci + 2];
      if (cx === undefined) { const missing: any = undefined; void missing.x; }
      const nx = cx! + DX[cd!], ny = cy! + DY[cd!];
      const o = g.entAt(nx, ny); if (!o || o === ce) continue;
      const op = PROTOS[o.proto]; if (!op.fluid) continue;
      for (let ob = 0; ob < op.fluid.length; ob++) {
        if (boxFilter(o, ob) === false) continue;
        const other = conns(o, ob), opposite = (cd! + 2) % 4;
        let connected = false;
        for (let oi = 0; oi < other.length; oi += 3) {
          const ox = other[oi]; if (ox === undefined) continue;
          if (ox === nx && other[oi + 1] === ny && other[oi + 2] === opposite) { connected = true; break; }
        }
        if (connected) { outEntities.push(o); outBoxes.push(ob); }
      }
    }
    const p = PROTOS[ce.proto];
    if (p.ugReach) {
      for (let i = 1; i <= p.ugReach; i++) {
        const o = g.entAt(ce.x + DX[ce.dir] * i, ce.y + DY[ce.dir] * i);
        if (o && o.proto === ce.proto && o.dir % 2 === ce.dir % 2) {
          if (o.dir === (ce.dir + 2) % 4) { outEntities.push(o); outBoxes.push(0); }
          break;
        }
      }
    }
  };
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    if (p.fluid.length >= 64) throw new Error('rebuildFluids: too many fluid boxes');
    p.fluid.forEach((box, b) => {
      let amt = 0, fluid: string | null = null, se = SE_BOILER;
      if (e._clearFluid) { amt = 0; }
      else if (e._fn && e._fn[b] != null && g.fluidNets[e._fn[b]]) { const n = g.fluidNets[e._fn[b]]; amt = n.cap > 0 ? n.amount * box.cap / n.cap : 0; fluid = n.fluid; se = n.se; }
      else if (e.famt) { amt = e.famt[b] || 0; fluid = e.ffluid?.[b] ?? box.filter ?? null; if (e.fse && Number.isFinite(e.fse[b]) && e.fse[b] > 0) se = e.fse[b]; }
      share.set(e.id * 64 + b, { amt, fluid, se });
    });
    e.famt = undefined; e.ffluid = undefined; e.fse = undefined; e._clearFluid = undefined;
  }
  const nets: FluidNet[] = [];
  const seen = new Set<number>();
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    e._fn = p.fluid.map(() => -1);
  }
  // Scratch arrays are per rebuild call, so nested rebuilds keep independent live traversal state.
  const neighborEntities: Entity[] = [], neighborBoxes: number[] = [];
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (!p.fluid) continue;
    for (let b = 0; b < p.fluid.length; b++) {
      const k = e.id * 64 + b; if (seen.has(k)) continue;
      if (boxFilter(e, b) === false) continue;
      const net: FluidNet = { id: nets.length, fluid: null, amount: 0, cap: 0, nodes: [], conflict: false, se: SE_BOILER };
      let seNum = 0, seDen = 0;
      const filters = new Set<string>(); let anyFluid: string | null = null; let bestAmt = 0;
      const stackEntities: Entity[] = [e], stackBoxes: number[] = [b]; seen.add(k);
      while (stackEntities.length) {
        const ce = stackEntities.pop()!, cb = stackBoxes.pop()!;
        const cp = PROTOS[ce.proto]; const box = cp.fluid![cb];
        net.nodes.push([ce.id, cb]); net.cap += box.cap; ce._fn![cb] = net.id;
        const bf = boxFilter(ce, cb); if (bf) filters.add(bf);
        const sh = share.get(ce.id * 64 + cb); if (sh) { net.amount += sh.amt; seNum += sh.amt * sh.se; seDen += sh.amt; if (sh.amt > 0.01 && sh.fluid) { if (!anyFluid || sh.amt > bestAmt) { anyFluid = sh.fluid; bestAmt = sh.amt; } } }
        // Complete every neighbor scan before marking nodes seen, matching callback timing and live entity refs.
        neighbors(ce, cb, neighborEntities, neighborBoxes);
        for (let i = 0; i < neighborEntities.length; i++) {
          const o = neighborEntities[i], ob = neighborBoxes[i], kk = o.id * 64 + ob;
          if (!seen.has(kk)) { seen.add(kk); stackEntities.push(o); stackBoxes.push(ob); }
        }
      }
      if (filters.size > 1) net.conflict = true;
      net.fluid = filters.size ? [...filters][0] : anyFluid; net.filtered = filters.size > 0;
      net.se = seDen > 1e-9 ? Math.round(seNum / seDen * 1e6) / 1e6 : SE_BOILER;
      if (filters.size === 1 && anyFluid && anyFluid !== net.fluid) { net.amount = 0; net.se = SE_BOILER; } // смена рецепта: старая жидкость сливается
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
  e.fse = p.fluid.map((_, b) => g.fluidNets[e._fn![b]]?.se ?? SE_BOILER);
}
