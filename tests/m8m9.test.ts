// Тесты M8–M9: модули и маяки, аккумуляторы, жидкостные рецепты, ракетная шахта, чертежи,
// призраки, быстрая замена, снос, улучшение, отмена, бесконечные исследования, сохранения v3.
import { Game } from '../src/sim/game';
import { asleep, beltInsert } from '../src/sim/belts';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { makeBlueprint, rotateBp, flipBp, bpCost } from '../src/sim/blueprint';
import { packStr, unpackStr } from '../src/core/pack';
import { speedMul, energyMul, prodBonus } from '../src/sim/modules';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { ITEMS } from '../src/data/items';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const run = (g: Game, sec: number) => { for (let i = 0; i < sec * 60; i++) g.step(); };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(x + Math.cos(a / 24 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 24 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
const fresh = () => { const g = new Game(7, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); return g; };

console.log('1. Модули и маяки (8.7)');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 40, 40, 12, 6);
  const a = g.build('assembling-machine-2', A.x, A.y, 0, false)!;
  const b = g.build('assembling-machine-2', A.x + 6, A.y, 0, false)!;
  g.enqueue({ t: 'setRecipe', id: a.id, recipe: 'iron-gear-wheel' }); g.enqueue({ t: 'setRecipe', id: b.id, recipe: 'iron-gear-wheel' }); g.step();
  g.inv.add('speed-module', 2); g.enqueue({ t: 'put', id: a.id, item: 'speed-module', count: 2 }); g.step();
  ok(a.modules!.filter(Boolean).length === 2, 'два модуля скорости в Сборщике 2');
  ok(Math.abs(speedMul(g, a) - 1.4) < 1e-9 && Math.abs(energyMul(g, a) - 2) < 1e-9, `скорость ×${speedMul(g, a).toFixed(2)}, энергия ×${energyMul(g, a).toFixed(2)}`);
  for (const e of [a, b]) { e.input!['iron-plate'] = 400; }
  const keep = () => { for (const e of [a, b]) { e.input!['iron-plate'] = 400; e.output = {}; } };
  let na = 0, nb = 0; for (let i = 0; i < 600; i++) { g.step(); na += a.output!['iron-gear-wheel'] || 0; nb += b.output!['iron-gear-wheel'] || 0; keep(); }
  ok(Math.abs(na / nb - 1.4) < 0.08, `с модулями ${na} шестерней против ${nb} (≈×1.4)`);
  g.inv.add('productivity-module', 2); g.enqueue({ t: 'take', id: b.id, slot: 'module:0' });
  g.enqueue({ t: 'put', id: b.id, item: 'productivity-module', count: 2 }); g.step();
  ok(Math.abs(prodBonus(g, b) - 0.08) < 1e-9 && Math.abs(speedMul(g, b) - 0.9) < 1e-9, `продуктивность +${(prodBonus(g, b) * 100).toFixed(0)}%, скорость ×${speedMul(g, b).toFixed(2)}`);
  nb = 0; let crafts = 0; for (let i = 0; i < 6000; i++) { const pr = b.progress!; g.step(); if (b.progress! < pr) crafts++; nb += b.output!['iron-gear-wheel'] || 0; keep(); }
  ok(nb > crafts && Math.abs(nb / crafts - 1.08) < 0.03, `${crafts} циклов дали ${nb} шестерней (+8%)`);
  // продуктивность не работает на неразрешённом рецепте
  g.enqueue({ t: 'setRecipe', id: b.id, recipe: 'iron-chest' }); g.step();
  ok(prodBonus(g, b) === 0, 'продуктивность не действует на сундук (не промежуточная деталь)');
  // маяк
  const bc = g.build('beacon', A.x + 3, A.y + 3, 0, false)!;
  g.inv.add('speed-module', 2); g.enqueue({ t: 'put', id: bc.id, item: 'speed-module', count: 2 }); run(g, 0.2);
  ok(Math.abs(speedMul(g, a) - 1.6) < 1e-9, `маяк даёт соседу +20% (итого ×${speedMul(g, a).toFixed(2)})`);
  g.inv.add('productivity-module', 1); const before = g.inv.count('productivity-module'); g.enqueue({ t: 'take', id: bc.id, slot: 'module:0' }); g.enqueue({ t: 'put', id: bc.id, item: 'productivity-module', count: 1 }); g.step();
  ok(g.inv.count('productivity-module') === before && !bc.modules!.includes('productivity-module'), 'маяк не принимает продуктивность');
  (g as any).sat = (e: any) => e.t === 'beacon' ? 0 : 1; run(g, 0.1);
  ok(Math.abs(speedMul(g, a) - 1.4) < 1e-9, 'маяк без энергии не действует');
}

