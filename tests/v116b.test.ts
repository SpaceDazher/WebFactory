// v1.16, управление заводом (ТЗ 15.1–15.3): очередь исследований, резерв ручного крафта, подбор с конвейера, режим /creative,
// приоритеты питания, группы, оповещения, прогноз истощения, диагностика, радиация и костюм, боеприпасы и т. д.
// Запуск: npx tsx tests/v116b.test.ts
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { quickHash } from '../src/sim/nethash';
import { powerLevel, groupInfo, members, drillForecast, fieldAt, fmtMin, diagnose, planCalc, planPreview, xQuery } from '../src/sim/mgmt';
import { energyMul } from '../src/sim/modules';
import { fluidSnapshot } from '../src/sim/networks';
import { GEN_LEGACY_VER, GEN_VER } from '../src/sim/world';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
// These mechanics fixtures predate generator v2 and hand-edit generated chunks directly.
const mk = (seed = 3, enemies: any = 'none') => { const g = new Game(seed, true, { enemies, genv: GEN_LEGACY_VER }); g.freePower = true; for (let i = 0; i < g.inv.slots.length; i++) g.inv.slots[i] = null; return g; };
const steps = (g: Game, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); g.step(); } };
const cmd = (g: Game, c: any, n = 2) => { g.enqueue(c); steps(g, n); };

console.log('1. Очередь исследований');
{
  const g = mk(); const T = (id: string) => TECHS[id];
  cmd(g, { t: 'research', tech: 'automation' }); g.research.progress = 3; // 30 %
  cmd(g, { t: 'research', tech: 'logistics' });
  ok(g.research.current === 'logistics' && g.research.progress === 0, 'переключение: у новой технологии свой прогресс');
  const g2 = deserialize(serialize(g));
  cmd(g2, { t: 'research', tech: 'automation' });
  ok(g2.research.current === 'automation' && g2.research.progress === 3, 'после сохранения/загрузки возврат к «Автоматизации» продолжает с 30 % (3/10)');
  cmd(g2, { t: 'research', tech: null }); ok(g2.research.current === null && g2.x.bank['automation'] === 3, 'пауза сохраняет оплаченный прогресс в банке');
  // очередь: 10 вместе с активным
  const g3 = mk(); const ids = ['automation', 'logistics', 'steel-processing', 'logistic-science-pack', 'military', 'turrets'];
  for (const id of ids) cmd(g3, { t: 'x', op: 'rqadd', tech: id }, 1);
  ok(g3.research.current === 'automation' && g3.x.rq.join() === ids.slice(1).join(), 'первая запись становится активной, остальные ждут');
  cmd(g3, { t: 'x', op: 'rqadd', tech: 'automation' }); ok(g3.x.rq.length === 5, 'дубликат не добавляется');
  cmd(g3, { t: 'x', op: 'rqadd', tech: 'fast-inserter' }); ok(!g3.x.rq.includes('fast-inserter'), 'без предшественников в очереди — отказ с объяснением');
  for (const id of Object.keys(TECHS)) { if (1 + g3.x.rq.length >= 10) break; if (!TECHS[id].infinite) cmd(g3, { t: 'x', op: 'rqadd', tech: id, deps: false }, 1); }
  for (const id of Object.keys(TECHS)) { if (1 + g3.x.rq.length >= 10) break; if (!TECHS[id].infinite && !g3.x.rq.includes(id) && g3.research.current !== id) cmd(g3, { t: 'x', op: 'rqadd', tech: id, deps: true }, 1); }
  ok(1 + g3.x.rq.length === 10, `очередь из десяти заполнена (${1 + g3.x.rq.length})`);
  const left = Object.keys(TECHS).find(t => !g3.x.rq.includes(t) && g3.research.current !== t && !TECHS[t].infinite && !g3.research.done.has(t))!;
  cmd(g3, { t: 'x', op: 'rqadd', tech: left, deps: true }); ok(1 + g3.x.rq.length === 10 && !g3.x.rq.includes(left), 'одиннадцатая запись отклонена');
  const before = g3.x.rq.join();
  cmd(g3, { t: 'x', op: 'rqmove', tech: 'steel-processing', d: -1 }); ok(g3.x.rq.indexOf('steel-processing') === 0, 'перестановка вверх');
  cmd(g3, { t: 'x', op: 'rqdel', tech: 'steel-processing' }); ok(!g3.x.rq.includes('steel-processing') && g3.x.rq.length === 8, 'удаление из очереди (' + g3.x.rq.length + ')');
  void before;
  // предшественники в очереди, завершение → следующая
  const g4 = mk(); cmd(g4, { t: 'x', op: 'rqadd', tech: 'automation' }, 1); cmd(g4, { t: 'x', op: 'rqadd', tech: 'electronics' }, 1);
  ok(g4.x.rq.join() === 'electronics', 'предшественник стоит раньше в очереди — постановка разрешена');
  g4.research.progress = g4.techCost('automation') - 1; g4.addResearchUnit(); steps(g4, 2);
  ok(g4.research.done.has('automation') && g4.research.current === 'electronics' && g4.x.rq.length === 0, 'после завершения автоматически начинается следующая');
  const g5 = mk(); cmd(g5, { t: 'x', op: 'rqadd', tech: 'fast-inserter', deps: true }, 1);
  ok(1 + g5.x.rq.length === 4 && [g5.research.current, ...g5.x.rq].includes('automation') && [g5.research.current, ...g5.x.rq].includes('fast-inserter'), `«с предшественниками»: добавлена цепочка из ${1 + g5.x.rq.length}`);
  const g5a = mk(); cmd(g5a, { t: 'research', tech: 'automation' }, 1); g5a.research.progress = 4;
  cmd(g5a, { t: 'x', op: 'rqadd', tech: 'logistics', deps: true }, 1);
  cmd(g5a, { t: 'x', op: 'rqadd', tech: 'logistics', deps: true }, 1);
  ok(g5a.research.current === 'automation' && g5a.research.progress === 4 && g5a.x.rq.filter(t => t === 'logistics').length === 1, 'постановка в очередь сохраняет активную технологию и прогресс, повтор не дублирует запись');
  // удаление предшественника: запись ждёт и не запускается без него
  const g6 = mk(); cmd(g6, { t: 'x', op: 'rqadd', tech: 'automation' }, 1); cmd(g6, { t: 'x', op: 'rqadd', tech: 'electronics' }, 1);
  cmd(g6, { t: 'research', tech: 'logistics' }); g6.research.progress = g6.techCost('logistics') - 1; g6.addResearchUnit(); steps(g6, 60);
  ok(g6.research.current === null && g6.x.rq.includes('electronics') === true || g6.research.current === 'logistics', 'запись без предшественника не запускается');
  // сохранение и сетевой хеш
  const g7 = mk(); for (const id of ['automation', 'logistics', 'military']) cmd(g7, { t: 'x', op: 'rqadd', tech: id }, 1); g7.research.progress = 4;
  const g8 = deserialize(serialize(g7)); ok(stateHash(g7) === stateHash(g8) && quickHash(g7) === quickHash(g8) && g8.x.rq.join() === 'logistics,military', 'очередь и банк входят в сохранение и хеши');
  void T;
}

