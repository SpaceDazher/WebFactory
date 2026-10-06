import { ITEMS } from '../data/items';
export interface Stack { item: string; count: number; }
/** Инвентарь из ячеек со стопками. Главный инвентарь игрока сортируется автоматически. */
export class Inventory {
  slots: (Stack | null)[];
  /** v1.7: фильтры ячеек (грузовой вагон): в пустую ячейку с фильтром кладётся только этот предмет. Хранятся в постройке (filt) */
  filt?: (string | null)[];
  constructor(public size: number, public autoSort = false) { this.slots = new Array(size).fill(null); }
  count(item: string) { let n = 0; for (const s of this.slots) if (s && s.item === item) n += s.count; return n; }
  canAdd(item: string, n: number) { return this.spaceFor(item) >= n; }
  spaceFor(item: string) {
    const st = ITEMS[item]?.stack ?? 50; let sp = 0;
    const f = this.filt; for (let i = 0; i < this.slots.length; i++) { const s = this.slots[i]; if (!s) { if (!f || !f[i] || f[i] === item) sp += st; } else if (s.item === item) sp += st - s.count; }
    return sp;
  }
  /** добавить, вернуть сколько не поместилось */
  add(item: string, n: number): number {
    const st = ITEMS[item]?.stack ?? 50;
    for (const s of this.slots) if (n > 0 && s && s.item === item && s.count < st) { const k = Math.min(n, st - s.count); s.count += k; n -= k; }
    const f = this.filt; for (let i = 0; i < this.size && n > 0; i++) if (!this.slots[i] && (!f || !f[i] || f[i] === item)) { const k = Math.min(n, st); this.slots[i] = { item, count: k }; n -= k; }
    if (this.autoSort) this.sort();
    return n;
  }
  remove(item: string, n: number): number {
    let removed = 0;
    for (let i = this.size - 1; i >= 0 && removed < n; i--) {
      const s = this.slots[i]; if (!s || s.item !== item) continue;
      const k = Math.min(n - removed, s.count); s.count -= k; removed += k; if (s.count === 0) this.slots[i] = null;
    }
    if (this.autoSort) this.sort();
    return removed;
  }
  firstItem(filter?: (i: string) => boolean): string | null { for (const s of this.slots) if (s && (!filter || filter(s.item))) return s.item; return null; }
  isEmpty() { return this.slots.every(s => !s); }
  items(): Record<string, number> { const r: Record<string, number> = {}; for (const s of this.slots) if (s) r[s.item] = (r[s.item] || 0) + s.count; return r; }
  sort() {
    const all = this.items(); const keys = Object.keys(all).sort((a, b) => (ITEMS[a]?.order ?? 999) - (ITEMS[b]?.order ?? 999));
    this.slots.fill(null); let i = 0;
    for (const k of keys) { let n = all[k]; const st = ITEMS[k]?.stack ?? 50; while (n > 0 && i < this.size) { const c = Math.min(n, st); this.slots[i++] = { item: k, count: c }; n -= c; } }
  }
  toJSON() { return this.slots; }
  load(a: (Stack | null)[]) { for (let i = 0; i < this.size; i++) this.slots[i] = a[i] ? { ...a[i]! } : null; }
}