console.log('2. Аккумуляторы и порядок генераторов (8.5)');
{
  const g = fresh(); let day = 1; (g as any).daylight = () => day;
  const A = land(g, -40, 40, 16, 8);
  for (let i = 0; i < 4; i++) g.build('solar-panel', A.x + i * 3, A.y, 0, false);
  const acc = g.build('accumulator', A.x, A.y + 4, 0, false)!;
  g.build('big-electric-pole', A.x + 2, A.y + 3, 0, false);
  g.build('substation', A.x + 6, A.y + 3, 0, false);
  const lab = g.build('lab', A.x + 9, A.y + 4, 0, false)!;
  ok(acc._net! >= 0 && lab._net! >= 0 && acc._net === lab._net, 'большая опора и подстанция связали аккумулятор и лабораторию');
  run(g, 10);
  const net = g.powerNets.get(acc._net!)!;
  ok(acc.charge! > 0, `днём излишек солнца заряжает аккумулятор: ${(acc.charge! / 1e6).toFixed(2)} МДж`);
  acc.charge = 5e6; day = 0; lab.active = true;
  (lab as any).input = { 'automation-science-pack': 100 }; g.research.current = 'automation';
  run(g, 5);
  ok(acc.charge! < 5e6 && net.satisfaction > 0.99, `ночью аккумулятор питает сеть: ${(acc.charge! / 1e6).toFixed(2)} МДж, удовлетворение ${(net.satisfaction * 100).toFixed(0)}%`);
  ok(acc.status === 'discharging', 'статус «разряжается»');
}

console.log('3. Жидкостные рецепты в сборщике: электродвигатель на смазке');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 60, -40, 5, 5);
  const a = g.build('assembling-machine-3', A.x, A.y, 0, false)!;
  g.enqueue({ t: 'setRecipe', id: a.id, recipe: 'electric-engine-unit' }); run(g, 0.1);
  const n = g.fluidNetFor(a, 'lubricant', 'in');
  ok(!!n, 'у сборщика 3 появился вход для смазки');
  n!.amount = 100; n!.fluid = 'lubricant';
  a.input = { 'engine-unit': 10, 'electronic-circuit': 20 };
  run(g, 25);
  ok((a.output!['electric-engine-unit'] || 0) >= 2, `сделано электродвигателей: ${a.output!['electric-engine-unit'] || 0}`);
  const a1 = g.build('assembling-machine-1', A.x, A.y + 10, 0, false);
  if (a1) { g.enqueue({ t: 'setRecipe', id: a1.id, recipe: 'electric-engine-unit' }); g.step(); ok(a1.recipe == null, 'Сборщик 1 не умеет рецепты с жидкостью'); }
}

