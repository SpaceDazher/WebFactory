// Бот-тест: чертежи блоков. Все блоки — ряды одинаковых «ячеек» (сундук → манипулятор → машина → манипулятор → сундук).
// Логистику между ячейками бот делает руками (как игрок с полным инвентарём), внутри ячейки — манипуляторы.
import type { Blueprint, BpEnt } from '../../src/sim/blueprint';
import { dims } from './map';

export type XY = [number, number];
/** ячейка внутри блока: клетка машины, входного и выходного сундука (относительно блока) */
export interface CellSpec { m: XY; in?: XY; out?: XY; i?: XY; /** что машина получает прямо из соседней машины (не носить) */ direct?: string[]; }
export interface Block { bp: Blueprint; cells: CellSpec[]; /** клетки портов жидкости, к которым надо подвести трубы: [x,y (перед портом), сеть] */ pipes?: { x: number; y: number; net: string }[]; }
type E = BpEnt;
const D = (d: number) => d as 0 | 1 | 2 | 3;
export function mk(name: string, ents: E[]): Blueprint {
  let w = 0, h = 0; const cnt: Record<string, number> = {};
  for (const e of ents) { const [a, b] = dims(e.p, e.d); w = Math.max(w, e.x + a); h = Math.max(h, e.y + b); cnt[e.p] = (cnt[e.p] || 0) + 1; }
  return { v: 1, name, icons: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]), w, h, entities: ents };
}
/** Сборочный блок: n ячеек 3×7 (выход сверху). fluid — машины повёрнуты, порты слева/справа сливаются в одну трубу вдоль ряда. */
export function craftBlock(name: string, machine: string, recipe: string, n: number, o: { ins?: string; chest?: string; fluid?: boolean } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 3 * i;
    ents.push({ p: ch, x: x + 1, y: 0, d: 0 }, { p: ins, x: x + 1, y: 1, d: 0 }, { p: machine, x, y: 2, d: D(o.fluid ? 1 : 0), recipe },
      { p: ins, x: x + 1, y: 5, d: 0 }, { p: ch, x: x + 1, y: 6, d: 0 }, { p: 'small-electric-pole', x, y: 1, d: 0 }, { p: 'small-electric-pole', x, y: 5, d: 0 });
    cells.push({ m: [x, 2], in: [x + 1, 6], out: [x + 1, 0], i: [x + 1, 5] });
  }
  return { bp: mk(name, ents), cells };
}
/** Цепочка «машина → машина»: feed (например, провод) идёт манипулятором прямо в соседнюю машину recipe — промежуточное носить не надо.
 *  Ячейка 7×7: сундук ↓ подающая машина → манипулятор → основная машина ↑ сундук-выход, основное сырьё — снизу. */
