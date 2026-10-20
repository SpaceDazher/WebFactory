import { PROTOS } from '../data/entities';
import { CHUNK } from '../core/types';

export type WallPoint = readonly [number, number];
export interface WallConnectionGame {
  entAt(x: number, y: number): { proto: string } | null;
  ghostAt?(x: number, y: number): { proto: string } | null;
  world?: { hasChunk?(cx: number, cy: number): boolean };
}

const WALL_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const coordKey = (x: number, y: number) => `${x}:${y}`;

/** Return N=1, E=2, S=4, W=8 connections to neighboring walls, regardless of material. */
export function wallConnMask(
  game: WallConnectionGame,
  proto: string,
  x: number,
  y: number,
  planned?: ReadonlySet<string> | readonly WallPoint[],
  includeGhosts = false,
): number {
  if (PROTOS[proto]?.type !== 'wall') return 0;
  const plannedHas = (nx: number, ny: number) => {
    if (!planned) return false;
    if (Array.isArray(planned)) return (planned as readonly WallPoint[]).some(([px, py]) => px === nx && py === ny);
    return (planned as ReadonlySet<string>).has(coordKey(nx, ny));
  };
  let mask = 0;
  for (let d = 0; d < WALL_DIRS.length; d++) {
    const [dx, dy] = WALL_DIRS[d]!; const nx = x + dx, ny = y + dy;
    // Game.entAt delegates to World.occ, which creates missing terrain chunks.
    // Rendering must stay read-only at explored edges; lightweight renderer test
    // doubles without a world retain the historical direct lookup behavior.
    const loaded = typeof game.world?.hasChunk !== 'function' ||
      game.world.hasChunk(Math.floor(nx / CHUNK), Math.floor(ny / CHUNK));
    const entity = loaded ? game.entAt(nx, ny) : null;
    const ghost = includeGhosts ? game.ghostAt?.(nx, ny) : null;
    if (plannedHas(nx, ny) || entity && PROTOS[entity.proto]?.type === 'wall' || ghost && PROTOS[ghost.proto]?.type === 'wall') mask |= 1 << d;
  }
  return mask;
}

/** Add connection state to a raster cache key so neighbor changes select a new atlas tile. */
export function wallConnAtlasKey(mask: number): string { return `|wall-conn:${mask & 15}`; }
