// v1.16: ядерная энергетика — тепловая сеть, реакторы, теплообменники, аварии и заражение.
// Тепло хранится в целых джоулях (энергия над окружающей средой 15 °C), потоки считаются по температуре начала фазы,
// рёбра обходятся в порядке числовых id. Баланс тика: запас + выработка = новый запас + пар + потери.
import { DX, DY, rotLocal, CHUNK, TICKS } from '../core/types';
import { PROTOS } from '../data/entities';
import type { Entity, Game } from './game';
import { addSteam, rebuildFluids, rebuildPower, turbineKW } from './networks';
import { SE_HOT } from './steam-energy';
import { applyUnitSlow, unitsNear, hitUnit, UNITS } from './enemies';
import { R_URAN } from './world';
import { kitStats, kitOf } from './combat';
import { HeatStorage, HeatNeighbors, HEAT_PAGE, HEAT_SLOT_PAGE } from './heat-cache';

export const AMB = 15, ROD_TICKS = 12000, BASE_MW = 40, ROD_STACK = 50;
/** проводимость ребра: 20 МВт на градус разности → Дж за тик на градус; максимум ребра 200 МВт */
const COND = 20e6 / 60, EDGE_MAX = 200e6 / 60;
export const HEX_ON = 500, WARN_T = 900, OVER_T = 1000, MAX_T = 1200, OVER_TICKS = 600;
export const BOOM_R = 12, BOOM_DMG = 2500, ZONE_R = 20, ZONE_TICKS = 30 * 60 * 60, ZONE_DPS = 10;
const HEX_J = SE_HOT * 1000;

export interface NucZone { x: number; y: number; t: number; r: number; dur: number; /** v1.16: интенсивность в центре, ед/с (по умолчанию — заражение реактора) */ dps?: number; }
export interface NucState { zones: NucZone[]; st: Record<string, number>; }
export const newNuc = (): NucState => ({ zones: [], st: {} });
export const nstat = (g: Game, k: string, v = 1) => { g.nuc.st[k] = (g.nuc.st[k] || 0) + v; };

export const isHeatType = (t: string) => t === 'reactor' || t === 'hpipe' || t === 'hexch';
const capJ = (e: Entity) => PROTOS[e.proto].heatC! * 1e6;
/** температура узла, °C */
export const heatTemp = (e: Entity) => AMB + (e.hE || 0) / capJ(e);
const energyAt = (e: Entity, T: number) => Math.max(0, Math.floor((T - AMB) * capJ(e)));

interface Port { x: number; y: number; d: number; }
function ports(e: Entity): Port[] {
  const p = PROTOS[e.proto];
  if (e.t === 'hpipe') return [0, 1, 2, 3].map(d => ({ x: e.x, y: e.y, d }));
  if (e.t === 'reactor') return [{ x: e.x + 2, y: e.y, d: 0 }, { x: e.x + 4, y: e.y + 2, d: 1 }, { x: e.x + 2, y: e.y + 4, d: 2 }, { x: e.x, y: e.y + 2, d: 3 }];
  if (e.t === 'hexch') { const [lx, ly] = rotLocal(1, 1, p.w, p.h, e.dir); return [{ x: e.x + lx, y: e.y + ly, d: (2 + e.dir) % 4 }]; }
  return [];
}
/** мировые порты тепловой связи постройки (для подсказок и призраков) */
export function heatPorts(e: Pick<Entity, 'proto' | 't' | 'x' | 'y' | 'dir'>): Port[] { return ports(e as Entity); }
function hasHeatPort(e: Entity, x: number, y: number, d: number): boolean {
  if (e.t === 'hpipe') return e.x === x && e.y === y;
  if (e.t === 'reactor') {
    if (d === 0) return e.x + 2 === x && e.y === y;
    if (d === 1) return e.x + 4 === x && e.y + 2 === y;
    if (d === 2) return e.x + 2 === x && e.y + 4 === y;
    return d === 3 && e.x === x && e.y + 2 === y;
  }
  if (e.t === 'hexch') {
    const p = PROTOS[e.proto], [lx, ly] = rotLocal(1, 1, p.w, p.h, e.dir);
    return e.x + lx === x && e.y + ly === y && (2 + e.dir) % 4 === d;
  }
  return false;
}