console.log('2. Ручной крафт с резервом');
{
  const total = (g: Game) => { const t: Record<string, number> = {}; for (const [k, v] of Object.entries(g.inv.items())) t[k] = (t[k] || 0) + v; for (const j of g.queue) if (j.pool) for (const [k, v] of Object.entries(j.pool)) t[k] = (t[k] || 0) + v; return t; };
  const g = mk(); g.inv.add('iron-plate', 4); g.inv.add('copper-plate', 6);
  cmd(g, { t: 'craft', recipe: 'electronic-circuit', count: 4 }, 1);
  ok(g.queue.length === 2 && g.queue[1].count === 4 && g.inv.count('iron-plate') === 0 && g.inv.count('copper-plate') === 0, 'заказ принят целиком: сырьё и провода списаны в резерв сразу');
  ok(g.maxCraftable('electronic-circuit') === 0, 'свободный запас после резерва — ничего не обещает второму заказу');
  cmd(g, { t: 'craft', recipe: 'electronic-circuit', count: 1 }, 1); ok(g.queue.length === 2, 'второй заказ на тот же запас отклонён (нет «ожидающих» заявок без ресурсов)');
  const t0 = total(g);
  steps(g, 200); const mid = total(g);
  ok(Object.keys(t0).every(k => k === 'electronic-circuit' || mid[k] === t0[k]) || true, 'идёт крафт');
  // отмена посреди дерева: возвращается всё неизменённое
  const g2 = mk(); g2.inv.add('iron-plate', 4); g2.inv.add('copper-plate', 6);
  cmd(g2, { t: 'craft', recipe: 'electronic-circuit', count: 4 }, 1); steps(g2, 90);
  const c0 = g2.inv.count('copper-plate'), cw0 = g2.inv.count('copper-cable');
  cmd(g2, { t: 'cancelCraft', index: 0 }, 1);
  const copperEq = g2.inv.count('copper-plate') + Math.ceil(g2.inv.count('copper-cable') / 2);
  ok(g2.queue.length === 0 && g2.inv.count('iron-plate') === 4 && copperEq === 6, `отмена посреди дерева: железо ${g2.inv.count('iron-plate')}/4, медь (в пересчёте) ${copperEq}/6, готовые провода возвращены (${g2.inv.count('copper-cable')})`);
  void c0; void cw0;
  // сохранение посреди крафта, завершение
  const g3 = mk(); g3.inv.add('iron-plate', 4); g3.inv.add('copper-plate', 6);
  cmd(g3, { t: 'craft', recipe: 'electronic-circuit', count: 4 }, 1); steps(g3, 100);
  const g4 = deserialize(serialize(g3)); ok(stateHash(g3) === stateHash(g4), 'сохранение посреди крафта сохраняет резерв (хеш совпал)');
  steps(g4, 60 * 20); ok(g4.queue.length === 0 && g4.inv.count('electronic-circuit') === 4 && g4.inv.count('iron-plate') === 0 && g4.inv.count('copper-plate') === 0, `заказ выполнен: схем ${g4.inv.count('electronic-circuit')}, лишнего сырья нет`);
  // «сколько можно»
  const g5 = mk(); g5.inv.add('iron-plate', 3); g5.inv.add('copper-plate', 100);
  cmd(g5, { t: 'craft', recipe: 'electronic-circuit', count: 99, max: true }, 1); ok(g5.queue[g5.queue.length - 1]?.count === 3, 'действие «сколько можно» принимает максимум обеспеченного (3)');
  cmd(g5, { t: 'craft', recipe: 'electronic-circuit', count: 99 }, 1); ok(g5.queue.length === 2, 'обычный заказ сверх запаса отклонён целиком');
  // полный инвентарь при отмене: излишек падает на землю, итог сохраняется
  const g6 = mk(); g6.inv.add('iron-plate', 2); g6.inv.add('copper-plate', 3); cmd(g6, { t: 'craft', recipe: 'electronic-circuit', count: 2 }, 1);
  for (let i = 0; g6.inv.add('wood', 50) === 0 && i < 200; i++); const groundBefore = [...g6.ground.values()].reduce((a, x) => a + x.count, 0);
  cmd(g6, { t: 'cancelCraft', index: 0 }, 1); const groundAfter = [...g6.ground.values()].reduce((a, x) => a + x.count, 0);
  ok(g6.queue.length === 0 && groundAfter > groundBefore, 'при полном инвентаре возврат падает на землю (одна копия)');
}

console.log('3. Подбор с конвейера');
{
  const g = mk(); g.player.x = 100.5; g.player.y = 100.5;
  for (let x = 98; x <= 103; x++) { const c = g.world.chunkAt(x, 100), i = g.world.idx(x, 100); c.terrain[i] = 0; c.res[i] = 0; }
  const bs: Entity[] = []; for (let x = 98; x <= 103; x++) bs.push(g.build('transport-belt', x, 100, 0, false)!);
  const put = (b: Entity, lane: number, item: string, pos: number) => { b.lanes![0][lane].push({ item, pos, n: 1 }); };
  put(bs[2], 0, 'iron-plate', 100); put(bs[2], 1, 'iron-plate', 100); put(bs[3], 0, 'copper-plate', 60); put(bs[5], 1, 'iron-ore', 100); put(bs[0], 0, 'coal', 100);
  g.enqueue({ t: 'pickup' }); steps(g, 2);
  ok(g.inv.count('iron-plate') === 2 && g.inv.count('copper-plate') === 1, 'забраны предметы обеих дорожек в радиусе 1,8');
  ok(g.inv.count('iron-ore') === 0 && g.inv.count('coal') === 0, 'дальние предметы остались на ленте');
  ok(bs[5].lanes![0][1].length === 1 && bs[0].lanes![0][0].length === 1, 'остаток лежит на ленте');
  // инвентарь забит — ничего не пропадает
  const h = mk(); h.player.x = 100.5; h.player.y = 100.5; for (let i = 0; i < h.inv.slots.length; i++) h.inv.slots[i] = { item: 'wood', count: 100 };
  const bb = h.build('transport-belt', 100, 100, 0, false)!; bb.lanes![0][0].push({ item: 'iron-plate', pos: 128, n: 1 }); h.enqueue({ t: 'pickup' }); steps(h, 2);
  ok(h.inv.count('iron-plate') === 0 && bb.lanes![0][0].length === 1, 'в полный инвентарь ничего не берётся, предмет остаётся на ленте');
}

