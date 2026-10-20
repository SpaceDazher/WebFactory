// v1.11: точная коллизия инженера с постройками. Раньше любая твёрдая постройка занимала клетку целиком, и между двумя
// постройками вплотную пройти было нельзя. Теперь у постройки — прямоугольник с отступом от краёв клеток (как в Factorio):
// между соседями остаётся проход шире инженера (0,4 клетки). Сплошные — только стены и гнёзда; у труб — «стержень» по центру
// и «рукава» к соединённым соседям: вдоль соединённой трубы не пройти, между параллельными несоединёнными — можно.
import type { Game, Entity } from './game';
import { PROTOS, Proto } from '../data/entities';
import { DX, DY } from '../core/types';
import { fluidConns } from './networks';

/** отступ прямоугольника коллизии от краёв занятых клеток */
export function colMargin(p: Proto): number {
  if (p.colMargin != null) return p.colMargin;
  switch (p.type) {
    case 'wall': case 'nest': case 'gate': return 0;
    case 'pipe': return 0.3;
    case 'inserter': return 0.3;
    case 'pole': return p.w > 1 ? 0.45 : 0.35;
    case 'lamp': return 0.3;
    case 'signal': return 0.35;
    default: return 0.25;
  }
}
/** соединена ли труба / постройка e в сторону d клетки (x, y) с соседом (общая точка соединения жидкостей) */
function joined(g: Game, e: Entity, x: number, y: number, d: number): boolean {
  const n = g.entAt(x + DX[d], y + DY[d]); if (!n || n === e || !PROTOS[n.proto].fluid) return false;
  const back = (d + 2) % 4;
  for (let b = 0; b < PROTOS[n.proto].fluid!.length; b++) for (const c of fluidConns(n, b)) if (c.x === x + DX[d] && c.y === y + DY[d] && c.d === back) return true;
  return false;
}
const hitBox = (px: number, py: number, r: number, x0: number, y0: number, x1: number, y1: number) => px + r > x0 && px - r < x1 && py + r > y0 && py - r < y1;
/** задевает ли круг (квадрат) инженера (px, py, r) коллизию постройки */
export function entHit(g: Game, e: Entity, px: number, py: number, r: number): boolean {
  const p = PROTOS[e.proto]; const m = colMargin(p);
  if (hitBox(px, py, r, e.x + m, e.y + m, e.x + e.w - m, e.y + e.h - m)) return true;
  if (e.t !== 'pipe' || !p.fluid) return false;
  // рукава трубы к соединённым соседям — до края клетки
  for (const c of fluidConns(e, 0)) {
    if (!joined(g, e, c.x, c.y, c.d)) continue;
    const x0 = c.x + m, y0 = c.y + m, x1 = c.x + 1 - m, y1 = c.y + 1 - m;
    const ax0 = c.d === 3 ? c.x : x0, ax1 = c.d === 1 ? c.x + 1 : x1, ay0 = c.d === 0 ? c.y : y0, ay1 = c.d === 2 ? c.y + 1 : y1;
    if (hitBox(px, py, r, ax0, ay0, ax1, ay1)) return true;
  }
  return false;
}
