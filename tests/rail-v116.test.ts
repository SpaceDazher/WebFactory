// v1.16 rails: parallel preview geometry, isolated placement/undo, and a real bidirectional terminal shuttle.
import { Game } from '../src/sim/game';
import * as Rails from '../src/sim/trains';
import { shapeOf, pointOn } from '../src/sim/railgeo';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { RECIPES } from '../src/data/recipes';
import { T_SHALLOW } from '../src/sim/world';
import { straight as layStraight, signal as placeSignal, station, train as makeTrain } from '../src/sim/railkit';
import { adjustRailSpacing, railCellFree, railPieceKnown, railPreviewTarget } from '../src/client/railui';

let fails = 0;
const ok = (condition: unknown, message: string) => {
  console.log(`${condition ? '  ✔' : '  ✘'} ${message}`);
  if (!condition) fails++;
};
const run = (g: Game, n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    g.step();
    if (until?.()) return i + 1;
  }
  return n;
};
const fresh = (seed = 116) => {
  const g = new Game(seed, true, { enemies: 'none' });
  const world = g.world as any;
  world.terrain = () => 0; world.decor = () => 0; world.res = () => 0; world.walkable = () => true;
  for (const r of Object.values(RECIPES)) g.enabled.add(r.id);
  g.inv.slots.fill(null); (g as any).sat = () => 1;
  for (const t of ['railway', 'automated-rail-transportation', 'rail-signals']) g.research.done.add(t);
  return g;
};
const samples = (pieces: { proto: string; x: number; y: number; dir: number }[]) => {
  const pts: [number, number][] = [];
  for (const pc of pieces) {
    const s = shapeOf(pc.proto, pc.dir), ax = pc.x + s.ox, ay = pc.y + s.oy;
    for (let d = 0; d <= s.len; d += 250) {
      const p = pointOn(s, d); pts.push([ax + p[0], ay + p[1]]);
    }
  }
  return pts;
};
const minGap = (a: [number, number][], b: [number, number][]) => {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
};

console.log('1. Четыре параллельных пути: повороты, допустимая сетка, разделение и предел сегментов');
ok(adjustRailSpacing(1, 4, 0) === 4 && adjustRailSpacing(4, 4, 1) === 8 && adjustRailSpacing(3, 4, 1) === 6,
  'интервал меняется на допустимый шаг: 4 для чётного числа путей, 2 для нечётного');
const farTarget = railPreviewTarget(0, 0, 2400, 400);
const straightLimit = railPreviewTarget(0, 0, 2400, 0);
ok(straightLimit[0] === 1000 && straightLimit[1] === 0 && Math.hypot(farTarget[0], farTarget[1]) <= 1000 && farTarget.every(Number.isInteger) && farTarget.every(v => v % 2 === 0),
  'длинное протягивание ограничено 500 сегментами и остаётся на сетке');
let unknownReads = 0;
const unknownWorld = { hasChunk: () => false, terrain: () => { unknownReads++; return 0; }, occ: () => { unknownReads++; return -1; } };
ok(railCellFree(unknownWorld, 0, 0, 3) && !railPieceKnown(unknownWorld, { proto: 'straight-rail', x: 0, y: 0, dir: 2 }) && !railCellFree(unknownWorld, 65536, 0, 3) && unknownReads === 0,
  'превью не генерирует неизвестные чанки и помечает их сегменты как недоступные');
const parallel = (Rails as any).planParallelRails as undefined | ((...args: any[]) => any);
ok(typeof parallel === 'function', 'есть планировщик 1–4 линий с шагом по сетке');
if (parallel) {
  const g = fresh();
  g.inv.add('straight-rail', 1000); g.inv.add('curved-rail', 200);
  const r = parallel(20, 80, 0, 100, 20, -1,
    (x: number, y: number) => g.world.terrain(x, y) < 3 && g.world.occ(x, y) < 0,
    undefined, { tracks: 4, spacing: 4, budget: 40000, maxPieces: 500 });
  ok(r.exact && r.lanes.length === 4, `все четыре линии доходят до цели (${r.lanes?.map((x: any) => x.pieces.length).join(', ')})`);
  ok(r.spacing === 4 && r.lanes.every((l: any) => l.pieces.length <= 500), 'шаг 4 и предел 500 сегментов соблюдаются');
  const lines = r.lanes.map((l: any) => samples(l.pieces));
  let nearest = Infinity;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) nearest = Math.min(nearest, minGap(lines[i], lines[j]));
  ok(nearest >= 3.75, `оси линий сохраняют минимум 4 клетки и не пересекаются (минимум ${nearest.toFixed(2)})`);
  ok(r.lanes.every((l: any) => l.pieces.some((p: any) => p.proto === 'curved-rail')), 'все дорожки проходят повороты допустимыми кривыми');

  const before = [g.ents.size, g.ghosts.size, g.inv.count('straight-rail'), g.inv.count('curved-rail')].join('|');
  for (let i = 0; i < 15; i++) parallel(20, 80, 0, 100, 20, -1,
    () => true, undefined, { tracks: 4, spacing: 4, budget: 40000, maxPieces: 500 });
  const after = [g.ents.size, g.ghosts.size, g.inv.count('straight-rail'), g.inv.count('curved-rail')].join('|');
  ok(after === before, 'расчёт превью и его отмена не расходуют предметы и не меняют мир');
}

