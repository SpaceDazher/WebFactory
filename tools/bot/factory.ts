// Бот-тест: «экономика» — ячейки производства, логистика руками (сбор из выходных сундуков → раздача во входные),
// ручной крафт построек, размещение блоков (на руде и вне её), подключение столбов и прокладка труб.
import { Bot, BotError, Task, center } from './core';
import { PROTOS, ITEMS, RECIPES } from './core';
import { TECHS } from '../../src/data/techs';
import { Plan, PEnt, Port, portsOf, routePipe, commitRoute, key, unkey, dims, findPath } from './map';
import { Block, CellSpec, XY, mk } from './layouts';
import type { Entity } from '../../src/sim/game';
import { DX, DY } from '../../src/core/types';
import { CREEP_BLOCK, creepAt } from '../../src/sim/enemies';

export type CellKind = 'defense' | 'craft' | 'smelt' | 'lab' | 'col' | 'raw' | 'power' | 'chem' | 'ref' | 'pj' | 'silo' | 'burner';
export interface Cell { id: number; kind: CellKind; recipe: string | null; m: XY; in?: XY; out?: XY; i?: XY; prio: number; block: number; res?: string; direct?: string[]; }
export interface BlockRec { id: number; name: string; x: number; y: number; w: number; h: number; kind: CellKind; cells: number[]; }
const FLUIDS = new Set(Object.keys(ITEMS).filter(k => ITEMS[k].fluid));
const POLE = 'small-electric-pole';

class RouteHeap {
  private a: [number, number, number, number][] = [];
  private less(x: [number, number, number, number], y: [number, number, number, number]) { return x[0] < y[0] || (x[0] === y[0] && (x[1] < y[1] || (x[1] === y[1] && x[3] > y[3]))); }
  push(f: number, tie: number, k: number, g: number) {
    const a = this.a; a.push([f, tie, k, g]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number, number, number] | undefined {
    const a = this.a, top = a[0], last = a.pop(); if (!top) return;
    if (a.length) { a[0] = last!; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r;
      if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
    } }
    return top;
  }
  get size() { return this.a.length; }
}

/** Register power-block water and steam ports before routing the boiler feed. */
export function planPowerFluidPorts(plan: Plan, b: Block, ox: number, oy: number) {
  for (const e of b.bp.entities) {
    const placed = { p: e.p, x: ox + e.x, y: oy + e.y, d: e.d, recipe: e.recipe };
    if (e.p === 'pipe' || e.p === 'pipe-to-ground') {
      plan.add(placed, 'water-p');
      continue;
    }
    if (e.p === 'electric-mining-drill') {
      // The power block drills mine coal, but their dormant acid ports still
      // occupy a real connection point. Keep boiler water routes away from it.
      plan.add(placed, undefined, portsOf(placed, { in: ['sulfuric-acid'] }));
      continue;
    }
    const fixed = e.p === 'boiler' ? ['water-p', 'steam-p'] : e.p === 'steam-engine' ? ['steam-p'] : null;
    if (fixed) plan.add(placed, undefined, portsOf(placed, { fixed }));
  }
}

/** запас продукта, выше которого ячейку не кормим (канбан) */
const CAP: Record<string, number> = { 'iron-gear-wheel': 600, 'copper-cable': 1200, 'electronic-circuit': 1200, 'inserter': 200, 'fast-inserter': 100, 'transport-belt': 200, pipe: 400,
  'automation-science-pack': 300, 'logistic-science-pack': 300, 'chemical-science-pack': 300, 'production-science-pack': 300, 'utility-science-pack': 300,
  'steel-plate': 500, 'stone-brick': 1500, 'plastic-bar': 1200, sulfur: 400, 'advanced-circuit': 800, 'engine-unit': 300, battery: 400, 'processing-unit': 1600,
  'electric-engine-unit': 220, 'low-density-structure': 1150, 'rocket-fuel': 1100, 'solid-fuel': 1200, 'electric-furnace': 60, 'productivity-module': 60, 'solar-panel': 100, accumulator: 100, concrete: 1100 };