console.log('4. Ракетная шахта и запуск (6.7)');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 0, 90, 10, 10);
  const s = g.build('rocket-silo', A.x, A.y, 0, false)!;
  ok(!!s && s.w === 9, 'шахта 9×9');
  ok(g.insertItem(s, 'low-density-structure', 10, true) > 0 && g.insertItem(s, 'iron-plate', 1, true) === 0, 'принимает только детали ракеты');
  s.input = { 'low-density-structure': 30, 'rocket-fuel': 30, 'processing-unit': 30 };
  run(g, 21);
  ok(s.parts === 1, `деталь ракеты за 20 с: ${s.parts}`);
  s.parts = 99; run(g, 41);
  ok(s.parts === 100 && s.status === 'no-satellite', 'ракета собрана, ждёт спутник');
  ok(g.insertItem(s, 'satellite', 1, true) === 1 && g.insertItem(s, 'satellite', 1, true) === 0, 'спутник — одна штука');
  run(g, 1); ok(s.status === 'launching', 'запуск');
  run(g, 16);
  ok(g.rockets === 1 && s.output!['space-science-pack'] === 1000, `ракет запущено: ${g.rockets}, пакетов «Космос»: ${s.output!['space-science-pack']}`);
  ok(g.checkGoals !== undefined, 'цели: ' + (g.goalIdx));
}

console.log('5. Бесконечные исследования (9.2)');
{
  const g = fresh(); g.research.done.add('rocket-silo');
  ok(g.canResearch('mining-productivity'), 'доступно после ракетной шахты');
  g.enqueue({ t: 'research', tech: 'mining-productivity' }); g.step();
  const c0 = g.techCost('mining-productivity');
  for (let i = 0; i < c0; i++) g.addResearchUnit();
  ok(g.research.levels['mining-productivity'] === 1 && g.research.current === 'mining-productivity', 'уровень 1, исследование продолжается');
  ok(g.techCost('mining-productivity') === c0 * 2, `стоимость растёт линейно (v1.9): ${c0} → ${g.techCost('mining-productivity')}`);
  ok(Math.abs(g.bonus('mining') - 0.1) < 1e-9, 'бонус добычи +10%');
  ok(TECHS['weapon-damage'].packs.includes('space-science-pack'), 'нужна белая наука');
}

console.log('6. Чертежи (12): создание, поворот, строка, вставка, призраки');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 20, -60, 14, 14);
  g.player.x = A.x + 5; g.player.y = A.y + 5;
  for (let i = 0; i < 5; i++) g.build('transport-belt', A.x + i, A.y, 1, false);
  g.build('inserter', A.x + 1, A.y + 1, 2, false);
  const as = g.build('assembling-machine-1', A.x, A.y + 2, 0, false)!;
  g.enqueue({ t: 'setRecipe', id: as.id, recipe: 'iron-gear-wheel' }); g.step();
  const bp = makeBlueprint(g, A.x, A.y, A.x + 4, A.y + 4, 'Тест')!;
  ok(!!bp && bp.entities.length === 7 && bp.w === 5 && bp.h === 5, `в чертеже ${bp.entities.length} построек, ${bp.w}×${bp.h}`);
  ok(bp.entities.some(e => e.recipe === 'iron-gear-wheel'), 'рецепт сохранён');
  const r4 = rotateBp(rotateBp(rotateBp(rotateBp(bp))));
  ok(JSON.stringify(r4.entities.map(e => [e.p, e.x, e.y, e.d]).sort()) === JSON.stringify(bp.entities.map(e => [e.p, e.x, e.y, e.d]).sort()), '4 поворота = исходный');
  const r1 = rotateBp(bp); ok(r1.w === bp.h && r1.entities.find(e => e.p === 'inserter')!.d === 3, 'поворот меняет направления');
  const f2 = flipBp(flipBp(bp, true), true); ok(JSON.stringify(f2.entities) === JSON.stringify(bp.entities), 'двойное отражение = исходный');
  const str = await packStr(bp); const back = await unpackStr(str);
  ok(str[0] === '0' && JSON.stringify(back) === JSON.stringify(bp), `строка чертежа: ${str.length} символов, префикс «0»`);
  ok(bpCost(bp)['transport-belt'] === 5, 'стоимость: 5 конвейеров');
  // вставка с предметами — строится сразу
  const B = { x: A.x, y: A.y + 7 };
  g.inv.add('transport-belt', 5); g.inv.add('inserter', 1); g.inv.add('assembling-machine-1', 1);
  g.enqueue({ t: 'paste', bp, x: B.x, y: B.y }); g.step();
  const nb = g.entAt(B.x + 1, B.y + 3);
  ok(!!nb && nb.proto === 'assembling-machine-1' && nb.recipe === 'iron-gear-wheel', 'вставлено с рецептом');
  ok(g.ghosts.size === 0 && g.inv.count('transport-belt') === 0, 'всё построено из инвентаря');
  // без предметов — призраки, потом автопостройка, когда появились предметы
  const C = land(g, A.x + 30, A.y, 6, 6);
  g.enqueue({ t: 'paste', bp, x: C.x, y: C.y }); g.step();
  ok(g.ghosts.size === 7, `призраков: ${g.ghosts.size}`);
  ok(g.canPlace('wooden-chest', C.x, C.y, 0, false).ok, 'призрак не блокирует постройку');
  g.player.x = C.x + 2; g.player.y = C.y + 6;
  g.inv.add('transport-belt', 5); g.inv.add('inserter', 1); g.inv.add('assembling-machine-1', 1);
  run(g, 3);
  ok(g.ghosts.size === 0 && g.entAt(C.x + 1, C.y + 3)?.recipe === 'iron-gear-wheel', 'инженер сам построил призраки рядом');
  // отмена вставки
  g.player.x = B.x + 2; g.player.y = B.y + 2;
  const before = g.inv.count('transport-belt');
  g.enqueue({ t: 'undo' }); g.enqueue({ t: 'undo' }); g.step();
  ok(g.entAt(B.x, B.y) == null && g.inv.count('transport-belt') >= before + 5, 'Ctrl+Z убрал вставленный чертёж, предметы вернулись');
  g.enqueue({ t: 'redo' }); g.step();
  ok(g.entAt(B.x, B.y)?.proto === 'transport-belt', 'Ctrl+Y вернул');
}

