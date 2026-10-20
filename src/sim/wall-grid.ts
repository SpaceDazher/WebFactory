export const MAX_WALL_BATCH = 256;
const MIN_WALL_COORD = -65_536;
const MAX_WALL_COORD = 65_535;
const MAX_WALL_SPAN = 1_023;

export type WallPoint = [number, number];
export interface WallGridPlan { positions: WallPoint[]; overflow: boolean; total: number; }

function validCoord(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_WALL_COORD && value <= MAX_WALL_COORD;
}

/** Generate an inclusive, row-staggered wall grid without allocating an unbounded plan. */
export function wallGridPositions(x0: number, y0: number, x1: number, y1: number, step = 2, stagger = true): WallGridPlan {
  if (![x0, y0, x1, y1].every(validCoord) || !Number.isInteger(step) || step < 1 || step > 4) {
    throw new RangeError('Wall grid requires integer coordinates within map bounds and a step from 1 to 4');
  }
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  if (maxX - minX > MAX_WALL_SPAN || maxY - minY > MAX_WALL_SPAN) return { positions: [], overflow: true, total: MAX_WALL_BATCH + 1 };
  const positions: WallPoint[] = [];
  const rowOffset = step > 1 ? Math.ceil(step / 2) : 0;
  let row = 0;
  for (let y = minY; y <= maxY; y += step, row++) {
    const offset = stagger && row % 2 ? rowOffset : 0;
    for (let x = minX + offset; x <= maxX; x += step) {
      positions.push([x, y]);
      if (positions.length > MAX_WALL_BATCH) return { positions: [], overflow: true, total: MAX_WALL_BATCH + 1 };
    }
  }
  return { positions, overflow: false, total: positions.length };
}

/** Validate untrusted simulation/worker command positions before touching the world. */
export function validWallBatchPositions(value: unknown): value is WallPoint[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WALL_BATCH) return false;
  const seen = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2 || !validCoord(point[0]) || !validCoord(point[1])) return false;
    minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    const key = `${point[0]}:${point[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return maxX - minX <= MAX_WALL_SPAN && maxY - minY <= MAX_WALL_SPAN;
}