console.log('1b. Бюджет превью: четыре линии по 500 сегментов укладываются в p95 50 мс');
if (parallel) {
  const g = fresh(1162), chunkCount = g.world.chunks.size, timings: number[] = []; let allExact = true;
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    const r = parallel(0, 0, 2, 1000, 0, 2, (x: number, y: number) => railCellFree(g.world, x, y, T_SHALLOW), undefined,
      { tracks: 4, spacing: 4, budget: 40000, maxPieces: 500 });
    timings.push(performance.now() - t0);
    allExact &&= r.exact && r.lanes.length === 4 && r.lanes.every((l: any) => l.pieces.length === 500);
  }
  const ordered = timings.slice().sort((a, b) => a - b), p95 = ordered[Math.ceil(ordered.length * .95) - 1];
  ok(allExact, 'каждая трасса из 500 сегментов рассчитана точно');
  ok(p95 <= 50, `p95 превью ${p95.toFixed(2)} мс (лимит 50 мс)`);
  ok(g.world.chunks.size === chunkCount, 'планировщик не создаёт неизведанные чанки при предпросмотре');
}

console.log('1c. Полный предпросмотр на известных чанках: A* + проверка препятствий/дальности');
if (parallel) {
  const g = fresh(1163), timings: number[] = []; let allValid = true;
  for (let cx = -1; cx <= 32; cx++) for (let cy = -1; cy <= 1; cy++) g.world.getChunk(cx, cy);
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    const r = parallel(0, 0, 2, 1000, 0, 2, (x: number, y: number) => railCellFree(g.world, x, y, T_SHALLOW), undefined,
      { tracks: 4, spacing: 4, budget: 40000, maxPieces: 500 });
    allValid &&= r.exact && r.lanes.length === 4;
    for (const lane of r.lanes) for (const p of lane.pieces) {
      allValid &&= railPieceKnown(g.world, p);
      const c = g.canPlace(p.proto, p.x, p.y, p.dir, false);
      allValid &&= c.ok || c.reason === 'Рельсы уже лежат';
      g.canPlace(p.proto, p.x, p.y, p.dir, true);
    }
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.ceil(timings.length * .95) - 1];
  ok(allValid, 'все четыре трассы проходят obstacle/range preview на известных чанках');
  ok(p95 <= 50, `полный предпросмотр четырёх трасс из 500 сегментов p95 ${p95.toFixed(2)} мс (лимит 50 мс)`);
}

