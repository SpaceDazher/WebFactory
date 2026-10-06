// v1.8 «Железная дорога II»: блоки и светофоры (обычные и проходные), очередь и лимит станций, составные условия расписания
// (И/ИЛИ, груз, сигнал сети), включение и лимит станции по сети, чтение станции, цистерна и насос, топливо на ходу,
// урон поездам и рельсам, сохранение с резервами блоков, детерминизм, 100 кругов с рудой по условию «груз».
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { graph, carAt, FWAGON_CAP, Train, trainOf } from '../src/sim/trains';
import { sigValue } from '../src/sim/circuits';
import { makeBlueprint, rotateBp, flipBp } from '../src/sim/blueprint';
import { flat, lay, straight, signal, train, station, run, minGap, ok, fails } from './railkit';

/** петля: верх 0..80 на восток, низ 80..0 на запад; станции A (верх) и B (низ); 4 светофора */
function loop(seed = 7, sig = true) {
  const g = flat(seed);
  straight(g, 0, 0, 2, 40); lay(g, 80, 0, 2, 80, 40, 6); straight(g, 80, 40, 6, 40); lay(g, 0, 40, 6, 0, 0, 2);
  const sigs = sig ? [signal(g, 40, 0, 2), signal(g, 40, 40, 6), signal(g, 70, 0, 2), signal(g, 10, 40, 6)] : [];
  const A = station(g, 58, 1, 1, 'A'), B = station(g, 18, 37, 3, 'B');
  return { g, A, B, sigs };
}
const auto = (g: Game, t: Train, sched: any[]) => { g.enqueue({ t: 'sched', id: t.cars[0], sched }); g.enqueue({ t: 'tmode', id: t.cars[0], auto: true }); g.step(); };
const T2 = (g: Game) => train(g, [['locomotive', 60, 40, true], ['cargo-wagon', 67, 40, true]]);

console.log('1. Блоки: светофоры делят путь, ставятся только у узла справа по ходу');
{
  const { g, sigs } = loop(7, false);
  ok(graph(g).nblk === 1, 'петля без светофоров — один блок');
  ok(!g.canPlace('rail-signal', 41, 3, 2, false).ok, 'вдали от узла — нельзя');
  for (const [x, y, h] of [[40, 0, 2], [40, 40, 6], [70, 0, 2], [10, 40, 6]]) sigs.push(signal(g, x, y, h));
  ok(sigs.every(s => !!s), '4 светофора поставлены');
  ok(graph(g).nblk === 4, `4 светофора — 4 блока (${graph(g).nblk})`);
  g.removeEntity(sigs[3]!, false); ok(graph(g).nblk === 3, 'светофор снят — блоки слились');
  const c = signal(g, 10, 40, 6, true); ok(!!c && c.proto === 'rail-chain-signal' && graph(g).nblk === 4, 'проходной светофор тоже делит блоки');
  const bp = makeBlueprint(g, 30, -4, 50, 4)!; ok(!!bp && bp.entities.some(e => e.p === 'rail-signal'), 'светофор попадает в чертёж');
  const r = rotateBp(rotateBp(rotateBp(rotateBp(bp)))); ok(JSON.stringify(r.entities) === JSON.stringify(bp.entities), 'чертёж: 4 поворота — исходное');
  const f = flipBp(flipBp(bp, true), true); ok(JSON.stringify(f.entities.map(e => [e.p, e.x, e.y, e.d]).sort()) === JSON.stringify(bp.entities.map(e => [e.p, e.x, e.y, e.d]).sort()), 'чертёж: двойное отражение — исходное');
}

console.log('2. Два поезда на петле: светофоры держат дистанцию');
{
  const { g, sigs } = loop();
  const t1 = train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]), t2 = T2(g);
  for (const t of [t1, t2]) auto(g, t, [{ st: 'A', c: 'time', n: 1 }, { st: 'B', c: 'time', n: 1 }]);
  let mg = Infinity, red = 0;
  for (let i = 0; i < 30000; i++) { g.step(); if (i % 10 === 0) { mg = Math.min(mg, minGap(g)); if (sigs.some(s => s!.ss === 2)) red++; } }
  ok((t1.laps || 0) >= 4 && (t2.laps || 0) >= 4, `кругов: ${t1.laps} и ${t2.laps}`);
  ok(mg > 7, `поезда не сближаются: минимум ${mg.toFixed(1)} клетки`);
  ok(red > 0, 'светофор горит красным, когда блок занят');
}

