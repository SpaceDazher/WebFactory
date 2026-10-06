// Модули и маяки (8.7). Эффекты кешируются в сущности и пересчитываются,
// когда меняется «версия» (поставили/убрали постройку, модуль, рецепт, маяк включился/выключился).
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { prodAllowed } from '../data/recipes';
import type { Entity, Game } from './game';

export interface Fx { speed: number; prod: number; energy: number; pollution: number; }
const ZERO: Fx = { speed: 0, prod: 0, energy: 0, pollution: 0 };
export const moduleSlots = (e: Entity) => PROTOS[e.proto].modules || 0;
export const isModule = (item: string) => !!ITEMS[item]?.module;
/** можно ли поставить модуль в постройку (маяк не принимает продуктивность — как в Factorio) */
export function moduleFits(e: Entity, item: string) {
  const m = ITEMS[item]?.module; if (!m || !moduleSlots(e)) return false;
  if (e.t === 'beacon' && m.kind === 'productivity') return false;
  return true;
}
function sumModules(e: Entity, k: number, withProd: boolean, acc: Fx) {
  for (const id of e.modules || []) {
    if (!id) continue; const m = ITEMS[id].module!;
    acc.speed += m.speed * k; acc.energy += m.energy * k; acc.pollution += m.pollution * k;
    if (withProd) acc.prod += m.prod * k;
  }
}
/** продуктивность действует? (для сборщиков — только разрешённые рецепты) */
function prodOk(e: Entity) {
  if (e.t === 'assembler' || e.t === 'silo') return prodAllowed(e.recipe);
  return e.t === 'furnace' || e.t === 'drill' || e.t === 'lab' || e.t === 'pumpjack';
}
function overlaps(b: Entity, e: Entity) {
  const r = PROTOS[b.proto].beaconRange || 0;
  return e.x < b.x + b.w + r && e.x + e.w > b.x - r && e.y < b.y + b.h + r && e.y + e.h > b.y - r;
}
export function computeFx(g: Game, e: Entity): Fx {
  if (!moduleSlots(e) || e.t === 'beacon') return ZERO;
  const f: Fx = { speed: 0, prod: 0, energy: 0, pollution: 0 };
  const po = prodOk(e);
  sumModules(e, 1, po, f);
  for (const b of g.beaconList()) if (b._on && overlaps(b, e)) sumModules(b, 0.5, false, f);
  return f;
}
export function fx(g: Game, e: Entity): Fx {
  if (!moduleSlots(e)) return ZERO;
  if (e._fxv !== g.fxVer || !e._fx) { e._fx = computeFx(g, e); e._fxv = g.fxVer; }
  return e._fx;
}
/** множитель скорости (минимум 20%) */
export const speedMul = (g: Game, e: Entity) => Math.max(0.2, 1 + fx(g, e).speed);
/** множитель энергии (минимум 20% от базы — 8.7) */
export const energyMul = (g: Game, e: Entity) => Math.max(0.2, 1 + fx(g, e).energy);
export const prodBonus = (g: Game, e: Entity) => Math.max(0, fx(g, e).prod);
export const pollutionMul = (g: Game, e: Entity) => (1 + fx(g, e).pollution) * energyMul(g, e);