console.log('2. Повторная проверка препятствий Worker и отмена только своего размещения');
{
  const g = fresh(1160); g.railPath([{ proto: 'straight-rail', x: 65536, y: 1, dir: 2 }], false);
  ok(g.ghosts.size === 0 && ![...g.ents.values()].some(e => e.t === 'rail'), 'граница координат отклоняет путь, который нельзя безопасно индексировать');
}
{
  const g = fresh(1160); const chunks = g.world.chunks.size;
  const sparse = Array.from({ length: 257 }, (_, i) => ({ proto: 'straight-rail', x: 30000 + i * 128, y: 30000, dir: 2 }));
  g.railPath(sparse, false);
  ok(g.world.chunks.size === chunks && g.ghosts.size === 0, 'разреженный путь сверх лимита чанков отклоняется без генерации мира');
}
{
  if (parallel) {
    const g = fresh(1161); g.inv.add('straight-rail', 100); g.inv.add('curved-rail', 20);
    const r = parallel(20, 40, 2, 60, 40, 2, () => true, undefined,
      { tracks: 1, spacing: 4, budget: 12000, maxPieces: 500 });
    const pc = r.lanes[0].pieces[Math.floor(r.lanes[0].pieces.length / 2)], sh = shapeOf(pc.proto, pc.dir);
    const blocker = g.build('wooden-chest', pc.x + sh.ox + sh.cells[0][0], pc.y + sh.oy + sh.cells[0][1], 0 as any, false)!;
    g.railPath(r.lanes[0].pieces, false);
    ok(g.ents.has(blocker.id) && ![...g.ents.values()].some(e => e.t === 'rail') && g.ghosts.size === 0 && g.inv.count('straight-rail') === 100 && g.inv.count('curved-rail') === 20,
      'изменившееся препятствие отменяет весь путь до расхода предметов');
  }
}
{
  const g = fresh();
  g.inv.add('straight-rail', 1000); g.inv.add('curved-rail', 200);
  g.player.x = 20; g.player.y = 40;
  const foreign = g.build('wooden-chest', -10, 0, 0 as any, false)!;
  const planner = parallel;
  if (!planner) ok(false, 'план готов к повторной проверке на стороне Game');
  else {
    const r = planner(20, 40, 2, 60, 40, 2, () => true, undefined,
      { tracks: 1, spacing: 4, budget: 12000, maxPieces: 500 });
    const pcs = r.lanes[0].pieces;
    g.railPath(pcs, false);
    const placed = [...g.ents.values()].filter(e => e.t === 'rail');
    const actionCount = placed.length + g.ghosts.size;
    ok(actionCount === pcs.length && placed.length > 0 && g.ghosts.size > 0, 'Worker ставит близкие рельсы и оставляет дальние части призраками');
    const keep = placed[0];
    if (actionCount) {
      g.undo();
      ok(![...g.ents.values()].some(e => e.t === 'rail') && g.ghosts.size === 0 && g.ents.has(foreign.id),
        'отмена удаляет только сегменты этой операции и сохраняет постройку до неё');
      g.redo();
      ok([...g.ents.values()].filter(e => e.t === 'rail').length + g.ghosts.size === actionCount,
        'повтор возвращает только отменённое железнодорожное действие');
    }
  }
}