export interface HeatNet {
  ents: Entity[]; edges: [Entity, Entity][]; reactors: Entity[]; hexs: Entity[]; pipes: Entity[];
  storage: HeatStorage; slotCaps: Float64Array;
  /** Immutable canonical page rows cached in storage.keys order for physics loops. */
  edgeSlotPages: readonly Int32Array[]; pipeSlotPages: readonly Int32Array[];
  neighborsById: ReadonlyMap<number, number[]>;
  componentById: Map<number, number>; hexsByComponent: Map<number, Entity[]>;
  caps: Float64Array; edgeA: Int32Array; edgeB: Int32Array;
  temp: Float64Array; energy: Float64Array; out: Float64Array; incoming: Float64Array; maxTemp: Float64Array;
  flowA: Int32Array; flowB: Int32Array; flowJ: Float64Array;
  /** page edgeSlots / pipes concatenated in storage.keys order (exact same iteration order) */
  edgeFlat: Int32Array; edgeFlatLen: number; pipeFlat: Int32Array; pipeFlatLen: number;
}
const heatFlatCapacities = new WeakMap<HeatNet, { edge: number; pipe: number }>();
function addHeatNeighbor(g: Game, a: Entity, neighbors: Entity[], x: number, y: number, d: number) {
  const bx = x + DX[d], by = y + DY[d], b = g.entAt(bx, by);
  if (!b || b === a || !isHeatType(b.t) || !hasHeatPort(b, bx, by, (d + 2) % 4)) return;
  for (let i = 0; i < neighbors.length; i++) if (neighbors[i].id === b.id) return;
  neighbors.push(b);
}
const byId = (a: Entity, b: Entity) => a.id - b.id;
function heatNeighbors(g: Game, a: Entity): Entity[] {
  const neighbors: Entity[] = [];
  // Heat pipes expose one port per direction on their own tile; walk them
  // directly instead of materializing four Port objects per lookup.
  if (a.t === 'hpipe') for (let d = 0; d < 4; d++) addHeatNeighbor(g, a, neighbors, a.x, a.y, d);
  else for (const port of ports(a)) addHeatNeighbor(g, a, neighbors, port.x, port.y, port.d);
  if (neighbors.length > 1) neighbors.sort(byId);
  return neighbors;
}
function insertNeighbor(neighbors: number[], id: number) {
  let i = 0;
  while (i < neighbors.length && neighbors[i] < id) i++;
  if (neighbors[i] === id) return;
  neighbors.splice(i, 0, id);
}
export function heatNet(g: Game): HeatNet {
  if (g._heat && !g.heatDirty) return g._heat;
  const cached = g._heat, changedIds = g._heatDirtyIds;
  const incremental = !!cached && !g._heatDirtyFull && changedIds.size > 0;
  const storage = incremental ? cached!.storage.fork() : new HeatStorage();
  const rows = new Set<number>();
  if (incremental) {
    // Unlink from old immutable adjacency before replacing tracked nodes.
    for (const id of changedIds) {
      const old = cached!.storage.get(id);
      if (!old) continue;
      for (const neighborId of old.neighbors) {
        if (changedIds.has(neighborId)) continue;
        const neighbor = storage.writable(neighborId);
        if (!neighbor) continue;
        const index = neighbor.neighbors.indexOf(id);
        if (index >= 0) neighbor.neighbors.splice(index, 1);
        rows.add(neighborId);
      }
      storage.remove(id);
    }
    for (const id of changedIds) {
      const e = g.ents.get(id);
      if (e && isHeatType(e.t)) { storage.insert(e, capJ(e)); rows.add(id); }
    }
    for (const id of changedIds) {
      const node = storage.get(id);
      if (!node) continue;
      for (const other of heatNeighbors(g, node.entity)) {
        insertNeighbor(storage.writable(id)!.neighbors, other.id);
        insertNeighbor(storage.writable(other.id)!.neighbors, id);
        rows.add(other.id);
      }
    }
    for (const id of rows) storage.rebuildRow(id);
  } else {
    const entities = [...g.ents.values()].filter(e => isHeatType(e.t)).sort((a, b) => a.id - b.id);
    for (const e of entities) storage.insert(e, capJ(e));
    for (const e of entities) storage.get(e.id)!.neighbors = heatNeighbors(g, e).map(other => other.id);
    for (const e of entities) storage.rebuildRow(e.id);
  }
  storage.finish();
  // Diagnostic wrappers may rebuild topology without running a physics phase.
  // Collect immutable canonical rows only when transfer/loss first consumes them.
  let orderedSlotPages: { edge: Int32Array[]; pipe: Int32Array[] } | undefined;
  const slotPages = () => {
    if (orderedSlotPages) return orderedSlotPages;
    const edge: Int32Array[] = [], pipe: Int32Array[] = [];
    for (const key of storage.keys) {
      const page = storage.blocks.get(key)!;
      edge.push(page.edgeSlots);
      pipe.push(page.pipeSlots);
    }
    return orderedSlotPages = { edge, pipe };
  };
  const neighborsById = new HeatNeighbors(storage);
  let reuseTypes = incremental;
  if (reuseTypes) for (const id of changedIds) {
    const old = cached!.storage.get(id)?.type, current = storage.get(id)?.type;
    if (old === 'reactor' || old === 'hexch' || current === 'reactor' || current === 'hexch') { reuseTypes = false; break; }
  }
  const reactors: Entity[] = reuseTypes ? cached!.reactors : [];
  const hexs: Entity[] = reuseTypes ? cached!.hexs : [];
  if (!reuseTypes) for (const key of storage.keys) for (const node of storage.blocks.get(key)!) if (node) {
    if (node.entity.t === 'reactor') reactors.push(node.entity);
    else if (node.entity.t === 'hexch') hexs.push(node.entity);
  }
  let reuseComponents = incremental;
  if (reuseComponents) for (const id of changedIds) {
    if (cached!.componentById.has(id) || storage.get(id)?.entity.t === 'hexch'
      || (cached!.storage.get(id)?.neighbors || []).some(v => cached!.componentById.has(v))
      || (storage.get(id)?.neighbors || []).some(v => cached!.componentById.has(v))) {
      reuseComponents = false; break;
    }
  }
  const componentById = reuseComponents ? cached!.componentById : new Map<number, number>();
  const hexsByComponent = reuseComponents ? cached!.hexsByComponent : new Map<number, Entity[]>();
  if (!reuseComponents) for (const seed of hexs) {
    if (componentById.has(seed.id)) continue;
    const component = seed.id, stack = [seed.id], members: Entity[] = [];
    componentById.set(seed.id, component);
    while (stack.length) {
      const id = stack.pop()!, node = storage.get(id);
      if (!node) continue;
      if (node.entity.t === 'hexch') members.push(node.entity);
      for (const neighborId of node.neighbors) if (!componentById.has(neighborId)) {
        componentById.set(neighborId, component); stack.push(neighborId);
      }
    }
    members.sort((a, b) => a.id - b.id);
    hexsByComponent.set(component, members);
  }
  const capacity = (size: number) => Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, size))));
  const floats = (old: Float64Array | undefined, size: number) => incremental && old && old.length >= size ? old : new Float64Array(capacity(size));
  const ints = (old: Int32Array | undefined, size: number) => incremental && old && old.length >= size ? old : new Int32Array(capacity(size));
  const n = storage.nextSlot, m = storage.edgeCount;
  const slotCaps = floats(cached?.slotCaps, n);
  if (incremental && slotCaps === cached!.slotCaps) {
    for (const id of changedIds) { const node = storage.get(id); if (node) slotCaps[node.slot] = node.cap; }
  } else {
    for (const key of storage.keys) for (const node of storage.blocks.get(key)!) if (node) slotCaps[node.slot] = node.cap;
  }
  let edgeFlatView: Int32Array | undefined, pipeFlatView: Int32Array | undefined;
  let edgeFlatLenValue = storage.edgeCount * 2, pipeFlatLenValue: number | undefined;
  const previousFlatCapacity = incremental && cached ? heatFlatCapacities.get(cached) : undefined;
  const flatCapacity = {
    edge: Math.max(previousFlatCapacity?.edge || 0, capacity(edgeFlatLenValue)),
    pipe: previousFlatCapacity?.pipe || capacity(0),
  };
  const flatSlots = (pipes: boolean) => {
    let length = 0;
    for (const key of storage.keys) {
      const page = storage.blocks.get(key)!;
      length += (pipes ? page.pipeSlots : page.edgeSlots).length;
    }
    const field = pipes ? 'pipe' : 'edge';
    if (flatCapacity[field] < length) flatCapacity[field] = capacity(length);
    const result = new Int32Array(flatCapacity[field]);
    let offset = 0;
    for (const key of storage.keys) {
      const page = storage.blocks.get(key)!;
      const slots = pipes ? page.pipeSlots : page.edgeSlots;
      result.set(slots, offset); offset += slots.length;
    }
    return result;
  };
  const pipeFlatLength = () => {
    if (pipeFlatLenValue == null) {
      pipeFlatLenValue = 0;
      for (const key of storage.keys) pipeFlatLenValue += storage.blocks.get(key)!.pipeSlots.length;
    }
    return pipeFlatLenValue;
  };
  // Compatibility views flatten only when explicitly read. The heat step
  // consumes canonical page slots directly and does not pay to repack them.
  let entsView: Entity[] | undefined, edgesView: [Entity, Entity][] | undefined;
  let pipesView: Entity[] | undefined, capsView: Float64Array | undefined;
  let edgeAView: Int32Array | undefined, edgeBView: Int32Array | undefined;
  const entities = () => entsView || (entsView = storage.entities());
  const pairs = () => edgesView || (edgesView = storage.edgePairs());
  // Count queries do not flatten a diagnostic snapshot after every step.
  // All canonical row construction and slot work already happened above.
  // Other array operations still expose the exact canonical pairs.
  let edgeFacade = new Proxy([] as [Entity, Entity][], {
    get(_target, key) {
      if (key === 'length') return storage.edgeCount;
      const array = pairs(), value = Reflect.get(array, key, array);
      return typeof value === 'function' ? value.bind(array) : value;
    },
    ownKeys() { return Reflect.ownKeys(pairs()); },
    getOwnPropertyDescriptor(_target, key) { return Reflect.getOwnPropertyDescriptor(pairs(), key); },
  });
  const indices = () => {
    if (edgeAView) return;
    const index = new Map<number, number>();
    entities().forEach((e, i) => index.set(e.id, i));
    edgeAView = new Int32Array(storage.edgeCount); edgeBView = new Int32Array(storage.edgeCount);
    pairs().forEach(([a, b], i) => { edgeAView![i] = index.get(a.id)!; edgeBView![i] = index.get(b.id)!; });
  };
  g._heat = {
    storage, slotCaps,
    get edgeSlotPages() { return slotPages().edge; }, get pipeSlotPages() { return slotPages().pipe; },
    reactors, hexs, neighborsById, componentById, hexsByComponent,
    get ents() { return entities(); }, set ents(value) { entsView = value; },
    get edges() { return edgeFacade; }, set edges(value) { edgeFacade = value; },
    get pipes() { return pipesView || (pipesView = entities().filter(e => e.t === 'hpipe')); },
    get caps() { return capsView || (capsView = Float64Array.from(entities(), e => storage.get(e.id)!.cap)); },
    get edgeA() { indices(); return edgeAView!; }, get edgeB() { indices(); return edgeBView!; },
    get edgeFlat() { return edgeFlatView || (edgeFlatView = flatSlots(false)); }, set edgeFlat(value) { edgeFlatView = value; flatCapacity.edge = value.length; },
    get edgeFlatLen() { return edgeFlatLenValue; }, set edgeFlatLen(value) { edgeFlatLenValue = value; },
    get pipeFlat() { return pipeFlatView || (pipeFlatView = flatSlots(true)); }, set pipeFlat(value) { pipeFlatView = value; flatCapacity.pipe = value.length; },
    get pipeFlatLen() { return pipeFlatLenValue ?? pipeFlatLength(); }, set pipeFlatLen(value) { pipeFlatLenValue = value; },
    temp: floats(cached?.temp, n), energy: floats(cached?.energy, n), out: floats(cached?.out, n), incoming: floats(cached?.incoming, n), maxTemp: floats(cached?.maxTemp, n),
    flowA: ints(cached?.flowA, m), flowB: ints(cached?.flowB, m), flowJ: floats(cached?.flowJ, m),
  };
  heatFlatCapacities.set(g._heat, flatCapacity);
  g.heatDirty = false;
  return g._heat;
}
/** число работающих соседей реактора по полной стороне с тем же выравниванием */
export function reactorNeighbours(g: Game, e: Entity): number {
  let n = 0;
  for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
    const o = g.entAt(e.x + (dx > 0 ? 5 : dx < 0 ? -1 : 2), e.y + (dy > 0 ? 5 : dy < 0 ? -1 : 2));
    if (o && o.t === 'reactor' && o.x === e.x + dx && o.y === e.y + dy && (o.rt || 0) > 0) n++;
  }
  return n;
}
/** потери: учесть уничтоженную энергию */
export function heatLoss(g: Game, J: number) { if (J > 0) nstat(g, 'lost', J); }