console.log('3. Очередь и лимит станции: лимит 2, третий поезд ждёт «нет места»');
{
  const { g, A } = loop();
  const ts = [train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]), T2(g), train(g, [['locomotive', 30, 40, true], ['cargo-wagon', 37, 40, true]])];
  g.enqueue({ t: 'stopLimit', id: A.id, lim: 2 }); g.step(); ok(A.tlim === 2, 'лимит станции A = 2');
  for (const t of ts) auto(g, t, [{ st: 'A', c: 'time', n: 5 }, { st: 'B', c: 'time', n: 1 }]);
  let full = 0, maxTo = 0, mg = Infinity, sw = 0;
  for (let i = 0; i < 30000; i++) { g.step(); if (i % 10 === 0) { const n = g.trains.filter(t => t.tgt === A.id && !t.manual).length; maxTo = Math.max(maxTo, n); if (g.trains.some(t => t.st === 'full')) full++; if (g.trains.some(t => t.st === 'signal')) sw++; mg = Math.min(mg, minGap(g)); } }
  ok(maxTo <= 2, `к станции A едет не больше двух поездов (${maxTo})`);
  ok(sw > 0, `поезда ждали у красного светофора (${sw} проверок)`);
  ok(full > 0, 'поезда ждут состояние «нет места на станции»');
  ok(ts.every(t => (t.laps || 0) >= 2), 'все три поезда ездят: ' + ts.map(t => t.laps).join(', '));
  ok(mg > 7, `без столкновений (${mg.toFixed(1)})`);
}

console.log('4. Составные условия: И / ИЛИ, груз, сигнал сети станции');
{
  const { g, A } = loop(); const t = train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]); const W = g.ents.get(t.cars[1])!;
  auto(g, t, [{ st: 'A', c: 'item', it: 'iron-plate', op: '>', n: 99, x: [{ c: 'time', n: 3, j: 0 }] }, { st: 'B', c: 'time', n: 1 }]);
  run(g, 4000, () => t.st === 'wait' && t.tgt === A.id); ok(t.st === 'wait', 'стоит на A');
  W.inv!.add('iron-plate', 50); run(g, 400); ok(t.st === 'wait', '50 пластин < 100 — ждёт');
  W.inv!.add('iron-plate', 60); const left = run(g, 400, () => t.st !== 'wait'); ok(t.st !== 'wait', `110 пластин И прошло 3 с — уехал (${left} тиков)`);
  // ИЛИ: «пуст» ИЛИ «время 2 с» — с грузом уезжает по времени
  g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: 'A', c: 'empty', n: 0, x: [{ c: 'time', n: 2, j: 1 }] }, { st: 'B', c: 'time', n: 1 }], si: 0 }); g.step();
  run(g, 6000, () => t.st === 'wait' && t.tgt === A.id); const w0 = g.tick; run(g, 400, () => t.st !== 'wait');
  ok(t.st !== 'wait' && g.tick - w0 >= 110 && g.tick - w0 <= 140, `ИЛИ: уехал по времени через ${g.tick - w0} тиков`);
  // сигнал сети: постоянный комбинатор у станции, условие «A > 3»
  const k = g.build('constant-combinator', 61, 2, 0, false)!; g.inv.add('red-wire', 1); g.enqueue({ t: 'cwire', a: k.id, b: A.id, c: 0 }); g.step();
  g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-A', n: 2 }] } }); g.step();
  g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: 'A', c: 'circuit', n: 0, cs: { a: 'signal-A', op: '>', n: 3 } }, { st: 'B', c: 'time', n: 1 }], si: 0 }); g.step();
  run(g, 6000, () => t.st === 'wait' && t.tgt === A.id); run(g, 300); ok(t.st === 'wait', 'A = 2 — ждёт');
  g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-A', n: 5 }] } }); run(g, 60, () => t.st !== 'wait'); ok(t.st !== 'wait', 'A = 5 — уехал');
  // чтение станции: содержимое поезда (1) и сигнал C (2)
  g.enqueue({ t: 'cset', id: A.id, cc: { rd: 3 } }); g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: 'A', c: 'time', n: 30 }, { st: 'B', c: 'time', n: 1 }], si: 0 }); g.step();
  run(g, 3000, () => t.st === 'wait' && t.tgt === A.id); run(g, 3);
  ok(sigValue(g, k, 'iron-plate') === 110, `станция выдаёт груз поезда: ${sigValue(g, k, 'iron-plate')}`);
  ok(sigValue(g, k, 'signal-C') === 1, 'сигнал C — поездов едет сюда: 1');
  // включение станции по сети: A выключена, пока нет сигнала B
  g.enqueue({ t: 'cset', id: A.id, cc: { en: { a: 'signal-B', op: '>', n: 0 } } }); g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: 'B', c: 'time', n: 1 }, { st: 'A', c: 'time', n: 1 }], si: 0 }); g.step();
  run(g, 4000, () => t.st === 'full'); ok(t.st === 'full' && !!A.coff, 'станция выключена сетью — поезд ждёт «нет места»');
  g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-B', n: 1 }] } }); run(g, 4000, () => t.st === 'wait' && t.tgt === A.id); ok(t.st === 'wait' && t.tgt === A.id, 'сигнал B — станция включилась, поезд приехал');
  // лимит по сигналу L
  g.enqueue({ t: 'cset', id: A.id, cc: { lim: true } }); g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-L', n: 0 }] } }); g.step(); g.step();
  run(g, 4000, () => t.st === 'full'); ok(t.st === 'full', 'L = 0 — станция закрыта лимитом');
  g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-L', n: 1 }] } }); run(g, 4000, () => t.tgt === A.id && t.st === 'wait'); ok(t.tgt === A.id, 'L = 1 — поезд поехал');
}