console.log('2b. Undo рельсов работает по id своей сущности, призрака и после повтора');
if (parallel) {
  const planned = parallel(20, 40, 2, 24, 40, 2, () => true, undefined,
    { tracks: 1, spacing: 4, budget: 12000, maxPieces: 500 });
  const pc = planned.lanes[0].pieces[0];
  const multi = () => {
    const g = fresh(1164); g.addPeer('Второй', '#00ff00');
    for (let i = 0; i < 2; i++) { g.usePl(i); g.player.x = 20; g.player.y = 40; g.inv.add('straight-rail', 100); g.usePl(0); }
    return g;
  };
  const asPlayer = (g: Game, i: number, f: () => void) => { g.usePl(i); try { f(); } finally { g.usePl(0); } };
  const railAt = (g: Game) => [...g.ents.values()].find(e => e.t === 'rail' && e.x === pc.x && e.y === pc.y && e.dir === pc.dir) || null;
  const ghostAt = (g: Game) => [...g.ghosts.values()].find(gh => gh.proto === pc.proto && gh.x === pc.x && gh.y === pc.y && gh.dir === pc.dir) || null;

  {
    const g = multi(); asPlayer(g, 0, () => g.railPath([pc], false)); const original = railAt(g)!;
    g.removeEntity(original, false);
    asPlayer(g, 1, () => g.railPath([pc], false)); const foreign = railAt(g)!;
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ents.has(foreign.id), 'undo первого игрока не удаляет рельс второго игрока, поставленный в ту же клетку');
  }
  {
    const g = multi(); asPlayer(g, 0, () => g.railPath([pc], true)); const original = ghostAt(g)!;
    g.removeGhost(original);
    asPlayer(g, 1, () => g.railPath([pc], true)); const foreign = ghostAt(g)!;
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ghosts.has(foreign.id), 'undo первого игрока не удаляет призрак второго игрока на той же позиции');
  }
  {
    const g = multi(); asPlayer(g, 1, () => g.railPath([pc], false)); const foreign = railAt(g)!;
    asPlayer(g, 0, () => g.undoStack.push([{ k: 'b', proto: pc.proto, x: pc.x, y: pc.y, dir: pc.dir as any }]));
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ents.has(foreign.id), 'старое действие без id не угадывает и не удаляет совпадающий рельс');
  }
  {
    const g = multi(); asPlayer(g, 1, () => g.railPath([pc], true)); const foreign = ghostAt(g)!;
    asPlayer(g, 0, () => g.undoStack.push([{ k: 'b', proto: pc.proto, x: pc.x, y: pc.y, dir: pc.dir as any }]));
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ghosts.has(foreign.id), 'старое действие без id не угадывает и не удаляет совпадающий призрак');
  }
  {
    const g = multi(); asPlayer(g, 0, () => g.railPath([pc], false));
    asPlayer(g, 0, () => g.undo()); asPlayer(g, 0, () => g.redo()); const redone = railAt(g)!;
    g.removeEntity(redone!, false);
    asPlayer(g, 1, () => g.railPath([pc], false)); const foreign = railAt(g)!;
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ents.has(foreign.id), 'повторное undo привязан к новой собственной сущности после redo');
  }
  {
    const g = multi(); asPlayer(g, 0, () => g.railPath([pc], true));
    asPlayer(g, 0, () => g.undo()); asPlayer(g, 0, () => g.inv.remove('straight-rail', g.inv.count('straight-rail')));
    asPlayer(g, 0, () => g.redo()); const redone = ghostAt(g)!;
    g.removeGhost(redone!);
    asPlayer(g, 1, () => g.railPath([pc], true)); const foreign = ghostAt(g)!;
    asPlayer(g, 0, () => g.undo());
    ok(!!foreign && g.ghosts.has(foreign.id), 'повторное undo привязано к новому собственному призраку после redo');
  }
  {
    const g = multi(); asPlayer(g, 1, () => g.railPath([pc], true)); const ghost = ghostAt(g)!;
    asPlayer(g, 0, () => g.build(pc.proto, pc.x, pc.y, pc.dir as any, true)); const replacement = railAt(g)!;
    asPlayer(g, 1, () => g.undo());
    ok(!!ghost && !!replacement && g.ents.has(replacement.id), 'чужая ручная постройка не привязывается к журналу владельца прежнего призрака');
  }
  {
    const g = multi(); asPlayer(g, 0, () => g.railPath([pc], true)); const gh = ghostAt(g)!;
    const e = g.build(pc.proto, pc.x, pc.y, pc.dir as any, false)!;
    asPlayer(g, 0, () => g.undo());
    ok(!!e && !g.ents.has(e.id) && !g.ghosts.has(gh.id), 'undo исходного призрака удаляет именно рельс, построенный роботом из этого призрака');
    const saved = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    saved.world.terrain = () => 0; saved.world.occ = () => -1;
    const savedGh = saved.placeGhost(pc.proto, pc.x, pc.y, pc.dir as any)!;
    const resumed = deserialize(JSON.parse(JSON.stringify(serialize(saved))));
    const resumedGh = resumed.ghosts.get(savedGh.id);
    ok(!!resumedGh && resumedGh.id === savedGh.id && resumedGh.own === 0, 'id и владелец рельсового призрака сохраняются после загрузки');
  }
}
{
  const g = fresh(1165); g.player.x = 0.5; g.player.y = 0.5; g.inv.add('wooden-chest', 3);
  const chest = g.build('wooden-chest', 1, 0, 0 as any, true)!;
  g.undo(); const undoBuild = ![...g.ents.values()].some(e => e.t === 'chest');
  g.redo(); const rebuilt = [...g.ents.values()].find(e => e.t === 'chest')!;
  g.markDecon({ t: 'decon', x0: 1, y0: 0, x1: 1, y1: 0, filter: 'all', trees: false });
  g.undo(); const undoMark = !rebuilt.decon; g.redo(); const redoMark = rebuilt.decon;
  g.removeEntity(rebuilt, true); g.undo(); const undoDelete = [...g.ents.values()].some(e => e.t === 'chest');
  g.redo(); const redoDelete = ![...g.ents.values()].some(e => e.t === 'chest');
  ok(!!chest && undoBuild && undoMark && redoMark && undoDelete && redoDelete, 'обычные undo/redo постройки, сноса и пометки остаются прежними');
}

