// v1.12: набор модов и отпечаток игровых данных. У всех игроков кооператива он должен совпадать:
// иначе одинаковые команды дадут разную игру. С v1.10 — включённые моды (имя, версия, отпечаток) и данные игры после них.
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { RESOURCES, MAPGEN } from '../data/resources';
import { activeMods, onModsChanged } from '../mods/registry';
export interface ModSet { mods: { id: string; ver: string; hash: string }[]; data: string; }
let cached: ModSet | null = null;
onModsChanged(() => { cached = null; });
function fnv(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
export function modSet(): ModSet {
  if (cached) return cached;
  // названия, описания и цвета (режим для дальтоников меняет цвета пакетов науки) на игру не влияют
  const strip = (o: any) => JSON.stringify(o, (k, v) => (k === 'name' || k === 'desc' || k === 'color' || k === 'sprite' || typeof v === 'function') ? undefined : v);
  cached = { mods: activeMods().map(m => ({ id: m.name, ver: m.version, hash: m.hash })), data: fnv(strip(ITEMS) + strip(PROTOS) + strip(RECIPES) + strip(TECHS) + strip(RESOURCES) + strip(MAPGEN)) };
  return cached;
}
/** одинаковый ли набор модов (и данные игры) */
export function sameMods(a: ModSet | undefined, b: ModSet): boolean {
  return !!a && a.data === b.data && a.mods.length === b.mods.length && a.mods.every((m, i) => m.id === b.mods[i].id && m.hash === b.mods[i].hash);
}