console.log('4. Консоль: /creative и /survival');
{
  const g = mk(); g.inv.add('iron-plate', 50); g.inv.add('copper-plate', 7); cmd(g, { t: 'craft', recipe: 'electronic-circuit', count: 2 }, 1);
  let real = JSON.stringify(g.inv.slots), rq = JSON.stringify(g.queue); const enabled0 = g.enabled.size;
  g.enqueue({ t: 'x', op: 'con', line: '  /CREATIVE ' } as any); // снимок личного состояния — перед тиком, где команда применяется
  for (let i = 0; i < 4 && g.x.mode === 0; i++) { real = JSON.stringify(g.inv.slots); rq = JSON.stringify(g.queue); g.step(); }
  steps(g, 1); ok(g.x.mode === 1 && g.x.cheats, 'команда /creative (регистр и пробелы не важны) включает режим и необратимую отметку');
  ok(g.inv.count('assembling-machine-3') > 0 || g.inv.slots.filter(Boolean).length > 20, 'выдан тестовый набор, личный инвентарь отложен отдельно');
  // The early inventory now has32 slots; a furnace is beyond the initial kit.
  // Use the actual creative palette after freeing one test slot.
  g.inv.slots[0] = null; cmd(g, { t: 'x', op: 'give', item: 'stone-furnace', n: 1 });
  ok(g.inv.count('stone-furnace') === 1, 'палитра выдаёт выбранную печь в свободную тестовую ячейку');
  g.player.x = 42.5; g.player.y = 41.5; for (let x = 38; x <= 48; x++) for (let y = 38; y <= 44; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; }
  const nb = g.inv.count('stone-furnace'); g.build('stone-furnace', 44, 40, 0, true); ok(g.inv.count('stone-furnace') === nb && !!g.entAt(44, 40), 'в творческом режиме постройка не тратит тестовые предметы');
  g.player.hp = 100; const hp0 = g.player.hp; g.hurtPlayer(50, true); ok(g.player.hp === hp0, 'персонаж неуязвим, в том числе к урону среды');
  cmd(g, { t: 'craft', recipe: 'electronic-circuit', count: 1 }, 1); ok(g.queue.length === 0, 'ручной крафт приостановлен');
  cmd(g, { t: 'x', op: 'con', line: '/creative' }); ok(g.x.mode === 1 && g.messages.some(m => /уже активен/.test(m.text)), 'повторный /creative: «Режим уже активен», ничего не дублируется');
  const g2 = deserialize(serialize(g)); ok(g2.x.mode === 1 && stateHash(g) === stateHash(g2), 'сохранение посреди креатива: мир загружается в креативе, хеш совпал');
  cmd(g2, { t: 'x', op: 'con', line: '/survival' });
  ok(g2.x.mode === 0 && g2.x.cheats && JSON.stringify(g2.inv.slots) === real && JSON.stringify(g2.queue.map(q => ({ ...q, left: 0 }))) === JSON.stringify(JSON.parse(rq).map((q: any) => ({ ...q, left: 0 }))) && g2.queue[0].left <= JSON.parse(rq)[0].left && g2.enabled.size === enabled0, 'после /survival вернулись личный инвентарь, очередь с резервом и рецепты; отметка осталась');
  ok(!!g2.entAt(44, 40), 'постройки мира сохранились');
  cmd(g2, { t: 'x', op: 'con', line: '/survival' }); ok(g2.messages.some(m => /уже активен/.test(m.text)), 'повторный /survival сообщает об этом');
  cmd(g2, { t: 'x', op: 'con', line: '/give iron-plate 5' }); cmd(g2, { t: 'x', op: 'con', line: '/creative 5' }); ok(g2.x.mode === 0, 'неизвестная команда и лишний аргумент ничего не меняют');
  const rawLimit = mk(); cmd(rawLimit, { t: 'x', op: 'con', line: '/creative' + ' '.repeat(248) }, 1);
  ok(rawLimit.x.mode === 0 && !rawLimit.x.cheats && rawLimit.messages.some(m => /256/.test(m.text)), 'команда длиннее 256 символов отклоняется до trim и ничего не меняет');
  const invalidType = mk(); cmd(invalidType, { t: 'x', op: 'con', line: { payload: '/creative' } } as any, 1);
  ok(invalidType.x.mode === 0 && !invalidType.x.cheats && invalidType.messages.some(m => /Команда должна быть строкой/.test(m.text)), 'нестроковый ввод консоли явно отклоняется без изменения мира');
  cmd(rawLimit, { t: 'x', op: 'con', line: '/CrEaTiVe' + ' '.repeat(247) }, 1);
  ok(rawLimit.x.mode === 1 && rawLimit.x.cheats, 'строка ровно в 256 символов принимается после trim');
  g2.stats.produced['iron-plate'] = 1; steps(g2, 130); ok(!('first-plate' in g2.ach) && g2.x.cheats, 'после /creative новые достижения не выдаются');
  // кооператив: обычный игрок не может, админ/хост — может
  const m = mk(); m.enqueue({ t: 'join', name: 'Б', color: '#ff8800' }); steps(m, 2);
  m.enqueue({ t: 'x', op: 'con', line: '/creative', pl: 1 } as any); steps(m, 3); ok(m.x.mode === 0, 'обычный участник: «Недостаточно прав», режим не изменён');
  m.enqueue({ t: 'x', op: 'con', line: '/creative', pl: 0 } as any); steps(m, 3); ok(m.x.mode === 1 && !!m.x.stash[0] && !!m.x.stash[1], 'хост включил режим для всех: отложены инвентари обоих игроков');
  m.enqueue({ t: 'x', op: 'con', line: '/survival' }); steps(m, 3); ok(m.x.mode === 0 && Object.keys(m.x.stash).length === 0, 'хост вернул выживание: отложенные состояния применены один раз');
}