console.log('3. Двусторонний челнок: 2 локомотива + 8 вагонов + 2 обратных локомотива');
{
  const g = fresh(117);
  layStraight(g, 0, 0, 2, 130);
  station(g, 4, -3, 3, 'West terminal');
  station(g, 258, 1, 1, 'East terminal');
  const signals = [placeSignal(g, 80, 0, 2), placeSignal(g, 80, 0, 6), placeSignal(g, 180, 0, 2), placeSignal(g, 180, 0, 6)];
  ok(signals.every(Boolean) && (Rails as any).graph(g).sig.size === 4, 'оба направления маршрута защищены парными сигналами');
  const types = ['locomotive', 'locomotive', ...Array(8).fill('cargo-wagon'), 'locomotive', 'locomotive'];
  let t: any = null;
  for (let i = 0; i < types.length; i++) {
    const proto = types[i], L = (Rails as any).CAR_LEN[proto] as number;
    let x = 160;
    if (t) {
      const tail = (Rails as any).trailPoint((Rails as any).graph(g), t, (Rails as any).trainLen(g, t));
      x = tail[0] - Math.cos(tail[2]) * (L / 2 + (Rails as any).CAR_GAP) / 1000;
    }
    const rail = (Rails as any).railAt(g, Math.floor(x), 0, x, 0);
    const e = rail && (Rails as any).placeCar(g, proto, rail.id, x, 0, i >= 10);
    if (!e || typeof e === 'string') { ok(false, `вагон ${i + 1} сцепляется с составом: ${e || 'рельса не найдена'}`); break; }
    if (!t) t = (Rails as any).trainOf(g, e);
    else if ((Rails as any).trainOf(g, e) !== t) { ok(false, `вагон ${i + 1} присоединён к одному составу`); break; }
    if (e.t === 'loco') e.fuel = { item: 'coal', count: 100 };
  }
  const cars = t ? t.cars.map((id: number) => g.ents.get(id)!) : [];
  ok(cars.length === 12 && t?.cars.length === 12 && g.trains.length === 1, `12 вагонов сцеплены на прямой линии (${cars.length})`);
  if (t) {
    const protos = t.cars.map((id: number) => g.ents.get(id)?.proto);
    const locos = t.cars.map((id: number) => g.ents.get(id)).filter((e: any) => e?.t === 'loco');
    ok(protos.filter((p: string) => p === 'cargo-wagon').length === 8 && locos.length === 4,
      'состав содержит 8 грузовых вагонов и 4 локомотива');
    const tFirst = locos.filter((e: any) => !e.fl).length, tBack = locos.filter((e: any) => !!e.fl).length;
    ok(tFirst === 2 && tBack === 2, `передняя и задняя тяговые группы ориентированы правильно (${tFirst}+${tBack})`);
    for (const id of t.cars) { const e = g.ents.get(id); if (e?.proto === 'cargo-wagon') e.inv!.add('iron-plate', 25); }
    ok((Rails as any).fillPct(g, t) > 0, 'грузовой инвентарь участвует в состоянии состава');
    g.enqueue({ t: 'sched', id: cars[0].id, sched: [{ st: 'East terminal', c: 'time', n: 1 }, { st: 'West terminal', c: 'time', n: 1 }] });
    g.enqueue({ t: 'tmode', id: cars[0].id, auto: true }); g.step();
    run(g, 100);
    const saved = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    run(saved, 1200); run(g, 1200);
    ok(stateHash(g) === stateHash(saved), 'состав в пути сохраняется и воспроизводится с тем же сетевым хешем');
    const arrived = run(g, 12000, () => t.laps! >= 1 && t.st === 'wait');
    ok(t.laps! >= 1 && t.st === 'wait', `состав доходит до двух терминалов и разворачивает тягу без петли (${arrived} тиков; ${t.st}, пункт ${t.si}, цель ${t.tgt}, круги ${t.laps || 0})`);
    ok(t.cars.slice(0, 2).every((id: number) => g.ents.get(id)?.t === 'loco') && t.cars.slice(-2).every((id: number) => g.ents.get(id)?.t === 'loco'),
      'после разворота локомотивы остаются спереди и сзади состава');
    ok(t.cars.length === 12 && cars.every((e: any) => g.ents.has(e.id)), 'порядок сцепки и груз переживают смену направления');
    ok((Rails as any).fillPct(g, t) > 0, 'груз сохраняется после прибытия на терминал');
  }
}

console.log('4. Ручное управление поездом остаётся привязано к выбранному локомотиву');
{
  const g = fresh(118); layStraight(g, 0, 0, 2, 80);
  const t = makeTrain(g, [['locomotive', 20, 0, false]]), e = g.ents.get(t.cars[0])!;
  g.player.x = e._cx!; g.player.y = e._cy! + 2; g.enqueue({ t: 'vehicle' }); g.step();
  ok(g.player.veh === e.id, 'игрок входит в локомотив');
  const x0 = e._cx!; g.input.my = -1; run(g, 90); g.input.my = 0;
  ok(e._cx! > x0 + 1, 'ручное управление двигает состав по направлению кабины');
}

console.log(fails ? `\n✘ rail-v116 failures: ${fails}` : '\n✔ rail-v116 checks passed');
process.exit(fails ? 1 : 0);
