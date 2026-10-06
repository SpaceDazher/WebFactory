// v1.9: мегабаза — синтетическая фабрика для бенчмарка «20 000 построек + 100 000 предметов на лентах»,
// теста «оптимизации не меняют результат» (tests/mega.test.ts) и замера в игре (?bench=mega).
// Ячейка 40×11: сундук-источник → манипулятор → конвейер с разделителем и подземным участком → две ветки:
// верхняя — в сундук-сток, нижняя — манипуляторами в 4 печи → выход печей на ленту, на неё сбоку вливается
// вторая лента (медная руда) → сток. Стоки опустошаются, источники пополняются — ленты то забиваются, то разгружаются.
// Питание ячеек — «бесплатное» (g.freePower: постройки без сети считаются запитанными), эталонная база — со своей сетью.
import type { Game, Entity } from './game';

export function clearArea(g: Game, x: number, y: number, w: number, h: number) {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    g.world.getChunk(Math.floor(tx / 32), Math.floor(ty / 32));
    if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) return false;
  }
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  return true;
}
export interface Cell { src: Entity[]; sink: Entity[]; belts: Entity[]; furn: Entity[]; all: Entity[]; }
export const CELL_W = 40, CELL_H = 11;
export function buildCell(g: Game, X: number, Y: number, belt = 'transport-belt', fill = false): Cell | null {
  if (!clearArea(g, X, Y, CELL_W, CELL_H)) return null;
  const c: Cell = { src: [], sink: [], belts: [], furn: [], all: [] };
  const B = (p: string, x: number, y: number, d: number) => { const e = g.build(p, X + x, Y + y, d as any, false); if (!e) throw new Error(`не встало ${p} ${x},${y}`); c.all.push(e); if (e.lanes) c.belts.push(e); return e; };
  const src = B('iron-chest', 0, 0, 0); src.inv!.add('iron-ore', 1500); c.src.push(src);
  B('stack-inserter', 1, 0, 1);
  // второй источник снизу — на другую дорожку (манипулятор кладёт на дальнюю от себя): ленты полны с обеих сторон
  B('stack-inserter', 4, 1, 0); const s3 = B('iron-chest', 4, 2, 0); s3.inv!.add('iron-ore', 1500);
  for (let x = 2; x <= 21; x++) B(belt, x, 0, 1);
  B('splitter', 22, 0, 1);
  for (let x = 23; x <= 25; x++) B(belt, x, 0, 1);
  B('underground-belt', 26, 0, 1); B('underground-belt', 29, 0, 1);
  for (let x = 30; x <= 35; x++) B(belt, x, 0, 1);
  B('fast-inserter', 36, 0, 1); c.sink.push(B('iron-chest', 37, 0, 0));
  for (let x = 23; x <= 35; x++) B(belt, x, 1, 1);
  B('inserter', 36, 1, 1); c.sink.push(B('iron-chest', 37, 1, 0));
  for (const fx of [24, 26, 28, 30]) {
    B('inserter', fx, 2, 2); const f = B('stone-furnace', fx, 3, 0); f.fuel = { item: 'coal', count: 50 }; c.furn.push(f);
    B('inserter', fx, 5, 2);
  }
  for (let x = 23; x <= 35; x++) B(belt, x, 6, 1);
  B('fast-inserter', 36, 6, 1); c.sink.push(B('iron-chest', 37, 6, 0));
  // боковое вливание медной руды на нижнюю ленту
  B(belt, 33, 8, 0); B(belt, 33, 7, 0);
  B('inserter', 33, 9, 0); const s2 = B('iron-chest', 33, 10, 0); s2.inv!.add('copper-ore', 800); c.src.push(s2, s3);
  // буферная линия: медленный забор манипулятором в конце — лента почти всегда стоит забитой и сдвигается раз в ~1,2 с
  const s4 = B('iron-chest', 3, 8, 0); s4.inv!.add('iron-plate', 1500); B('inserter', 4, 8, 1);
  for (let x = 5; x <= 30; x++) B(belt, x, 8, 1);
  B('inserter', 31, 8, 1); c.sink.push(B('iron-chest', 32, 8, 0)); c.src.push(s4);
  // плотно забить ленты (как на мегабазе: большая часть лент стоит забитой)
  if (fill) for (const e of c.belts) if (e.t === 'belt') for (const L of [0, 1]) { const a = e.lanes![0][L]; if (!a.length) for (const p of [192, 128, 64, 0]) a.push({ item: e.y === Y + 8 && e.x !== X + 33 ? 'iron-plate' : e.y === Y + 7 || e.y === Y + 8 ? 'copper-ore' : 'iron-ore', pos: p, n: 1 }); }
  return c;
}
/** сетка ячеек; возвращает построенные */
export function buildCells(g: Game, n: number, X0 = 300, Y0 = 300, cols = 6, belt = 'transport-belt', fill = false): Cell[] {
  const out: Cell[] = [];
  for (let k = 0; out.length < n && k < n * 20 + 40; k++) {
    const x = X0 + (k % cols) * (CELL_W + 2), y = Y0 + Math.floor(k / cols) * (CELL_H + 2);
    try { const c = buildCell(g, x, y, belt, fill); if (c) out.push(c); } catch { /* клетка не подошла — следующая */ }
  }
  return out;
}
/** обслуживание: стоки опустошаются по очереди, источники пополняются (детерминированно по тику) */
export function serviceCells(g: Game, cells: Cell[] = (g as any)._mega || []) {
  const k = Math.floor(g.tick / 600);
  cells.forEach((c, i) => {
    if ((i + k) % 3 === 0) for (const s of c.sink) s.inv!.slots.fill(null);
    if (c.src[0].inv!.count('iron-ore') < 600) c.src[0].inv!.add('iron-ore', 600);
    if (c.src[1].inv!.count('copper-ore') < 300) c.src[1].inv!.add('copper-ore', 300);
    if (c.src[2] && c.src[2].inv!.count('iron-ore') < 600) c.src[2].inv!.add('iron-ore', 600);
    if (c.src[3] && c.src[3].inv!.count('iron-plate') < 600) c.src[3].inv!.add('iron-plate', 600);
    for (const f of c.furn) if (!f.fuel || f.fuel.count < 10) f.fuel = { item: 'coal', count: 30 };
  });
}

/** мегабаза поверх загруженной партии (эталонной базы): n ячеек правее неё; обслуживание — каждые 600 тиков из Game.step */
export function addMegaCells(g: Game, n: number, X0 = 300, Y0 = -200, cols = 16) {
  g.batchBuild = true; const cells = buildCells(g, n, X0, Y0, cols, 'transport-belt', true); g.batchBuild = false;
  g.freePower = true; (g as any)._mega = cells;
  g._hook = (gg: Game) => { if (gg.tick % 600 === 0) serviceCells(gg, cells); };
  return cells;
}
/** число предметов на лентах */
export function beltItemCount(g: Game) { let n = 0; for (const e of g.ents.values()) if (e.lanes) for (const sg of e.lanes) n += sg[0].length + sg[1].length; return n; }
