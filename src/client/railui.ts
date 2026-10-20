import { shapeOf } from '../sim/railgeo';

/** Small, deterministic helpers for rail drag controls and the supported preview distance. */
export const MAX_RAIL_PREVIEW_DISTANCE = 1000;
export interface RailPreviewWorld { hasChunk(cx: number, cy: number): boolean; terrain(x: number, y: number): number; occ(x: number, y: number): number; }

/** Unloaded terrain is provisionally routable; commit validation generates and checks it in the simulation worker. */
export function railCellFree(world: RailPreviewWorld, x: number, y: number, waterLevel: number): boolean {
  if (x < -65536 || x > 65535 || y < -65536 || y > 65535) return false;
  if (!world.hasChunk(Math.floor(x / 32), Math.floor(y / 32))) return true;
  return world.terrain(x, y) < waterLevel && world.occ(x, y) < 0;
}

export function railPieceKnown(world: RailPreviewWorld, p: { proto: string; x: number; y: number; dir: number }): boolean {
  const s = shapeOf(p.proto, p.dir), ax = p.x + s.ox, ay = p.y + s.oy;
  return s.cells.every(([cx, cy]) => world.hasChunk(Math.floor((ax + cx) / 32), Math.floor((ay + cy) / 32)));
}

export function adjustRailSpacing(tracks: number, spacing: number, direction: number): number {
  const count = Math.max(1, Math.min(4, Math.floor(Number.isFinite(tracks) ? tracks : 1)));
  const step = count % 2 === 0 ? 4 : 2;
  const current = Math.max(step, Math.min(16, Math.round((Number.isFinite(spacing) ? spacing : 4) / step) * step));
  const change = Math.sign(direction) * step;
  return Math.max(step, Math.min(16, current + change));
}

/** Snap a drag endpoint to rail nodes while keeping 500 two-cell segments in range. */
export function railPreviewTarget(sx: number, sy: number, wx: number, wy: number, maxDistance = MAX_RAIL_PREVIEW_DISTANCE): [number, number] {
  const limit = Math.max(2, Math.min(MAX_RAIL_PREVIEW_DISTANCE, Number.isFinite(maxDistance) ? maxDistance : MAX_RAIL_PREVIEW_DISTANCE));
  let tx = Math.round(wx / 2) * 2, ty = Math.round(wy / 2) * 2;
  const dx = tx - sx, dy = ty - sy, length = Math.hypot(dx, dy);
  if (length > limit) {
    const factor = Math.max(0, limit / length);
    tx = Math.round((sx + dx * factor) / 2) * 2;
    ty = Math.round((sy + dy * factor) / 2) * 2;
    while (Math.hypot(tx - sx, ty - sy) > limit) {
      if (Math.abs(tx - sx) >= Math.abs(ty - sy)) tx -= Math.sign(tx - sx) * 2;
      else ty -= Math.sign(ty - sy) * 2;
    }
  }
  return [tx, ty];
}