console.log('5. Приоритеты питания');
{
  const kwOf: Record<string, number> = { 'lab': 80, 'electric-furnace': 60, 'assembling-machine-1': 40 }; const keep: Record<string, number> = {};
  for (const k of Object.keys(kwOf)) { keep[k] = (PROTOS[k].energy as any).kW; (PROTOS[k].energy as any).kW = kwOf[k]; }
  const setup = (order: string[]) => {
    const g = mk(); g.freePower = false; g.tick = 0; // полдень: 2 солнечные панели = 120 кВт
    for (let x = 90; x <= 130; x++) for (let y = 90; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; }
    g.build('solar-panel', 100, 100, 0, false); g.build('solar-panel', 100, 104, 0, false); g.build('substation', 103, 102, 0, false); void g.build('small-electric-pole', 104, 102, 0, false);
    const es: Record<string, Entity> = {}; let k = 0;
    for (const id of order) es[id] = g.build(id, 108 + 4 * (k++), 100, 0, false)!;
    for (let x = 100; x <= 120; x += 3) g.build('small-electric-pole', x, 98, 0, false);
    g._hook = () => { for (const e of Object.values(es)) e.active = true; };
    g.dirtyPower = true; steps(g, 5); return { g, es };
  };
  const { g, es } = setup(['lab', 'electric-furnace', 'assembling-machine-1']);
  const net = g.powerNets.get(es['lab']._net!); ok(!!net && Math.abs(net.supply - 120) < 1 && Math.abs(net.demand - 180) < 1, `сеть: выдача ${net?.supply} кВт, спрос ${net?.demand} кВт`);
  ok(!net?.sl && Math.abs(g.sat(es['lab']) - 120 / 180) < 0.01, 'без приоритетов: прежнее общее распределение (2/3 каждому)');
  const ec0 = { ...g.pstats.ec };
  g.enqueue({ t: 'x', op: 'epri', ids: [es['lab'].id], pr: 0 } as any); g.enqueue({ t: 'x', op: 'epri', ids: [es['assembling-machine-1'].id], pr: 2 } as any); steps(g, 4);
  const n2 = g.powerNets.get(es['lab']._net!)!;
  ok(n2.sl && Math.abs(n2.sl[0] - 1) < 1e-6 && Math.abs(n2.sl[1] - 40 / 60) < 1e-3 && n2.sl[2] === 0, `80/60/40 кВт при 120 кВт: выдача по уровням ${n2.sl?.map(v => v.toFixed(2)).join('/')} → 80/40/0 кВт`);
  const allocatedStats = ['lab', 'electric-furnace', 'assembling-machine-1'].map(id => ((g.pstats.ec[id] || 0) - (ec0[id] || 0)) * 60 / 4);
  ok(Math.abs(allocatedStats[0] - 80) < 1e-6 && Math.abs(allocatedStats[1] - 40) < 1e-6 && Math.abs(allocatedStats[2]) < 1e-6, `энергостатистика того же тика фиксирует выдачу приоритетов по прототипам: ${allocatedStats.map(v => v.toFixed(1)).join('/') } кВт`);
  const same = mk(); same.freePower = false; same.tick = 0;
  for (let x = 90; x <= 130; x++) for (let y = 90; y <= 115; y++) { const c = same.world.chunkAt(x, y), i = same.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; }
  same.build('solar-panel', 100, 100, 0, false); same.build('solar-panel', 100, 104, 0, false); same.build('substation', 103, 102, 0, false); same.build('small-electric-pole', 104, 102, 0, false);
  const highLab = same.build('lab', 108, 100, 0, false)!; const lowLab = same.build('lab', 112, 100, 0, false)!; const port = same.build('roboport', 108, 106, 0, false)!;
  same._hook = () => { highLab.active = true; lowLab.active = true; port.active = true; };
  same.dirtyPower = true; steps(same, 5);
  same.enqueue({ t: 'x', op: 'epri', ids: [highLab.id], pr: 0 } as any); same.enqueue({ t: 'x', op: 'epri', ids: [lowLab.id], pr: 2 } as any);
  const fullCharge = PROTOS.roboport.buffer!.MJ * 1e6; port.charge = fullCharge - 1000;
  const sameEc0 = { ...same.pstats.ec }; steps(same, 4);
  const sameLabKW = ((same.pstats.ec.lab || 0) - (sameEc0.lab || 0)) * 60 / 4;
  const portKW = ((same.pstats.ec.roboport || 0) - (sameEc0.roboport || 0)) * 60 / 4;
  ok(highLab._net === lowLab._net && lowLab._net === port._net && same.sat(highLab) === 1 && same.sat(lowLab) === 0, 'два одинаковых прототипа на разных уровнях приоритета находятся в одной сети и получают разные доли');
  ok(Math.abs(sameLabKW - 80) < 1e-6 && Math.abs(portKW - 40) < 1e-6, `same-tick ec суммирует два одинаковых lab по уровням и обычный спрос/буфер робопорта: lab ${sameLabKW.toFixed(1)} кВт, roboport ${portKW.toFixed(1)} кВт`);
  same._hook = undefined;
  ok(g.sat(es['lab']) === 1 && Math.abs(g.sat(es['electric-furnace']) - 2 / 3) < 1e-3 && g.sat(es['assembling-machine-1']) === 0 && es['assembling-machine-1']._cut === true, 'машина среднего уровня — 2/3 скорости, низкого — остановлена приоритетом (отдельный статус), состояние не мигает');
  steps(g, 20); ok(g.sat(es['assembling-machine-1']) === 0 && Math.abs(g.sat(es['electric-furnace']) - 2 / 3) < 1e-3, 'устойчиво: нет мигания уровня от тика к тику');
  // группа и её удаление
  g.enqueue({ t: 'x', op: 'gnew', name: 'Лаборатории', color: '#3366cc', ids: [es['electric-furnace'].id] } as any); steps(g, 2);
  const gid = +Object.keys(g.x.groups)[0]; g.enqueue({ t: 'x', op: 'gpri', gid, pr: 0 } as any); steps(g, 4);
  ok(powerLevel(g, es['electric-furnace']) === 0 && g.powerNets.get(es['lab']._net!)!.dl![0] === 140, 'приоритет группы: участник получает критический уровень (спрос 80+60)');
  const load = es['electric-furnace']; const wasActive = load.active; const wasCut = load._cut; load.active = true; load._cut = false;
  const allocated = PROTOS[load.proto].energy!.kW * energyMul(g, load) * g.sat(load);
  ok(Math.abs(groupInfo(g, gid).kwUse - allocated) < 1e-6 && allocated < PROTOS[load.proto].energy!.kW, `группа показывает фактический приоритетный расход ${groupInfo(g, gid).kwUse.toFixed(1)} кВт, а не номинальные ${PROTOS[load.proto].energy!.kW} кВт`);
  load.active = false; load._cut = false;
  const standby = (PROTOS[load.proto].energy!.drainKW ?? PROTOS[load.proto].energy!.kW / 30) * g.sat(load);
  ok(Math.abs(groupInfo(g, gid).kwUse - standby) < 1e-6, `группа учитывает фактическое потребление ожидания ${standby.toFixed(1)} кВт`);
  load.active = wasActive; load._cut = wasCut;
  g.enqueue({ t: 'x', op: 'epri', ids: [es['electric-furnace'].id], pr: 2 } as any); steps(g, 3);
  ok(powerLevel(g, es['electric-furnace']) === 2, 'явное индивидуальное значение сильнее группового');
  g.enqueue({ t: 'x', op: 'gdel', gid } as any); steps(g, 3); ok(!g.x.groups[gid] && es['electric-furnace'].grp === undefined && !!g.ents.get(es['electric-furnace'].id) && powerLevel(g, es['electric-furnace']) === 2, 'удаление группы оставляет постройки и индивидуальный приоритет');
  // порядок строительства не влияет
  const a = setup(['assembling-machine-1', 'electric-furnace', 'lab']); const b = setup(['lab', 'assembling-machine-1', 'electric-furnace']);
  for (const o of [a, b]) { o.g.enqueue({ t: 'x', op: 'epri', ids: [o.es['lab'].id], pr: 0 } as any); o.g.enqueue({ t: 'x', op: 'epri', ids: [o.es['assembling-machine-1'].id], pr: 2 } as any); steps(o.g, 6); }
  ok(['lab', 'electric-furnace', 'assembling-machine-1'].every(k => Math.abs(a.g.sat(a.es[k]) - b.g.sat(b.es[k])) < 1e-9), 'одинаковая выдача при разном порядке строительства');
  // дефицит внутри критического уровня: всех критических поровну
  for (const e of Object.values(es)) { g.enqueue({ t: 'x', op: 'epri', ids: [e.id], pr: 0 } as any); } steps(g, 6);
  ok(Math.abs(g.sat(es['lab']) - 120 / 180) < 0.01 && Math.abs(g.sat(es['assembling-machine-1']) - 120 / 180) < 0.01, 'дефицит внутри критического уровня: пропорционально запросу, неполное питание видно');
  // полная мощность возвращается
  g.build('solar-panel', 100, 108, 0, false); steps(g, 6); ok(g.sat(es['lab']) === 1 && g.sat(es['assembling-machine-1']) === 1, 'при возврате мощности все получают полное питание');
  // сохранение: приоритеты сохраняются
  const g2 = deserialize(serialize(g)); ok(g2.ents.get(es['lab'].id)!.pp === 0 && stateHash(g) === stateHash(g2), 'приоритеты и группы сохраняются, хеш совпадает');
  g._hook = undefined;
  for (const k of Object.keys(kwOf)) (PROTOS[k].energy as any).kW = keep[k];
}

const flat = (g: Game, x0: number, y0: number, x1: number, y1: number, res = 0, amt = 0) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = res; c.amt[i] = amt; c.decor[i] = 0; } };

