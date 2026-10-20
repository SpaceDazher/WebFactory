import { ITEMS } from '../data/items';

/** Contents are never part of a copied chest configuration. Null means All. */
export interface ChestSettings { limit: number | null; filters: (string | null)[]; }
export function validChestSettings(value: unknown, maxSlots = 1_000_000): value is ChestSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as ChestSettings;
  return Object.keys(v).sort().join(',') === 'filters,limit' &&
    (v.limit === null || Number.isSafeInteger(v.limit) && v.limit >= 1 && v.limit <= maxSlots) &&
    Array.isArray(v.filters) && v.filters.length <= maxSlots && v.filters.every(it => it === null || typeof it === 'string' && Object.hasOwn(ITEMS, it) && !ITEMS[it].fluid && !ITEMS[it].virtual);
}
export function copyChestSettings(value: ChestSettings, size: number): ChestSettings {
  return { limit: value.limit === null ? null : Math.min(size, value.limit), filters: value.filters.slice(0, size) };
}
