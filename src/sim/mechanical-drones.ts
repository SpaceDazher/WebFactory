import type { Game } from './game';
import type { DroneInstance } from './v117';
import { CHUNK } from '../core/types';
import { PROTOS } from '../data/entities';
import { entHit } from './collide';

export function droneInFlight(d: DroneInstance): boolean {
  return d.hp > 0 && (d.mode === 'flying' || d.mode === 'returning' || d.mode === 'combat' || d.mode === 'repair');
}
/** A forced landing keeps its deployed unit reserved until actual recovery/docking or death. */
export function droneUsesBudget(d: DroneInstance): boolean { return d.hp > 0; }
/** Repair mode is actual low work; travel to a repair target stays flying. */
export function droneLow(d: DroneInstance): boolean {
  return d.hp > 0 && (d.mode === 'landed' || d.mode === 'disabled' || d.mode === 'repair');
}
export function droneGroundReachable(g: Game, d: DroneInstance, x: number, y: number): boolean {
  if (!droneLow(d)) return false;
  const distance = Math.hypot(d.x - x, d.y - y), steps = Math.max(1, Math.ceil(distance * 4));
  for (let i = 1; i <= steps; i++) {
    const px = x + (d.x - x) * i / steps, py = y + (d.y - y) * i / steps;
    if (!g.world.hasChunk(Math.floor(px / CHUNK), Math.floor(py / CHUNK))) return false;
    const obstacle = g.entAt(Math.floor(px), Math.floor(py));
    // Pipe collision inspects fluid neighbours. Keep this short melee ray local
    // rather than letting an edge pipe generate an unexplored adjacent chunk.
    if (obstacle && PROTOS[obstacle.proto]?.solid && !(obstacle.t === 'gate' && obstacle.open) && (obstacle.t === 'pipe' || entHit(g, obstacle, px, py, .03))) return false;
  }
  return true;
}
export function damageCombatDrone(g: Game, d: DroneInstance, damage: number): boolean {
  if (d.hp <= 0 || !Number.isFinite(damage) || damage <= 0) return false;
  g.markRadarThreatHit(d.x, d.y); d.hp = Math.max(0, d.hp - damage);
  if (d.hp === 0) {
    d.mode = 'disabled'; d.target = null; d.home = null;
    d.charge = 0; d.ammo = 0; d.ammoType = null; d.repair = 0;
    g.fx.push({ k: 'blast', x: d.x, y: d.y, t: 12, life: 12, s: .4 });
    g.alert(d.x, d.y, 'Боевой дрон уничтожен');
  }
  return true;
}
export function damageCombatDronesInRadius(g: Game, x: number, y: number, radius: number, damage: number, groundOnly = false) {
  for (const d of g.v117.drones.instances) if (d.hp > 0 && (!groundOnly || droneLow(d)) && Math.hypot(d.x - x, d.y - y) <= radius) damageCombatDrone(g, d, damage);
}