/** можно ли разобрать постройку вручную/роботом; строка — причина отказа */
export function dismantleBlock(e: Entity): string | null {
  if (e.t === 'reactor') {
    if ((e.rt || 0) > 0) return 'В реакторе горит стержень — сначала аварийная остановка';
    if (heatTemp(e) >= HEX_ON) return 'Реактор горячий (от 500 °C) — дождитесь охлаждения';
  }
  if (e.t === 'car' && e.vehicleState) {
    const v = e.vehicleState;
    if (v.driver != null) return 'Сначала выйдите из автомобиля';
    if (Math.abs(v.speed) > .01) return 'Автомобиль должен полностью остановиться перед сносом';
    if (e.fuel || (e.fuelJ || 0) > 1) return 'Сначала заберите топливо из слота автомобиля и израсходуйте остаток двигателя';
    if (e.inv?.slots.some(s => !!s) || v.mounts.some(m => !!m) || v.grid.length || v.gridCharge > 1) return 'Перед сносом опустошите багажник, топливный слот, турели и сетку оборудования';
  }
  return null;
}

/** рецепт ядерного цикла (смена и разбор обрабатываются по особым правилам) */
export const NUC_RECIPES = new Set(['uranium-processing', 'nuclear-fuel-cell', 'nuclear-fuel-reprocessing', 'uranium-enrichment']);