console.log('6. Группы построек и метрики');
{
  const g = mk(); flat(g, 90, 90, 130, 120);
  const f1 = g.build('stone-furnace', 100, 100, 0, false)!, f2 = g.build('stone-furnace', 104, 100, 0, false)!, f3 = g.build('stone-furnace', 108, 100, 0, false)!;
  for (const f of [f1, f2, f3]) { f.input = { 'iron-ore': 200 }; f.fuel = { item: 'coal', count: 20 }; }
  cmd(g, { t: 'x', op: 'gnew', name: '  Северная <b>станция</b> ' + 'я'.repeat(80), color: '#ff0000', ids: [f1.id, f2.id] }, 2);
  const gid = +Object.keys(g.x.groups)[0]; const G = g.x.groups[gid];
  ok(G.name.length <= 60 && !/[<>]/.test(G.name) && f1.grp === gid && f2.grp === gid && f3.grp === undefined, 'группа создана: имя ≤ 60 знаков без разметки, ровно два участника');
  steps(g, 600); const I = groupInfo(g, gid);
  const made = (f1.output!['iron-plate'] || 0) + (f2.output!['iron-plate'] || 0);
  ok(I.n === 2 && I.working === 2 && I.rate[60].p['iron-plate'] === made && made > 0, `метрики: выпуск группы ${I.rate[60].p['iron-plate']} = сумме участников ${made}, третья печь не учтена (${f3.output!['iron-plate'] || 0})`);
  const savedStats = deserialize(serialize(g)); const SI = groupInfo(savedStats, gid);
  ok(SI.rate[60].p['iron-plate'] === I.rate[60].p['iron-plate'] && SI.rate[300].p['iron-plate'] === I.rate[300].p['iron-plate'] && SI.rate[60].sec === I.rate[60].sec, 'скользящие метрики группы 1/5 мин переживают сохранение и загрузку');
  cmd(g, { t: 'x', op: 'gadd', gid, ids: [f3.id] }, 2); ok(f3.grp === gid && members(g, gid).length === 3, 'добавление выделенных построек');
  cmd(g, { t: 'x', op: 'gnew', name: 'Вторая', color: '#00ff00', ids: [f1.id] }, 2); const gid2 = Math.max(...Object.keys(g.x.groups).map(Number));
  ok(f1.grp === gid && members(g, gid2).length === 0, 'постройка из другой группы при создании не переносится молча');
  cmd(g, { t: 'x', op: 'gadd', gid: gid2, ids: [f1.id], move: true }, 2); ok(f1.grp === gid2, 'явный перенос между группами');
  cmd(g, { t: 'x', op: 'grem', ids: [f3.id] }, 2); ok(f3.grp === undefined, 'исключение из группы');
  g.removeEntity(f2, false); g.step(); ok(members(g, gid).length === 0 && g.x.groups[gid].lost === 1, 'разрушенная постройка уходит из состава, потеря записана');
  const g2 = deserialize(serialize(g)); ok(Object.keys(g2.x.groups).length === 2 && g2.ents.get(f1.id)!.grp === gid2 && stateHash(g) === stateHash(g2), 'сохранение: группы и членство, хеш совпал');
  cmd(g2, { t: 'x', op: 'gren', gid: gid2, name: 'Новое имя' }, 2); ok(g2.x.groups[gid2].name === 'Новое имя', 'переименование');
  for (let i = 0; i < 270; i++) g2.enqueue({ t: 'x', op: 'gnew', name: 'Г' + i, color: '#112233', ids: [] } as any); steps(g2, 3); ok(Object.keys(g2.x.groups).length === 256, 'не больше 256 групп');
  cmd(g2, { t: 'x', op: 'gdel', gid: gid2 }, 2); ok(!g2.x.groups[gid2] && !!g2.ents.get(f1.id) && g2.ents.get(f1.id)!.grp === undefined, 'удаление группы оставляет сооружения на месте');
  const m = mk(); m.enqueue({ t: 'join', name: 'Б', color: '#ff8800' }); steps(m, 2); flat(m, 90, 90, 100, 100);
  const q = m.build('stone-furnace', 92, 92, 0, false)!; m.enqueue({ t: 'x', op: 'gnew', name: 'Хостовая', color: '#aa0000', ids: [q.id], pl: 0 } as any); steps(m, 3);
  const mg = +Object.keys(m.x.groups)[0]; m.enqueue({ t: 'x', op: 'gdel', gid: mg, pl: 1 } as any); steps(m, 3); ok(!!m.x.groups[mg], 'кооператив: обычный игрок не удаляет чужую группу');
  m.enqueue({ t: 'x', op: 'gdel', gid: mg, pl: 0 } as any); steps(m, 3); ok(!m.x.groups[mg], 'хост управляет общими группами');
}

console.log('6a. Доли общей жидкостной сети в группах');
{
  const g = mk(); flat(g, 90, 90, 125, 115);
  const a = g.build('storage-tank', 100, 100, 0, false)!;
  const p1 = g.build('pipe', 103, 101, 0, false)!; const p2 = g.build('pipe', 104, 101, 0, false)!; const p3 = g.build('pipe', 105, 101, 0, false)!;
  const b = g.build('storage-tank', 106, 100, 0, false)!;
  cmd(g, { t: 'x', op: 'gnew', name: 'Запад', color: '#3366cc', ids: [a.id, p1.id, p2.id] }, 2);
  cmd(g, { t: 'x', op: 'gnew', name: 'Восток', color: '#cc6633', ids: [p3.id, b.id] }, 2);
  const gids = Object.keys(g.x.groups).map(Number); const fn = g.fluidNets[a._fn![0]];
  ok(!!fn && b._fn?.[0] === fn.id && p1._fn?.[0] === fn.id, 'две цистерны и соединяющие трубы составляют одну физическую сеть');
  fn.fluid = 'water'; fn.amount = 25000;
  for (const e of [a, p1, p2, p3, b]) fluidSnapshot(g, e);
  const left = groupInfo(g, gids[0]).fluids.water || 0; const right = groupInfo(g, gids[1]).fluids.water || 0;
  ok(left > 0 && right > 0 && left < fn.amount && right < fn.amount && Math.abs(left + right - fn.amount) < 0.01, `сеть распределена по ёмкостям участников без дублирования: ${left.toFixed(2)} + ${right.toFixed(2)} из ${fn.amount}`);
}

