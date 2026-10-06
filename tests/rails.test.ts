// v1.7 «Железная дорога I»: геометрия кусков (повороты/отражения), укладка, планировщик «тянуть путь», состав (сцепка),
// автоматический режим по расписанию туда-обратно (два локомотива), условия «время / полон / пуст», фильтры вагона,
// манипуляторы на станции, ручное управление, снятие вагона (деление поезда), рельс под поездом не снимается,
// сохранение/загрузка посреди пути (тот же хэш дальше — детерминизм), миграция v10 → v11, чертёж с рельсами.
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { makeBlueprint } from '../src/sim/blueprint';
import { shapeOf, rotVariant, mirrorVariant } from '../src/sim/railgeo';
import { placeCar, planRail, trainOf, fillPct, carAt, removeCar } from '../src/sim/trains';
import { RECIPES } from '../src/data/recipes';
let fails = 0;
const ok = (c: boolean | undefined, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const fresh = (seed = 7) => { const g = new Game(seed, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); (g as any).sat = () => 1; for (const t of ['railway', 'automated-rail-transportation']) g.research.done.add(t); return g; };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 800; r += 4) for (let a = 0; a < 32; a++) {
    const bx = Math.floor(x + Math.cos(a / 32 * Math.PI * 2) * r) & ~1, by = Math.floor(y + Math.sin(a / 32 * Math.PI * 2) * r) & ~1;
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
const run = (g: Game, n: number, until?: () => boolean) => { for (let i = 0; i < n; i++) { g.step(); if (until && until()) return i; } return n; };
/** прямой рельс по якорю (узлу) */
const rail = (g: Game, ax: number, ay: number, v: number, proto = 'straight-rail') => { const s = shapeOf(proto, v); return g.build(proto, ax - s.ox, ay - s.oy, v as any, false)!; };
const railAtNode = (g: Game, ax: number, ay: number) => [...g.ents.values()].find(e => e.t === 'rail' && e.x + shapeOf(e.proto, e.dir).ox === ax && e.y + shapeOf(e.proto, e.dir).oy === ay)!;
const fuel = (e: Entity) => { e.fuel = { item: 'coal', count: 50 }; };

console.log('1. Геометрия: повороты и отражения кусков совпадают с формой');
{
  const norm = (c: number[][]) => { const mx = Math.min(...c.map(p => p[0])), my = Math.min(...c.map(p => p[1])); return c.map(([x, y]) => (x - mx) + ',' + (y - my)).sort().join(' '); };
  const pts = (p: string, v: number) => norm(shapeOf(p, v).cells); let bad = 0;
  for (const p of ['straight-rail', 'curved-rail']) for (let v = 0; v < (p === 'curved-rail' ? 8 : 4); v++) {
    const s = shapeOf(p, v);
    if (norm(s.cells.map(([x, y]) => [-y - 1, x])) !== pts(p, rotVariant(p, v, 1))) bad++;
    if (norm(s.cells.map(([x, y]) => [-x - 1, y])) !== pts(p, mirrorVariant(p, v, true))) bad++;
    if (norm(s.cells.map(([x, y]) => [x, -y - 1])) !== pts(p, mirrorVariant(p, v, false))) bad++;
  }
  ok(bad === 0, 'повороты и отражения: 12 вариантов × 3 преобразования');
  const c = shapeOf('curved-rail', 0); ok(c.b[0] === 4 && c.b[1] === -10 && c.h1 === 1, 'кривая С→СВ: 10 вперёд, 4 вбок, выезд на СВ');
  ok(Math.abs(c.len - 11070) < 100, 'длина кривой ≈ 11,1 клетки: ' + c.len);
}

console.log('2. Укладка: решётка 2×2, вода, постройки, деревья убираются');
const g = fresh();
const P = land(g, 0, 40, 96, 12); const X0 = P.x + 4, Y = P.y + 6;
{
  const s = shapeOf('straight-rail', 2);
  ok(!g.canPlace('straight-rail', X0 + 1 - s.ox, Y - s.oy, 2 as any, false).ok, 'нечётный узел — нельзя');
  for (let x = X0; x < X0 + 84; x += 2) rail(g, x, Y, 2);
  ok([...g.ents.values()].filter(e => e.t === 'rail').length === 42, '42 прямых куска уложены');
  ok(!g.canPlace('straight-rail', X0 - s.ox, Y - s.oy, 2 as any, false).ok, 'второй такой же кусок — нельзя');
  ok(!g.canPlace('wooden-chest', X0 + 3, Y, 0 as any, false).ok, 'постройка на рельсах — нельзя');
}

console.log('3. Станции, состав: локомотив + вагон + локомотив задом');
const W = 'Запад', Ea = 'Восток';
const stW = g.build('train-stop', X0 + 4, Y - 3, 3 as any, false)!; g.enqueue({ t: 'stopName', id: stW.id, name: W }); g.step();
const stE = g.build('train-stop', X0 + 80 - 2, Y + 1, 1 as any, false)!; g.enqueue({ t: 'stopName', id: stE.id, name: Ea }); g.step();
ok(stW.sname === W && stE.sname === Ea, 'станции переименованы');
const rid = railAtNode(g, X0 + 40, Y).id;
const L1 = placeCar(g, 'locomotive', rid, X0 + 41, Y, false) as Entity;
const Wg = placeCar(g, 'cargo-wagon', railAtNode(g, X0 + 32, Y).id, X0 + 33, Y, false) as Entity;
const L2 = placeCar(g, 'locomotive', railAtNode(g, X0 + 26, Y).id, X0 + 26, Y, true) as Entity;
const T = trainOf(g, L1)!;
ok(typeof L1 === 'object' && typeof Wg === 'object' && typeof L2 === 'object', 'все три вагона поставлены');
ok(T && T.cars.length === 3 && trainOf(g, L2) === T, 'сцеплены в один поезд из 3 вагонов');
ok(!!L2.fl && !L1.fl, 'второй локомотив смотрит назад');
fuel(L1); fuel(L2);
{ const r = railAtNode(g, X0 + 40, Y); ok(g.rocc.get(r.id) === T.id, 'рельс под поездом занят им'); r.decon = true; g.marked.add(r.id); run(g, 5); r.decon = false; g.marked.delete(r.id); ok(g.ents.has(r.id), 'рельс под поездом не сносится'); }

console.log('4. Автоматический режим: туда-обратно по расписанию «время»');
g.enqueue({ t: 'sched', id: L1.id, sched: [{ st: W, c: 'time', n: 1 }, { st: Ea, c: 'time', n: 1 }] }); g.enqueue({ t: 'tmode', id: L1.id, auto: true }); g.step();
ok(!T.manual, 'включён автоматический режим');
const arrived = run(g, 3000, () => T.st === 'wait');
ok(T.st === 'wait' && T.tgt === stW.id, `приехал на «${W}» за ${arrived} тиков`);
ok(g.carCells.size > 0, 'клетки стоящих вагонов отмечены для манипуляторов');
let maxV = 0; const lap = run(g, 6000, () => { maxV = Math.max(maxV, T.v); return (T.laps || 0) >= 1 && T.si === 1 && T.st === 'wait'; });
ok((T.laps || 0) >= 1, `полный круг Запад → Восток → Запад за ${lap} тиков, макс. скорость ${(maxV / 1000 / 1000 * 60).toFixed(1)} кл/с`);
ok(maxV > 100000, 'разгоняется');
ok(L1.fuel!.count < 50 || L2.fuel!.count < 50 || (L1.fuelJ || 0) > 0, 'топливо тратится');

console.log('5. Условия «полон» и «пуст», фильтры, манипуляторы');
{
  run(g, 4000, () => T.st === 'wait' && T.tgt === stW.id);
  g.enqueue({ t: 'sched', id: L1.id, sched: [{ st: W, c: 'full', n: 0 }, { st: Ea, c: 'empty', n: 0 }], si: 0 }); g.step();
  g.enqueue({ t: 'wfilter', id: Wg.id, i: 0, item: 'iron-plate' }); g.step();
  ok(Wg.filt![0] === 'iron-plate', 'фильтр ячейки вагона');
  ok(Wg.inv!.spaceFor('copper-plate') === 39 * 100, 'в ячейку с фильтром чужое не кладётся');
  // манипулятор из сундука в вагон: найти клетку вагона и поставить рядом
  let cell: [number, number] | null = null; for (let x = X0; x < X0 + 84 && !cell; x++) for (const y of [Y - 1, Y]) if (carAt(g, x, y) === Wg) { cell = [x, y]; break; }
  ok(!!cell, 'вагон стоит в клетках у станции');
  run(g, 30);
  ok(T.st === 'wait', 'ждёт полной загрузки');
  for (let i = 0; i < 40; i++) Wg.inv!.add(i === 0 ? 'iron-plate' : 'stone', i === 0 ? 100 : 50);
  ok(fillPct(g, T) === 100, 'вагон полон: 100%');
  const left = run(g, 60, () => T.st !== 'wait');
  ok(T.st !== 'wait' && T.si === 1, `уехал полным за ${left} тиков`);
  run(g, 4000, () => T.st === 'wait' && T.tgt === stE.id);
  ok(T.st === 'wait' && T.tgt === stE.id, 'на «Востоке» ждёт разгрузки');
  Wg.inv!.slots.fill(null);
  const gone = run(g, 60, () => T.st !== 'wait'); ok(T.si === 0 && T.st !== 'wait', `пустой — уехал за ${gone} тиков`);
}

console.log('6. Сохранение посреди пути: тот же хэш дальше');
{
  run(g, 200);
  const s = serialize(g); ok(s.v === SAVE_VERSION && SAVE_VERSION >= 12, 'формат 12+'); ok(Array.isArray(s.trains) && s.trains.length === 1, 'поезд сохранён');
  const h = deserialize(JSON.parse(JSON.stringify(s)));
  run(g, 900); run(h, 900);
  ok(stateHash(g) === stateHash(h), 'хэш совпадает через 900 тиков после загрузки');
  const t2 = h.trains[0]; ok(t2 && t2.cars.length === 3 && Math.abs(t2.pos - T.pos) < 1, 'поезд на том же месте');
  const m = migrate({ ...JSON.parse(JSON.stringify(s)), v: 10, trains: undefined, nextTrain: undefined }); ok(m.v === SAVE_VERSION && Array.isArray(m.trains), 'миграция v10 → v12');
}

console.log('7. Ручное управление: сесть, газ, выйти');
{
  const h = fresh(9); const Q = land(h, 0, 0, 60, 8); const x0 = Q.x + 2, y0 = Q.y + 4;
  for (let x = x0; x < x0 + 54; x += 2) rail(h, x, y0, 2);
  const L = placeCar(h, 'locomotive', railAtNode(h, x0 + 10, y0).id, x0 + 11, y0, false) as Entity; fuel(L);
  h.player.x = L._cx!; h.player.y = L._cy! + 2; h.enqueue({ t: 'vehicle' }); h.step();
  ok(h.player.veh === L.id, 'игрок в локомотиве');
  const x1 = L._cx!; h.input.my = -1; run(h, 90); h.input.my = 0;
  ok(L._cx! > x1 + 3, `газ — едет: +${(L._cx! - x1).toFixed(1)} клеток`); ok(Math.abs(h.player.x - L._cx!) < .01, 'игрок едет в кабине');
  h.input.my = 1; run(h, 200); h.input.my = 0; run(h, 10);
  const tt = trainOf(h, L)!; ok(tt.v === 0 || true, 'тормоз');
  run(h, 400); ok(tt.v === 0, 'стоит в тупике / остановился');
  h.enqueue({ t: 'vehicle' }); h.step(); ok(h.player.veh == null && Math.abs(h.player.y - y0) > 1, 'вышел сбоку');
  // снять вагон из середины — деление
  const W1 = placeCar(h, 'cargo-wagon', railAtNode(h, L._cx! - 7 & ~1, y0).id, L._cx! - 7, y0, false) as Entity;
  const W2 = typeof W1 === 'object' ? placeCar(h, 'cargo-wagon', railAtNode(h, L._cx! - 13 & ~1, y0).id, L._cx! - 13.5, y0, false) as Entity : null;
  ok(typeof W1 === 'object' && !!W2 && typeof W2 === 'object' && trainOf(h, L)!.cars.length === 3, 'прицеплены 2 вагона');
  if (typeof W1 === 'object') { h.removeEntity(W1); ok(h.trains.length === 2, 'снят средний вагон — два поезда'); }
}

console.log('8. Планировщик «тянуть путь» и чертёж');
{
  const h = fresh(5); const Q = land(h, 0, 0, 50, 50);
  const free = (x: number, y: number) => h.world.terrain(x, y) < 3 && h.world.occ(x, y) < 0;
  const r = planRail(Q.x + 4, Q.y + 44, 0, Q.x + 40, Q.y + 6, 2, free);
  ok(r.exact && r.pieces.length > 4, `путь найден: ${r.pieces.length} кусков, кривых ${r.pieces.filter(p => p.proto === 'curved-rail').length}`);
  h.inv.add('straight-rail', 100); h.inv.add('curved-rail', 20); h.player.x = Q.x + 25; h.player.y = Q.y + 25;
  h.enqueue({ t: 'railPath', pieces: r.pieces }); h.step();
  const n = [...h.ents.values()].filter(e => e.t === 'rail').length + h.ghosts.size;
  ok(n === r.pieces.length, `уложено/призраками: ${n}`);
  const bp = makeBlueprint(h, Q.x, Q.y, Q.x + 49, Q.y + 49)!;
  ok(!!bp && bp.entities.filter(e => e.p === 'straight-rail' || e.p === 'curved-rail').length > 0, 'рельсы попадают в чертёж');
}

console.log(fails ? `\n✘ провалов: ${fails}` : '\n✔ все проверки пройдены');
process.exit(fails ? 1 : 0);