// Keep the typed-buffer transfer kernel separate from reactor/HX/accident
// control flow. This is the same canonical four-pass calculation, not a
// second physics mode; topology construction remains inside stepHeat.
function transferHeat(H: HeatNet) {
  const { temp: T0, energy: E0, slotCaps: caps, out, incoming: inn, maxTemp: tmax, flowA, flowB, flowJ, storage } = H;
  // These are independent reads into stable slots, not an accumulation:
  // slot order need not be ID order. Keep the sparse high-water fallback.
  if (storage.nextSlot <= storage.count * 2) {
    for (let p = 0; p < storage.slots.length; p++) {
      const page = storage.slots[p], base = p * HEAT_SLOT_PAGE;
      for (let j = 0; j < HEAT_SLOT_PAGE; j++) {
        const e = page[j]; if (!e) continue;
        const i = base + j; E0[i] = e.hE || 0; T0[i] = AMB + E0[i] / caps[i];
      }
    }
  } else {
    for (let p = 0; p < storage.keys.length; p++) {
      const page = storage.blocks.get(storage.keys[p])!;
      for (let j = 0; j < HEAT_PAGE; j++) {
        const node = page[j]; if (!node) continue;
        const i = node.slot; E0[i] = node.entity.hE || 0; T0[i] = AMB + E0[i] / caps[i];
      }
    }
  }
  out.fill(0); inn.fill(0); tmax.fill(0);
  let count = 0;
  {
    for (const slots of H.edgeSlotPages) {
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i], b = slots[i + 1], ta = T0[a], tb = T0[b]; if (ta === tb) continue;
        const h = ta > tb ? a : b, c = ta > tb ? b : a, dT = Math.abs(ta - tb);
        const ch = caps[h], cc = caps[c];
        const eq = dT * ch * cc / (ch + cc);
        const f = Math.floor(Math.min(COND * dT, EDGE_MAX, eq));
        if (f > 0) { flowA[count] = h; flowB[count] = c; flowJ[count++] = f; out[h] += f; }
      }
    }
  }
  if (count) {
    for (let i = 0; i < count; i++) { const a = flowA[i]; if (out[a] > E0[a]) flowJ[i] = Math.floor(flowJ[i] * E0[a] / out[a]); }
    for (let i = 0; i < count; i++) { const a = flowA[i], b = flowB[i]; inn[b] += flowJ[i]; tmax[b] = Math.max(tmax[b], T0[a]); }
    for (let i = 0; i < count; i++) { const b = flowB[i], room = Math.max(0, Math.floor((tmax[b] - T0[b]) * caps[b])); if (inn[b] > room) flowJ[i] = Math.floor(flowJ[i] * room / inn[b]); }
    // The incoming/max-temperature scratch buffers are dead after the
    // constraint passes. Reuse them as exact working energy/touched flags.
    // Keep each original Number operation in edge order, not a net-flow sum.
    // Pipe commits are deferred to their loss phase; HX/reactor commits
    // happen now, before any exchanger reads its transferred energy.
    inn.set(E0); tmax.fill(0);
    for (let i = 0; i < count; i++) {
      const a = flowA[i], b = flowB[i], f = flowJ[i];
      inn[a] = (inn[a] || 0) - f; inn[b] = (inn[b] || 0) + f;
      tmax[a] = 1; tmax[b] = 1;
    }
    for (const e of H.reactors) {
      const slot = storage.get(e.id)!.slot;
      if (tmax[slot]) e.hE = inn[slot];
    }
    for (const e of H.hexs) {
      const slot = storage.get(e.id)!.slot;
      if (tmax[slot]) e.hE = inn[slot];
    }
  }
  return count > 0;
}