export function chainBlock(name: string, machine: string, feed: string, recipe: string, n: number, o: { ins?: string; chest?: string } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 7 * i;
    ents.push({ p: ch, x: x + 1, y: 0, d: 0 }, { p: ins, x: x + 1, y: 1, d: 2 }, { p: machine, x, y: 2, d: 0, recipe: feed }, { p: ins, x: x + 3, y: 3, d: 1 },
      { p: machine, x: x + 4, y: 2, d: 0, recipe }, { p: ins, x: x + 5, y: 1, d: 0 }, { p: ch, x: x + 5, y: 0, d: 0 }, { p: ins, x: x + 5, y: 5, d: 0 }, { p: ch, x: x + 5, y: 6, d: 0 },
      { p: 'small-electric-pole', x: x + 3, y: 1, d: 0 }, { p: 'small-electric-pole', x: x + 3, y: 5, d: 0 });
    cells.push({ m: [x, 2], in: [x + 1, 0], i: [x + 1, 1] }, { m: [x + 4, 2], in: [x + 5, 6], out: [x + 5, 0], i: [x + 5, 5], direct: [feed] });
  }
  return { bp: mk(name, ents), cells };
}
/** Плавильный блок (сталь, кирпич): ячейки 2×6, топливо (уголь) кладётся во входной сундук вместе с сырьём */
export function smeltBlock(name: string, n: number, o: { ins?: string; chest?: string; furnace?: string } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest', f = o.furnace || 'stone-furnace'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 2 * i;
    ents.push({ p: ch, x, y: 0, d: 0 }, { p: ins, x, y: 1, d: 0 }, { p: f, x, y: 2, d: 0 }, { p: ins, x, y: 4, d: 0 }, { p: ch, x, y: 5, d: 0 },
      { p: 'small-electric-pole', x: x + 1, y: 1, d: 0 }, { p: 'small-electric-pole', x: x + 1, y: 4, d: 0 });
    cells.push({ m: [x, 2], in: [x, 5], out: [x, 0], i: [x, 4] });
  }
  return { bp: mk(name, ents), cells };
}
/** Лаборатории: сундук с пакетами → манипулятор → лаборатория */
export function labBlock(n: number, o: { ins?: string; chest?: string } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 3 * i;
    ents.push({ p: ch, x: x + 1, y: 0, d: 0 }, { p: ins, x: x + 1, y: 1, d: 2 }, { p: 'lab', x, y: 2, d: 0 }, { p: 'small-electric-pole', x, y: 1, d: 0 });
    cells.push({ m: [x, 2], in: [x + 1, 0] });
  }
  return { bp: mk('Лаборатории', ents), cells };
}
/** Шахтные колонны: электробур → печь → манипулятор → сундук с пластинами (топливо печи — рукой) */
export function columnBlock(name: string, n: number, o: { ins?: string; chest?: string; flip?: boolean } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 3 * i;
    if (o.flip) { // бур сверху, сундук снизу
      ents.push({ p: 'electric-mining-drill', x, y: 0, d: 2 }, { p: 'stone-furnace', x: x + 1, y: 3, d: 0 }, { p: 'small-electric-pole', x, y: 4, d: 0 }, { p: ins, x: x + 1, y: 5, d: 2 }, { p: ch, x: x + 1, y: 6, d: 0 });
      cells.push({ m: [x + 1, 3], out: [x + 1, 6] }); continue;
    }
    ents.push({ p: ch, x: x + 1, y: 0, d: 0 }, { p: ins, x: x + 1, y: 1, d: 0 }, { p: 'stone-furnace', x: x + 1, y: 2, d: 0 }, { p: 'small-electric-pole', x, y: 2, d: 0 }, { p: 'electric-mining-drill', x, y: 4, d: 0 });
    cells.push({ m: [x + 1, 2], out: [x + 1, 0] });
  }
  return { bp: mk(name, ents), cells };
}
/** Сырьё в сундук: электробур → сундук (уголь, камень) */
export function rawBlock(name: string, n: number, o: { chest?: string } = {}): Block {
  const ch = o.chest || 'iron-chest'; const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 3 * i;
    ents.push({ p: ch, x: x + 1, y: 0, d: 0 }, { p: 'small-electric-pole', x, y: 0, d: 0 }, { p: 'electric-mining-drill', x, y: 1, d: 0 });
    cells.push({ m: [x, 1], out: [x + 1, 0] });
  }
  return { bp: mk(name, ents), cells };
}
/** Электростанция на угольном поле: бур → бойлер → 2 паровых двигателя; вода — по трубе вдоль бойлеров (порт слева у первого) */
export function powerBlock(n: number): Block {
  const ents: E[] = []; const cells: CellSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = 4 * i;
    ents.push({ p: 'steam-engine', x, y: 0, d: 0 }, { p: 'steam-engine', x, y: 5, d: 0 }, { p: 'boiler', x, y: 10, d: 0 }, { p: 'electric-mining-drill', x, y: 12, d: 0 });
    ents.push({ p: 'small-electric-pole', x: x + 3, y: 2, d: 0 }, { p: 'small-electric-pole', x: x + 3, y: 7, d: 0 }, { p: 'small-electric-pole', x: x + 3, y: 13, d: 0 });
    if (i < n - 1) ents.push({ p: 'pipe', x: x + 3, y: 11, d: 0 });
    cells.push({ m: [x, 10] });
  }
  return { bp: mk('Электростанция', ents), cells, pipes: [{ x: -1, y: 11, net: 'water-p' }] };
}
/** Хим. завод с сундуками слева/справа; порты: низ (0,2)/(2,2) — входы, верх (0,0)/(2,0) — выходы */
export function chemUnit(recipe: string, o: { ins?: string; chest?: string } = {}): Block {
  const ins = o.ins || 'inserter', ch = o.chest || 'iron-chest';
  const ents: E[] = [{ p: ch, x: 0, y: 1, d: 0 }, { p: ins, x: 1, y: 1, d: 1 }, { p: 'chemical-plant', x: 2, y: 0, d: 0, recipe }, { p: ins, x: 5, y: 1, d: 1 }, { p: ch, x: 6, y: 1, d: 0 },
    { p: 'small-electric-pole', x: 1, y: 2, d: 0 }, { p: 'small-electric-pole', x: 5, y: 2, d: 0 }];
  return { bp: mk('Хим. завод: ' + recipe, ents), cells: [{ m: [2, 0], in: [0, 1], out: [6, 1], i: [1, 1] }] };
}
export function refineryUnit(recipe: string): Block {
  return { bp: mk('НПЗ: ' + recipe, [{ p: 'oil-refinery', x: 0, y: 0, d: 0, recipe }, { p: 'small-electric-pole', x: 5, y: 2, d: 0 }]), cells: [{ m: [0, 0] }] };
}
export function pumpjackUnit(): Block { return { bp: mk('Качалка', [{ p: 'pumpjack', x: 0, y: 0, d: 0 }, { p: 'small-electric-pole', x: 3, y: 1, d: 0 }]), cells: [{ m: [0, 0] }] }; }
/** Ракетная шахта: снизу сундук → быстрый манипулятор ×2 */
export function siloBlock(o: { ins?: string; chest?: string } = {}): Block {
  const ins = o.ins || 'fast-inserter', ch = o.chest || 'steel-chest';
  const ents: E[] = [{ p: 'rocket-silo', x: 0, y: 0, d: 0 }, { p: ins, x: 4, y: 9, d: 0 }, { p: ch, x: 4, y: 10, d: 0 }, { p: 'small-electric-pole', x: 3, y: 9, d: 0 }];
  return { bp: mk('Ракетная шахта', ents), cells: [{ m: [0, 0], in: [4, 10], i: [4, 9] }] };
}
/** Склад: ряд сундуков со столбом не нужен */
export function storeBlock(n: number, chest = 'iron-chest'): Block {
  const ents: E[] = []; for (let i = 0; i < n; i++) ents.push({ p: chest, x: i, y: 0, d: 0 });
  return { bp: mk('Склад', ents), cells: [] };
}