console.log('5. Цистерна и насос: налив на A, слив на B');
{
  const { g, A, B } = loop(); const t = train(g, [['locomotive', 20, 0], ['fluid-wagon', 13, 0]]); const F = g.ents.get(t.cars[1])!;
  auto(g, t, [{ st: 'A', c: 'full', n: 0 }, { st: 'B', c: 'empty', n: 0 }]);
  run(g, 4000, () => t.st === 'wait' && t.tgt === A.id); ok(t.st === 'wait', 'цистерна у A');
  let cx = -1; for (let x = 30; x < 60 && cx < 0; x++) if (carAt(g, x, 0) === F) cx = x;
  ok(cx > 0, 'клетка цистерны найдена: ' + cx);
  const P = g.build('train-pump', cx, 1, 0, false)!, Tk = g.build('storage-tank', cx - 1, 2, 0, false)!;
  run(g, 2); const n = g.fluidNets[Tk._fn![0]]; n.fluid = 'water'; n.amount = n.cap;
  const filled = run(g, 3000, () => t.st !== 'wait'); ok(t.st !== 'wait' && Math.round(F.tn!) === FWAGON_CAP && F.tf === 'water', `залита полностью (${Math.round(F.tn!)}) за ${filled} тиков`);
  run(g, 4000, () => t.st === 'wait' && t.tgt === B.id); let bx = -1; for (let x = 0; x < 40 && bx < 0; x++) if (carAt(g, x, 39) === F) bx = x;
  ok(bx >= 0, 'цистерна у B: ' + bx);
  const P2 = g.build('train-pump', bx, 38, 2, false)!; const Tk2 = g.build('storage-tank', bx - 1, 35, 0, false)!; g.enqueue({ t: 'tpmode', id: P2.id, m: 1 }); g.step();
  const drained = run(g, 3000, () => t.st !== 'wait'); const n2 = g.fluidNets[Tk2._fn![0]];
  ok(t.st !== 'wait' && !F.tn && Math.round(n2.amount) >= 24000, `слита в цистерну (${Math.round(n2.amount)}) за ${drained} тиков`);
  void P;
}

console.log('6. Топливо тратится и на ходу (не только при разгоне); урон поездам и рельсам');
{
  const g = flat(); straight(g, 0, 0, 2, 500); station(g, 996, 1, 1, 'Конец');
  const t = train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]); const L = g.ents.get(t.cars[0])!;
  auto(g, t, [{ st: 'Конец', c: 'time', n: 1 }]);
  const E = () => (L.fuel ? L.fuel.count : 0) * 4e6 + (L.fuelJ || 0);
  let cruise = 0, burnt = 0, vmax = 0; for (let i = 0; i < 6000 && t.st !== 'wait'; i++) { const v0 = t.v, e0 = E(); g.step(); if (t.v === v0 && v0 > 0) { cruise++; burnt += e0 - E(); } vmax = Math.max(vmax, t.v); }
  ok(cruise > 30 && burnt > 0, `на постоянной скорости ${cruise} тиков, сожжено ${(burnt / 1e6).toFixed(2)} МДж`);
  // урон: рельс под поездом не разрушается, вагон — разрушается (поезд делится/уменьшается)
  const r = [...g.ents.values()].find(e => e.t === 'rail' && g.rocc.get(e.id) === t.id)!;
  g.damage(r, 1e6, true); ok(g.ents.has(r.id) && r.hp === 1, 'рельс под поездом держится (1 ед. прочности)');
  const Wg = g.ents.get(t.cars[1])!; g.damage(Wg, 1e6, true); ok(!g.ents.has(Wg.id) && trainOf(g, L)!.cars.length === 1, 'вагон разрушен Роем — поезд из одного локомотива');
}