console.log('7. Быстрая замена, планировщики сноса и улучшения (11.4, 12)');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, -60, -60, 10, 8);
  g.player.x = A.x + 4; g.player.y = A.y + 6;
  for (let i = 0; i < 6; i++) g.build('transport-belt', A.x + i, A.y, 1, false);
  const b0 = g.entAt(A.x + 2, A.y)!; b0.lanes![0][0].push({ item: 'iron-plate', pos: 100, n: 1 });
  run(g, 1 / 60); // warm the yellow-belt speed cache before the in-place upgrade
  const beforeUpgrade = b0.lanes![0][0][0].pos;
  g.inv.add('fast-transport-belt', 1);
  g.enqueue({ t: 'build', proto: 'fast-transport-belt', x: A.x + 2, y: A.y, dir: 1 }); g.step();
  const b1 = g.entAt(A.x + 2, A.y)!;
  ok(b1 === b0 && b1.proto === 'fast-transport-belt' && b1.lanes![0][0].length === 1, 'конвейер заменён, предмет остался');
  ok(b1.lanes![0][0][0].pos - beforeUpgrade === 16,
    'upgraded belt uses red speed immediately after cached yellow speed (' + (b1.lanes![0][0][0].pos - beforeUpgrade) + ' units)');
  ok(g.inv.count('transport-belt') === 1, 'старый конвейер вернулся в инвентарь');
  const beforeDowngrade = b1.lanes![0][0][0].pos;
  g.inv.add('transport-belt', 1);
  g.enqueue({ t: 'build', proto: 'transport-belt', x: A.x + 2, y: A.y, dir: 1 }); g.step();
  const b2 = g.entAt(A.x + 2, A.y)!;
  ok(b2 === b0 && b2.proto === 'transport-belt' && b2.lanes![0][0][0].pos - beforeDowngrade === 8,
    'downgraded belt uses yellow speed immediately after cached red speed (' + (b2.lanes![0][0][0].pos - beforeDowngrade) + ' units)');
  b2.lanes![0][0].length = 0;
  run(g, 1 / 60);
  const sleptWithYellowCache = asleep(g, b2);
  g.inv.add('fast-transport-belt', 1);
  g.enqueue({ t: 'build', proto: 'fast-transport-belt', x: A.x + 2, y: A.y, dir: 1 }); g.step();
  const wokeWithRedCache = b2._spd === 16;
  const insertedOnWakingBelt = beltInsert(b2, 0, 0, 'iron-plate', 1, g);
  g.step();
  ok(sleptWithYellowCache && wokeWithRedCache && insertedOnWakingBelt && b2.lanes![0][0][0]?.pos === 144,
    'upgrading a sleeping belt invalidates cached speed before its next insertion');
  const as = g.build('assembling-machine-1', A.x, A.y + 2, 0, false)!;
  g.enqueue({ t: 'setRecipe', id: as.id, recipe: 'copper-cable' }); g.step();
  g.enqueue({ t: 'upgrade', x0: A.x, y0: A.y, x1: A.x + 6, y1: A.y + 5, map: { 'transport-belt': 'fast-transport-belt', 'assembling-machine-1': 'assembling-machine-2' } }); g.step();
  ok(as.upgrade === 'assembling-machine-2' && g.entAt(A.x, A.y)!.upgrade === 'fast-transport-belt', 'помечено к улучшению');
  g.inv.add('assembling-machine-2', 1); g.inv.add('fast-transport-belt', 10);
  run(g, 4);
  ok(as.proto === 'assembling-machine-2' && as.recipe === 'copper-cable' && as.modules?.length === 2, 'Сборщик 1 → 2, рецепт сохранён, появились слоты модулей');
  ok([0, 1, 3, 4, 5].every(i => g.entAt(A.x + i, A.y)!.proto === 'fast-transport-belt'), 'все конвейеры улучшены');
  // снос
  g.enqueue({ t: 'decon', x0: A.x, y0: A.y, x1: A.x + 5, y1: A.y, filter: 'belts' }); g.step();
  ok(g.marked.size === 6 && !as.decon, 'фильтр «только конвейеры»');
  run(g, 4);
  ok(g.entAt(A.x + 3, A.y) == null && g.inv.count('fast-transport-belt') >= 6, 'инженер разобрал помеченное');
  g.enqueue({ t: 'undo' }); g.step();
  ok(g.entAt(A.x + 5, A.y)?.proto === 'fast-transport-belt' || g.ghostAt(A.x + 5, A.y) != null, 'отмена сноса возвращает постройку');
  // ручная постройка → отмена → повтор
  g.inv.add('wooden-chest', 1); const n0 = g.inv.count('wooden-chest');
  g.enqueue({ t: 'build', proto: 'wooden-chest', x: A.x + 8, y: A.y + 4, dir: 0 }); g.step();
  ok(g.entAt(A.x + 8, A.y + 4)?.proto === 'wooden-chest', 'сундук поставлен');
  g.enqueue({ t: 'undo' }); g.step();
  ok(g.entAt(A.x + 8, A.y + 4) == null && g.inv.count('wooden-chest') === n0, 'отмена: сундук убран в инвентарь');
  g.enqueue({ t: 'redo' }); g.step(); ok(g.entAt(A.x + 8, A.y + 4)?.proto === 'wooden-chest', 'повтор');
}