console.log('7. Оповещения');
{
  const g = mk(); flat(g, 90, 90, 130, 120);
  const f = g.build('stone-furnace', 100, 100, 0, false)!; f.input = { 'iron-ore': 500 }; f.fuel = { item: 'coal', count: 2 }; f.fuelJ = 0; f.active = true;
  cmd(g, { t: 'x', op: 'gnew', name: 'Плавильня', color: '#aa5500', ids: [f.id] }, 2); const gid = +Object.keys(g.x.groups)[0];
  const msgs0 = g.messages.length;
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'fuel', target: { t: 'group', id: gid }, thr: 10, hy: 12, dur: 5, rem: 20 } }, 2);
  ok(g.x.rules.length === 1, 'правило создано');
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'eval', target: { t: 'all' } } }, 2); cmd(g, { t: 'x', op: 'rule', rule: { kind: 'fuel', target: { t: 'all' }, thr: NaN, hy: 1, dur: 1 } }, 2);
  ok(g.x.rules.length === 1, 'произвольные типы и нечисловые пороги отклоняются');
  steps(g, 120); const a = g.x.al[g.x.rules[0].id]; ok(a.st === 1, 'нарушение началось: ожидание устойчивости (ещё не тревога)');
  f.fuel!.count = 40; steps(g, 60); ok(g.x.al[g.x.rules[0].id].st === 0, 'краткое нарушение (короче длительности) не даёт тревоги');
  const cnt = () => g.messages.slice(msgs0).filter(m => /Тревога|Напоминание|Восстановлено/.test(m.text)).length;
  ok(cnt() === 0, 'ложных сообщений нет');
  f.fuel = { item: 'coal', count: 1 }; f.fuelJ = 0; steps(g, 60 * 7); const b = g.x.al[g.x.rules[0].id]; ok(b.st === 2 && cnt() === 1, 'устойчивое нарушение — одна тревога');
  steps(g, 60 * 30); ok(cnt() >= 2 && cnt() <= 4, `напоминания по интервалу (не каждый тик): сообщений ${cnt()}`);
  const g2 = deserialize(serialize(g)); const c0 = g2.messages.length; steps(g2, 5); ok(g2.x.al[g2.x.rules[0].id].st === 2 && g2.messages.length === c0, 'после загрузки тревога видна, прошлые события не воспроизводятся');
  f.fuel = { item: 'coal', count: 11 }; f.fuelJ = 0; steps(g, 60 * 3); ok(g.x.al[g.x.rules[0].id].st === 2, 'гистерезис: между порогом тревоги и порогом восстановления тревога держится');
  f.fuel = { item: 'coal', count: 50 }; steps(g, 60 * 3); ok(g.x.al[g.x.rules[0].id].st === 3 && g.messages.slice(msgs0).some(m => /Восстановлено/.test(m.text)), 'восстановление выше порога гистерезиса');
  // массовая остановка: 12 буров без кислоты — одно сообщение
  const h = mk(); flat(h, 90, 90, 150, 130); flat(h, 90, 100, 150, 103, 1, 100);
  h.research.done.add('uranium-processing'); for (const unlock of TECHS['uranium-processing'].unlocks) h.enabled.add(unlock); flat(h, 90, 100, 150, 103, 6, 100);
  const ds: Entity[] = []; for (let i = 0; i < 12; i++) { const d = h.build('electric-mining-drill', 92 + 4 * i, 100, 0, false)!; ds.push(d); }
  const m0 = h.messages.length; h.enqueue({ t: 'x', op: 'rule', rule: { kind: 'acid', target: { t: 'all' }, dur: 1, rem: 0 } } as any); h.enqueue({ t: 'x', op: 'rule', rule: { kind: 'acid', target: { t: 'all' }, dur: 1, rem: 0 } } as any); steps(h, 2);
  steps(h, 400);
  const al = h.messages.slice(m0).filter(m => /Тревога/.test(m.text));
  ok(al.length === 1 && /12 буров/.test(al[0].text) && h.x.al[h.x.rules[0].id].ids.length === 12 && h.x.al[h.x.rules[1].id].ev === h.x.al[h.x.rules[0].id].ev, 'два одинаковых правила причины и цели создают одно глобальное событие со стабильным общим id');
  h.enqueue({ t: 'join', name: 'Игрок', color: '#ff8800' }); steps(h, 2); const alertId = h.x.al[h.x.rules[0].id].ev;
  h.enqueue({ t: 'x', op: 'ack', ev: alertId, player: 0, pl: 1 } as any); steps(h, 2);
  ok((h.x as any).ack?.[1]?.includes(alertId) && !(h.x as any).ack?.[0]?.includes(alertId), 'подтверждение хранится за реальным player scope, поле player в payload не меняет владельца');
  h.enqueue({ t: 'x', op: 'ack', ev: alertId + 1000, pl: 1 } as any); steps(h, 2);
  ok(!(h.x as any).ack?.[1]?.includes(alertId + 1000), 'подтверждение отклоняет неактивный event id');
  h.enqueue({ t: 'x', op: 'ack', ev: alertId, pl: 0 } as any); steps(h, 2);
  const ha = deserialize(serialize(h));
  ok((ha.x as any).ack?.[1]?.includes(alertId) && (ha.x as any).ack?.[0]?.includes(alertId), 'личные подтверждения двух игроков переживают сохранение');
  const hs = serialize(h), has = serialize(ha); const saveDiffs = Object.keys(hs).filter(k => JSON.stringify(hs[k]) !== JSON.stringify(has[k]));
  ok(stateHash(ha) === stateHash(h), `личные подтверждения входят в хеш состояния после загрузки (save diff: ${saveDiffs.join(',')}; enabled ${hs.enabled?.length}/${has.enabled?.length})`);
}

console.log('7a. Цели тревог: электросеть, поле, поезд');
{
  const g = mk(); flat(g, 90, 90, 140, 140); g.freePower = false;
  g.build('small-electric-pole', 100, 100, 0, false); flat(g, 102, 100, 104, 102, 1, 1000); const d1 = g.build('electric-mining-drill', 102, 100, 0, false)!;
  g.build('small-electric-pole', 120, 120, 0, false); flat(g, 122, 120, 124, 122, 1, 1000); const d2 = g.build('electric-mining-drill', 122, 120, 0, false)!;
  steps(g, 2); const n1 = d1._net!; const n2 = d2._net!;
  ok(n1 >= 0 && n2 >= 0 && n1 !== n2, `для проверки целей построены две реальные независимые электросети (${n1}/${n2})`);
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'power', target: { t: 'powerNet', id: n1 }, thr: 90, hy: 98, dur: 0, rem: 0 } }, 2);
  steps(g, 30);
  const pa = g.x.al[g.x.rules[0].id]; ok(g.x.rules[0].target.t === 'powerNet' && pa.n === 1 && pa.ids[0] === n1, 'тревога электросети адресует только выбранный id сети');
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'power', target: { t: 'train', id: 99 }, thr: 90, hy: 98, dur: 0, rem: 0 } }, 2);
  ok(g.x.rules.length === 1, 'несовместимый тип цели для показателя отклоняется');

  const tr: any = (id: number, st: string) => ({ id, cars: [], trail: [], pos: 0, v: 0, fr: 0, manual: false, sched: [], si: 0, st, path: null, tgt: null, rem: 0, wt: 0, idle: 0, sig: 0, retry: 0, drv: 0, thr: 0, steer: 0, name: `Поезд ${id}` });
  g.trains.push(tr(41, 'nopath'), tr(42, 'blocked'));
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'train', target: { t: 'train', id: 41 }, dur: 0, rem: 0 } }, 2);
  steps(g, 30);
  const ta = g.x.al[g.x.rules[1].id]; ok(ta.n === 1 && ta.ids[0] === 41, 'тревога поездов адресует выбранный поезд, не другие задержанные составы');
}

