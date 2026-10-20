import { ITEMS } from '../data/items';
export interface DroneStackState { id: number; owner: string; model: string; hp: number; maxHp: number; charge: number; ammo: number; ammoType: string | null; repair: number; }
export interface Stack { item: string; count: number; /** A physical 1.17 combat drone. Never merged with another stack. */ instance?: DroneStackState; }
// Keep runtime allocation callbacks outside the structured-cloneable inventory.
const droneFactories = new WeakMap<Inventory, (item: string) => DroneStackState>();
/** Инвентарь из ячеек со стопками. Главный инвентарь игрока сортируется автоматически. */
export class Inventory {
  slots: (Stack | null)[];
  /** Количество ячеек, куда разрешено класть предметы; занятое за пределом лимита остаётся доступно для изъятия. */
  slotLimit: number;
  /** v1.7: фильтры ячеек (грузовой вагон): в пустую ячейку с фильтром кладётся только этот предмет. Хранятся в постройке (filt) */
  filt?: (string | null)[];
  constructor(public size: number, public autoSort = false) { this.slots = new Array(size).fill(null); this.slotLimit = size; }
  setDroneFactory(factory?: (item: string) => DroneStackState) { if (factory) droneFactories.set(this, factory); else droneFactories.delete(this); }
  createDroneStack(item: string): Stack | null { const factory = droneFactories.get(this); return ITEMS[item]?.droneModel && factory ? { item, count: 1, instance: factory(item) } : null; }
  setSlotLimit(n: number) { if (!Number.isInteger(n) || n < 1 || n > this.size) return false; this.slotLimit = n; return true; }
  count(item: string) { let n = 0; for (const s of this.slots) if (s && s.item === item) n += s.count; return n; }
  countRange(item: string, start: number, end: number) { let n = 0; for (let i = Math.max(0, Math.floor(start)); i < Math.min(this.slotLimit, Math.floor(end)); i++) { const s = this.slots[i]; if (s?.item === item) n += s.count; } return n; }
  canAdd(item: string, n: number) { return this.spaceFor(item) >= n; }
  spaceFor(item: string) {
    const st = ITEMS[item]?.stack ?? 50; let sp = 0;
    const f = this.filt; for (let i = 0; i < this.slotLimit; i++) { if (f?.[i] && f[i] !== item) continue; const s = this.slots[i]; if (!s) sp += st; else if (s.item === item && !s.instance) sp += Math.max(0, st - s.count); }
    return sp;
  }
  spaceForRange(item: string, start: number, end: number) {
    const st = ITEMS[item]?.stack ?? 50, lo = Math.max(0, Math.floor(start)), hi = Math.min(this.slotLimit, Math.floor(end)); let sp = 0;
    for (let i = lo; i < hi; i++) { const f = this.filt?.[i]; if (f && f !== item) continue; const s = this.slots[i]; if (!s) sp += st; else if (s.item === item && !s.instance) sp += Math.max(0, st - s.count); }
    return sp;
  }
  /** добавить, вернуть сколько не поместилось */
  add(item: string, n: number): number {
    if (ITEMS[item]?.droneModel) return n;
    const st = ITEMS[item]?.stack ?? 50;
    for (let i = 0; i < this.slotLimit && n > 0; i++) { const s = this.slots[i]; if (s && !s.instance && s.item === item && s.count < st && (!this.filt?.[i] || this.filt[i] === item)) { const k = Math.min(n, st - s.count); s.count += k; n -= k; } }
    const f = this.filt; for (let i = 0; i < this.slotLimit && n > 0; i++) if (!this.slots[i] && (!f || !f[i] || f[i] === item)) { const k = Math.min(n, st); this.slots[i] = { item, count: k }; n -= k; }
    if (this.autoSort) this.sort();
    return n;
  }
  /** Create new zero-charge physical products only at their production boundary. */
  addDrone(item: string, n: number): number {
    if (!ITEMS[item]?.droneModel || !Number.isSafeInteger(n) || n < 0) return n;
    const factory = droneFactories.get(this); if (!factory) return n;
    let left = n;
    for (let i = 0; i < this.slotLimit && left > 0; i++) {
      if (this.slots[i]) continue;
      const f = this.filt?.[i]; if (f && f !== item) continue;
      this.slots[i] = { item, count: 1, instance: factory(item) }; left--;
    }
    if (this.autoSort) this.sort();
    return left;
  }
  remove(item: string, n: number): number {
    let removed = 0;
    for (let i = this.size - 1; i >= 0 && removed < n; i--) {
      const s = this.slots[i]; if (!s || s.instance || s.item !== item) continue;
      const k = Math.min(n - removed, s.count); s.count -= k; removed += k; if (s.count === 0) this.slots[i] = null;
    }
    if (this.autoSort) this.sort();
    return removed;
  }
  removeRange(item: string, n: number, start: number, end: number): number {
    if (!Number.isSafeInteger(n) || n <= 0) return 0;
    let removed = 0; const lo = Math.max(0, Math.floor(start)), hi = Math.min(this.size, Math.floor(end));
    for (let i = hi - 1; i >= lo && removed < n; i--) { const s = this.slots[i]; if (!s || s.item !== item || s.instance) continue; const take = Math.min(n - removed, s.count); s.count -= take; removed += take; if (!s.count) this.slots[i] = null; }
    return removed;
  }
  /** Move one exact stack without resetting state. Stateful drone stacks can only move whole. */
  takeSlot(index: number, count = Number.MAX_SAFE_INTEGER): Stack | null {
    const s = this.slots[index]; if (!s || !Number.isSafeInteger(count) || count < 1) return null;
    if (s.instance) { if (count < s.count) return null; this.slots[index] = null; if (this.autoSort) this.sort(); return { ...s, instance: { ...s.instance } }; }
    const n = Math.min(s.count, count), moved = { item: s.item, count: n }; s.count -= n; if (!s.count) this.slots[index] = null;
    if (this.autoSort) this.sort(); return moved;
  }
  /** Insert a previously extracted stack, keeping instance identity and damage. */
  addStack(stack: Stack): boolean {
    if (!stack || !ITEMS[stack.item] || !Number.isSafeInteger(stack.count) || stack.count < 1) return false;
    if (stack.instance) {
      if (!ITEMS[stack.item]?.droneModel || stack.count !== 1) return false;
      for (let i = 0; i < this.slotLimit; i++) {
        if (this.slots[i]) continue;
        const f = this.filt?.[i]; if (f && f !== stack.item) continue;
        this.slots[i] = { item: stack.item, count: 1, instance: { ...stack.instance } };
        if (this.autoSort) this.sort();
        return true;
      }
      return false;
    }
    if (ITEMS[stack.item]?.droneModel) return false;
    // Preflight before mutating: callers keep the source stack when this
    // returns false, so a partial add here would duplicate its accepted part.
    if (this.spaceFor(stack.item) < stack.count) return false;
    return this.add(stack.item, stack.count) === 0;
  }
  canAddStack(stack: Stack, start = 0, end = this.slotLimit): boolean {
    const lo = Math.max(0, Math.floor(start)), hi = Math.min(this.slotLimit, Math.floor(end));
    if (!stack || !ITEMS[stack.item] || !Number.isSafeInteger(stack.count) || stack.count < 1 || lo >= hi) return false;
    if (stack.instance) {
      if (!ITEMS[stack.item]?.droneModel || stack.count !== 1) return false;
      for (let i = lo; i < hi; i++) if (!this.slots[i] && (!this.filt?.[i] || this.filt[i] === stack.item)) return true;
      return false;
    }
    if (ITEMS[stack.item]?.droneModel) return false;
    return this.spaceForRange(stack.item, lo, hi) >= stack.count;
  }
  hasInstanceSlot(item: string, start = 0, end = this.slotLimit): boolean {
    if (!ITEMS[item]?.droneModel) return false;
    const lo = Math.max(0, Math.floor(start)), hi = Math.min(this.slotLimit, Math.floor(end));
    for (let i = lo; i < hi; i++) if (!this.slots[i] && (!this.filt?.[i] || this.filt[i] === item)) return true;
    return false;
  }
  instanceSpace(item: string, start = 0, end = this.slotLimit): number {
    if (!ITEMS[item]?.droneModel) return 0;
    const lo = Math.max(0, Math.floor(start)), hi = Math.min(this.slotLimit, Math.floor(end)); let space = 0;
    for (let i = lo; i < hi; i++) if (!this.slots[i] && (!this.filt?.[i] || this.filt[i] === item)) space++;
    return space;
  }
  addStackInRange(stack: Stack, start: number, end: number): boolean {
    const lo = Math.max(0, Math.floor(start)), hi = Math.min(this.slotLimit, Math.floor(end));
    if (!stack || !ITEMS[stack.item] || !Number.isSafeInteger(stack.count) || stack.count < 1 || lo >= hi) return false;
    if (stack.instance) {
      if (!ITEMS[stack.item]?.droneModel || stack.count !== 1) return false;
      for (let i = lo; i < hi; i++) {
        if (this.slots[i]) continue;
        const f = this.filt?.[i]; if (f && f !== stack.item) continue;
        this.slots[i] = { item: stack.item, count: 1, instance: { ...stack.instance } };
        if (this.autoSort) this.sort();
        return true;
      }
      return false;
    }
    if (ITEMS[stack.item]?.droneModel || this.spaceForRange(stack.item, lo, hi) < stack.count) return false;
    const st = ITEMS[stack.item]?.stack ?? 50; let n = stack.count;
    for (let i = lo; i < hi && n > 0; i++) { const s = this.slots[i]; if (s && s.item === stack.item && !s.instance && s.count < st && (!this.filt?.[i] || this.filt[i] === stack.item)) { const k = Math.min(n, st - s.count); s.count += k; n -= k; } }
    for (let i = lo; i < hi && n > 0; i++) if (!this.slots[i] && (!this.filt?.[i] || this.filt[i] === stack.item)) { const k = Math.min(n, st); this.slots[i] = { item: stack.item, count: k }; n -= k; }
    if (n) return false; // preflight above makes this unreachable absent mutation.
    if (this.autoSort) this.sort();
    return true;
  }
  takeDrone(id: number): Stack | null {
    const i = this.slots.findIndex(s => s?.instance?.id === id);
    return i < 0 ? null : this.takeSlot(i);
  }
  firstItem(filter?: (i: string) => boolean): string | null { for (const s of this.slots) if (s && (!filter || filter(s.item))) return s.item; return null; }
  isEmpty() { return this.slots.every(s => !s); }
  items(): Record<string, number> { const r: Record<string, number> = {}; for (const s of this.slots) if (s) r[s.item] = (r[s.item] || 0) + s.count; return r; }
  sort() {
    const all = new Map<string, number>(), rows: Stack[] = [], positions: number[] = [];
    for (let i = 0; i < this.slotLimit; i++) {
      // Fixed filters keep their contents in place, including any withdrawn-only
      // legacy mismatch. Closed cells are never touched by sorting.
      if (this.filt?.[i]) continue;
      positions.push(i);
      const s = this.slots[i]; if (!s) continue;
      if (s.instance) rows.push({ ...s, instance: { ...s.instance } });
      else if (ITEMS[s.item]?.droneModel) { if (s.count > this.slotLimit - rows.length) return; for (let n = 0; n < s.count; n++) rows.push({ item: s.item, count: 1 }); }
      else all.set(s.item, (all.get(s.item) || 0) + s.count);
    }
    for (const [item, total] of all) { let n = total; const cap = ITEMS[item]?.stack ?? 50; while (n > 0) { if (rows.length >= positions.length) return; const count = Math.min(n, cap); rows.push({ item, count }); n -= count; } }
    rows.sort((a, b) => (ITEMS[a.item]?.order ?? 999) - (ITEMS[b.item]?.order ?? 999) || (a.instance?.id ?? 0) - (b.instance?.id ?? 0));
    if (rows.length > positions.length) return; // preserve legacy overflow verbatim.
    for (let i = 0; i < positions.length; i++) this.slots[positions[i]] = rows[i] || null;
  }
  toJSON() { return this.slots; }
  load(a: (Stack | null)[]) { for (let i = 0; i < this.size; i++) { const s = a[i]; this.slots[i] = s ? { ...s, ...(s.instance ? { instance: { ...s.instance } } : {}) } : null; } }
}