console.log('7. Сохранение посреди пути с резервами блоков: тот же хэш дальше');
{
  const { g } = loop(); const ts = [train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]), T2(g)];
  for (const t of ts) auto(g, t, [{ st: 'A', c: 'time', n: 1 }, { st: 'B', c: 'time', n: 1 }]);
  run(g, 500, () => g.bres.size > 0); run(g, 3);
  const s = serialize(g); ok(s.trains.some((t: any) => t.res && t.res.length) || g.bres.size === 0, 'резервы в сохранении');
  const h = deserialize(JSON.parse(JSON.stringify(s))); ok(h.bres.size === g.bres.size, `резервы восстановлены: ${h.bres.size}`);
  run(g, 3000); run(h, 3000); ok(stateHash(g) === stateHash(h), 'хэш совпадает через 3000 тиков');
}

console.log('8. Детерминизм: 6 поездов, две независимые партии');
{
  const mk = () => { const { g } = loop(11); const ts = [train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]), T2(g), train(g, [['locomotive', 30, 40, true], ['cargo-wagon', 37, 40, true]])];
    for (const t of ts) auto(g, t, [{ st: 'A', c: 'time', n: 2 }, { st: 'B', c: 'idle', n: 1 }]); return g; };
  const a = mk(), b = mk(); run(a, 8000); run(b, 8000); ok(stateHash(a) === stateHash(b), 'хэши совпадают');
}

console.log('9. 100 кругов с рудой: сундук → манипулятор → вагон, условие «груз ≥ 50», разгрузка на B');
{
  const { g, A, B } = loop(); const t = train(g, [['locomotive', 20, 0], ['cargo-wagon', 13, 0]]); const W = g.ents.get(t.cars[1])!;
  auto(g, t, [{ st: 'A', c: 'item', it: 'iron-ore', op: '>', n: 49 }, { st: 'B', c: 'empty', n: 0 }]);
  run(g, 4000, () => t.st === 'wait' && t.tgt === A.id);
  let ax = -1; for (let x = 30; x < 60 && ax < 0; x++) if (carAt(g, x, 0) === W) ax = x;
  const ins = g.build('fast-inserter', ax + 2, 1, 0, false)!, src = g.build('iron-chest', ax + 2, 2, 0, false)!; void ins; src.inv!.add('iron-ore', 200);
  run(g, 6000, () => t.st === 'wait' && t.tgt === B.id); let bx = -1; for (let x = 0; x < 40 && bx < 0; x++) if (carAt(g, x, 39) === W) bx = x;
  ok(bx > 0, 'вагон у B, клетка ' + bx);
  const ins2 = g.build('fast-inserter', bx + 2, 38, 0, false)!, dst = g.build('iron-chest', bx + 2, 37, 0, false)!; void ins2;
  const laps0 = t.laps || 0; let got = 0;
  for (let i = 0; i < 600000 && (t.laps || 0) - laps0 < 100; i++) { if (src.inv!.count('iron-ore') < 100) src.inv!.add('iron-ore', 100); const Lc = g.ents.get(t.cars[0])!; if (!Lc.fuel || Lc.fuel.count < 5) Lc.fuel = { item: 'coal', count: 50 }; g.step(); if (i % 600 === 0) { const n = dst.inv!.count('iron-ore'); if (n) { dst.inv!.remove('iron-ore', n); got += n; } } }
  got += dst.inv!.count('iron-ore');
  ok((t.laps || 0) - laps0 >= 100, `100 кругов за ${g.tick} тиков`);
  ok(got >= 100 * 50 - 50, `привезено руды: ${got}`);
}

console.log(fails ? `\n✘ провалов: ${fails}` : '\n✔ все проверки пройдены');
process.exit(fails ? 1 : 0);
