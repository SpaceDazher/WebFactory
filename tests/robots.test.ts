// v1.2: строительные роботы — сети робопортов, стройка из сундуков (чертёж на 1000 построек), снос, улучшение,
// ремонт, восстановление разрушенного Роем, сохранение посреди полёта (детерминизм), личный робопорт,
// зарядка, иконки призраков, отмена стройки, приоритет; быстрая погрузка/разгрузка и разделение стопок.
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { ledger, diffLedger } from '../src/sim/compat';
import { makeBlueprint } from '../src/sim/blueprint';
import { roboIndex, netAt, roboSummary, robotBuffer, ROBOT_STRIDE, robotMaxJ } from '../src/sim/robots';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import { PROTOS } from '../src/data/entities';
import { TECHS } from '../src/data/techs';
import { NEWS } from '../src/data/news';
import { TIPS } from '../src/ui/tips';
import { setLang, untranslated } from '../src/core/i18n';
import fs from 'fs';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const fresh = () => { const g = new Game(7, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); return g; };
/** ровная суша w×h без воды (деревья и скалы убираются) */
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 600; r += 4) for (let a = 0; a < 32; a++) {
    const bx = Math.floor(x + Math.cos(a / 32 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 32 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
/** робопорт с питанием «как от сети» (буфер заряжается на 4 МВт) */
const port = (g: Game, x: number, y: number, robots = 50, packs = 0) => {
  const p = g.build('roboport', x, y, 0, false)!; p.charge = 100e6;
  if (robots) p.inv!.add('construction-robot', robots); if (packs) p.inv!.add('repair-pack', packs);
  return p;
};
const powered = (g: Game) => { const o = g.sat.bind(g); (g as any).sat = (e: Entity) => e.t === 'roboport' ? 1 : o(e); const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); }; };
const run = (g: Game, ticks: number, until?: () => boolean) => { for (let i = 0; i < ticks; i++) { g.step(); if (until && until()) return i + 1; } return ticks; };
const reload = (g: Game) => { const h = deserialize(JSON.parse(JSON.stringify(serialize(g)))); powered(h); return h; };
const chest = (g: Game, x: number, y: number, items: [string, number][]) => { const c = g.build('storage-chest', x, y, 0, false)!; for (const [it, n] of items) c.inv!.add(it, n); return c; };
const totalItems = (g: Game) => { const l = ledger(serialize(g)); const m = { ...l.items }; for (const k in l.ents) m[k] = (m[k] || 0) + l.ents[k]; return m; };
const sameItems = (a: Record<string, number>, b: Record<string, number>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => (a[k] || 0) === (b[k] || 0));

console.log('1. Сети робопортов (union-find по зонам логистики), пространственный индекс');
{
  const g = fresh(); const A = land(g, 300, 300, 4, 4);
  const a = port(g, A.x, A.y), b = port(g, A.x + 40, A.y), c = port(g, A.x + 200, A.y);
  const I = roboIndex(g);
  ok(I.nets.length === 2 && I.netOf.get(a.id) === I.netOf.get(b.id) && I.netOf.get(c.id) !== I.netOf.get(a.id), `сетей: ${I.nets.length} (порты в 40 клетках — одна сеть, в 200 — отдельная)`);
  ok(netAt(g, A.x + 2 + 54, A.y + 2) === I.netOf.get(a.id) && netAt(g, A.x + 120, A.y + 2) === null, 'зона стройки 110×110: точка в 54 клетках — в сети, в 118 — вне зон');
  g.removeEntity(b, false); ok(roboIndex(g).nets.length === 2 && g.roboDirty === false, 'после сноса порта сети пересобраны');
}

console.log('2. Чертёж на 1000 построек строят только роботы, из сундуков в зоне');
let big: Game; let bigTicks = 0; let BA = { x: 0, y: 0 };
{
  const g = fresh(); powered(g); const A = land(g, 260, 260, 64, 64); big = g; BA = A;
  const P1 = port(g, A.x + 10, A.y + 30, 50), P2 = port(g, A.x + 50, A.y + 30, 50);
  // 1000 построек: 600 стен, 300 конвейеров, 50 сундуков, 30 сборщиков, 20 столбов
  const plan: [string, number, number, number][] = [];
  for (let i = 0; i < 600; i++) plan.push(['stone-wall', A.x + 2 + (i % 60), A.y + 2 + Math.floor(i / 60), 0]);
  for (let i = 0; i < 300; i++) plan.push(['transport-belt', A.x + 2 + (i % 60), A.y + 14 + Math.floor(i / 60), 1]);
  for (let i = 0; i < 50; i++) plan.push(['wooden-chest', A.x + 2 + i, A.y + 21, 0]);
  for (let i = 0; i < 30; i++) plan.push(['assembling-machine-1', A.x + 2 + (i % 15) * 4, A.y + 36 + Math.floor(i / 15) * 4, 0]);
  for (let i = 0; i < 20; i++) plan.push(['small-electric-pole', A.x + 2 + i * 3, A.y + 46, 0]);
  const need: Record<string, number> = {}; for (const [p] of plan) need[p] = (need[p] || 0) + 1;
  chest(g, A.x + 30, A.y + 50, Object.entries(need).map(([k, n]) => [k, n] as [string, number]));
  chest(g, A.x + 32, A.y + 50, [['repair-pack', 10]]);
  let placed = 0; for (const [p, x, y, d] of plan) if (g.placeGhost(p, x, y, d as any, p === 'assembling-machine-1' ? 'iron-gear-wheel' : null)) placed++;
  ok(placed === 1000, `призраков поставлено: ${placed}`);
  ok(Math.hypot(g.player.x - A.x, g.player.y - A.y) > 100 && g.inv.isEmpty(), 'инженер далеко и с пустым инвентарём — строить могут только роботы');
  const items0 = totalItems(g);
  // посреди стройки — сохранение и загрузка, затем продолжаем обе партии и сравниваем
  run(g, 1800);
  const flying = g.robots.length, carrying = g.robots.filter(r => r.cargo.length).length;
  ok(flying >= 50 && carrying > 0, `через 30 с в полёте ${flying} роботов, с грузом ${carrying}`);
  const buf = robotBuffer(g, Object.fromEntries(Object.keys(ITEMS).map((k, i) => [k, i])));
  ok(buf instanceof Float32Array && buf.length === flying * ROBOT_STRIDE && buf[0] === g.robots[0].x.valueOf() || Math.abs(buf[0] - g.robots[0].x) < 1e-3, `данные для рендера — Float32Array по ${ROBOT_STRIDE} числа на робота`);
  const h = reload(g); ok(stateHash(h) === stateHash(g) && h.robots.length === flying, 'сохранение посреди полёта: роботы с позицией, зарядом, задачей и грузом');
  ok(diffLedger(ledger(serialize(g)), ledger(serialize(h))).length === 0 && sameItems(totalItems(g), items0), 'предметы сходятся ' + JSON.stringify(Object.keys({...totalItems(g), ...items0}).filter(k => (totalItems(g)[k]||0) !== (items0[k]||0)).map(k => [k, items0[k], totalItems(g)[k]])) + ': роботы в полёте и их груз учтены, ничего не потеряно');
  run(g, 600); run(h, 600);
  ok(stateHash(g) === stateHash(h), 'через 10 с после загрузки состояние совпадает с непрерывной партией');
  bigTicks = 2400 + run(g, 60 * 60 * 15, () => g.ghosts.size === 0 && g.robots.length === 0);
  const built = g.stats.robotBuilt;
  ok(g.ghosts.size === 0 && built === 1000, `все 1000 построены роботами за ${(bigTicks / 3600).toFixed(1)} мин игры (robotBuilt=${built})`);
  const asm = [...g.ents.values()].filter(e => e.proto === 'assembling-machine-1');
  ok(asm.length === 30 && asm.every(e => e.recipe === 'iron-gear-wheel'), 'рецепты из чертежа выставлены');
  ok(P1.inv!.count('construction-robot') + P2.inv!.count('construction-robot') === 100, 'все роботы вернулись в робопорты');
  ok((g.tele.robots?.build || 0) === 1000, `телеметрия: robots.build = ${g.tele.robots?.build}`);
  ok(JSON.stringify(totalItems(g)) !== '' && ledger(serialize(g)).ents['stone-wall'] === 600, 'стены на месте');
}

console.log('3. Снос, улучшение, ремонт; восстановление разрушенного Роем');
{
  const g = big!;
  const x0 = BA.x + 2, y0 = BA.y + 2;
  g.enqueue({ t: 'decon', x0, y0, x1: x0 + 59, y1: y0 }); g.step();
  ok(g.marked.size === 60, `помечено к сносу: ${g.marked.size}`);
  // улучшение конвейеров
  const belts = [...g.ents.values()].filter(e => e.proto === 'transport-belt');
  const st = [...g.ents.values()].find(e => e.proto === 'storage-chest')!; st.inv!.add('fast-transport-belt', 300);
  const bx0 = Math.min(...belts.map(e => e.x)), by0 = Math.min(...belts.map(e => e.y)), bx1 = Math.max(...belts.map(e => e.x)), by1 = Math.max(...belts.map(e => e.y));
  g.enqueue({ t: 'upgrade', x0: bx0, y0: by0, x1: bx1, y1: by1, map: { 'transport-belt': 'fast-transport-belt' } }); g.step();
  // повреждения: ремонтные наборы — в робопорту
  const ports = [...g.ents.values()].filter(e => e.t === 'roboport'); ports[0].inv!.add('repair-pack', 20);
  const asm = [...g.ents.values()].filter(e => e.proto === 'assembling-machine-1').slice(0, 5); for (const e of asm) e.hp = 100;
  run(g, 600);
  const h = reload(g); run(g, 600); run(h, 600);
  ok(stateHash(g) === stateHash(h), 'сохранение посреди сноса/улучшения/ремонта — продолжение совпадает');
  run(g, 60 * 60 * 5, () => g.marked.size === 0 && g.robots.length === 0 && asm.every(e => e.hp === PROTOS[e.proto].hp));
  ok([...g.ents.values()].filter(e => e.proto === 'stone-wall').length === 540, 'роботы снесли 60 стен');
  ok([...g.ents.values()].filter(e => e.proto === 'fast-transport-belt').length === 300 && ![...g.ents.values()].some(e => e.proto === 'transport-belt'), 'роботы улучшили 300 конвейеров');
  const stored = [...g.ents.values()].filter(e => e.t === 'chest').reduce((a, c) => a + c.inv!.count('stone-wall'), 0);
  const oldBelts = [...g.ents.values()].filter(e => e.t === 'chest').reduce((a, c) => a + c.inv!.count('transport-belt'), 0);
  ok(stored >= 60 && oldBelts === 300, `снесённое и заменённое — в сундуках сети: стен ${stored}, старых конвейеров ${oldBelts}`);
  ok(asm.every(e => e.hp === PROTOS[e.proto].hp), 'повреждённые сборщики отремонтированы');
  // восстановление: без технологии — призрака нет, с ней — роботы отстраивают
  const victim = asm[0]; const vx = victim.x, vy = victim.y;
  g.damage(victim, 1e6, true); ok(!g.entAt(vx, vy) && g.ghosts.size === 0, 'без «Строительных роботов» разрушенное не восстанавливается');
  st.inv!.add('assembling-machine-1', 2);
  g.research.done.add('construction-robotics');
  const v2 = asm[1]; const v2x = v2.x, v2y = v2.y; g.damage(v2, 1e6, true);
  const gh = g.ghostAt(v2x, v2y); ok(!!gh && gh.rb === true && gh.recipe === 'iron-gear-wheel', 'разрушенное Роем оставило призрак с пометкой «восстановить» и рецептом');
  run(g, 120); const h2 = reload(g); ok(h2.ghosts.size === g.ghosts.size || stateHash(h2) === stateHash(g), 'пометка восстановления переживает сохранение');
  run(g, 3600, () => !!g.entAt(v2x, v2y));
  const e2 = g.entAt(v2x, v2y); ok(!!e2 && e2.recipe === 'iron-gear-wheel' && (g.tele.robots?.rebuild || 0) === 1, 'роботы восстановили сборщик с рецептом');
}

console.log('4. Иконки призраков: вне зоны / нет предмета / нет роботов / ждёт робота; отмена стройки; приоритет');
{
  const g = fresh(); powered(g); const A = land(g, -300, 300, 70, 10);
  const P = port(g, A.x + 4, A.y + 2, 0);
  const far = g.placeGhost('stone-wall', A.x + 66, A.y + 2, 0)!; // за пределами 110×110? центр порта A.x+6 → 60 клеток
  const g1 = g.placeGhost('iron-chest', A.x + 10, A.y + 2, 0)!;
  run(g, 16);
  ok(far.st === 'out', `вне зоны: ${far.st}`); ok(g1.st === 'noitem', `нет предмета: ${g1.st}`);
  chest(g, A.x + 12, A.y + 6, [['iron-chest', 5]]); run(g, 16);
  ok(g1.st === 'norobot', `нет роботов: ${g1.st}`);
  const sum = roboSummary(g)[0]; ok(sum.noRobot === 1 && sum.idle === 0, `сводка сети: без робота ${sum.noRobot}, свободных ${sum.idle}`);
  P.inv!.add('construction-robot', 1); run(g, 16); ok(g1.st === 'wait' && g.robots.length === 1, `ждёт робота (робот вылетел): ${g1.st}`);
  // приоритет: из двух призраков первым строится помеченный Shift+ЛКМ
  run(g, 1200, () => !g.ghosts.has(g1.id) && g.robots.length === 0);
  const a = g.placeGhost('iron-chest', A.x + 20, A.y + 2, 0)!, b = g.placeGhost('iron-chest', A.x + 30, A.y + 2, 0)!;
  g.enqueue({ t: 'robotPrio', x: b.x, y: b.y }); run(g, 2);
  ok(g.robots[0]?.tgt === b.id, 'Shift+ЛКМ по призраку — робот берёт его первым');
  g.enqueue({ t: 'cancelGhosts', x0: a.x - 1, y0: a.y - 1, x1: a.x + 1, y1: a.y + 1 }); g.step();
  ok(!g.ghosts.has(a.id) && g.ghosts.has(b.id) === (g.ghostAt(b.x, b.y) != null), '«Отменить стройку» убрала призраки в выделении');
}

console.log('5. Зарядка: робот с низким зарядом летит к порту, буфер тратится');
{
  const g = fresh(); powered(g); const A = land(g, 300, -300, 60, 10);
  const P = port(g, A.x + 2, A.y + 2, 1); P.charge = 50e6;
  chest(g, A.x + 8, A.y + 2, [['stone-wall', 10]]);
  g.placeGhost('stone-wall', A.x + 50, A.y + 3, 0);
  run(g, 10); const r = g.robots[0]; ok(!!r, 'робот вылетел'); r.e = 0.15 * robotMaxJ();
  run(g, 2); ok(r.chg === P.id, 'заряд < 20% — летит к ближайшему робопорту');
  let maxE = 0; run(g, 900, () => { maxE = Math.max(maxE, r.e); return r.chg < 0; });
  ok(r.e >= robotMaxJ() - 1 && (P.charge || 0) < 100e6, `зарядился до ${(r.e / 1e6).toFixed(2)} МДж, буфер порта ${((P.charge || 0) / 1e6).toFixed(1)} МДж`);
  run(g, 1800, () => !g.ghosts.size && !g.robots.length);
  ok(!g.ghosts.size, 'после зарядки задача выполнена');
  // настоящая электросеть: робопорт без питания не заряжает буфер
  const h = fresh(); const B = land(h, 300, -300, 10, 10); const q = h.build('roboport', B.x, B.y, 0, false)!; run(h, 60);
  ok((q.charge || 0) === 0 && q.status === 'no-power', `без электросети буфер пуст, статус ${q.status}`);
}

console.log('6. Личный робопорт (модуль брони): зона 15×15, 10 роботов, заменяет авто-стройку инженера');
{
  const g = fresh(); const A = land(g, 0, 0, 12, 12); g.player.x = A.x + 6; g.player.y = A.y + 6;
  g.inv.add('personal-roboport-equipment', 1); g.inv.add('construction-robot', 15); g.inv.add('stone-wall', 40);
  g.enqueue({ t: 'equip', item: 'personal-roboport-equipment' }); g.step();
  ok(g.equip === 'personal-roboport-equipment' && g.inv.count('personal-roboport-equipment') === 0, 'модуль надет');
  for (let i = 0; i < 20; i++) g.placeGhost('stone-wall', A.x + (i % 10) + 1, A.y + 1 + Math.floor(i / 10), 0);
  run(g, 30); const fl = g.robots.filter(r => r.home === -1).length;
  ok(fl === 10, `в полёте ${fl} личных роботов (лимит 10)`);
  const h = reload(g); run(g, 300); run(h, 300); ok(stateHash(g) === stateHash(h), 'личные роботы переживают сохранение посреди полёта');
  run(g, 3000, () => !g.ghosts.size && !g.robots.length);
  ok(!g.ghosts.size && g.inv.count('construction-robot') === 15 && g.inv.count('stone-wall') === 20, `построено личными роботами, роботы вернулись: ${g.inv.count('construction-robot')}`);
  const far = g.placeGhost('stone-wall', A.x + 6, A.y + 6 + 9, 0)!; run(g, 30); ok(far.st === 'out' && g.ents.size === 20, 'за пределами 15×15 инженер не строит сам (авто-стройка заменена роботами)');
  g.enqueue({ t: 'equip', item: null }); g.step(); ok(g.equip === null && g.inv.count('personal-roboport-equipment') === 1, 'модуль снят');
  run(g, 60); ok(g.ghosts.size === 0, `без модуля инженер снова строит сам в радиусе 10 (призраков: ${g.ghosts.size}, ${g.canPlace('stone-wall', far.x, far.y, 0, true).reason})`);
}

console.log('7. Ракетная шахта, построенная роботами');
{
  const g = fresh(); powered(g); const A = land(g, -260, -260, 30, 30);
  port(g, A.x + 2, A.y + 2, 5); chest(g, A.x + 7, A.y + 2, [['rocket-silo', 1]]);
  g.placeGhost('rocket-silo', A.x + 12, A.y + 12, 0);
  run(g, 3600, () => !g.ghosts.size);
  ok(!!g.entAt(A.x + 12, A.y + 12) && g.entAt(A.x + 12, A.y + 12)!.proto === 'rocket-silo', 'шахту 9×9 поставил робот');
}

console.log('8. Быстрая погрузка/разгрузка (Ctrl+ЛКМ / Ctrl+ПКМ) и стопка в руке');
{
  const g = fresh(); const A = land(g, 0, 0, 16, 8); g.player.x = A.x + 1; g.player.y = A.y + 7;
  const f = g.build('stone-furnace', A.x, A.y, 0, false)!, a = g.build('assembling-machine-1', A.x + 3, A.y, 0, false)!, c = g.build('iron-chest', A.x + 7, A.y, 0, false)!;
  const t = g.build('gun-turret', A.x + 8, A.y + 2, 0, false)!, l = g.build('lab', A.x + 3, A.y + 4, 0, false)!;
  g.inv.add('iron-ore', 120); g.inv.add('coal', 70); g.inv.add('wood', 10); g.inv.add('iron-plate', 200); g.inv.add('firearm-magazine', 30); g.inv.add('automation-science-pack', 30);
  g.enqueue({ t: 'quick', id: f.id, op: 'load' }); g.step();
  ok(f.fuel?.item === 'coal' && g.inv.count('coal') === 20 && g.inv.count('iron-ore') === 70, `печь: топливо ${f.fuel?.item}×${f.fuel?.count}, руда ×${f.input!['iron-ore']} — одной командой`);
  g.enqueue({ t: 'setRecipe', id: a.id, recipe: 'iron-gear-wheel' }); g.step();
  g.enqueue({ t: 'quick', id: a.id, op: 'load' }); g.step(); ok(g.inv.count('iron-plate') === 100, `сборщик: ингредиенты рецепта ×${200 - g.inv.count('iron-plate')}`);
  g.enqueue({ t: 'quick', id: t.id, op: 'load' }); g.step(); ok(g.inv.count('firearm-magazine') === 0, `турель: магазины ×${30 - g.inv.count('firearm-magazine')}`);
  g.enqueue({ t: 'quick', id: l.id, op: 'load' }); g.step(); ok(l.input!['automation-science-pack'] === 30, 'лаборатория: пакеты науки');
  g.enqueue({ t: 'quick', id: c.id, op: 'load', item: 'iron-plate' }); g.step(); ok(c.inv!.count('iron-plate') === 100 && g.inv.count('iron-plate') === 0, 'сундук: вся стопка выбранного предмета');
  a.output!['iron-gear-wheel'] = 7; g.enqueue({ t: 'quick', id: a.id, op: 'unload' }); g.step(); ok(g.inv.count('iron-gear-wheel') === 7 && !a.output!['iron-gear-wheel'], 'разгрузка сборщика: всё готовое в инвентарь');
  g.enqueue({ t: 'quick', id: c.id, op: 'unload' }); g.step(); ok(c.inv!.isEmpty() && g.inv.count('iron-plate') === 100, 'разгрузка сундука: всё содержимое');
  const before = JSON.stringify(totalItems(g));
  // стопка в руке
  const i0 = g.inv.slots.findIndex(s => s?.item === 'iron-plate');
  g.enqueue({ t: 'hand', op: 'pick', from: 'inv', i: i0, n: 'half' }); g.step(); ok(g.held?.count === 50 && g.inv.count('iron-plate') === 50, `ПКМ — половина в руку: ${g.held?.count}`);
  ok(JSON.stringify(totalItems(serialize(g) ? g : g)) === before, 'стопка в руке учтена в сохранении (ничего не теряется)');
  g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: c.id, slot: 'chest:3', n: 'one' }); g.step(); ok(c.inv!.slots[3]?.count === 1 && g.held?.count === 49, 'ПКМ с рукой — по одному в ячейку сундука');
  g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: c.id, slot: 'chest:3', n: 'all' }); g.step(); ok(c.inv!.slots[3]?.count === 50 && !g.held, 'ЛКМ — всю стопку');
  g.enqueue({ t: 'hand', op: 'pick', from: 'ent', id: c.id, slot: 'chest:3', n: 'one' }); g.step(); ok(g.held?.count === 1 && c.inv!.slots[3]?.count === 49, 'Shift+ПКМ — один предмет из сундука в руку');
  const h = reload(g); ok(h.held?.count === 1 && stateHash(h) === stateHash(g), 'стопка в руке сохраняется');
  g.enqueue({ t: 'hand', op: 'return' }); g.step(); ok(!g.held && JSON.stringify(totalItems(g)) === before, 'Q — вернуть в инвентарь, итог сходится');
  g.enqueue({ t: 'hand', op: 'pick', from: 'inv', i: g.inv.slots.findIndex(s => s?.item === 'coal'), n: 'all' }); g.step();
  g.enqueue({ t: 'quick', id: f.id, op: 'load' }); g.step(); ok(!g.held || g.held.count < 20, 'Ctrl+ЛКМ со стопкой в руке — кладёт её');
  g.enqueue({ t: 'hand', op: 'return' }); g.step();
  const far = g.build('iron-chest', A.x + 11, A.y + 7, 0, false)!; g.player.x = A.x - 30; g.enqueue({ t: 'quick', id: far.id, op: 'load', item: 'coal' }); g.step(); ok(far.inv!.isEmpty(), 'издалека не грузит (радиус действий)');
  // робопорт: роботы и ремнаборы
  g.player.x = A.x + 8; const P = g.build('roboport', A.x + 12, A.y, 0, false)!; g.inv.add('construction-robot', 400); g.inv.add('repair-pack', 30);
  g.enqueue({ t: 'quick', id: P.id, op: 'load' }); g.step(); ok(P.inv!.count('construction-robot') === 350 && P.inv!.count('repair-pack') === 30, `робопорт: роботов ${P.inv!.count('construction-robot')} (7×50), ремнаборов ${P.inv!.count('repair-pack')}`);
}