console.log('8. Опоры, радар');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 100, 100, 40, 3);
  const p1 = g.build('big-electric-pole', A.x, A.y, 0, false)!, p2 = g.build('big-electric-pole', A.x + 28, A.y, 0, false)!;
  ok(p1._net === p2._net && g.wires.length === 1, 'большие опоры соединены на 28 клетках');
  const R = land(g, 200, -200, 3, 3); const rd = g.build('radar', R.x, R.y, 0, false)!;
  const c0 = g.world.chunks.size; run(g, 31);
  ok(g.world.chunks.size > c0 && rd.status === 'working', `радар открыл чанков: ${g.world.chunks.size - c0}`);
}

console.log('9. Сохранения v3, миграция v2 → v3, детерминизм');
{
  const g = fresh(); (g as any).sat = () => 1;
  const A = land(g, 30, 30, 8, 8);
  const a = g.build('assembling-machine-2', A.x, A.y, 0, false)!; a.modules = ['speed-module', null];
  g.placeGhost('wooden-chest', A.x + 5, A.y, 0); g.research.levels['lab-speed'] = 2; g.rockets = 3;
  const s = JSON.parse(JSON.stringify(serialize(g)));
  const g2 = deserialize(s);
  ok(g2.ghosts.size === 1 && g2.ghostAt(A.x + 5, A.y) != null, 'призраки сохраняются');
  ok(g2.entAt(A.x, A.y)!.modules![0] === 'speed-module' && g2.rockets === 3 && g2.research.levels['lab-speed'] === 2, 'модули, ракеты и уровни сохраняются');
  ok(stateHash(g) === stateHash(g2), 'хеш до и после загрузки совпадает');
  const old = JSON.parse(JSON.stringify(s)); old.v = 2; delete old.ghosts; delete old.rockets; delete old.treeMarks; delete old.research.levels; for (const o of old.ents) delete o.modules;
  const m = migrate(old); ok(m.v === SAVE_VERSION && m.ents.find((o: any) => o.proto === 'assembling-machine-2').modules.length === 2, 'миграция v2 → v3 → v4 → v5 добавила слоты модулей');
  const play = () => {
    const h = fresh(); const B = land(h, 30, 30, 10, 6); h.player.x = B.x; h.player.y = B.y + 4;
    h.inv.add('transport-belt', 20); h.inv.add('iron-plate', 50);
    for (let i = 0; i < 8; i++) h.enqueue({ t: 'build', proto: 'transport-belt', x: B.x + i, y: B.y, dir: 1 });
    h.enqueue({ t: 'decon', x0: B.x, y0: B.y, x1: B.x + 3, y1: B.y }); run(h, 3); h.enqueue({ t: 'undo' }); run(h, 3);
    return stateHash(h);
  };
  ok(play() === play(), 'детерминизм с чертежами, сносом и отменой');
}
console.log('10. Данные: все рецепты ссылаются на существующие предметы и постройки');
{
  let bad: string[] = [];
  for (const r of Object.values(RECIPES)) for (const [it] of [...r.in, ...r.out]) if (!ITEMS[it]) bad.push(r.id + ':' + it);
  for (const t of Object.values(TECHS)) { for (const u of t.unlocks) if (!RECIPES[u]) bad.push('tech ' + t.id + ':' + u); for (const p of t.prereq) if (!TECHS[p]) bad.push('prereq ' + t.id + ':' + p); }
  for (const it of Object.values(ITEMS)) if (it.place && !PROTOS[it.place]) bad.push('place ' + it.id);
  for (const p of Object.values(PROTOS)) if (p.buildable !== false && !ITEMS[p.id]) bad.push('item ' + p.id);
  ok(bad.length === 0, 'ссылки целы ' + bad.join(', '));
  // каждый рецепт можно где-то сделать
  const cats = new Set<string>(); for (const p of Object.values(PROTOS)) for (const c of p.cats || []) cats.add(c); cats.add('smelting'); cats.add('crafting');
  const orphan = Object.values(RECIPES).filter(r => !cats.has(r.cat)).map(r => r.id);
  ok(orphan.length === 0, 'у всех рецептов есть машина ' + orphan.join(','));
  // каждая технология достижима
  const done = new Set<string>(); let ch = true; while (ch) { ch = false; for (const t of Object.values(TECHS)) if (!done.has(t.id) && t.prereq.every(p => done.has(p))) { done.add(t.id); ch = true; } }
  ok(done.size === Object.keys(TECHS).length, `технологий достижимо: ${done.size}/${Object.keys(TECHS).length}`);
}
console.log(fails ? `\nПровалено: ${fails}` : '\nВсе тесты M8–M9 прошли');
(globalThis as any).process.exit(fails ? 1 : 0);