function pipeHeatLoss(g: Game, H: HeatNet, hasTransfers: boolean) {
  const { storage, incoming: transferred, maxTemp: touched } = H;
  let pipeLoss = 0, hasPipeLoss = false;
  {
    // Page order and each pipeSlots row match the former flat compatibility view.
    const bySlot = storage.slots;
    for (const pipeSlots of H.pipeSlotPages) {
      for (let i = 0; i < pipeSlots.length; i++) {
        const slot = pipeSlots[i], e = bySlot[slot >> 6][slot & 63]!;
        const moved = hasTransfers && touched[slot] === 1;
        const energy = moved ? transferred[slot] : e.hE;
        const h = energy || 0;
        if (h <= 0) { if (moved) e.hE = energy; e.hL = 0; continue; }
        const acc = (e.hL || 0) + h, L = Math.floor(acc / 3e6); e.hL = acc - L * 3e6;
        if (L > 0) {
          const loss = Math.min(h, L); e.hE = h - loss;
          pipeLoss = ((hasPipeLoss ? pipeLoss : g.nuc.st.lost) || 0) + loss;
          hasPipeLoss = true;
        } else if (moved) e.hE = energy;
      }
    }
  }
  if (hasPipeLoss) g.nuc.st.lost = pipeLoss;
}

export function stepHeat(g: Game) {
  const H = heatNet(g);
  const noBoom = !!g.settings.noBoom;
  if (!H.storage.count) { stationStats(g, H); stepZones(g); return; }
  // 1. реакторы: запуски, остановки, выработка (активность — по состоянию после запусков/остановок этого тика)
  // Snapshot each emergency-tripped rod's current output before processing
  // stops, so simultaneous trips retain the same adjacency multiplier.
  const stoppedOutputMW = new Map<number, number>();
  for (const e of H.reactors) if (e.rstop && (e.rt || 0) > 0)
    stoppedOutputMW.set(e.id, BASE_MW * (1 + reactorNeighbours(g, e)));
  for (const e of H.reactors) reactorStart(g, e, stoppedOutputMW.get(e.id));
  const nb = new Map<number, number>();
  for (const e of H.reactors) if ((e.rt || 0) > 0) nb.set(e.id, reactorNeighbours(g, e));
  for (const e of H.reactors) {
    if (!((e.rt || 0) > 0)) { e.rn = 0; e._mw = 0; continue; }
    const N = nb.get(e.id) || 0; e.rn = N; const P = BASE_MW * (1 + N); e._mw = P;
    const tot = (e.rrem || 0) + P * 1e6, J = Math.floor(tot / 60); e.rrem = tot - J * 60; e.hE = (e.hE || 0) + J;
    nstat(g, 'heatBase', BASE_MW * 1e6 / 60); if (N) nstat(g, 'heatBonus', BASE_MW * N * 1e6 / 60);
    e.rt!--;
    if (e.rt === 0) { e.output!['used-nuclear-fuel-cell'] = (e.output!['used-nuclear-fuel-cell'] || 0) + 1; nstat(g, 'burned'); nstat(g, 'spent'); if (H.reactors.length >= 4) nstat(g, 'spent4'); g.fxVer++; }
  }
  // 2. перенос тепла по температуре начала фазы
  // Буферы принадлежат текущему графу: сохраняем тот же одновременный
  // расчёт и порядок округления, не создавая десятки тысяч объектов за тик.
  const hasTransfers = transferHeat(H);
  // 3. теплообменники: реально отведённая энергия → пар 500 °C
  const lim = g.tick % 3 < 2 ? 166667 : 166666;
  for (const e of H.hexs) {
    e._hx = 0; e.status = 'no-heat'; e.active = false;
    const avail = Math.floor((e.hE || 0) - energyAt(e, HEX_ON));
    if (avail <= 0) continue;
    const water = g.fluidNets[e._fn?.[0] ?? -1], steam = g.fluidNets[e._fn?.[1] ?? -1];
    if (!water || water.conflict || water.fluid !== 'water' || water.amount < 1e-6) { e.status = 'no-water'; continue; }
    if (!steam || steam.conflict || (steam.fluid && steam.fluid !== 'steam' && steam.amount > 1e-6)) { e.status = 'output-full'; continue; }
    const J = Math.min(avail, lim, Math.floor(water.amount * HEX_J), Math.floor((steam.cap - steam.amount) * HEX_J));
    if (J <= 0) { e.status = steam.cap - steam.amount < 1e-6 ? 'output-full' : 'no-water'; continue; }
    const u = J / HEX_J; water.amount = Math.max(0, water.amount - u); addSteam(steam, u, SE_HOT); e.hE = (e.hE || 0) - J;
    nstat(g, 'steamJ', J); e._hx = J * 60 / 1e6; e.status = 'working'; e.active = true;
  }
  // 4. потери труб: 20 Вт на градус → (T−15)/3 Дж за тик; целочисленно через накопитель числителя
  // Keep the original sequence of Number additions, including || 0
  // normalization. Commit once: repeated boxed counter writes are not
  // needed inside this synchronous phase. Do not replace this with a
  // sum-of-losses addition (rounding differs beyond safe-integer precision).
  pipeHeatLoss(g, H, hasTransfers);
  // 5. аварийные проверки
  // Reactor checks and their synchronous blast cascade share one topology
  // batch; no fluid or power consumer runs until this heat phase is complete.
  const ownsBatch = !g.batchBuild;
  if (ownsBatch) g.batchBuild = true;
  try {
    for (const e of H.reactors) reactorCheck(g, e, noBoom);
    drainBoom(g);
  } finally {
    if (ownsBatch) {
      g.batchBuild = false;
      if (g.dirtyPower) { rebuildPower(g); g.dirtyPower = false; }
      if (g.dirtyFluid) { rebuildFluids(g); g.dirtyFluid = false; }
    }
  }
  stationStats(g, H);
  stepZones(g);
}