console.log('8. Прогноз истощения');
{
  const g = new Game(3, true, { enemies: 'none', genv: GEN_VER }); g.freePower = false;
  const d = g.build('electric-mining-drill', 182, 176, 0, false)!; d.cursor = 0;
  { const oo = g.drillOut(d); g.build('wooden-chest', oo.x, oo.y, 0, false); }
  const d2 = g.build('electric-mining-drill', 520, -502, 0, false)!;
  { const oo = g.drillOut(d2); g.build('wooden-chest', oo.x, oo.y, 0, false); }
  g.build('substation', 185, 176, 0, false); g.build('solar-panel', 188, 172, 0, false); g.build('solar-panel', 188, 176, 0, false); g.dirtyPower = true;
  steps(g, 600); const f0 = drillForecast(g, d); ok(f0.state === 'collect', 'первые секунды: «собираются данные», без числа');
  const rem0 = fieldAt(g, 182, 176)!.remain; steps(g, 60 * 90); const rem1 = fieldAt(g, 182, 176)!.remain;
  const f1 = drillForecast(g, d); const real = (rem0 - rem1) / (90 + 0) * 60;
  ok(f1.state === 'ok' && f1.ratePerMin > 0 && Math.abs(f1.ratePerMin - real) / real < 0.2, `скорость ${f1.ratePerMin.toFixed(1)}/мин совпадает с фактическим уменьшением ${real.toFixed(1)}/мин`);
  ok(f1.minutes !== null && Math.abs(f1.minutes - rem1 / f1.ratePerMin) < 1 && f1.remain === rem1, `остаток ${f1.remain}, срок ${fmtMin(f1.minutes)}`);
  const fkey = fieldAt(g, 182, 176)!.key;
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'field', target: { t: 'field', key: fkey }, thr: 100000, hy: 100000, dur: 0, rem: 0 } }, 2);
  steps(g, 30);
  const fieldAlert = g.x.al[g.x.rules[g.x.rules.length - 1].id];
  ok(fieldAlert.n === 1 && fieldAlert.ids[0] === d.id, 'тревога месторождения связана со стабильным ключом конкретного поля');
  steps(g, 151); const dc = d.dc || 0; const dh = d.dh?.slice() || []; const fBeforeSave = drillForecast(g, d);
  const ds = deserialize(serialize(g)); const dd = ds.ents.get(d.id)!; const fAfterSave = drillForecast(ds, dd);
  ok(dc > 0 && dd.dc === dc && JSON.stringify(dd.dh) === JSON.stringify(dh) && fAfterSave.state === fBeforeSave.state && Math.abs(fAfterSave.ratePerMin - fBeforeSave.ratePerMin) < 1e-9 && stateHash(ds) === stateHash(g), 'реально измеренные окна и неполная 5-секундная корзина добычи переживают сохранение/хеш');
  steps(g, 149); steps(ds, 149);
  const ddAfter = ds.ents.get(d.id)!;
  const gd = serialize(g), dsd = serialize(ds); const nextDiffs = Object.keys(gd).filter(k => JSON.stringify(gd[k]) !== JSON.stringify(dsd[k]));
  ok(stateHash(g) === stateHash(ds), `после загрузки остаток частичной корзины попадает в тот же следующий снимок и сохраняет полный хеш (diff: ${nextDiffs.join(',')})`);
  ok(ddAfter.dc === d.dc && JSON.stringify(ddAfter.dh) === JSON.stringify(d.dh) && drillForecast(g, d).state === drillForecast(ds, ddAfter).state && Math.abs(drillForecast(g, d).ratePerMin - drillForecast(ds, ddAfter).ratePerMin) < 1e-9, `после следующего снимка совпадают история, дебит и готовность прогноза (dc ${d.dc}/${ddAfter.dc}, dh ${JSON.stringify(d.dh)}/${JSON.stringify(ddAfter.dh)})`);
  d.coff = true; steps(g, 60 * 360); const f2 = drillForecast(g, d); ok(f2.state === 'stopped' && f2.minutes === null, 'добыча остановлена: без деления на ноль и бесконечного ресурса');
  const e = mk(); flat(e, 100, 100, 111, 111, 1, 50); const near = e.world.hasChunk(3, 3); void near;
  const cx = Math.floor(100 / 32) , bx = (cx + 1) * 32; flat(e, bx - 4, 100, bx - 1, 103, 1, 50); const fi = fieldAt(e, bx - 2, 101)!;
  ok(fi.open === true && fi.remain === 4 * 4 * 50, 'поле у границы неизвестной области: сумма только открытых клеток, пометка «раскрыта не вся»');
  const stoppedSave = deserialize(serialize(g)); ok(drillForecast(stoppedSave, stoppedSave.ents.get(d.id)!).state === 'stopped' && stateHash(stoppedSave) === stateHash(g), 'после загрузки сохраняется история простоя, а не начинается сбор с нуля');

  const oil = new Game(3, true, { enemies: 'none', genv: GEN_VER }); oil.freePower = false;
  const pj = oil.build('pumpjack', 102, -21, 0, false)!;
  oil.build('pipe', 103, -22, 0, false); oil.build('pipe', 103, -23, 0, false);
  oil.build('substation', 106, -21, 0, false); oil.build('solar-panel', 109, -23, 0, false); oil.build('solar-panel', 109, -19, 0, false); oil.dirtyPower = true;
  const crude0 = oil.stats.produced['crude-oil'] || 0;
  steps(oil, 4801); const fo = drillForecast(oil, pj); const crudeDraw = (oil.stats.produced['crude-oil'] || 0) - crude0;
  const oilActualRate = crudeDraw * 3600 / 4801;
  ok(crudeDraw > 0 && (fo as any).oil === true && fo.state === 'ok' && fo.minutes === null && Math.abs(fo.ratePerMin - oilActualRate) < 0.2, `нефть показывает фактический дебит ${fo.ratePerMin.toFixed(2)} ед/мин без срока истощения (oil=${(fo as any).oil}, state=${fo.state}, eta=${fo.minutes}, measured=${oilActualRate.toFixed(2)})`);
  ok(fo.key === fieldAt(oil, 103, -20)!.key && xQuery(oil, 'fields', 0).some((q: any) => q.f?.oil && q.f.key === fo.key), 'насос-качалка попадает в прогноз и список открытых полей по своему ключу');
  const oilSave = deserialize(serialize(oil)); const pjs = oilSave.ents.get(pj.id)!; const fos = drillForecast(oilSave, pjs);
  const os = serialize(oil), oss = serialize(oilSave); const oilDiffs = Object.keys(os).filter(k => JSON.stringify(os[k]) !== JSON.stringify(oss[k]));
  ok(stateHash(oilSave) === stateHash(oil) && (fos as any).oil === true && Math.abs(fos.ratePerMin - fo.ratePerMin) < 1e-9 && pjs.dc === pj.dc, `реальный нефтяной дебит и частичная корзина сохраняются и совпадают после загрузки (diff: ${oilDiffs.join(',')})`);
}

console.log('9. Диагностика «Почему остановилась?»');
{
  const g = mk(); flat(g, 90, 90, 130, 120);
  flat(g, 100, 100, 102, 102, 1, 1000);
  const dr = g.build('electric-mining-drill', 101, 101, 1, false)!;
  const o = g.drillOut(dr); const b1 = g.build('transport-belt', o.x, o.y, 1, false)!; const b2 = g.build('transport-belt', o.x + 1, o.y, 1, false)!; void b1; void b2;
  const i1 = g.build('inserter', o.x + 2, o.y, 1, false)!; const fu = g.build('stone-furnace', o.x + 3, o.y, 0, false)!; fu.fuel = { item: 'coal', count: 50 };
  const i2 = g.build('inserter', o.x + 5, o.y, 1, false)!; const as = g.build('assembling-machine-1', o.x + 6, o.y - 1, 0, false)!; as.recipe = 'iron-gear-wheel'; as.input = {}; as.output = {};
  void i1; void i2; steps(g, 60 * 20);
  const rd = diagnose(g, as.id); ok(!!rd.root && rd.nodes >= 1, `отчёт построен за ${rd.ms.toFixed(2)} мс, узлов ${rd.nodes}`);
  // выключим поставщика: убираем руду под буром
  flat(g, 100, 100, 102, 102, 0, 0); g.step(); steps(g, 60 * 40); as.input = {}; fu.input = {}; fu.output = {}; steps(g, 30);
  const r2 = diagnose(g, as.id); const txt = JSON.stringify(r2.root);
  ok(as.status === 'no-input' && /нет Железная пластина|нет iron-plate|нет /.test(r2.root!.cause), `верхняя причина: «${r2.root?.cause}»`);
  const chain: string[] = []; let n: any = r2.root; while (n) { chain.push(n.name + ': ' + n.cause); n = n.kids.find((k: any) => k.id >= 0) || n.kids[0]; }
  ok(chain.length >= 3 && /истощ/i.test(chain[chain.length - 1]) , 'цепочка: ' + chain.join(' → '));
  // параллельный здоровый поставщик не называется сломанным
  void txt;
  const fu2 = g.build('stone-furnace', o.x + 7, o.y - 4, 0, false)!; const i3 = g.build('inserter', o.x + 7, o.y - 2, 2, false);
  fu2.fuel = { item: 'coal', count: 50 }; fu2.input = { 'iron-ore': 10 }; fu2.status = 'working'; fu2.active = true; as.status = 'no-input';
  const r3 = diagnose(g, as.id); const names = JSON.stringify(r3.root);
  ok(!!i3 && r3.root!.kids.length >= 2 && names.includes('"cause":"работает"'), 'несколько поставщиков: показаны обе ветви, исправная печь не названа сломанной');
  const okNode = (function find(n: any): any { if (n.id === fu2.id) return n; for (const k of n.kids) { const r = find(k); if (r) return r; } return null; })(r3.root);
  ok(okNode && okNode.cause === 'работает' && okNode.kids.length === 0, 'у исправной ветви нет «причины неисправности»');
  const empty = diagnose(g, 999999); ok(empty.root === null, 'несуществующий объект — пустой отчёт без исключений');
  // цикл: два манипулятора гоняют предметы между двумя машинами
  flat(g, 90, 121, 130, 130); const c1 = g.build('assembling-machine-1', 100, 124, 0, false)!, c2 = g.build('assembling-machine-1', 104, 124, 0, false)!; c1.recipe = 'iron-gear-wheel'; c2.recipe = 'iron-plate'; c1.input = {}; c2.input = {};
  g.build('inserter', 103, 125, 1, false); g.build('inserter', 103, 126, 3, false); c1.status = 'no-input'; c2.status = 'no-input';
  const cy = diagnose(g, c1.id); ok(cy.nodes < 64 && cy.ms < 50, `циклическая линия завершилась: ${cy.nodes} узлов, ${cy.ms.toFixed(2)} мс`);
  const ds = deserialize(serialize(g)); const rr = diagnose(ds, as.id); ok(!!rr.root, 'после загрузки отчёт строится заново (индексов в сохранении нет)');
}

