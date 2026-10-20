// v1.11: помощники укладки железной дороги (перенесены из tests/railkit.ts — нужны и замеру производительности)
import type { Game, Entity } from './game';
import { planRail, placeCar, trainOf, graph, SIG_OX, SIG_OY, Train } from './trains';
import { shapeOf } from './railgeo';
/** проложить путь от узла (sx, sy) с направлением sh до узла (tx, ty) с направлением th; возвращает число кусков */
export function lay(g: Game, sx: number, sy: number, sh: number, tx: number, ty: number, th: number): number {
  const r = planRail(sx, sy, sh, tx, ty, th, () => true, undefined, 400000);
  if (!r.exact) throw new Error(`путь не найден ${sx},${sy},${sh} → ${tx},${ty},${th}`);
  let n = 0; for (const p of r.pieces) { const c = g.canPlace(p.proto, p.x, p.y, p.dir as any, false); if (!c.ok) { if (c.reason === 'Рельсы уже лежат') continue; throw new Error('кусок не лёг: ' + c.reason + ' ' + JSON.stringify(p)); } g.build(p.proto, p.x, p.y, p.dir as any, false); n++; }
  return n;
}
/** прямой участок по узлам (шаг 2) */
export function straight(g: Game, x: number, y: number, h: number, n: number) {
  const v = h % 4, dx = [0, 1, 1, 1][v] * (h >= 4 ? -1 : 1), dy = [-1, -1, 0, 1][v] * (h >= 4 ? -1 : 1);
  for (let i = 0; i < n; i++) { const ax = x + dx * 2 * i + (h >= 4 ? dx * 2 : 0), ay = y + dy * 2 * i + (h >= 4 ? dy * 2 : 0); const s = shapeOf('straight-rail', v); const c = g.canPlace('straight-rail', ax - s.ox, ay - s.oy, v as any, false); if (c.ok) g.build('straight-rail', ax - s.ox, ay - s.oy, v as any, false); }
}
/** светофор у узла (x, y) для хода h */
export function signal(g: Game, x: number, y: number, h: number, chain = false): Entity | null {
  const c = g.canPlace(chain ? 'rail-chain-signal' : 'rail-signal', x + SIG_OX[h], y + SIG_OY[h], h, false); if (!c.ok) return null;
  return g.build(chain ? 'rail-chain-signal' : 'rail-signal', x + SIG_OX[h], y + SIG_OY[h], h as any, false);
}
/** рельс, проходящий через узел (x, y) */
export function railNear(g: Game, x: number, y: number): Entity { const G = graph(g); for (const [id, r] of G.info) { if ((r.ax === x && r.ay === y) || (r.ax + r.s.b[0] === x && r.ay + r.s.b[1] === y)) return r.e; } throw new Error('нет рельса у ' + x + ',' + y); }
/** состав по узлам вдоль прямой: протоколы, точки (x, y) центров вагонов; back — локомотив задом */
export function train(g: Game, cars: [string, number, number, boolean?][]): Train {
  let t: Train | null = null;
  for (const [p, x, y, back] of cars) { const r = railNear(g, x & ~1, y & ~1); const e = placeCar(g, p, r.id, x, y, !!back); if (typeof e === 'string') throw new Error('вагон: ' + e + ' ' + p + ' ' + x + ',' + y); if (p === 'locomotive') e.fuel = { item: 'coal', count: 50 }; t = trainOf(g, e); }
  return t!;
}
export function station(g: Game, x: number, y: number, dir: number, name: string): Entity {
  const e = g.build('train-stop', x, y, dir as any, false); if (!e) throw new Error('станция не встала: ' + g.canPlace('train-stop', x, y, dir as any, false).reason);
  g.enqueue({ t: 'stopName', id: e.id, name }); g.step(); return e;
}