/** счётчики для достижений: «Квадрат мощности» — подряд идущие тики станции 2×2 с отдачей ≥450 МВт электричества */
function stationStats(g: Game, H: HeatNet) {
  const st = g.nuc.st; let n = 0;
  for (const e of H.reactors) if ((e.rt || 0) > 0 && (e.rn || 0) >= 2) n++;
  if (n >= 4 && turbineKW() >= 450000) { st.sq = (st.sq || 0) + 1; if (st.sq > (st.sqBest || 0)) st.sqBest = st.sq; } else if (st.sq) st.sq = 0;
}
function reactorStart(g: Game, e: Entity, stoppedOutputMW?: number) {
  const noBoom = !!g.settings.noBoom;
  const T = heatTemp(e);
  if (noBoom) { if (T >= OVER_T) e.rhold = true; else if (T < WARN_T) e.rhold = false; }
  if (e.rstop) {
    if ((e.rt || 0) > 0) { // аварийная остановка: стержень отработан; остаток потенциальной выработки не является потерей уже выделенного тепла
      const outputMW = stoppedOutputMW ?? BASE_MW * (1 + reactorNeighbours(g, e));
      nstat(g, 'stoppedPotentialJ', Math.round((e.rt! / ROD_TICKS) * (outputMW * 1e6) * 200));
      e.rt = 0; e.output!['used-nuclear-fuel-cell'] = (e.output!['used-nuclear-fuel-cell'] || 0) + 1; nstat(g, 'stopped'); nstat(g, 'spent'); g.fxVer++;
    }
    e.status = 'emergency'; e._why = 'Аварийная остановка'; return;
  }
  const cells = e.input!['nuclear-fuel-cell'] || 0, waste = e.output!['used-nuclear-fuel-cell'] || 0;
  if ((e.rt || 0) <= 0) {
    const allow = e.rgo !== false && !e.coff && !e.rhold;
    if (cells > 0 && waste + 1 <= ROD_STACK && allow) { e.input!['nuclear-fuel-cell'] = cells - 1; if (!e.input!['nuclear-fuel-cell']) delete e.input!['nuclear-fuel-cell']; e.rt = ROD_TICKS; e.rrem = e.rrem || 0; g.fxVer++; }
    else e._why = cells <= 0 ? 'Нет стержней' : waste + 1 > ROD_STACK ? 'Выход отходов заполнен' : e.rhold ? 'Перегрев: ждёт охлаждения ниже 900 °C' : e.rgo === false ? 'Следующий стержень не разрешён' : 'Выключено условием схемы';
  }
}
/** предполагаемая причина роста температуры: связи, теплообменники, вода, пар (по состоянию тепловой сети реактора) */
export function reactorCause(g: Game, e: Entity): string {
  const H = heatNet(g), component = H.componentById.get(e.id);
  const hx = component === undefined ? [] : H.hexsByComponent.get(component) || [];
  if (!hx.length) return H.hexs.length ? 'реактор не соединён с теплообменником — проверьте тепловые трубы и порты' : 'нет теплообменников — теплу некуда уходить';
  let allNoWater = true, allOutputFull = true, allNoHeat = true, anyNoWater = false, anyOutputFull = false;
  for (let i = 0; i < hx.length; i++) {
    if (!(i in hx)) continue;
    const status = hx[i].status;
    if (status !== 'no-water') allNoWater = false; else anyNoWater = true;
    if (status !== 'output-full') allOutputFull = false; else anyOutputFull = true;
    if (status !== 'no-heat') allNoHeat = false;
  }
  if (allNoWater) return 'теплообменникам не хватает воды';
  if (allOutputFull) return 'пар не расходуется — проверьте турбины, двигатели и трубы пара';
  if (anyNoWater) return 'часть теплообменников без воды';
  if (anyOutputFull) return 'часть теплообменников не может отдать пар';
  if (allNoHeat) return 'теплообменники не прогреты — тепловая труба слишком длинная или тонкая';
  return `теплообменников мало: ${hx.length} шт. не успевают отвести ${e._mw || 0} МВт`;
}
function reactorCheck(g: Game, e: Entity, noBoom: boolean) {
  if (e.hp != null && e.hp <= 0) return;
  let T = heatTemp(e);
  if (T >= OVER_T) g.nuc.st.spent4 = 0; // авария обнуляет серию «Холодной головы»
  if (noBoom && T >= OVER_T) { const keep = energyAt(e, OVER_T), ex = (e.hE || 0) - keep; if (ex > 0) { e.hE = keep; nstat(g, 'lost', ex); T = OVER_T; } }
  if (!noBoom && T >= OVER_T) { if (!((e.ot || 0) > 0)) { g.nucEv.push({ k: 'overheat', id: e.id }); g.alert(e.x + 2.5, e.y + 2.5, 'Реактор перегрет!'); } e.ot = (e.ot || 0) + 1; } else if (e.ot) e.ot = 0;
  // v1.16: рост температуры (°C/мин, по замеру раз в 5 с), причина и подсказка ОСКАРа при выходе на 900 °C
  if ((g.tick + e.id) % 300 === 0) { const p = e._tp; e._dT = p ? (T - p[1]) * 12 * 300 / Math.max(1, g.tick - p[0]) : 0; e._tp = [g.tick, T]; if (T >= WARN_T - 100) e._cause = reactorCause(g, e); }
  if (T >= WARN_T && !e._wa) { e._wa = true; e._cause = reactorCause(g, e); g.msg(`ОСКАР: реактор ${Math.round(T)} °C — тревога. Вероятная причина: ${e._cause}.`); g.snd('alert', e.x + 2.5, e.y + 2.5); }
  else if (T < WARN_T - 50) e._wa = false;
  if (T >= WARN_T && g.tick % 300 === 0) g.alert(e.x + 2.5, e.y + 2.5, noBoom && T >= OVER_T ? 'Перегрев: потеря тепла, взрыв отключён' : 'Реактор: ' + Math.round(T) + ' °C');
  if (!noBoom && ((e.ot || 0) >= OVER_TICKS || T >= MAX_T)) { g.nuc.st.boom = (g.nuc.st.boom || 0) + 1; explode(g, e, false); return; }
  const rod = (e.rt || 0) > 0;
  if (e.rstop) { e.status = 'emergency'; e.active = false; }
  else if (T >= OVER_T) { e.status = 'overheat'; e.active = rod; }
  else if (rod) { e.status = (e.output!['used-nuclear-fuel-cell'] || 0) >= ROD_STACK ? 'waste-full' : 'working'; e.active = true; e._why = ''; }
  else { e.active = false; e.status = (e.input!['nuclear-fuel-cell'] || 0) <= 0 ? 'no-input' : (e.output!['used-nuclear-fuel-cell'] || 0) + 1 > ROD_STACK ? 'output-full' : 'blocked'; }
}