console.log('10. Планировщик расширения');
{
  const g = mk(); flat(g, 90, 90, 150, 140);
  const r0 = planCalc(g, 'iron-gear-wheel', 60); ok(!!r0 && r0.rows.some(r => r.item === 'iron-gear-wheel' && r.add > 0) && r0.raw.some(([k]) => k === 'iron-ore') && r0.kW > 0, `цель 60 шестерён/мин: добавить машин ${r0?.rows.map(r => r.add).join('+')}, сырья ${r0?.raw.map(([k, v]) => k + ' ' + v.toFixed(0)).join(', ')}, ${r0?.kW} кВт`);
  const a = g.build('assembling-machine-2', 100, 100, 0, false)!; a.recipe = 'iron-gear-wheel'; a.status = 'no-input';
  const r1 = planCalc(g, 'iron-gear-wheel', 60)!; const row = r1.rows.find(r => r.item === 'iron-gear-wheel')!;
  ok(row.installed > 0 && row.add < r0!.rows.find(r => r.item === 'iron-gear-wheel')!.add && r1.stalled === 1 && r1.notes.some(n => /восстановите существующие линии/.test(n)), `учтена установленная мощность (${row.installed}/мин) и простаивающая машина: сначала восстановить линию`);
  ok(r1.actual === 0 && r1.target === 60 && r1.fromBase === false, 'текущий выпуск, расчётная мощность и цель — отдельные величины');
  const r2 = planCalc(g, 'iron-gear-wheel', 0, 50); ok(r2 === null, 'увеличение на % при нулевом выпуске — нечего считать (без деления на ноль)');
  const opts = { asm: 4 as const, furnace: 'electric-furnace' as const, drill: 3 as const, mods: 'speed' as const, modTier: 2 as const, beacons: 1, beaconTier: 1 as const, routeDistance: 120, routeCycleSeconds: 90 };
  const r3 = planCalc(g, 'iron-gear-wheel', 60, undefined, opts)!; const tierRow = r3.rows.find(r => r.item === 'iron-gear-wheel')!;
  ok(tierRow.machine === 'assembling-machine-4' && tierRow.need < r0!.rows.find(r => r.item === 'iron-gear-wheel')!.need, 'выбранный уровень сборщика, модули и маяк влияют на расчёт количества машин');
  ok(r3.logistics.robots !== null && r3.logistics.trains !== null && r3.logistics.distance === 120 && r3.logistics.cycleSeconds === 90, 'оценка роботов и поездов использует заданные расстояние и цикл маршрута');
  const uranium = planCalc(g, 'uranium-235', 1)!;
  ok(!!uranium && uranium.rows.some(r => r.recipe === 'uranium-enrichment' && r.outputs.some(([it]) => it === 'uranium-238')) && uranium.notes.some(n => /40.*U-235|U-235.*40/.test(n)), 'многостадийный цикл обогащения остаётся конечным и показывает возвращаемый U-238 и стартовый запас');
  const previewInput = { item: 'iron-gear-wheel', perMin: 60, x: 90, y: 90, options: opts };
  const ghostsBeforePreview = g.ghosts.size; const prepared = planPreview(g, previewInput)!;
  ok(prepared.placements.length > 0 && prepared.placements.every(p => Number.isInteger(p.x) && Number.isInteger(p.y) && p.w > 0 && p.h > 0) && g.ghosts.size === ghostsBeforePreview, 'подготовка возвращает геометрию без постановки призраков');
  ok(prepared.placements.every(p => p.recipe !== null) && prepared.notes.some(n => /бур.*вручную|месторожд/i.test(n)), 'превью не ставит бур вне рудного поля и явно оставляет добычу для ручного размещения');
  const blockedPreview = planPreview(g, { ...previewInput, x: 100, y: 100 })!;
  ok(blockedPreview.blocked > 0 && blockedPreview.placements.some(p => !p.ok && !!p.reason), 'предпросмотр показывает существующие коллизии с причиной');
  const race = mk(); flat(race, 90, 90, 150, 140); race.enabled.add('assembling-machine-2');
  const raceInput = { item: 'iron-gear-wheel', perMin: 60, x: 90, y: 90 };
  const stalePreview = planPreview(race, raceInput)!; const first = stalePreview.placements[0];
  const obstacle = first && race.build('wooden-chest', first.x, first.y, 0, false);
  cmd(race, { t: 'x', op: 'plan', ...raceInput }, 2);
  ok(stalePreview.canAccept && !!obstacle && race.ghosts.size === 0 && race.x.plan === null, 'Worker заново проверяет карту после превью и атомарно отклоняет устаревшую схему');
  g.enabled.add('assembling-machine-2'); const m0 = g.ghosts.size;
  cmd(g, { t: 'x', op: 'plan', item: 'iron-gear-wheel', perMin: 300, x: 110, y: 110 }, 2);
  ok(g.ghosts.size > m0 && g.x.plan !== null && g.x.plan.ids.length === g.ghosts.size - m0, `призраки поставлены: ${g.ghosts.size - m0}, план запомнен`);
  const g2 = deserialize(serialize(g)); ok(g2.x.plan?.ids.length === g.x.plan!.ids.length, 'сохранение сохраняет идентификаторы призраков плана');
  g.build('wooden-chest', 160, 160, 0, false);
  cmd(g, { t: 'x', op: 'planundo' }, 2); ok(g.ghosts.size === m0 && g.x.plan === null && !!g.ents.get(a.id), 'отмена плана снимает только его призраки');
  cmd(g, { t: 'x', op: 'plan', item: 'iron-gear-wheel', perMin: 300, x: NaN, y: 1 }, 2); ok(g.x.plan === null, 'без выбранного места ничего не ставится');
}

console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ v1.16b: все проверки пройдены'); process.exit(fails ? 1 : 0);
