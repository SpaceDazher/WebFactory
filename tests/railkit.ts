// v1.8: общие помощники тестов железной дороги — ровная суша, укладка путей планировщиком, светофоры у узла, составы
import { Game, Entity } from '../src/sim/game';
import { planRail, placeCar, trainOf, graph, SIG_OX, SIG_OY, nk, Train } from '../src/sim/trains';
import { shapeOf } from '../src/sim/railgeo';
import { RECIPES } from '../src/data/recipes';
export let fails = 0;
export const ok = (c: boolean | undefined, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
/** игра на ровной суше без деревьев и руды (рельсы кладутся куда угодно) */
export function flat(seed = 7): Game {
  const g = new Game(seed, true, { enemies: 'none' });
  const W: any = g.world; W.terrain = () => 0; W.decor = () => 0; W.res = () => 0; W.walkable = () => true;
  for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); (g as any).sat = () => 1;
  for (const t of ['railway', 'automated-rail-transportation', 'rail-signals', 'fluid-wagon']) g.research.done.add(t);
  return g;
}
export const run = (g: Game, n: number, until?: () => boolean) => { for (let i = 0; i < n; i++) { g.step(); if (until && until()) return i; } return n; };
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
/** минимальное расстояние между осями вагонов разных поездов (клетки) */
export function minGap(g: Game): number {
  let best = Infinity; const cs: { t: number; x: number; y: number }[] = [];
  for (const t of g.trains) for (const id of t.cars) { const e = g.ents.get(id)!; cs.push({ t: t.id, x: e._cx ?? e.x, y: e._cy ?? e.y }); }
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (cs[i].t !== cs[j].t) best = Math.min(best, Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y));
  return best;
}
/** v1.8: эталонная сеть (railnet.test, бенчмарк): 2 горизонтальные и 2 вертикальные двухпутные линии с петлями,
 *  16 пересечений путей (проходной на въезде, обычный на выезде), 8 станций, 20 поездов по расписанию «время 2 с» */
export function refNet(seed = 3): { g: Game; trains: Train[]; sigN: number } {
  const g = flat(seed);
  const C = [-74, -46, 46, 74];               // координаты путей поперечных линий
  const near = (v: number) => C.some(c => Math.abs(c - v) < 12);
  let sigN = 0;
  const sig = (x: number, y: number, h: number, chain = false) => { if (!signal(g, x, y, h, chain)) throw new Error(`светофор не встал ${x},${y},${h}`); sigN++; };
  for (const y0 of [-60, 60]) {
    const yE = y0 - 14, yW = y0 + 14;
    straight(g, -150, yE, 2, 150); lay(g, 150, yE, 2, 150, yW, 6); straight(g, 150, yW, 6, 150); lay(g, -150, yW, 6, -150, yE, 2);
  }
  for (const x0 of [-60, 60]) {
    const xS = x0 + 14, xN = x0 - 14;
    straight(g, xS, -150, 4, 150); lay(g, xS, 150, 4, xN, 150, 0); straight(g, xN, 150, 0, 150); lay(g, xN, -150, 0, xS, -150, 4);
  }
  // светофоры: на въезде в пересечение — проходной, на выезде — обычный; между пересечениями — обычные через 30 клеток
  for (const y0 of [-60, 60]) {
    const yE = y0 - 14, yW = y0 + 14;
    for (const c of C) { sig(c - 4, yE, 2, true); sig(c + 4, yE, 2); sig(c + 4, yW, 6, true); sig(c - 4, yW, 6); }
    for (let x = -140; x <= 140; x += 30) if (!near(x)) { sig(x, yE, 2); sig(x, yW, 6); }
  }
  for (const x0 of [-60, 60]) {
    const xS = x0 + 14, xN = x0 - 14;
    for (const c of C) { sig(xS, c - 4, 4, true); sig(xS, c + 4, 4); sig(xN, c + 4, 0, true); sig(xN, c - 4, 0); }
    for (let y = -140; y <= 140; y += 30) if (!near(y)) { sig(xS, y, 4); sig(xN, y, 0); }
  }
  // станции: по одной на каждом пути каждой линии (8), поезда — по 5 на линию
  const trains: Train[] = []; const names: string[][] = [];
  let li = 0;
  for (const y0 of [-60, 60]) {
    const yE = y0 - 14, yW = y0 + 14, a = `Г${li}-восток`, b = `Г${li}-запад`; li++;
    station(g, -112 - 2, yE + 1, 1, a); station(g, 112, yW - 3, 3, b);
    for (const x of [-136, -100, 10, 30, 130]) trains.push(train(g, [['locomotive', x, yE], ['cargo-wagon', x - 7, yE]]));
    names.push([a, b]);
  }
  for (const x0 of [-60, 60]) {
    const xS = x0 + 14, xN = x0 - 14, a = `В${li}-юг`, b = `В${li}-север`; li++;
    station(g, xS - 3, -112 - 2, 2, a); station(g, xN + 1, 112, 0, b);
    for (const y of [-136, -100, 10, 30, 130]) trains.push(train(g, [['locomotive', xN, y], ['cargo-wagon', xN, y + 7]]));
    names.push([a, b]);
  }
  trains.forEach((t, i) => { const [a, b] = names[Math.floor(i / 5)]; g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: a, c: 'time', n: 2 }, { st: b, c: 'time', n: 2 }] }); g.enqueue({ t: 'tmode', id: t.cars[0], auto: true }); });
  g.step();
  return { g, trains, sigN };
}
export { nk };