// ---------- взрыв и заражение ----------
export function reactorKilled(g: Game, e: Entity) {
  if (e.rdead) return; if (g.settings.noBoom || heatTemp(e) < HEX_ON) return;
  if (g._booming) { g._boomQ.push(e); return; }
  explode(g, e, true);
}
/**
 * Explosion candidates: every entity that can lie within BOOM_R of (cx, cy),
 * in ascending id order, excluding `self`. Equivalent to scanning all of
 * g.ents: an entity whose closest point is closer than R has a tile inside
 * [floor(c - R), floor(c + R)] on both axes, so the tile scan finds every
 * entity that is fully registered in the occupancy grid. Entities that are
 * not fully registered there (rails, locomotives, wagons, any irregular
 * record) come from an off-grid list rebuilt whenever an entity was added
 * (nextId changed) or the tick advanced. Removed entities are skipped by
 * the caller through g.ents.has, exactly as before.
 */
let offGridTick = -1, offGridNext = -1, offGridGame: Game | null = null, offGrid: Entity[] = [];
function offGridEntities(g: Game): Entity[] {
  if (offGridGame === g && offGridTick === g.tick && offGridNext === g.nextId) return offGrid;
  const list: Entity[] = [];
  for (const o of g.ents.values()) {
    let onGrid = o.t !== 'rail' && o.t !== 'loco' && o.t !== 'wagon' && o.w > 0 && o.h > 0;
    if (onGrid) for (let ty = o.y; onGrid && ty < o.y + o.h; ty++) for (let tx = o.x; tx < o.x + o.w; tx++) if (g.world.occ(tx, ty) !== o.id) { onGrid = false; break; }
    if (!onGrid) list.push(o);
  }
  offGridGame = g; offGridTick = g.tick; offGridNext = g.nextId; offGrid = list;
  return list;
}
function boomCandidates(g: Game, self: Entity, cx: number, cy: number, R: number): Entity[] {
  const seen = new Set<number>(), out: Entity[] = [];
  for (let ty = Math.floor(cy - R); ty <= Math.floor(cy + R); ty++) for (let tx = Math.floor(cx - R); tx <= Math.floor(cx + R); tx++) {
    const id = g.world.occ(tx, ty); if (id < 0 || seen.has(id)) continue; seen.add(id);
    const o = g.ents.get(id); if (o && o !== self) out.push(o);
  }
  for (const o of offGridEntities(g)) if (o !== self && !seen.has(o.id)) { seen.add(o.id); out.push(o); }
  return out.sort((a, b) => a.id - b.id);
}
function explode(g: Game, e: Entity, fromDamage: boolean) {
  if (e.rdead) return; e.rdead = true; g.nuc.st.spent4 = 0;
  const queue = g._boomQ; g._booming = true;
  try {
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    nstat(g, 'lost', Math.max(0, Math.floor(e.hE || 0))); e.hE = 0;
    g.fx.push({ k: 'blast', x: cx, y: cy, t: 70, life: 70, s: BOOM_R }); g.fx.push({ k: 'boom', x: cx, y: cy, t: 60, life: 60, s: 8 }); g.snd('boom', cx, cy);
    g.alert(cx, cy, 'ВЗРЫВ РЕАКТОРА');
    g.nuc.zones.push({ x: cx, y: cy, t: g.tick, r: ZONE_R, dur: ZONE_TICKS });
    g.nucEv.push({ k: 'boom', id: e.id });
    const near = boomCandidates(g, e, cx, cy, BOOM_R);
    const dm = (d: number) => BOOM_DMG * Math.max(0, 1 - d / BOOM_R);
    for (const o of near) {
      if (!g.ents.has(o.id)) continue;
      const d = Math.hypot(Math.max(o.x, Math.min(cx, o.x + o.w)) - cx, Math.max(o.y, Math.min(cy, o.y + o.h)) - cy);
      if (d < BOOM_R) g.damage(o, dm(d), false);
    }
    for (const u of unitsNear(g, cx, cy, BOOM_R + 0.4)) { const d = Math.hypot(u.x - cx, u.y - cy); if (d < BOOM_R) hitUnit(g, u, dm(d), -1, 'expl'); }
    g.eachPl(() => { const pl = g.player; if (pl.dead) return; const d = Math.hypot(pl.x - cx, pl.y - cy); if (d < BOOM_R) g.hurtPlayer(dm(d), true, false, 'expl'); });
    if (!fromDamage && g.ents.has(e.id)) { e._died = true; g.removeEntity(e, false); }
  } finally { g._booming = false; }
  void queue;
}
/** v1.16: ядерная боеголовка боеприпаса — урон падает от центра к краю (до 20% на границе), затем радиоактивный след; считается один раз при попадании */
export function nuclearBlast(g: Game, cx: number, cy: number, R: number, dmg: number, nk: { tr: number; ts: number; dps: number }, by: number, bio?: { kind: 'acid' | 'slow'; amount: number; baseDamage: number }) {
  g.fx.push({ k: 'blast', x: cx, y: cy, t: 70, life: 70, s: R }); g.fx.push({ k: 'boom', x: cx, y: cy, t: 60, life: 60, s: Math.min(8, R) }); g.snd('boom', cx, cy);
  const dm = (d: number) => dmg * Math.max(0, 1 - 0.8 * d / R);
  const seen = new Set<number>();
  for (let ty = Math.floor(cy - R); ty <= Math.floor(cy + R); ty++) for (let tx = Math.floor(cx - R); tx <= Math.floor(cx + R); tx++) {
    const o = g.entAt(tx, ty); if (!o || seen.has(o.id)) continue; seen.add(o.id);
    const d = Math.hypot(Math.max(o.x, Math.min(cx, o.x + o.w)) - cx, Math.max(o.y, Math.min(cy, o.y + o.h)) - cy);
    if (d < R) { const scale = Math.max(0, 1 - 0.8 * d / R), acid = bio?.kind === 'acid' ? bio.baseDamage * bio.amount * scale : 0; g.damage(o, dm(d) + acid, false, by, 'expl'); }
  }
  for (const u of unitsNear(g, cx, cy, R + 0.4, [], true, true)) { const d = Math.hypot(u.x - cx, u.y - cy); if (d < R) {
    const scale = Math.max(0, 1 - 0.8 * d / R);
    if (bio?.kind === 'acid') hitUnit(g, u, bio.baseDamage * bio.amount * scale, by, 'acid', 0, 1, 0);
    hitUnit(g, u, dm(d), by, 'expl');
    if (bio?.kind === 'slow' && u.hp > 0) applyUnitSlow(g, u, UNITS[u.k]?.boss ? .01 : bio.amount, 2 * TICKS);
  } }
  g.eachPl(() => { const pl = g.player; if (pl.dead) return; const d = Math.hypot(pl.x - cx, pl.y - cy); if (d < R) g.hurtPlayer(dm(d), true, false, 'expl'); });
  g.nuc.zones.push({ x: cx, y: cy, t: g.tick, r: nk.tr, dur: nk.ts * 60, dps: nk.dps });
  nstat(g, 'nukes');
}
function drainBoom(g: Game) {
  while (g._boomQ.length) {
    g._boomQ.sort((a, b) => a.id - b.id); const e = g._boomQ.shift()!;
    if (e.rdead) continue;
    if (g.ents.has(e.id)) explode(g, e, false); else explode(g, e, true);
  }
}
function stepZones(g: Game) {
  const z = g.nuc.zones; if (!z.length) return;
  g.nuc.zones = z.filter(a => g.tick - a.t < a.dur);
}
/** урон заражения в точке, ед/с: наибольшая интенсивность из наложившихся зон */
export function contamRate(g: Game, x: number, y: number): number {
  let m = 0;
  for (const a of g.nuc.zones) { const d = Math.hypot(x - a.x, y - a.y); if (d >= a.r) continue; const k = (1 - d / a.r) * (1 - (g.tick - a.t) / a.dur); if (k > 0) m = Math.max(m, (a.dps ?? ZONE_DPS) * k); }
  return m;
}
/** v1.16: радиация урановых месторождений — до 2 ед/с без защиты в пределах 3 клеток от руды с ненулевым запасом; берётся наибольший локальный уровень, исчерпанная руда не излучает */
export const FIELD_R = 3, FIELD_DPS = 2;
export function fieldRate(g: Game, x: number, y: number): number {
  const tx = Math.floor(x), ty = Math.floor(y); let best = 1e9;
  for (let dy = -FIELD_R; dy <= FIELD_R; dy++) for (let dx = -FIELD_R; dx <= FIELD_R; dx++) {
    const cx = tx + dx, cy = ty + dy; if (!g.world.hasChunk(Math.floor(cx / CHUNK), Math.floor(cy / CHUNK))) continue;
    if (g.world.res(cx, cy) !== R_URAN) continue;
    const d = Math.hypot(x - (cx + .5), y - (cy + .5)); if (d < best) best = d;
  }
  return best <= FIELD_R ? FIELD_DPS * (1 - best / (FIELD_R + 1)) : 0;
}
/** суммарная радиация в точке, ед/с до защиты: месторождения, аварийные зоны и следы боеприпасов — берётся наибольшая, а не сумма */
export const radRate = (g: Game, x: number, y: number) => Math.max(fieldRate(g, x, y), contamRate(g, x, y));
/** состояние дозы для HUD: до защиты, защита и итог, ед/с */
export function radStatus(g: Game, pl = g.player): { raw: number; prot: number; net: number } {
  const raw = radRate(g, pl.x, pl.y); const prot = kitStats(kitOf(pl)).rad; return { raw, prot, net: raw * (1 - prot) };
}
/** радиация действует на текущего инженера (вызывается внутри eachPl); урон считается каждый тик, остатки не округляются */
export function stepContam(g: Game) {
  const pl = g.player; if (pl.dead) return;
  const r = radRate(g, pl.x, pl.y); if (r <= 0) { return; }
  const prot = kitStats(kitOf(pl)).rad;
  if (g.tick - (g.radWarnT.get(g.pl) ?? -1e9) > 900 && prot < 0.5 && !(g.x.mode === 1)) { g.radWarnT.set(g.pl, g.tick); g.msg('☢ Радиация! Уйдите от урановой руды или наденьте радиационный костюм.'); }
  g.hurtPlayer(r * (1 - prot) / 60, true, true, 'rad');
}
