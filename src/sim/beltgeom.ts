import { DX, DY } from '../core/types';

/** Shared belt-lane geometry, in world-tile coordinates, for simulation snapshots and sprites. */
export function beltLanePos(tx: number, ty: number, dir: number, curve: number, lane: number, pos: number): [number, number] {
  const a = Math.max(0, Math.min(255, pos)) / 256;
  const lat = lane === 0 ? -0.24 : 0.24;
  const side = (dir + 1) % 4;
  if (curve >= 0 && curve !== dir && a < 0.5) {
    const inSide = (curve + 1) % 4;
    const start: [number, number] = [tx + 0.5 - DX[curve] * 0.5 + DX[inSide] * lat, ty + 0.5 - DY[curve] * 0.5 + DY[inSide] * lat];
    const end: [number, number] = [tx + 0.5 + DX[side] * lat, ty + 0.5 + DY[side] * lat];
    const handle = 0.22;
    const c1: [number, number] = [start[0] + DX[curve] * handle, start[1] + DY[curve] * handle];
    const c2: [number, number] = [end[0] - DX[dir] * handle, end[1] - DY[dir] * handle];
    const t = a * 2, u = 1 - t;
    const cubic = (v0: number, v1: number, v2: number, v3: number) => u * u * u * v0 + 3 * u * u * t * v1 + 3 * u * t * t * v2 + t * t * t * v3;
    return [cubic(start[0], c1[0], c2[0], end[0]), cubic(start[1], c1[1], c2[1], end[1])];
  }
  return [tx + 0.5 + DX[dir] * (a - 0.5) + DX[side] * lat, ty + 0.5 + DY[dir] * (a - 0.5) + DY[side] * lat];
}
