// Бот-тест: сценарий партии от пустой карты до запуска ракеты. Только команды игрока; логистика — руками бота.
import { Factory, Cell, planPowerFluidPorts } from './factory';
import { Guarded, withDeps } from './defense';
import { BotError, Task } from './core';
import { PROTOS, RECIPES } from './core';
import { TECHS } from '../../src/data/techs';
import { craftBlock, chainBlock, smeltBlock, labBlock, columnBlock, rawBlock, powerBlock, chemUnit, refineryUnit, pumpjackUnit, siloBlock, mk, Block, XY } from './layouts';
import { key } from './map';
import { DX, DY } from '../../src/core/types';
import { T_SHALLOW } from '../../src/sim/world';
import type { Entity } from '../../src/sim/game';
import { trainOf, graph, SIG_OX, SIG_OY } from '../../src/sim/trains';
import { shapeOf } from '../../src/sim/railgeo';

const RES = { iron: 1, copper: 2, coal: 3, stone: 4 } as const;
type ResName = keyof typeof RES;
const ORE: Record<ResName, string> = { iron: 'iron-ore', copper: 'copper-ore', coal: 'coal', stone: 'stone' };
export function powerCoalOrder(patches: Patch[], ref: XY, preserveOtherOres: boolean): Patch[] {
  const overlaps = (a: Patch, b: Patch) => a.box[0] <= b.box[2] && a.box[2] >= b.box[0] && a.box[1] <= b.box[3] && a.box[3] >= b.box[1];
  const conflicts = (coal: Patch) => preserveOtherOres && patches.some(p =>
    (p.res === RES.iron || p.res === RES.copper) && p.amt >= 20000 && overlaps(coal, p));
  return patches.filter(p => p.res === RES.coal && p.amt >= 30000).slice().sort((a, b) => {
    const conflictOrder = Number(conflicts(a)) - Number(conflicts(b));
    return conflictOrder || Math.hypot(a.c[0] - ref[0], a.c[1] - ref[1]) - Math.hypot(b.c[0] - ref[0], b.c[1] - ref[1]);
  });
}
export interface Patch { res: number; tiles: number; amt: number; c: XY; box: [number, number, number, number]; }
export const RESEARCH = ['automation', 'logistic-science-pack', 'electronics', 'steel-processing', 'fast-inserter', 'automation-2', 'oil-processing', 'solar-energy', 'plastics',
  'sulfur-processing', 'engine', 'advanced-electronics', 'chemical-science-pack', 'battery', 'advanced-oil-processing', 'lubricant', 'modules', 'advanced-electronics-2',
  'advanced-material-processing-2', 'electric-engine', 'electric-energy-distribution-1', 'electric-energy-accumulators', 'production-science-pack', 'utility-science-pack',
  'modules-2', 'low-density-structure', 'rocket-fuel', 'concrete', 'modules-3', 'rocket-silo',
  'logistics', 'logistics-2', 'railway', 'automated-rail-transportation', 'rail-signals']; // v1.7: ж/д — после шахты, демо-участок после ракеты

