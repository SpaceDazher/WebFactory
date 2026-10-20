import { ITEMS } from '../data/items';
import { Inventory, Stack } from './inventory';
import type { Entity } from './game';

export const LOCO_FUEL_SLOTS = 5;
const itemDef = (id: unknown) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : undefined;
const fuelDef = (id: unknown) => { const d = itemDef(id); return d && Number.isFinite(d.fuel) && (d.fuel || 0) > 0 ? d : undefined; };

/** Ensure the locomotive fuel is represented by its five ordinary inventory slots.
 *  Old RC7 saves only have e.fuel; move that stack once into slot 0. */
export function locoFuelInventory(e: Entity): Inventory | null {
  if (e.t !== 'loco') return null;
  if (!e.inv) e.inv = new Inventory(LOCO_FUEL_SLOTS);
  e.inv.setSlotLimit(locoFuelOpen(e));
  if (e.fuel && fuelDef(e.fuel.item) && Number.isFinite(e.fuel.count)) {
    const left = e.inv.add(e.fuel.item, Math.max(0, Math.floor(e.fuel.count)));
    if (!left) e.fuel = undefined;
    else e.fuel = { ...e.fuel, count: left };
  }
  return e.inv;
}

/** Missing limits are old saves and mean all five fuel slots are open. */
export function locoFuelOpen(e: Entity): number {
  const n = e.slotLimit;
  return Number.isInteger(n) && n! >= 1 && n! <= LOCO_FUEL_SLOTS ? n! : LOCO_FUEL_SLOTS;
}

/** Add an item across open slots only. Closed slots keep fuel for burning and extraction. */
export function addLocoFuel(e: Entity, item: string, count: number): number {
  const inv = locoFuelInventory(e), def = fuelDef(item); if (!inv || !def || !Number.isFinite(count) || count <= 0) return 0;
  let left = Math.max(0, Math.floor(count)); const requested = left, cap = def.stack;
  for (let i = 0; i < locoFuelOpen(e) && left > 0; i++) {
    const slot = inv.slots[i]; if (slot && slot.item !== item) continue;
    const room = cap - (slot?.count || 0); if (room <= 0) continue;
    const moved = Math.min(left, room);
    if (slot) slot.count += moved; else inv.slots[i] = { item, count: moved };
    left -= moved;
  }
  return requested - left;
}

export function locoFuelStacks(e: Entity): Stack[] {
  const inv = locoFuelInventory(e);
  return inv ? inv.slots.slice(0, LOCO_FUEL_SLOTS).filter((s): s is Stack => !!s) : [];
}