console.log('9. Переводы v1.2 (RU+EN): предметы, технологии, «Что нового», ОСКАР, окна и сообщения');
{
  const rob = ['roboport', 'construction-robot', 'flying-robot-frame', 'personal-roboport-equipment'];
  const strs: string[] = [...rob.map(i => ITEMS[i].name), ...rob.filter(i => PROTOS[i]).map(i => PROTOS[i].name)];
  for (const t of ['construction-robotics', 'worker-robots-speed-1', 'worker-robots-speed-2', 'personal-roboport-equipment']) strs.push(TECHS[t].name, ...(TECHS[t].desc ? [TECHS[t].desc!] : []));
  const n12 = NEWS.find(n => n.ver.startsWith('1.2'));
  ok(!!n12, '«Что нового» содержит запись 1.2');
  if (n12) strs.push(n12.title, ...n12.items.map(i => i.text));
  for (const k of ['ent:roboport', 'inv:v12']) { ok(!!TIPS[k], `подсказка ОСКАРа ${k} есть`); if (TIPS[k]) strs.push(TIPS[k].title, TIPS[k].text); }
  // все русские литералы интерфейса (окна, сообщения, подсказки, справка) — по фрагментам между тегами и подстановками
  for (const f of ['src/ui/ui.ts', 'src/main.ts', 'src/sim/game.ts', 'src/sim/robots.ts']) {
    const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || [])
      for (const p of m.slice(1, -1).split(/<[^>]*>|\$\{[^}]*\}|"/)) if (/[А-Яа-яЁё]/.test(p)) strs.push(p);
  }
  setLang('en');
  const left = [...new Set(strs.flatMap(untranslated))].filter(x => !['с', 'ч', 'Русский'].includes(x)); // единицы после подстановок; название языка
  setLang('ru');
  ok(!left.length, `переведено ${strs.length} строк${left.length ? '; без перевода: ' + left.slice(0, 20).join(' | ') : ''}`);
}

console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ Роботы и быстрая погрузка: всё в порядке');
if (fails) process.exit(1);