export class Factory extends Bot {
  cells: Cell[] = []; blocks: BlockRec[] = []; nets = new Map<string, Set<number>>(); hub: XY[] = [];
  researchOrder: string[] = []; caps = { ...CAP }; reserved: Record<string, number> = {}; wantChain = new Set<string>(); rounds = 0; ins = 'inserter'; asm = 'assembling-machine-1'; chest = 'iron-chest';
  // ---------- справка ----------
  E(p: XY | undefined): Entity | null { if (!p) return null; return this.g.entAt(p[0], p[1]); }
  inv(item: string) { return this.g.inv.count(item); }
  chestItems(e: Entity | null): Record<string, number> { return e?.inv ? e.inv.items() : {}; }
  /** где лежит товар: выходные сундуки ячеек и склад */
  sources(): { e: Entity; items: Record<string, number> }[] {
    const out: { e: Entity; items: Record<string, number> }[] = [];
    for (const c of this.cells) if (c.out) { const e = this.E(c.out); if (e?.inv) out.push({ e, items: e.inv.items() }); }
    for (const h of this.hub) { const e = this.E(h); if (e?.inv) out.push({ e, items: e.inv.items() }); }
    return out;
  }
  stock(): Record<string, number> { const s: Record<string, number> = { ...this.g.inv.items() }; for (const src of this.sources()) for (const k in src.items) s[k] = (s[k] || 0) + src.items[k]; return s; }
  /** время одного крафта ячейки с учётом скорости манипуляторов */
  cellTime(c: Cell): number {
    const r = RECIPES[c.recipe!]; const m = this.E(c.m); if (!m) return 1e9; const sp = PROTOS[m.proto].speed || 1;
    let t = r.time / sp; const insE = this.E(c.i);
    const rate = insE && PROTOS[insE.proto].rot ? PROTOS[insE.proto].rot! : 0.83;
    const nin = r.in.filter(i => !FLUIDS.has(i[0])).reduce((a, i) => a + i[1], 0), nout = r.out.filter(i => !FLUIDS.has(i[0])).reduce((a, i) => a + i[1], 0);
    return Math.max(t, nin / rate, nout / rate);
  }
  // ---------- заявки на подачу ----------
  requests(): { e: Entity; item: string; n: number; prio: number }[] {
    const reqs: { e: Entity; item: string; n: number; prio: number }[] = []; const st = this.stock();
    const H = 15 * 60; // горизонт подачи, с
    for (const c of this.cells) {
      if (c.kind === 'col' || c.kind === 'burner') { // топливо печи колонны
        const f = this.E(c.m); if (!f || PROTOS[f.proto].energy?.kind !== 'burner') continue; const have = f.fuel?.item === 'coal' ? f.fuel.count : f.fuel ? 99 : 0;
        if (have < 20) reqs.push({ e: f, item: 'coal', n: 50 - have, prio: 1 });
        continue;
      }
      if (c.kind === 'power') { const b = this.E(c.m); if (b && (!b.fuel || b.fuel.count < 2) && (b.fuelJ || 0) < 1e6) reqs.push({ e: b, item: 'coal', n: 20, prio: 0 }); continue; }
      if (!c.in || !c.recipe) {
        if (c.kind === 'lab') { /* ниже */ } else continue;
      }
      const chest = this.E(c.in); if (!chest?.inv) continue;
      const have = chest.inv.items();
      if (c.kind === 'lab') {
        const t = this.g.research.current; if (!t) continue;
        for (const p of TECHS[t].packs) { const h = have[p] || 0; if (h < 10) reqs.push({ e: chest, item: p, n: 30 - h, prio: 0 }); }
        continue;
      }
      const r = RECIPES[c.recipe!]; const firstOut = r.out[0]; if (!firstOut) continue;
      const [prod, perCraft] = firstOut;
      if (r.in.some(([it]) => this.reserved[it]) && !this.wantChain.has(prod)) continue; // материалы нужны на стройку (кроме ячеек, что делают недостающее)
      if (c.kind === 'silo') {
        for (const [it, n] of r.in) { const h = have[it] || 0; if (h < n * 5) reqs.push({ e: chest, item: it, n: n * 10 - h, prio: 0 }); }
        continue;
      }
      const cap = c.out ? this.caps[prod] ?? Infinity : Infinity; const s = c.out ? st[prod] || 0 : 0; if (s >= cap) continue;
      const m = this.E(c.m); if (!m) continue;
      if (m.status === 'output-full' && c.kind !== 'chem') continue;
      const t = this.cellTime(c); let k = Math.min(H / t, (cap - s) / perCraft + 2);
      const solid = r.in.filter(i => !FLUIDS.has(i[0]) && !c.direct?.includes(i[0]));
      if (c.kind === 'smelt') solid.push(['coal', 0]);
      // не больше ~26 слотов на всё
      const slots = solid.reduce((a, [it, n]) => a + (n * k) / ITEMS[it].stack, 0); if (slots > 26) k *= 26 / slots;
      k = Math.max(k, 2);
      for (const [it, n0] of solid) {
        let n = n0 * k; if (it === 'coal' && c.kind === 'smelt') n = Math.max(4, k * PROTOS[m.proto].energy!.kW * r.time / (PROTOS[m.proto].speed || 1) / 4000) + 2;
        const tgt = Math.ceil(n); const h = have[it] || 0; const inMachine = m.input?.[it] || 0;
        if (h + inMachine < tgt * 0.4) reqs.push({ e: chest, item: it, n: tgt - h, prio: c.prio });
      }
    }
    return reqs.sort((a, b) => a.prio - b.prio);
  }
  // ---------- один обход ----------
  *round(): Task<boolean> {
    this.rounds++; this.manageResearch();
    yield* this.tidy();
    const reqs = this.requests(); if (!reqs.length) return false;
    // распределение: сначала инвентарь, потом сундуки-источники (в пределах свободных слотов)
    const st = this.stock(); const inv = this.g.inv.items();
    const want: Record<string, number> = {}; const plan: { e: Entity; item: string; n: number }[] = [];
    let slots = this.freeSlots() - 3;
    for (const r of reqs) {
      const avail = (st[r.item] || 0) - (want[r.item] || 0); if (avail <= 0) continue;
      let n = Math.min(r.n, avail); const fromInv = Math.max(0, (inv[r.item] || 0) - (want[r.item] || 0));
      const fetch = Math.max(0, n - fromInv); const needSlots = Math.ceil(fetch / ITEMS[r.item].stack);
      if (needSlots > slots) { n = fromInv + Math.max(0, slots) * ITEMS[r.item].stack; if (n <= 0) continue; }
      slots -= Math.ceil(Math.max(0, n - fromInv) / ITEMS[r.item].stack);
      want[r.item] = (want[r.item] || 0) + n; plan.push({ e: r.e, item: r.item, n });
    }
    if (!plan.length) return false;
    yield* this.fetch(want);
    // раздача — ближайший следующий
    let todo = plan.slice(); let any = false;
    while (todo.length) {
      todo.sort((a, b) => this.distE(a.e) - this.distE(b.e));
      const p = todo.shift()!; const e = this.g.ents.get(p.e.id); if (!e) continue;
      const n = Math.min(p.n, this.inv(p.item)); if (n <= 0) continue;
      yield* this.reach(e); this.put(e, p.item, n); any = true; yield;
      // всё, что рядом, — сразу
      for (const q of todo.slice()) { const qe = this.g.ents.get(q.e.id); if (qe && this.inReach(qe)) { const k = Math.min(q.n, this.inv(q.item)); if (k > 0) { this.put(qe, q.item, k); yield; } todo.splice(todo.indexOf(q), 1); } }
    }
    return any;
  }
  distE(e: Entity) { const [x, y] = center(e); return this.dist(x, y); }
  /** собрать в инвентарь want[item] штук (с учётом того, что уже есть) из сундуков-источников */
  *fetch(want: Record<string, number>): Task {
    const need = (it: string) => (want[it] || 0) - this.inv(it);
    for (let guard = 0; guard < 60; guard++) {
      const items = Object.keys(want).filter(it => need(it) > 0); if (!items.length) return;
      // ближайший сундук, где есть что-то нужное
      let best: Entity | null = null, bd = Infinity;
      for (const s of this.sources()) { if (!items.some(it => s.items[it] > 0)) continue; const d = this.distE(s.e); if (d < bd) { bd = d; best = s.e; } }
      if (!best) return;
      yield* this.reach(best);
      for (const s of this.sources()) {
        if (!this.inReach(s.e)) continue;
        for (let i = 0; i < s.e.inv!.size; i++) { const sl = s.e.inv!.slots[i]; if (!sl || need(sl.item) <= 0) continue; if (this.freeSlots() < 1 && this.g.inv.spaceFor(sl.item) < 1) break; this.take(s.e, 'chest:' + i); yield; }
      }
      if (this.freeSlots() < 1) return;
    }
  }
  /** выгрузить на склад всё лишнее, если инвентарь забит */
  *tidy(force = false): Task {
    if (!force && this.freeSlots() >= 26) return;
    if (!this.hub.length) return;
    const keep = (it: string, n: number) => PROTOS[it] ? n <= 60 : it === 'coal' ? n <= 100 : it === 'wood' ? n <= 100 : false;
    const items = this.g.inv.items();
    for (const h of this.hub) {
      const e = this.E(h); if (!e?.inv) continue;
      const left = Object.entries(this.g.inv.items()).filter(([it, n]) => !keep(it, n) && e.inv!.spaceFor(it) > 0); if (!left.length) continue;
      yield* this.reach(e);
      for (const [it, n] of left) { const k = Math.min(n - (PROTOS[it] ? 0 : 0), e.inv.spaceFor(it)); if (k > 0) { this.put(e, it, k); yield; } }
    }
    void items;
    if (this.freeSlots() < 10) { this.log('склад переполнен — строю ещё сундуки'); yield* this.growHub(); yield* this.tidy(true); }
  }
  *growHub(): Task {
    const ch = this.g.enabled.has('steel-chest') && this.stock()['steel-plate'] > 400 ? 'steel-chest' : 'iron-chest';
    const b: Block = { bp: mk('Склад', Array.from({ length: 8 }, (_, i) => ({ p: ch, x: i, y: 0, d: 0 as const }))), cells: [] };
    const h0 = this.hub[0] || [Math.floor(this.px), Math.floor(this.py)];
    const at = this.plan.findRect(h0[0] + 4, h0[1] + 2, 8, 1, { margin: 1, noOre: true }); if (!at) throw new BotError('нет места под склад');
    yield* this.makeAll({ [ch]: 8 });
    this.planAdd(b, at.x, at.y); yield* this.buildBp(b.bp, at.x, at.y);
    for (let i = 0; i < 8; i++) this.hub.push([at.x + i, at.y]);
  }
  // ---------- исследования ----------
  onSecond() { this.manageResearch(); }
  manageResearch() {
    const r = this.g.research; if (r.current && !r.done.has(r.current)) return;
    const next = this.researchOrder.find(t => !r.done.has(t) && this.g.canResearch(t));
    if (next && next !== r.current) { this.research(next); this.log('исследование: ' + TECHS[next].name); }
  }
  // ---------- ожидание с обслуживанием ----------
  /** обслуживать фабрику, пока не выполнится cond (или до maxMin игровых минут) */
  *serve(cond: () => boolean, maxMin: number, what: string): Task {
    const end = this.g.tick + maxMin * 3600;
    while (!cond()) {
      if (this.g.tick > end) throw new BotError('не дождался: ' + what, this.diag());
      const did = yield* this.round();
      if (cond()) return;
      if (this.g.tick - this.lastBalance > 20 * 3600) { this.lastBalance = this.g.tick; yield* this.balance(); }
      if (this.g.tick - this.lastGuard > 5 * 3600) { this.lastGuard = this.g.tick; yield* this.guard(); }
      yield did ? 120 : 900;
    }
  }
  lastBalance = 0; lastGuard = 0;
  /** v1.14.1: оборона (переопределяется в defense.ts) */
  *guard(): Task {}
  /** подстройка добычи и энергии под фактические запасы (переопределяется в сценарии) */
  *balance(): Task {}
  onCheckpoint() {
    if (!this.verbose) return;
    const d = this.diag(); const st = Object.entries(d.statuses).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '×' + v).join(' ');
    const r = this.g.research; const key = ['iron-plate', 'copper-plate', 'steel-plate', 'coal', 'iron-gear-wheel', 'copper-cable', 'electronic-circuit', 'automation-science-pack', 'logistic-science-pack', 'chemical-science-pack', 'plastic-bar', 'advanced-circuit', 'engine-unit', 'sulfur', 'battery', 'processing-unit', 'low-density-structure', 'rocket-fuel', 'solid-fuel', 'production-science-pack', 'utility-science-pack'];
    this.log(`  состояние: ${r.current} ${Math.round(r.progress)}/${r.current ? this.g.techCost(r.current) : 0}; ${st}`);
    this.log('  запасы: ' + key.filter(k => d.stock[k]).map(k => k + ' ' + d.stock[k]).join(', ') + `; сеть ${Math.round(this.maxDemand())}/${Math.round(this.maxSupply())} кВт, обходов ${this.rounds}`);
    const idle: Record<string, string> = {}; for (const c of this.cells) { if (!c.recipe) continue; const m = this.E(c.m); if (!m) continue; const k = c.kind + ':' + c.recipe; const w = m.status === 'working' ? 1 : 0; const [a, b] = (idle[k] || '0/0').split('/').map(Number); idle[k] = (a + w) + '/' + (b + 1); }
    this.log('  ячейки (работают/всего): ' + Object.entries(idle).map(([k, v]) => k + ' ' + v).join(', '));
  }
  maxDemand() { let d = 0; for (const n of this.g.powerNets.values()) d = Math.max(d, n.demand); return d; }
  maxSupply() { let d = 0; for (const n of this.g.powerNets.values()) d = Math.max(d, n.supply); return d; }
  diag() {
    const st: Record<string, number> = {}; for (const e of this.g.ents.values()) if (e.status && e.status !== 'working') { const k = e.proto + ':' + e.status; st[k] = (st[k] || 0) + 1; }
    return { tick: this.g.tick, research: this.g.research.current, stock: this.stock(), statuses: st };
  }
  // ---------- ручной крафт ----------
  /** что нужно взять из запасов, чтобы скрафтить n item руками (avail — доступно; reserve не трогать) */
  craftPlan(item: string, n: number, avail: Record<string, number>, need: Record<string, number>, missing: Record<string, number>, depth = 0) {
    const a = Math.max(0, avail[item] || 0); const t = Math.min(a, n);
    if (t > 0) { avail[item] = a - t; need[item] = (need[item] || 0) + t; }
    const rem = n - t; if (rem <= 0) return;
    const r = this.g.handRecipe(item);
    if (!r || depth > 8) { missing[item] = (missing[item] || 0) + rem; return; }
    const out = r.out.find(o => o[0] === item)![1]; const runs = Math.ceil(rem / out);
    for (const [i, m] of r.in) this.craftPlan(i, m * runs, avail, need, missing, depth + 1);
  }
  /** иметь в инвентаре items (докрафтить недостающее руками из запасов); ждёт, обслуживая фабрику */
  *makeAll(items: Record<string, number>, maxMin = 240): Task {
    const end = this.g.tick + maxMin * 3600;
    for (let pass = 0; ; pass++) {
      const short = Object.entries(items).filter(([it, n]) => this.inv(it) < n);
      if (!short.length) { this.reserved = {}; this.wantChain.clear(); return; }
      if (this.g.tick > end) throw new BotError('не хватило материалов: ' + short.map(([i, n]) => `${i} ${this.inv(i)}/${n}`).join(', '), this.diag());
      const avail = this.stock(); for (const [it, n] of Object.entries(items)) avail[it] = (avail[it] || 0) - Math.min(n, this.inv(it));
      const need: Record<string, number> = {}, missing: Record<string, number> = {};
      const [it, n] = short[0]; const want = n - this.inv(it);
      // сначала забрать готовое
      const ready = Math.min(want, Math.max(0, avail[it] - this.inv(it) + Math.min(n, this.inv(it))));
      void ready;
      this.craftPlan(it, want, avail, need, missing);
      if (Object.keys(missing).length) {
        // ждём, пока фабрика наработает
        if (pass % 20 === 0) this.log(`жду материалы для ${it}: нет ${Object.entries(missing).map(([a, b]) => a + ' ' + Math.ceil(b)).join(', ')}`);
        if (yield* this.handFallback(missing)) continue;
        // резерв: готовое на стройку не раздаём, но цепочку недостающего (и её сырьё) не блокируем — иначе тупик (сталь из железа)
        const chain = new Set<string>(); const add = (x: string, d = 0) => { if (chain.has(x) || d > 8) return; chain.add(x); const rr = Object.values(RECIPES).find(q => q.out[0]?.[0] === x); if (rr) for (const [i] of rr.in) add(i, d + 1); };
        for (const x in missing) add(x);
        this.reserved = { ...need, ...missing }; this.wantChain = chain;
        const did = yield* this.round(); yield did ? 120 : 1200; continue;
      }
      const want2: Record<string, number> = {}; for (const [a, b] of Object.entries(need)) want2[a] = b + (items[a] ? Math.min(items[a], this.inv(a)) : 0);
      // забираем (для готового item — сам предмет; для остального — ингредиенты)
      yield* this.fetch(want2);
      if (this.inv(it) >= n) continue;
      const r = this.g.handRecipe(it); if (!r) { yield 600; continue; }
      const runs = Math.ceil((n - this.inv(it)) / r.out.find(o => o[0] === it)![1]);
      const before = this.inv(it); this.craft(r.id, runs); yield;
      yield* this.until(() => this.g.queue.length === 0, 3600 * 60, 'ручной крафт ' + it, 10);
      if (this.inv(it) <= before) { const did = yield* this.round(); yield did ? 60 : 600; }
    }
  }
  /** чем занять руки, пока нет материалов (на старте — добыть руками); true — что-то сделано */
  *handFallback(_missing: Record<string, number>): Task<boolean> { return false; }
  // ---------- размещение ----------
  planAdd(b: Block, ox: number, oy: number) { for (const e of b.bp.entities) this.plan.add({ p: e.p, x: ox + e.x, y: oy + e.y, d: e.d, recipe: e.recipe }); }
  bpNeed(b: Block): Record<string, number> { const n: Record<string, number> = {}; for (const e of b.bp.entities) n[e.p] = (n[e.p] || 0) + 1; return n; }
  /** построить блок в (ox,oy): материалы → вставка чертежа → ячейки → электричество */
  *placeBlock(b: Block, ox: number, oy: number, kind: CellKind, o: { prio?: number; res?: string; power?: boolean } = {}): Task<BlockRec> {
    yield* this.makeAll(this.bpNeed(b));
    this.planAdd(b, ox, oy);
    yield* this.buildBp(b.bp, ox, oy);
    const rec: BlockRec = { id: this.blocks.length, name: b.bp.name, x: ox, y: oy, w: b.bp.w, h: b.bp.h, kind, cells: [] };
    this.blocks.push(rec);
    for (const cs of b.cells) {
      const m = this.g.entAt(ox + cs.m[0], oy + cs.m[1]);
      const c: Cell = { id: this.cells.length, kind, recipe: (m as any)?.recipe || null, m: [ox + cs.m[0], oy + cs.m[1]], in: cs.in && [ox + cs.in[0], oy + cs.in[1]], out: cs.out && [ox + cs.out[0], oy + cs.out[1]], i: cs.i && [ox + cs.i[0], oy + cs.i[1]], prio: o.prio ?? 5, block: rec.id, res: o.res, direct: cs.direct };
      if (kind === 'smelt') c.recipe = o.res || null;
      this.cells.push(c); rec.cells.push(c.id);
    }
    if (o.power !== false && b.bp.entities.some(e => e.p === POLE)) yield* this.connectPower(rec);
    this.log(`построен блок «${b.bp.name}» (${b.cells.length} яч.) в ${ox},${oy}`);
    return rec;
  }
  /** место под блок вне руды, ближе к якорю */
  spot(b: Block, ax: number, ay: number, margin = 1): { x: number; y: number } {
    const at = this.plan.findRect(ax, ay, b.bp.w, b.bp.h, { margin, noOre: true, maxR: 160 });
    if (!at) throw new BotError(`нет места под «${b.bp.name}» около ${ax},${ay}`);
    return at;
  }
  /** место для блока с бурами на руде res (id 1..4): буры (клетки cells[].m) должны стоять на руде */
  oreSpot(b: Block, res: number, ax: number, ay: number, R = 40, drillAt?: XY[]): { x: number; y: number } | null {
    R = Math.ceil(R); const w = this.g.world; const drills = drillAt || b.bp.entities.filter(e => e.p === 'electric-mining-drill').map(e => [e.x, e.y] as XY);
    let best: { x: number; y: number } | null = null, bs = -1;
    for (let y = Math.round(ay) - R; y <= ay + R; y++) for (let x = Math.round(ax) - R; x <= ax + R; x++) {
      let score = 0, ok = true;
      for (const [dx, dy] of drills) {
        let tiles = 0, amt = 0;
        for (let yy = y + dy - 1; yy < y + dy + 4; yy++) for (let xx = x + dx - 1; xx < x + dx + 4; xx++) if (w.res(xx, yy) === res) { tiles++; amt += w.amt(xx, yy); }
        // под самим буром (центр) — руда этого типа; чужой руды под буром быть не должно
        let foreign = 0; for (let yy = y + dy - 1; yy < y + dy + 4; yy++) for (let xx = x + dx - 1; xx < x + dx + 4; xx++) { const r = w.res(xx, yy); if (r && r !== res) foreign++; }
        if (tiles < 8 || foreign) { ok = false; break; } score += amt;
      }
      if (!ok || score <= bs) continue;
      if (!this.plan.free(x - 1, y - 1, b.bp.w + 2, b.bp.h + 2)) continue;
      bs = score - Math.hypot(x - ax, y - ay) * 50; best = { x, y };
    }
    return best;
  }
  // ---------- электричество ----------
  poles(): Entity[] { const r: Entity[] = []; for (const e of this.g.ents.values()) if (e.t === 'pole') r.push(e); return r; }
  *connectPower(rec: BlockRec): Task {
    const mine = this.poles().filter(p => p.x >= rec.x && p.x < rec.x + rec.w && p.y >= rec.y && p.y < rec.y + rec.h);
    const others = this.poles().filter(p => !mine.includes(p));
    if (!others.length || !mine.length) return;
    const near = (x: number, y: number) => others.some(p => Math.hypot(p.x - x, p.y - y) <= 7.4);
    if (mine.some(p => near(p.x, p.y))) return;
    // ближайшая пара «свой столб — чужой столб»
    let a = mine[0], bd = Infinity; for (const p of mine) for (const q of others) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; a = p; } }
    yield* this.poleLine(a.x, a.y, near, others.map(p => [p.x, p.y] as XY));
  }
  /** линия столбов от (sx,sy) до клетки, где goal(x,y) */
  *poleLine(sx: number, sy: number, goal: (x: number, y: number) => boolean, targets: XY[]): Task {
    const pl = this.plan;
    const start = (x: number, y: number) => x === sx && y === sy;
    const buildable = (x: number, y: number) => start(x, y) || (pl.freeTile(x, y)
      && creepAt(this.g, x, y) < CREEP_BLOCK
      && this.g.canPlace(POLE, x, y, 0, false).ok);
    const ok = (x: number, y: number) => buildable(x, y) && (start(x, y) || !this.g.world.res(x, y));
    const ok2 = (x: number, y: number) => buildable(x, y);
    const distance = targets.reduce((d, [x, y]) => Math.min(d, Math.abs(x - sx) + Math.abs(y - sy)), Infinity);
    const routeLimit = Number.isFinite(distance) ? Math.min(1000000, Math.max(200000, Math.ceil((distance / 2 + 1) ** 2 * 2.5))) : 200000;
    let path = this.tilePath(sx, sy, goal, ok, routeLimit, targets); if (!path) path = this.tilePath(sx, sy, goal, ok2, routeLimit, targets);
    if (!path) throw new BotError(`нет трассы для столбов от ${sx},${sy}`);
    const pts: XY[] = []; let last: XY = [sx, sy];
    for (let i = 1; i < path.length; i++) {
      const [x, y] = path[i]; if (goal(last[0], last[1])) break;
      const nx = path[i + 1]; if (!nx || Math.hypot(nx[0] - last[0], nx[1] - last[1]) > 7.2) { if (!(x === sx && y === sy)) { pts.push([x, y]); last = [x, y]; } }
    }
    if (!pts.length) return;
    const ox = Math.min(...pts.map(p => p[0])), oy = Math.min(...pts.map(p => p[1]));
    const b: Block = { bp: mk('Линия столбов', pts.map(([x, y]) => ({ p: POLE, x: x - ox, y: y - oy, d: 0 as const }))), cells: [] };
    yield* this.makeAll({ [POLE]: pts.length + this.inv(POLE) * 0 });
    this.planAdd(b, ox, oy); yield* this.buildBp(b.bp, ox, oy);
    this.log(`линия столбов: ${pts.length} шт.`);
  }
  /** путь по клеткам (4-связный) через ok-клетки */
  tilePath(sx: number, sy: number, goal: (x: number, y: number) => boolean, ok: (x: number, y: number) => boolean, limit = 200000, targets: XY[] = []): XY[] | null {
    const prev = new Map<number, number>(), cost = new Map<number, number>(), heap = new RouteHeap(); const start = key(sx, sy);
    const h = (x: number, y: number): [number, number] => {
      if (!targets.length) return [0, 0];
      let d = Infinity, tie = Infinity;
      for (const [tx, ty] of targets) {
        const dx = Math.abs(x - tx), dy = Math.abs(y - ty), md = dx + dy, td = 2 * dx + dy;
        if (md < d || (md === d && td < tie)) { d = md; tie = td; }
      }
      return [Math.max(0, d - 11), tie]; // goal points are within 7.4 tiles of a target pole
    };
    const [startH, startTie] = h(sx, sy); prev.set(start, -1); cost.set(start, 0); heap.push(startH, startTie, start, 0); let visited = 0;
    while (heap.size && visited < limit) {
      const [, , k, g] = heap.pop()!; if (cost.get(k) !== g) continue; visited++;
      const [x, y] = unkey(k);
      if (goal(x, y)) { const p: XY[] = []; for (let c = k; c !== -1; c = prev.get(c)!) p.push(unkey(c)); return p.reverse(); }
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d], nk = key(nx, ny), ng = g + 1;
        if (ng >= (cost.get(nk) ?? Infinity) || !ok(nx, ny)) continue;
        const [nh, tie] = h(nx, ny); cost.set(nk, ng); prev.set(nk, k); heap.push(ng + nh, tie, nk, ng);
      }
    }
    return null;
  }
  // ---------- жидкости ----------
  netTiles(net: string) { let s = this.nets.get(net); if (!s) { s = new Set(); this.nets.set(net, s); } return s; }
  /** зарегистрировать постройку с портами в плане (порты с сетями) */
  addPorts(e: PEnt, fl: { in?: string[]; out?: string[]; fixed?: (string | null)[] }): Port[] { const ports = portsOf(e, fl); for (const t of this.plan.tile.values()) void t; this.plan.add(e, undefined, ports); return ports; }
  /** провести трубу сети net от клетки перед портом (fx,fy) до сети; если сети ещё нет — клетка становится её началом */
  *pipeTo(net: string, fx: number, fy: number): Task {
    const tiles = this.netTiles(net);
    if (!tiles.size || tiles.has(key(fx, fy))) { tiles.add(key(fx, fy)); return; }
    const r = routePipe(this.plan, net, fx, fy, tiles);
    if (!r) throw new BotError(`не проложить трубу «${net}» от ${fx},${fy}`);
    commitRoute(this.plan, net, r);
    for (const e of r.ents) tiles.add(key(e.x, e.y));
    tiles.add(key(fx, fy));
    if (!r.ents.length) return;
    const ox = Math.min(...r.ents.map(e => e.x)), oy = Math.min(...r.ents.map(e => e.y));
    const b: Block = { bp: mk('Трубы: ' + net, r.ents.map(e => ({ p: e.p, x: e.x - ox, y: e.y - oy, d: e.d as any }))), cells: [] };
    yield* this.makeAll(this.bpNeed(b));
    yield* this.buildBp(b.bp, ox, oy);
    this.log(`труба «${net}»: ${r.ents.length} шт.`);
  }
  /** блок/постройка с портами: занести порты (сети), построить, провести трубы ко всем используемым портам */
  *placeFluid(b: Block, ox: number, oy: number, kind: CellKind, fl: { in?: string[]; out?: string[]; fixed?: (string | null)[] }, o: { prio?: number; once?: boolean } = {}): Task<BlockRec> {
    const fluidEnts = b.bp.entities.filter(e => PROTOS[e.p].fluid);
    const ports: Port[] = [];
    for (const e of fluidEnts) ports.push(...this.addPorts({ p: e.p, x: ox + e.x, y: oy + e.y, d: e.d, recipe: e.recipe }, fl));
    const rec = yield* this.placeBlock(b, ox, oy, kind, o);
    const done = new Set<string>();
    for (const pt of ports) { if (!pt.net || (o.once && done.has(pt.net))) continue; const fx = pt.x + DX[pt.d], fy = pt.y + DY[pt.d]; const t = this.plan.tile.get(key(fx, fy)); if (t && t.e.p !== 'pipe') continue; yield* this.pipeTo(pt.net, fx, fy); done.add(pt.net); }
    return rec;
  }
}