/** v1.14.1: порядок исследований с обороной (при включённом Рое): турели и патроны — после стали, лазеры — после батарей */
export function defenseOrder(): string[] {
  const out: string[] = []; const put = (a: string[]) => { for (const t of a) if (!out.includes(t)) out.push(t); };
  for (const t of RESEARCH) {
    put([t]);
    if (t === 'steel-processing') put(withDeps(['turrets', 'stone-walls', 'military', 'military-2', 'bullet-damage-1', 'bullet-speed-1']));
    if (t === 'battery') put(withDeps(['laser-turret', 'laser-damage-1', 'laser-speed-1', 'bullet-damage-2']));
    if (t === 'advanced-electronics-2') put(withDeps(['laser-damage-2', 'laser-speed-2', 'bullet-damage-3', 'laser-damage-3']));
  }
  return out;
}
export class Run extends Guarded {
  patches: Patch[] = []; oilAt: XY = [0, 0]; wells: XY[] = [];
  burners: { d: number; f: number }[] = [];
  milestones: { t: number; what: string }[] = [];
  *handFallback(missing: Record<string, number>): Task<boolean> {
    // v1.15: дерево нужно и после старта (столбы) — на «Острове» его нет в стартовом наборе, а запас в сундуках не копится
    if (!this.boot) { if (!(missing.wood > 0)) return false; yield* this.gather('wood', this.inv('wood') + Math.ceil(missing.wood)); return true; }
    for (const [it, n] of Object.entries(missing)) {
      const want = this.inv(it) + Math.ceil(n);
      if (it === 'stone') { yield* this.rocks(1); if (this.inv('stone') < want) { const p = this.patch('stone'); yield* this.gather('stone', want, p.c[0], p.c[1]); } return true; }
      if (it === 'coal') { const p = this.patch('coal'); yield* this.gather('coal', want, p.c[0], p.c[1]); return true; }
      if (it === 'wood') { yield* this.gather('wood', want); return true; }
    }
    yield* this.tend(); yield 300; return true;
  }
  mark(what: string) { this.milestones.push({ t: this.g.tick, what }); this.log('★ ' + what); }
  // ---------- разведка карты ----------
  survey() {
    const w = this.g.world; const seen = new Set<number>(); const R = 1000;
    for (let y = -R; y < R; y += 2) for (let x = -R; x < R; x += 2) {
      const r = w.res(x, y); if (!r || r === 5 || seen.has(key(x, y))) continue;
      const q: XY[] = [[x, y]]; seen.add(key(x, y)); let n = 0, amt = 0, sx = 0, sy = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (q.length) { const [a, b] = q.pop()!; n++; amt += w.amt(a, b); sx += a; sy += b; x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
        for (let d = 0; d < 4; d++) { const c = a + DX[d], e = b + DY[d]; const k = key(c, e); if (!seen.has(k) && w.res(c, e) === r && Math.abs(c) < R + 40 && Math.abs(e) < R + 40) { seen.add(k); q.push([c, e]); } } }
      if (n >= 40) this.patches.push({ res: r, tiles: n, amt, c: [Math.round(sx / n), Math.round(sy / n)], box: [x0, y0, x1, y1] });
    }
    // нефть: самая богатая группа источников недалеко от центра
    const oil: [number, number, number][] = [];
    for (let y = -R; y < R; y++) for (let x = -R; x < R; x++) if (w.res(x, y) === 5) oil.push([x, y, w.amt(x, y)]);
    let best: [number, number, number][] = [], bs = -1;
    for (const o of oil) { const grp = oil.filter(p => Math.hypot(p[0] - o[0], p[1] - o[1]) < 14); const s = grp.reduce((a, p) => a + p[2], 0) - Math.hypot(o[0], o[1]) * 2; if (grp.length >= 4 && s > bs) { bs = s; best = grp; } }
    if (!best.length) throw new BotError('на карте нет нефти');
    this.wells = best.map(p => [p[0], p[1]] as XY);
    this.oilAt = [Math.round(best.reduce((a, p) => a + p[0], 0) / best.length), Math.round(best.reduce((a, p) => a + p[1], 0) / best.length)];
    for (const [x, y] of this.wells) this.plan.reserve(x - 2, y - 3, 5, 6);
    const s = this.patch('iron'), c = this.patch('copper'), k = this.patch('coal');
    this.base = [Math.round((s.c[0] + c.c[0] + k.c[0] + this.oilAt[0]) / 4), Math.round((s.c[1] + c.c[1] + k.c[1] + this.oilAt[1]) / 4) - 15];
    this.log(`разведка: железо ${s.c}, медь ${c.c}, уголь ${k.c}, камень ${this.patch('stone').c}, нефть ${this.oilAt} (${this.wells.length} ист.), база около ${this.base}`);
  }
  /** ближайшее к (ax,ay) месторождение (больше minAmt), skip — уже занятые */
  patch(r: ResName, ax = 0, ay = 0, minAmt = 40000, skip: Patch[] = []): Patch {
    const c = this.patches.filter(p => p.res === RES[r] && p.amt >= minAmt && !skip.includes(p)).sort((a, b) => Math.hypot(a.c[0] - ax, a.c[1] - ay) - Math.hypot(b.c[0] - ax, b.c[1] - ay));
    if (!c.length) throw new BotError('нет месторождения: ' + r); return c[0];
  }
  // ---------- мелочи ----------
  *buildOne(p: string, x: number, y: number, d = 0, recipe?: string): Task<Entity> {
    const b: Block = { bp: mk(PROTOS[p].name, [{ p, x: 0, y: 0, d: d as any, recipe }]), cells: [] };
    yield* this.makeAll({ [p]: 1 }); this.planAdd(b, x, y); yield* this.buildBp(b.bp, x, y);
    const e = this.g.entAt(x, y); if (!e) throw new BotError('не построено ' + p); return e;
  }
  *rocks(n: number): Task { for (let i = 0; i < n; i++) { const t = this.nearestTile((x, y) => this.g.world.decor(x, y) === 2, this.px, this.py, 40); if (!t) return; yield* this.handMineTile(t[0], t[1], 1); } }
  *chop(wood: number): Task { if (this.inv('wood') < wood) yield* this.gather('wood', wood); }
  /** место пары «бур 2×2 на руде + печь/сундук над ним» */
  pairSpot(res: number, ax: number, ay: number): XY | null {
    const w = this.g.world; let best: XY | null = null, bd = Infinity;
    for (let y = Math.round(ay) - 30; y <= ay + 30; y++) for (let x = Math.round(ax) - 30; x <= ax + 30; x++) {
      let ore = 0; for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (w.res(xx, yy) === res) ore++;
      if (ore < 4) continue; if (!this.plan.free(x - 1, y - 3, 4, 6)) continue;
      const d = Math.hypot(x - ax, y - ay); if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }
  // ---------- 1. старт без электричества ----------
  *bootstrap(): Task {
    this.log('старт: руками — камни, уголь, железо'); const iron = this.patch('iron'), coal = this.patch('coal'), copper = this.patch('copper'), stone = this.patch('stone');
    yield* this.rocks(3);
    if (this.inv('stone') < 30) yield* this.gather('stone', 30, stone.c[0], stone.c[1]);
    if (this.inv('coal') < 20) yield* this.gather('coal', 20, coal.c[0], coal.c[1]);
    yield* this.craftWait('stone-furnace', 2);
    // первые две печи — над будущими бурами
    yield* this.near(iron.c[0], iron.c[1], 30);
    const pairs: XY[] = [];
    for (let i = 0; i < 2; i++) { const s = this.pairSpot(1, this.px, this.py)!; pairs.push(s); this.plan.reserve(s[0], s[1], 2, 2); yield* this.buildOne('stone-furnace', s[0], s[1] - 2); }
    yield* this.gather('iron-ore', 24, pairs[0][0], pairs[0][1]);
    for (const s of pairs) { const f = this.g.entAt(s[0], s[1] - 2)!; yield* this.reach(f); this.put(f, 'coal', 3); this.put(f, 'iron-ore', 12); yield; }
    yield* this.gather('iron-ore', 30, pairs[0][0], pairs[0][1]);
    yield* this.until(() => pairs.every(s => !this.g.entAt(s[0], s[1] - 2)!.crafting && !Object.keys(this.g.entAt(s[0], s[1] - 2)!.input || {}).length), 3600 * 3, 'ручная плавка');
    for (const s of pairs) { const f = this.g.entAt(s[0], s[1] - 2)!; yield* this.reach(f); this.take(f, 'output:iron-plate'); this.put(f, 'iron-ore', 15); yield; }
    yield* this.until(() => pairs.every(s => !this.g.entAt(s[0], s[1] - 2)!.crafting && !Object.keys(this.g.entAt(s[0], s[1] - 2)!.input || {}).length), 3600 * 3, 'ручная плавка');
    for (const s of pairs) { const f = this.g.entAt(s[0], s[1] - 2)!; yield* this.reach(f); this.take(f, 'output:iron-plate'); yield; }
    yield* this.gather('iron-ore', 30, pairs[0][0], pairs[0][1]);
    for (const s of pairs) { const f = this.g.entAt(s[0], s[1] - 2)!; yield* this.reach(f); this.put(f, 'iron-ore', 15); yield; }
    this.log(`пластин руками: ${this.inv('iron-plate')}`);
    // буры под печами
    if (this.inv('stone') < 10) yield* this.rocks(1);
    for (const s of pairs) { yield* this.makeAll({ 'burner-mining-drill': 1 }, 30); for (const p of [s]) { this.plan.keep.delete(key(p[0], p[1])); } const k = [key(s[0], s[1]), key(s[0] + 1, s[1]), key(s[0], s[1] + 1), key(s[0] + 1, s[1] + 1)]; k.forEach(t => this.plan.keep.delete(t)); const d = yield* this.buildOne('burner-mining-drill', s[0], s[1]); yield* this.reach(d); this.put(d, 'coal', 4); this.burners.push({ d: d.id, f: this.g.entAt(s[0], s[1] - 2)!.id }); yield; }
    // дальше — растим число пар, пока не наберём на электричество
    const want = [ ['coal', 2], ['iron', 3], ['stone', 1], ['copper', 2], ['iron', 3], ['coal', 1] ] as [ResName, number][];
    for (const [r, n] of want) for (let i = 0; i < n; i++) yield* this.addBurner(r);
    if (this.inv('stone') < 40) yield* this.handFallback({ stone: 40 - this.inv('stone') });
    yield* this.tendUntil(() => this.inv('iron-plate') >= 420 && this.inv('copper-plate') >= 90 && this.inv('stone') >= 40, 120, 'запас на электричество');
    this.mark('твердотопливный старт: ' + this.burners.length + ' буров');
  }
  *addBurner(r: ResName): Task {
    const p = this.patch(r); const s = this.pairSpot(RES[r], p.c[0], p.c[1]); if (!s) throw new BotError('нет места для бура: ' + r);
    const top = r === 'iron' || r === 'copper' ? 'stone-furnace' : 'wooden-chest';
    if (top === 'wooden-chest') yield* this.chop(4);
    yield* this.tendUntil(() => this.g.maxCraftable('burner-mining-drill', 1) > 0 || this.inv('burner-mining-drill') > 0, 60, 'материалы на бур', true);
    yield* this.makeAll({ 'burner-mining-drill': 1, [top]: 1 }, 30);
    this.plan.reserve(s[0], s[1], 2, 2); this.plan.keep.forEach(() => 0);
    const f = yield* this.buildOne(top, s[0], s[1] - 2);
    for (let y = s[1]; y < s[1] + 2; y++) for (let x = s[0]; x < s[0] + 2; x++) this.plan.keep.delete(key(x, y));
    const d = yield* this.buildOne('burner-mining-drill', s[0], s[1]);
    const c = Math.min(5, this.inv('coal')); if (c) { yield* this.reach(d); this.put(d, 'coal', c); yield; }
    this.burners.push({ d: d.id, f: f.id });
  }
  /** разобрать постройку руками (как ПКМ): содержимое и сама постройка — в инвентарь */
  *pickUp(e: Entity): Task {
    yield* this.near(e.x + e.w / 2, e.y + e.h / 2, 8, 'разборка');
    this.input.mine = { x: e.x, y: e.y }; yield* this.until(() => !this.g.ents.has(e.id), 600, 'разборка ' + e.proto, 2); this.input.mine = null; yield;
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) { this.plan.tile.delete(key(x, y)); this.plan.keep.delete(key(x, y)); }
  }
  *removeBurners(): Task {
    const ids = this.burners.flatMap(b => [b.f, b.d]); let n = 0;
    for (const id of ids) { const e = this.g.ents.get(id); if (e) { yield* this.pickUp(e); n++; } }
    this.burners = []; this.log(`разобраны твердотопливные буры и печи: ${n}`);
  }
  /** обход твердотопливных пар: заправить, забрать пластины/уголь */
  *tend(): Task {
    const list = this.burners.map(b => ({ d: this.g.ents.get(b.d), f: this.g.ents.get(b.f) })).filter(b => b.d && b.f) as { d: Entity; f: Entity }[];
    // сначала угольные сундуки
    list.sort((a, b) => (a.f.t === 'chest' ? 0 : 1) - (b.f.t === 'chest' ? 0 : 1) || this.distE(a.d) - this.distE(b.d));
    for (const { d, f } of list) {
      yield* this.reach(f);
      if (f.t === 'chest') { this.take(f, 'chestall'); yield; }
      else { for (const k of Object.keys(f.output || {})) { this.take(f, 'output:' + k); yield; } }
      const coal = this.inv('coal');
      yield* this.reach(d); const fd = d.fuel?.count || 0; if (fd < 10 && coal > 2) { this.put(d, 'coal', Math.min(20 - fd, coal - 1)); yield; }
      if (f.t === 'furnace') { yield* this.reach(f); const ff = f.fuel?.count || 0; if (ff < 6 && this.inv('coal') > 2) { this.put(f, 'coal', Math.min(12 - ff, this.inv('coal') - 1)); yield; } }
    }
    if (this.inv('coal') < 25) { const k = this.patch('coal'); yield* this.gather('coal', 40, k.c[0], k.c[1]); }
  }
  *tendUntil(cond: () => boolean, maxMin: number, what: string, quick = false): Task {
    const end = this.g.tick + maxMin * 3600;
    while (!cond()) { if (this.g.tick > end) throw new BotError('не дождался: ' + what, this.diag()); yield* this.tend(); if (cond()) return; yield quick ? 300 : 900; }
  }
  // ---------- 2. электричество ----------
  shoreNear(ax: number, ay: number): { x: number; y: number; d: number } | null {
    const w = this.g.world; let best: { x: number; y: number; d: number } | null = null, bd = Infinity;
    for (let y = Math.round(ay) - 90; y <= ay + 90; y++) for (let x = Math.round(ax) - 90; x <= ax + 90; x++) {
      if (w.terrain(x, y) >= T_SHALLOW || !this.plan.freeTile(x, y)) continue;
      for (let d = 0; d < 4; d++) {
        if (w.terrain(x - DX[d], y - DY[d]) < T_SHALLOW) continue;
        const fx = x + DX[d], fy = y + DY[d]; if (!this.plan.freeTile(fx, fy) || !this.plan.free(fx - 1, fy - 1, 3, 3)) continue;
        const dd = Math.hypot(x - ax, y - ay); if (dd < bd) { bd = dd; best = { x, y, d }; }
      }
    }
    return best;
  }
  powerFull = false;
  *power(units: number): Task {
    const used: Patch[] = []; let b = powerBlock(units); let at: { x: number; y: number } | null = null;
    const hasPower = this.cells.some(c => c.kind === 'power');
    const ref = this.cells.find(c => c.kind === 'power')?.m || this.patch('coal').c;
    const coalOrder = powerCoalOrder(this.patches, ref, hasPower);
    for (;;) {
      const coal = coalOrder.find(p => !used.includes(p));
      if (!coal) throw new BotError('нет месторождения: coal');
      for (let k = units; k >= 1 && !at; k--) { b = powerBlock(k); at = this.oreSpot(b, RES.coal, coal.c[0], coal.c[1], 30, b.bp.entities.filter(e => e.p === 'electric-mining-drill').map(e => [e.x, e.y] as XY)); }
      if (at) break; used.push(coal); if (used.length > 10) throw new BotError('нет места под электростанцию на угле');
    }
    units = b.cells.length;
    if (!this.netTiles('water-p').size) {
      const sh = this.shoreNear(at.x, at.y + 11); if (!sh) throw new BotError('нет берега для насоса');
      const pb: Block = { bp: mk('Береговой насос', [{ p: 'offshore-pump', x: 0, y: 0, d: sh.d as any }]), cells: [] };
      yield* this.placeFluid(pb, sh.x, sh.y, 'pj', { fixed: ['water-p'] });
    }
    // порты бойлеров — в план (чтобы чужие трубы не прилипли)
    const rec = yield* this.placeBlock(b, at.x, at.y, 'power', { power: this.poles().length > 0 });
    planPowerFluidPorts(this.plan, b, at.x, at.y);
    yield* this.pipeTo('water-p', at.x - 1, at.y + 11);
    // A block's internal cross-pipe is not yet connected to the pump network.
    // Register it only after routing the external boiler feed, or pipeTo may
    // mistake this new local pipe for an existing source and leave it isolated.
    const tiles = this.netTiles('water-p'); for (const e of b.bp.entities) if (e.p === 'pipe') tiles.add(key(at.x + e.x, at.y + e.y));
    for (const id of rec.cells) { const bo = this.E(this.cells[id].m); if (bo && !(bo.fuel?.count)) { yield* this.reach(bo); this.put(bo, 'coal', Math.min(10, this.inv('coal'))); yield; } }
    yield* this.until(() => [...this.g.powerNets.values()].some(n => n.supply > 0) || true, 60, 'электричество');
    this.log(`электростанция: ${units} бойлер(а), ${units * 2} двигателя`);
  }
  powerCap() { return this.cells.filter(c => c.kind === 'power').length * 1800; }
  /** нагрузка всей сети, кВт */
  powerDemand() { let d = 0; for (const n of this.g.powerNets.values()) d = Math.max(d, n.demand); return d; }
  *ensurePower(minKW: number): Task { while (this.powerCap() < minKW) yield* this.power(Math.min(3, Math.ceil((minKW - this.powerCap()) / 1800))); }
  // ---------- блоки ----------
  *columns(r: 'iron' | 'copper', n: number, from?: XY): Task {
    const name = r === 'iron' ? 'Железо → пластины' : 'Медь → пластины';
    let left = n; const used: Patch[] = [];
    while (left > 0) {
      const p = this.patch(r, from?.[0] ?? this.base[0], from?.[1] ?? this.base[1], 20000, used);
      let placed = false;
      for (let k = Math.min(left, 6); k >= 1 && !placed; k--) for (const flip of [false, true]) {
        const b = columnBlock(name, k, { chest: this.chest, flip });
        const at = this.oreSpot(b, RES[r], p.c[0], p.c[1], Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) / 2 + 4);
        if (at) { yield* this.placeBlock(b, at.x, at.y, 'col', { res: ORE[r] }); left -= k; placed = true; break; }
      }
      if (!placed) { used.push(p); if (used.length > 8) throw new BotError('нет места для колонн: ' + r); }
    }
  }
  *raw(r: 'coal' | 'stone' | 'iron' | 'copper', n: number): Task {
    let left = n; const used: Patch[] = [];
    while (left > 0) {
      const k = Math.min(left, 4); const b = rawBlock((r === 'coal' ? 'Уголь' : r === 'stone' ? 'Камень' : r) + ' → сундук', k, { chest: this.chest });
      const p = this.patch(r, this.base[0], this.base[1], 20000, used);
      const at = this.oreSpot(b, RES[r], p.c[0], p.c[1], 25); if (!at) { used.push(p); if (used.length > 6) throw new BotError('нет места: ' + r); continue; }
      yield* this.placeBlock(b, at.x, at.y, 'raw', { res: ORE[r] }); left -= k;
    }
  }
  *asmBlock(recipe: string, n: number, prio: number, near?: XY): Task {
    const fluid = RECIPES[recipe].in.some(i => i[0] in FL);
    const m = fluid || RECIPES[recipe].cat === 'crafting-with-fluid' ? 'assembling-machine-2' : this.asm;
    const b = craftBlock(`${PROTOS[m].name}: ${recipe}`, m, recipe, n, { ins: this.ins, chest: this.chest, fluid });
    const a = near || (fluid ? this.oilAt : this.base);
    const at = this.spot(b, a[0], a[1], fluid ? 2 : 1);
    if (fluid) { const net = RECIPES[recipe].in.find(i => i[0] in FL)![0]; yield* this.placeFluid(b, at.x, at.y, 'craft', { in: [net] }, { prio, once: true }); }
    else yield* this.placeBlock(b, at.x, at.y, 'craft', { prio });
  }
  /** блок цепочек «провод → схема» (провод не носим) */
  *chain(feed: string, recipe: string, n: number, prio: number): Task {
    const b = chainBlock(`${PROTOS[this.asm].name}: ${feed} → ${recipe}`, this.asm, feed, recipe, n, { ins: this.ins, chest: this.chest });
    const at = this.spot(b, this.base[0], this.base[1]); yield* this.placeBlock(b, at.x, at.y, 'craft', { prio });
  }
  *smelt(product: 'steel-plate' | 'stone-brick', n: number, prio: number): Task {
    const b = smeltBlock(product === 'steel-plate' ? 'Сталь' : 'Кирпич', n, { ins: this.ins, chest: this.chest });
    const at = this.spot(b, this.base[0], this.base[1]); yield* this.placeBlock(b, at.x, at.y, 'smelt', { prio, res: product === 'steel-plate' ? 'steel-plate' : 'stone-brick' });
    for (const c of this.cells) if (c.kind === 'smelt' && !c.recipe) c.recipe = product;
  }
  *labs(n: number): Task { const b = labBlock(n, { ins: this.ins, chest: this.chest }); const at = this.spot(b, this.base[0] - 10, this.base[1] - 10); yield* this.placeBlock(b, at.x, at.y, 'lab', { prio: 0 }); }
  *chem(recipe: string, n = 1): Task {
    const r = RECIPES[recipe];
    for (let i = 0; i < n; i++) {
      const b = chemUnit(recipe, { ins: this.ins, chest: this.chest }); const at = this.spot(b, this.oilAt[0], this.oilAt[1], 2);
      const fin = r.in.filter(x => x[0] in FL).map(x => x[0]), fout = r.out.filter(x => x[0] in FL).map(x => x[0]);
      yield* this.ensureWater(fin);
      yield* this.placeFluid(b, at.x, at.y, 'chem', { in: fin, out: fout }, { prio: 3 });
    }
  }
  *refinery(recipe: 'basic-oil-processing' | 'advanced-oil-processing', n: number): Task {
    const r = RECIPES[recipe];
    for (let i = 0; i < n; i++) {
      const b = refineryUnit(recipe); const at = this.spot(b, this.oilAt[0], this.oilAt[1] - 12, 2);
      const fin = r.in.map(x => x[0]), fout = r.out.map(x => x[0]); yield* this.ensureWater(fin);
      yield* this.placeFluid(b, at.x, at.y, 'ref', { in: fin, out: fout });
    }
  }
  *ensureWater(fluids: string[]): Task {
    if (!fluids.includes('water') || this.netTiles('water').size) return;
    const sh = this.shoreNear(this.oilAt[0], this.oilAt[1]); if (!sh) throw new BotError('нет берега у нефти');
    const pb: Block = { bp: mk('Береговой насос', [{ p: 'offshore-pump', x: 0, y: 0, d: sh.d as any }]), cells: [] };
    yield* this.placeFluid(pb, sh.x, sh.y, 'pj', { fixed: ['water'] });
  }
  *pumpjacks(): Task {
    for (const [x, y] of this.wells) {
      for (let yy = y - 3; yy < y + 3; yy++) for (let xx = x - 2; xx < x + 3; xx++) this.plan.keep.delete(key(xx, yy));
      if (this.g.entAt(x, y)) continue;
      if (!this.plan.free(x - 1, y - 1, 4, 3)) continue;
      yield* this.placeFluid(pumpjackUnit(), x - 1, y - 1, 'pj', { out: ['crude-oil'] });
    }
  }
  /** модернизация: манипуляторы → быстрые, сборщики 1 → 2 */
  *upgrade(from: string, to: string): Task {
    const list = [...this.g.ents.values()].filter(e => e.proto === from && this.cells.some(c => [c.i, c.m].some(p => p && p[0] >= 0 - 1e9 && this.g.entAt(p[0], p[1]) === e) || this.blocks.some(b => b.kind !== 'col' && e.x >= b.x && e.x < b.x + b.w && e.y >= b.y && e.y < b.y + b.h)));
    if (!list.length) return;
    yield* this.makeAll({ [to]: list.length });
    for (const e of list) { this.cmd({ t: 'upgrade', x0: e.x, y0: e.y, x1: e.x, y1: e.y, map: { [from]: to } }); }
    yield;
    let left = list.filter(e => this.g.ents.get(e.id)?.proto === from);
    for (let guard = 0; left.length && guard < 400; guard++) {
      left.sort((a, b) => this.distE(a) - this.distE(b)); const e = left[0];
      yield* this.standNear(e.x + 0.5, e.y + 0.5, e.x - 2, e.y - 2, e.x + e.w + 1, e.y + e.h + 1);
      yield* this.until(() => this.g.ents.get(e.id)?.proto !== from, 600, 'модернизация ' + from, 6);
      left = left.filter(x => this.g.ents.get(x.id)?.proto === from);
    }
    this.log(`модернизация: ${list.length} × ${from} → ${to}`);
  }
  /** раз в 20 игровых минут: чего не хватает — того и больше */
  *balance(): Task {
    const st = this.stock(); const I = st['iron-plate'] || 0, C = st['copper-plate'] || 0;
    const cols = (r: string) => this.cells.filter(c => c.kind === 'col' && c.res === r && this.E(c.m) && this.drillOk(c)).length;
    const far = this.techDone('oil-processing') ? this.oilAt : undefined;
    if (C < (far ? 5000 : 1000) && I >= C && cols('copper-ore') < 90) { this.log(`баланс: мало меди (${C} при железе ${I}) — ещё колонны`); yield* this.columns('copper', far ? 8 : 4, far); }
    if (I < 1000 && C >= I && cols('iron-ore') < 70) { this.log(`баланс: мало железа (${I} при меди ${C}) — ещё колонны`); yield* this.columns('iron', 4, far); }
    if ((st.coal || 0) < 600) { this.log('баланс: мало угля'); yield* this.raw('coal', 2); }
    if ((st.stone || 0) < 300 && (st['stone-brick'] || 0) < 500 && this.techDone('steel-processing')) yield* this.raw('stone', 1);
    if (!this.powerFull && this.maxDemand() > 0.8 * this.powerCap()) { this.log(`баланс: нагрузка ${Math.round(this.maxDemand())} кВт из ${this.powerCap()} — ещё бойлеры`); try { yield* this.power(2); } catch (e: any) { if (!(e instanceof BotError)) throw e; this.log('баланс: ' + e.message + ' — обойдёмся'); this.powerFull = true; } }
  }
  /** у бура колонны ещё есть руда */
  drillOk(c: Cell): boolean { const f = this.E(c.m); if (!f) return false; for (const e of this.g.ents.values()) if (e.t === 'drill' && Math.abs(e.x - f.x) <= 1 && Math.abs(e.y - f.y) <= 4 && e.status === 'no-ore') return false; return true; }
  techDone(t: string) { return this.g.research.done.has(t); }
  *tech(t: string, maxMin = 600): Task { yield* this.serve(() => this.techDone(t), maxMin, 'исследование ' + t); this.mark('изучено: ' + TECHS[t].name); }
  cellsOf(recipe: string) { return this.cells.filter(c => c.recipe === recipe); }
  // ---------- сценарий ----------
  *main(): Task { yield* this.withRecovery(this.progression()); }
  private *progression(): Task {
    this.researchOrder = this.enemiesOn ? defenseOrder() : RESEARCH; this.survey();
    yield* this.bootstrap();
    yield* this.power(1); this.boot = false;
    this.mark('электричество');
    // склад
    yield* this.growHub();
    yield* this.tend(); yield* this.removeBurners(); yield* this.tidy(true);
    yield* this.columns('iron', 4); yield* this.raw('coal', 2); yield* this.columns('copper', 2); yield* this.raw('stone', 1);
    yield* this.labs(2);
    this.mark('шахтные колонны и лаборатории');
    yield* this.makeAll({ 'automation-science-pack': 10 });
    yield* this.tech('automation');
    yield* this.asmBlock('iron-gear-wheel', 2, 3); yield* this.asmBlock('automation-science-pack', 3, 2);
    yield* this.asmBlock('copper-cable', 2, 4); yield* this.asmBlock('electronic-circuit', 2, 3);
    yield* this.columns('iron', 4); yield* this.columns('copper', 2); yield* this.raw('coal', 2);
    yield* this.labs(4); yield* this.ensurePower(3600);
    yield* this.tech('logistic-science-pack');
    yield* this.asmBlock('inserter', 1, 3); yield* this.asmBlock('transport-belt', 1, 3); yield* this.asmBlock('logistic-science-pack', 4, 2);
    yield* this.tech('electronics');
    yield* this.tech('steel-processing');
    yield* this.smelt('steel-plate', 6, 3); yield* this.smelt('stone-brick', 2, 4); yield* this.raw('stone', 1);
    yield* this.tech('fast-inserter');
    this.ins = 'fast-inserter'; yield* this.upgrade('inserter', 'fast-inserter');
    yield* this.tech('automation-2');
    this.asm = 'assembling-machine-2'; yield* this.upgrade('assembling-machine-1', 'assembling-machine-2');
    yield* this.asmBlock('automation-science-pack', 1, 2); yield* this.asmBlock('logistic-science-pack', 2, 2); yield* this.asmBlock('electronic-circuit', 2, 3); yield* this.asmBlock('copper-cable', 1, 4);
    yield* this.columns('iron', 8); yield* this.columns('copper', 2); yield* this.ensurePower(7200);
    yield* this.tech('oil-processing');
    this.caps['steel-plate'] = 1500;
    yield* this.pumpjacks(); yield* this.refinery('basic-oil-processing', 3);
    this.mark('нефть');
    yield* this.tech('solar-energy');
    yield* this.tech('plastics'); yield* this.chem('plastic-bar', 2);
    yield* this.tech('sulfur-processing'); yield* this.chem('sulfur', 1);
    yield* this.tech('engine'); yield* this.asmBlock('pipe', 1, 4); yield* this.asmBlock('engine-unit', 3, 3);
    yield* this.tech('advanced-electronics'); yield* this.asmBlock('advanced-circuit', 4, 3);
    yield* this.columns('iron', 6, this.oilAt); yield* this.columns('copper', 2, this.oilAt); yield* this.ensurePower(10800);
    yield* this.tech('chemical-science-pack'); yield* this.asmBlock('chemical-science-pack', 3, 2); yield* this.labs(4);
    yield* this.tech('battery'); yield* this.chem('sulfuric-acid', 1); yield* this.chem('battery', 1);
    yield* this.tech('advanced-oil-processing'); yield* this.refinery('advanced-oil-processing', 1); yield* this.chem('heavy-oil-cracking', 1); yield* this.chem('solid-fuel-from-light-oil', 2);
    yield* this.tech('lubricant'); yield* this.chem('lubricant', 1);
    yield* this.tech('modules'); yield* this.asmBlock('productivity-module', 1, 3);
    yield* this.makeAll({ 'speed-module': 1 }); { const c = this.cellsOf('advanced-circuit')[0]; const m = this.E(c.m)!; yield* this.reach(m); this.put(m, 'speed-module', 1); yield; this.mark('модуль в машине'); }
    yield* this.tech('advanced-electronics-2'); yield* this.asmBlock('processing-unit', 2, 3);
    yield* this.tech('advanced-material-processing-2'); yield* this.asmBlock('electric-furnace', 1, 3);
    yield* this.tech('electric-engine'); yield* this.asmBlock('electric-engine-unit', 1, 3);
    yield* this.columns('iron', 6, this.oilAt); yield* this.ensurePower(14400);
    // поздняя игра: ~2000 пакетов B/P/Y, ~2400 процессоров, ~14 тыс. схем — расширяем цепочки
    yield* this.smelt('steel-plate', 6, 3); yield* this.columns('copper', 4, this.oilAt); yield* this.ensurePower(21600);
    yield* this.chain('copper-cable', 'electronic-circuit', 6, 3); yield* this.chain('copper-cable', 'advanced-circuit', 6, 3); yield* this.asmBlock('processing-unit', 3, 3);
    yield* this.asmBlock('chemical-science-pack', 2, 2); yield* this.asmBlock('engine-unit', 1, 3); yield* this.labs(4);
    yield* this.tech('electric-energy-accumulators'); yield* this.asmBlock('solar-panel', 1, 4); yield* this.asmBlock('accumulator', 1, 4);
    yield* this.tech('production-science-pack'); yield* this.asmBlock('productivity-module', 2, 3); yield* this.asmBlock('production-science-pack', 4, 2);
    yield* this.tech('utility-science-pack'); yield* this.asmBlock('utility-science-pack', 4, 2); yield* this.chem('battery', 1);
    yield* this.tech('low-density-structure'); yield* this.asmBlock('low-density-structure', 3, 3); yield* this.smelt('steel-plate', 6, 3); yield* this.smelt('steel-plate', 6, 3); yield* this.columns('copper', 4, this.oilAt);
    yield* this.tech('rocket-fuel'); yield* this.asmBlock('rocket-fuel', 4, 3); yield* this.chem('solid-fuel-from-light-oil', 1);
    // v1.4: шахта — из бетона (5 кирпича + 1 железная руда + 100 воды → 10)
    yield* this.tech('concrete'); yield* this.raw('iron', 1); yield* this.ensureWater(['water']); yield* this.asmBlock('concrete', 2, 3);
    yield* this.tech('rocket-silo', 1200);
    yield* this.makeAll({ 'rocket-silo': 1 }, 600);
    const sb = siloBlock({ chest: this.chest }); const sat = this.spot(sb, this.base[0], this.base[1] + 10, 2); yield* this.placeBlock(sb, sat.x, sat.y, 'silo', { prio: 0 });
    this.mark('ракетная шахта построена');
    yield* this.makeAll({ satellite: 1 }, 900);
    const silo = this.cells.find(c => c.kind === 'silo')!; { const s = this.E(silo.m)!; yield* this.reach(s); this.put(s, 'satellite', 1); yield; }
    yield* this.serve(() => this.g.rockets > 0, 900, 'запуск ракеты');
    this.mark('ракета запущена');
    // v1.7: демо-участок железной дороги — две станции, поезд «локомотив + вагон + локомотив», круг по расписанию
    try { yield* this.railDemo(); } catch (e: any) { if (!(e instanceof BotError)) throw e; this.log('ж/д: ' + e.message + ' — пропускаем'); }
  }
  *railDemo(): Task {
    yield* this.tech('automated-rail-transportation', 900);
    const s = shapeOf('straight-rail', 2);
    const fits = (x: number, y: number) => { const X0 = (x + 2) & ~1, Y = (y + 4) & ~1;
      for (let i = 0; i < 42; i++) if (!this.g.canPlace('straight-rail', X0 + 2 * i - s.ox, Y - s.oy, 2 as any, false).ok) return false;
      for (let ty = y; ty < y + 9; ty++) for (let tx = x; tx < x + 90; tx++) if (this.g.railCells.has(((tx + 65536) * 131072) + (ty + 65536))) return false;
      return true; };
    const r = this.plan.findRect(this.base[0], this.base[1], 90, 9, { noOre: true, maxR: 160, step: 2, pred: fits });
    if (!r) throw new BotError('нет места под путь');
    const X0 = (r.x + 2) & ~1, Y = (r.y + 4) & ~1; this.plan.reserve(r.x, r.y, 90, 9);
    yield* this.makeAll({ 'straight-rail': 42, 'train-stop': 2, locomotive: 2, 'cargo-wagon': 1 }, 600);
    const piece = (i: number) => ({ proto: 'straight-rail', x: X0 + 2 * i - s.ox, y: Y - s.oy, dir: 2 });
    const laid = (i: number) => (this.g.railCells.get(((X0 + 2 * i + 65536) * 131072) + (Y + 65536)) || []).length > 0;
    for (let pass = 0; pass < 3; pass++) for (let c = 0; c < 42; c += 4) {
      const idx: number[] = []; for (let i = c; i < Math.min(42, c + 4); i++) if (!laid(i)) idx.push(i);
      if (!idx.length) continue;
      yield* this.walk((x, y) => y >= Y + 2 && Math.abs(x - (X0 + 2 * c + 4)) < 2 && Math.abs(y - (Y + 3)) < 1.5, X0 + 2 * c + 4, Y + 3, 'к пути');
      this.cmd({ t: 'railPath', pieces: idx.map(piece) }); yield; yield;
    }
    const rails = [...this.g.ents.values()].filter(e => e.t === 'rail' && e.y + s.oy === Y && e.x + s.ox >= X0 && e.x + s.ox < X0 + 84);
    if (rails.length < 42) { const i = [...Array(42).keys()].find(i => !laid(i))!; const pc = piece(i); throw new BotError(`уложено рельсов ${rails.length} из 42 (у ${pc.x},${pc.y}: ${this.g.canPlace(pc.proto, pc.x, pc.y, 2 as any, false).reason})`); }
    this.mark('путь уложен');
    const at = (ax: number) => rails.find(e => e.x + s.ox === ax)!;
    const W = 'Руда', E = 'База';
    const stW = yield* this.buildOne('train-stop', X0 + 4, Y - 3, 3); this.cmd({ t: 'stopName', id: stW.id, name: W });
    const stE = yield* this.buildOne('train-stop', X0 + 78, Y + 1, 1); this.cmd({ t: 'stopName', id: stE.id, name: E }); yield;
    const cars: [string, number, number, boolean][] = [['locomotive', 40, 41, false], ['cargo-wagon', 32, 33, false], ['locomotive', 26, 26, true]];
    for (const [p, n, x, back] of cars) { yield* this.near(X0 + x, Y + 2); this.cmd({ t: 'placeCar', proto: p, rail: at(X0 + n).id, x: X0 + x, y: Y, back }); yield; }
    const locos = [...this.g.ents.values()].filter(e => e.t === 'loco' && Math.abs(e.y - Y) < 2 && e.x >= X0 && e.x < X0 + 84);
    const T = locos[0] && trainOf(this.g, locos[0]);
    if (!T || T.cars.length !== 3) throw new BotError('состав не собран');
    this.mark('поезд собран');
    const fuel = this.has('solid-fuel') >= 40 ? 'solid-fuel' : 'coal';
    if (this.has(fuel) < 40) yield* this.fetch({ [fuel]: 40 });
    for (const l of locos) { yield* this.reach(l); this.put(l, fuel, Math.min(20, this.has(fuel))); yield; }
    this.cmd({ t: 'sched', id: locos[0].id, sched: [{ st: W, c: 'time', n: 5 }, { st: E, c: 'time', n: 5 }] }); this.cmd({ t: 'tmode', id: locos[0].id, auto: true }); yield;
    // v1.8: пара светофоров посередине — напротив друг друга у одного узла (по одному на каждое направление) — путь делится на блоки, поезд проходит их в обе стороны
    try { yield* this.tech('rail-signals', 60); yield* this.makeAll({ 'rail-signal': 2 }, 600);
      for (const [nx, h] of [[X0 + 50, 2], [X0 + 50, 6]] as [number, number][]) { const sx = nx + SIG_OX[h], sy = Y + SIG_OY[h]; if (this.g.canPlace('rail-signal', sx, sy, h as any, false).ok) yield* this.buildOne('rail-signal', sx, sy, h); }
      const ns = [...this.g.ents.values()].filter(e => e.t === 'signal').length; if (ns >= 2) this.mark(`светофоры: ${ns}, блоков ${graph(this.g).nblk}`);
    } catch (e: any) { if (!(e instanceof BotError)) throw e; this.log('светофоры: ' + e.message); }
    yield* this.until(() => (T.laps || 0) >= 1, 3600 * 5, 'круг поезда');
    this.mark('поезд проехал круг Руда → База → Руда');
  }
}
const FL: Record<string, 1> = {}; for (const k of ['water', 'crude-oil', 'heavy-oil', 'light-oil', 'petroleum-gas', 'sulfuric-acid', 'lubricant', 'steam']) FL[k] = 1;
void (null as unknown as Cell);
