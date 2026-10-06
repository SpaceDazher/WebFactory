export type Dir = 0 | 1 | 2 | 3; // 0=С(вверх) 1=В 2=Ю 3=З
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const TICKS = 60;
export const CHUNK = 32;
export const tkey = (x: number, y: number) => (x + 65536) * 131072 + (y + 65536);
export const ckey = (cx: number, cy: number) => ((cx + 32768) << 16) | (cy + 32768);
export function rotLocal(lx: number, ly: number, w: number, h: number, r: number): [number, number] {
  // поворот локальной клетки (в ориентации «север») на r четвертей по часовой
  let x = lx, y = ly, W = w, H = h;
  for (let i = 0; i < r; i++) { const nx = H - 1 - y, ny = x; x = nx; y = ny; const t = W; W = H; H = t; }
  return [x, y];
}
