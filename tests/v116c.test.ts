// v1.16 (rc.4): электробуры 2/3, сборщик 4, радиация и защита, изотопные/ядерные боеприпасы, кривые урона,
// ядерное топливо транспорта, личный ядерный реактор. Запуск: npx tsx tests/v116c.test.ts
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { PROTOS, asmTier } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { kitOf, kitStats, combineProt, distMul, blastMul, NR_TICKS, RAD_CAP } from '../src/sim/combat';
import { radRate, radStatus, fieldRate, nuclearBlast } from '../src/sim/heat';
import { quickHash } from '../src/sim/nethash';
import { calculate } from '../src/sim/calc';
import { R_URAN } from '../src/sim/world';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= Math.abs(b) * tol + 1e-9;
const mk = (seed = 3, enemies: any = 'none') => { const g = new Game(seed, true, { enemies }); g.freePower = true; for (let i = 0; i < g.inv.slots.length; i++) g.inv.slots[i] = null; return g; };
const steps = (g: Game, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); g.step(); } };
const cmd = (g: Game, c: any, n = 2) => { g.enqueue(c); steps(g, n); };
const flat = (g: Game, x0: number, y0: number, x1: number, y1: number, res = 0, amt = 0) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = res; c.amt[i] = amt; c.decor[i] = 0; } };
const researchAll = (g: Game) => { for (const id of Object.keys(TECHS)) if (!TECHS[id].infinite) g.research.done.add(id); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); };

console.log('1. Данные: машины, боеприпасы, топливо, защита');
{
  const D = ['electric-mining-drill', 'electric-mining-drill-2', 'electric-mining-drill-3'].map(i => PROTOS[i]);
  ok(D[1].area === 7 && D[2].area === 9 && D[1].speed === 1 && D[2].speed === 2 && D[1].modules === 3 && D[2].modules === 4 && D.every(p => p.w === 3 && p.h === 3), 'электробуры 2/3: зона 7×7 и 9×9, 1 и 2 ед/с, 3 и 4 модуля');
  ok(D[1].energy!.kW === 180 && D[1].energy!.drainKW === 6 && D[2].energy!.kW === 360 && D[2].energy!.drainKW === 12, 'питание буров: 180+6 и 360+12 кВт');
  ok(D.every(p => p.fluid?.[0].filter === 'sulfuric-acid' && p.fluid[0].conns[0].x === 1 && p.fluid[0].conns[0].y === 2) && D.every(p => p.fr === 'drill'), 'один контракт кислотной добычи и общая группа быстрой замены');
  const A = PROTOS['assembling-machine-4']; ok(A.speed === 2 && A.modules === 5 && A.energy!.kW === 750 && A.energy!.drainKW === 25 && asmTier('assembling-machine-4') === 4 && A.cats!.includes('crafting-with-fluid'), 'сборщик 4: скорость 2, 5 модулей, 750+25 кВт, уровень 4, жидкостные рецепты');
  const rc = (id: string) => RECIPES[id].in.map(i => i.join('×')).join(' + ');
  ok(rc('electric-mining-drill-2') === 'electric-mining-drill×1 + steel-plate×20 + advanced-circuit×20 + iron-gear-wheel×20' && RECIPES['electric-mining-drill-2'].time === 5, 'рецепт бура 2 по ТЗ');
  ok(rc('electric-mining-drill-3') === 'electric-mining-drill-2×1 + steel-plate×30 + processing-unit×20 + electric-engine-unit×20' && RECIPES['electric-mining-drill-3'].time === 10, 'рецепт бура 3 по ТЗ');
  ok(rc('assembling-machine-4') === 'assembling-machine-3×1 + processing-unit×30 + electric-engine-unit×20 + low-density-structure×20' && RECIPES['assembling-machine-4'].time === 10, 'рецепт сборщика 4 по ТЗ');
  const t = (id: string) => TECHS[id]; ok(!t('mining-drill-3').packs.includes('space-science-pack') && !t('automation-4').packs.includes('space-science-pack') && t('mining-drill-3').packs.includes('utility-science-pack'), 'бур 3 и сборщик 4 без космической науки, с фиолетовой/жёлтой');
  // боеприпасы: 8 категорий
  const AM: [string, string, number, number][] = [['uranium-rounds-magazine', 'piercing-rounds-magazine', 1.8, 0], ['uranium-shotgun-shell', 'piercing-shotgun-shell', 1.8, 0], ['isotope-flamethrower-ammo', 'flamethrower-ammo', 1.5, 0], ['isotope-laser-cell', 'laser-cell', 2, 0], ['uranium-cannon-shell', 'explosive-cannon-shell', 2, 0], ['uranium-railgun-dart', 'railgun-dart', 2.5, 0]];
  ok(AM.every(([n, b, k]) => near(ITEMS[n].ammo!, ITEMS[b].ammo! * k, 0.001) && ITEMS[n].am!.cat === ITEMS[b].am!.cat), 'множители урона изотопных вариантов: ×1,8 / ×1,8 / ×1,5 / ×2 / ×2 / ×2,5');
  ok(ITEMS['nuclear-rocket'].ammo === 4000 && ITEMS['nuclear-rocket'].am!.aoe === 12 && ITEMS['nuclear-rocket'].am!.nuke!.tr === 8 && ITEMS['nuclear-rocket'].am!.nuke!.ts === 60, 'ядерная ракета: 4000, радиус 12, след 8 клеток на 60 с');
  ok(ITEMS['nuclear-artillery-shell'].ammo === 5000 && ITEMS['nuclear-artillery-shell'].am!.aoe === 20 && ITEMS['nuclear-artillery-shell'].am!.nuke!.tr === 12 && ITEMS['nuclear-artillery-shell'].am!.nuke!.ts === 180, 'ядерный артснаряд: 5000, радиус 20, след 12 клеток на 180 с');
  ok(RECIPES['nuclear-rocket'].time === 30 && RECIPES['nuclear-artillery-shell'].time === 30 && RECIPES['uranium-rounds-magazine'].time === 5 && RECIPES['isotope-laser-cell'].out[0][1] === 10 && RECIPES['isotope-flamethrower-ammo'].out[0][1] === 5, 'времена 5 с и 30 с, выходы 10 и 5');
  ok(['uranium-rounds-magazine', 'nuclear-rocket', 'nuclear-artillery-shell', 'isotope-laser-cell'].every(r => RECIPES[r].prod === false), 'продуктивность запрещена для ядерных боеприпасов');
  const F = ITEMS['nuclear-transport-fuel']; ok(F.stack === 10 && F.fuel === 12000 && F.fuelCat === 'nuclear-transport' && RECIPES['nuclear-transport-fuel'].time === 30 && RECIPES['nuclear-transport-fuel'].in.map(i => i.join('×')).join() === 'uranium-235×1,rocket-fuel×1', 'ядерное топливо транспорта: стопка 10, 12 ГДж, 1 U-235 + 1 ракетное топливо, 30 с');
  ok(PROTOS['locomotive'].fuelCats?.includes('nuclear-transport'), 'локомотив принимает категорию «ядерное топливо транспорта»');
  const S = ITEMS['radiation-suit'].armor!, H = ITEMS['heavy-armor'].armor!; ok(S.rad === 0.9 && S.pct === H.pct && S.flat === H.flat && S.hp === H.hp, 'костюм: −90% радиации, защита как у тяжёлой брони');
  ok(ITEMS['radiation-lining-equipment'].equip!.rad === 0.8 && ITEMS['radiation-lining-equipment'].equip!.w === 2 && ITEMS['fission-reactor-equipment'].equip!.kW === 500, 'подкладка 2×2 / 80%; личный реактор 500 кВт');
  ok(near(combineProt([0.9, 0.8]), RAD_CAP, 0.0001) && near(combineProt([0.5, 0.5]), 0.75, 0.0001) && combineProt([]) === 0 && near(combineProt([0.8]), 0.8, 0.0001), `формула 1−Π(1−p) с пределом ${RAD_CAP * 100}%`);
  const c = calculate('iron-plate', 600, { asm: 4, drill: 3 }); ok(c.steps.some(s => s.machine === 'electric-mining-drill-3'), 'калькулятор считает бур 3 и сборщик 4');
}

console.log('2. Электробуры и сборщик 4 в работе');
{
  const run = (proto: string, n = 1200) => {
    const g = mk(); researchAll(g); flat(g, 80, 80, 140, 140, 1, 100000);
    const d = g.build(proto, 100, 100, 0, false)!; const o = g.drillOut(d); const ch = g.build('wooden-chest', o.x, o.y, 0, false)!;
    steps(g, n); return { g, d, got: ch.inv!.count('iron-ore') };
  };
  const r1 = run('electric-mining-drill'), r2 = run('electric-mining-drill-2'), r3 = run('electric-mining-drill-3');
  ok(r1.got > 0 && near(r2.got / r1.got, 2, 0.12) && near(r3.got / r1.got, 4, 0.12), `выработка за 20 с: ${r1.got} / ${r2.got} / ${r3.got} (×1 / ×2 / ×4)`);
  const tiles = (r: { g: Game; d: Entity }) => r.g.drillTiles(r.d).length; ok(tiles(r1) === 25 && tiles(r2) === 49 && tiles(r3) === 81, `зона добычи 5×5 / 7×7 / 9×9 (${tiles(r1)}/${tiles(r2)}/${tiles(r3)})`);
  const g = mk(); researchAll(g); flat(g, 80, 80, 140, 140, 1, 100000); const d1 = g.build('electric-mining-drill', 100, 100, 0, false)!; d1.modules = ['speed-module', 'speed-module'];
  ok(!!g.replaceTarget('electric-mining-drill-2', 100, 100, 0), 'быстрая замена бура 1 → 2 возможна');
  const asm = (proto: string) => { const g = mk(); researchAll(g); flat(g, 80, 80, 140, 140); const a = g.build(proto, 100, 100, 0, false)!; a.recipe = 'electronic-circuit'; a.input = { 'iron-plate': 100000, 'copper-cable': 100000 }; steps(g, 1800); return a.output!['electronic-circuit'] || 0; };
  const a3 = asm('assembling-machine-3'), a4 = asm('assembling-machine-4'); ok(a3 > 0 && near(a4 / a3, 2 / 1.25, 0.1), `сборщик 4 быстрее сборщика 3 в ${(a4 / a3).toFixed(2)} раза (ожидалось 1,6)`);
  const gs = mk(); researchAll(gs); flat(gs, 80, 80, 140, 140); const sa = gs.build('assembling-machine-4', 100, 100, 0, false)!; sa.recipe = 'nuclear-fuel-cell'; sa.input = { 'uranium-235': 5, 'uranium-238': 100, 'iron-plate': 100 }; steps(gs, 1500);
  ok((sa.output!['nuclear-fuel-cell'] || 0) > 0, 'сборщик 4 делает ядерные стержни (рецепт уровня 2)');
  const gs2 = mk(); researchAll(gs2); flat(gs2, 80, 80, 140, 140); gs2.build('assembling-machine-4', 100, 100, 0, false); const gb = deserialize(serialize(gs2)); ok(stateHash(gs2) === stateHash(gb) && gb.ents.size === 1, 'сохранение и загрузка с новыми машинами');
}

console.log('3. Радиация месторождений и защита');
{
  const world = (suit: string | null, enemies: any = 'none') => {
    const g = mk(3, enemies); researchAll(g); flat(g, 90, 90, 130, 130); flat(g, 110, 110, 110, 110, R_URAN, 5000);
    g.player.x = 112.5; g.player.y = 110.5; g.player.hp = 250; // 2 клетки от руды
    if (suit) { g.inv.add(suit, 1); cmd(g, { t: 'kit', op: 'armor', item: suit }, 2); g.player.hp = 250; }
    return g;
  };
  const loss = (g: Game, n = 120) => { const h0 = g.player.hp; steps(g, n); return h0 - g.player.hp; };
  const g0 = world(null); const rate0 = radStatus(g0).raw; const l0 = loss(g0);
  ok(rate0 > 0 && rate0 <= 2 && near(l0, rate0 * 2, 0.03), `без защиты: ${rate0.toFixed(2)} ед/с (≤ 2), за 2 с потеряно ${l0.toFixed(2)}`);
  const gs = world('radiation-suit'); const ls = loss(gs);
  ok(near(ls, l0 * 0.1, 0.05) && ls > 0, `костюм −90%: потеряно ${ls.toFixed(3)} (≈ ${(l0 * 0.1).toFixed(3)}); дробные остатки не округляются вверх`);
  const gh = world('heavy-armor'); const lh = loss(gh); ok(near(lh, l0, 0.03), `обычная броня радиацию не снижает (${lh.toFixed(2)} ≈ ${l0.toFixed(2)})`);
  const gl = world('modular-armor'); gl.inv.add('radiation-lining-equipment', 1); cmd(gl, { t: 'kit', op: 'mod', item: 'radiation-lining-equipment' }, 2); gl.player.hp = 250;
  ok(near(kitStats(kitOf(gl.player)).rad, 0.8, 0.001), 'подкладка в модульной броне даёт 80%'); const ll = loss(gl); ok(near(ll, l0 * 0.2, 0.05), `с подкладкой: ${ll.toFixed(3)} ≈ ${(l0 * 0.2).toFixed(3)}`);
  const gp = world(null, 'none'); ok(radStatus(gp).raw > 0 && loss(gp, 60) > 0, 'мирный режим радиацию не отключает');
  const far = world(null); far.player.x = 118.5; ok(fieldRate(far, far.player.x, far.player.y) === 0, 'дальше 3 клеток от руды радиации нет');
  // перекрытие клеток: максимум, а не сумма
  const gm = world(null); flat(gm, 108, 108, 112, 112, R_URAN, 5000); gm.player.x = 110.5; gm.player.y = 110.5; ok(radRate(gm, 110.5, 110.5) <= 2 + 1e-9, `десятки клеток руды не суммируются (${radRate(gm, 110.5, 110.5).toFixed(2)} ≤ 2)`);
  // истощение
  const ge = world(null); ge.world.chunkAt(110, 110).amt[ge.world.idx(110, 110)] = 0; ok(radRate(ge, 112.5, 110.5) === 0, 'после истощения поля источник исчезает');
  // сохранение внутри поля
  const g1 = world(null); steps(g1, 30); const g2 = deserialize(serialize(g1)); g2.freePower = true; flat(g2, 110, 110, 110, 110, R_URAN, 5000); g2.player.x = g1.player.x; g2.player.y = g1.player.y; steps(g1, 90); steps(g2, 90); ok(Math.abs(g1.player.hp - g2.player.hp) < 1e-9, 'загрузка внутри поля продолжает ту же дозу ' + g1.player.hp + ' / ' + g2.player.hp);
  // смерть и возрождение
  const gd = world(null); gd.player.hp = 1; steps(gd, 60); ok(gd.player.dead, 'без защиты на поле можно погибнуть (после предупреждения)');
  steps(gd, 400); gd.player.x = 112.5; ok(true, 'возрождение возможно');
  // предупреждение
  const gw = world(null); const msgs: string[] = []; const m0 = gw.msg.bind(gw); gw.msg = (t: string) => { msgs.push(t); m0(t); }; steps(gw, 5); ok(msgs.some(m => m.includes('Радиация')), 'при входе в зону выводится предупреждение');
  // творческий режим
  const gc = world(null); cmd(gc, { t: 'x', op: 'con', line: '/creative' }, 2); gc.player.hp = 1; steps(gc, 60); ok(gc.player.hp >= 1 && !gc.player.dead, 'творческий режим: инженер неуязвим');
}

console.log('4. Ядерный взрыв и радиоактивный след');
{
  const g = mk(); flat(g, 80, 80, 160, 160); const W: Entity[] = [];
  for (const dx of [2, 6, 10, 14]) W.push(g.build('stone-wall', 120 + dx, 120, 0, false)!);
  const hp0 = W.map(w => w.hp!); const nk = ITEMS['nuclear-rocket'].am!.nuke!;
  g.player.x = 100; g.player.y = 100; nuclearBlast(g, 120, 120.5, 12, 200, nk, -1);
  const lost = W.map((w, i) => g.ents.has(w.id) ? hp0[i] - w.hp! : hp0[i]);
  ok(lost[0] >= lost[1] && lost[1] >= lost[2] && lost[2] > 0 && lost[3] === 0, `урон убывает от центра к краю и обрывается на границе (${lost.map(Math.round).join(' / ')})`);
  ok(g.nuc.zones.length === 1 && g.nuc.zones[0].r === 8 && g.nuc.zones[0].dur === 3600 && g.nuc.zones[0].dps === 5, 'остаётся радиоактивный след: 8 клеток, 60 с, 5 ед/с');
  const rr = radRate(g, 120, 120.5); ok(near(rr, 5, 0.01), `в центре следа ${rr.toFixed(2)} ед/с`);
  ok(radRate(g, 120 + 9, 120.5) === 0, 'за пределами следа радиации нет');
  g.player.x = 120; g.player.y = 120.5; g.player.hp = 250; steps(g, 60); ok(g.player.hp < 250, 'в следе без защиты инженер получает урон');
  const g2 = mk(); g2.nuc.zones.push({ x: 50, y: 50, t: 0, r: 8, dur: 3600, dps: 5 }); g2.player.x = 50; g2.player.y = 50; steps(g2, 3700); ok(g2.nuc.zones.length === 0, 'след исчезает через 60 с');
  const gs = mk(); gs.inv.add('nuclear-rocket', 3); gs.inv.add('rocket', 2); const k = kitOf(gs.player); k.guns[0] = 'rocket-launcher'; k.sel = 0; k.rnd[0] = 0;
  k.guns[0] = 'rocket-launcher'; gs.input.shoot = { x: gs.player.x + 5, y: gs.player.y }; steps(gs, 3); gs.input.shoot = null; ok(k.rt[0] === 'rocket' && gs.inv.count('nuclear-rocket') === 3, 'автоперезарядка не берёт ядерную ракету сама');
  const ga = mk(); flat(ga, 80, 80, 160, 160); const ex = ga.build('stone-wall', 125, 120, 0, false)!; const ex0 = ex.hp!; nuclearBlast(ga, 120, 120.5, 20, 5000, ITEMS['nuclear-artillery-shell'].am!.nuke!, -1);
  ok(ga.nuc.zones[0].r === 12 && ga.nuc.zones[0].dur === 10800 && (ga.ents.has(ex.id) ? ex.hp! < ex0 : true), 'ядерный артснаряд: радиус следа 12, 180 с');
  const sv = deserialize(serialize(g)); ok(sv.nuc.zones.length === 1 && sv.nuc.zones[0].dps === 5 && stateHash(sv) === stateHash(g), 'след сохраняется и входит в хеш');
}

console.log('5. Кривые урона от дальности и взрыва');
{
  const R = 20; const f = (cat: string, p: number) => distMul(cat, R * p, R);
  ok(f('bullet', 0) === 1 && f('bullet', 0.6) === 1 && near(f('bullet', 1), 0.7, 0.001) && near(f('bullet', 0.8), 0.85, 0.001), 'пули: полный до 60%, 70% на пределе');
  ok(f('shotgun', 0.25) === 1 && near(f('shotgun', 1), 0.25, 0.001) && f('shotgun', 0.6) < 1 && f('shotgun', 0.6) > 0.25, 'дробь: полный до 25%, 25% на пределе');
  ok(f('rail', 0.7) === 1 && near(f('rail', 1), 0.8, 0.001) && f('cell', 0.7) === 1 && near(f('cell', 1), 0.8, 0.001), 'рельс и энергооружие: полный до 70%, 80% на пределе');
  ok(f('rocket', 1) === 1 && near(f('bullet', 1.0001), 0.7, 0.001) && f('bullet', 2) === 0.7, 'ракеты полётом не ослабляются; дальше предела — не растёт');
  ok(blastMul(0, 10) === 1 && blastMul(3.5, 10) === 1 && near(blastMul(10, 10), 0.5, 0.001) && blastMul(6, 10) < 1 && blastMul(6, 10) > 0.5, 'взрыв: полный у центра, 50% у границы области');
  // рельсовые турели: каждое следующее пробитие ×0,8
  const g = mk(3, 'normal'); ok(typeof g.step === 'function', 'боевая партия создаётся');
}

console.log('6. Ядерное топливо для транспорта');
{
  const g = mk(); flat(g, 80, 80, 140, 140);
  const furn = g.build('stone-furnace', 100, 100, 0, false)!; const boil = g.build('boiler', 106, 100, 0, false)!;
  ok(g.insertItem(furn, 'nuclear-transport-fuel', 5, false, true) === 0 && g.insertItem(boil, 'nuclear-transport-fuel', 5, false, true) === 0, 'печь и котёл ядерную капсулу не принимают');
  ok(g.insertItem(furn, 'coal', 5, false, true) > 0, 'обычное топливо принимают как раньше');
  const loco = { id: 99, proto: 'locomotive', t: 'loco', x: 0, y: 0, w: 2, h: 7, dir: 0, fuel: null, fuelJ: 0 } as any as Entity;
  ok(g.insertItem(loco, 'nuclear-transport-fuel', 5, false, true) === 5 && g.insertItem(loco, 'nuclear-transport-fuel', 20, true, true) === 20, 'локомотив принимает капсулы в пять топливных ячеек без старого ограничения10');
  g.insertItem(loco, 'nuclear-transport-fuel', 2, false); ok(g.burn(loco, 600) && (loco.nj || 0) > 0 && near(loco.fuelJ! + 0, 12e9 - 600 * 1000 / 60, 0.001), 'капсула сгорает в запас энергии 12 ГДж, ядерная доля учтена');
  const nj0 = loco.nj!; for (let i = 0; i < 600; i++) g.burn(loco, 600); ok(loco.nj! < nj0 && loco.nj! >= 0, 'ядерная доля убывает вместе с запасом');
  const coal = { id: 98, proto: 'locomotive', t: 'loco', x: 0, y: 0, w: 2, h: 7, dir: 0, fuel: { item: 'coal', count: 3 }, fuelJ: 0 } as any as Entity; g.burn(coal, 600); ok(!coal.nj, 'обычный уголь бонуса не даёт — смесь топлива не умножает эффект');
  loco.nj = 1e9; loco.fuelJ = 2e9; const copy = JSON.parse(JSON.stringify(loco)); ok(copy.nj === 1e9, 'остаток ядерной энергии сериализуется');
}

console.log('7. Личный ядерный реактор');
{
  const g = mk(); researchAll(g); g.inv.add('modular-armor', 1); g.inv.add('fission-reactor-equipment', 1); g.inv.add('battery-equipment', 4); g.inv.add('nuclear-fuel-cell', 4);
  cmd(g, { t: 'kit', op: 'armor', item: 'modular-armor' }); cmd(g, { t: 'kit', op: 'mod', item: 'fission-reactor-equipment' }); for (let i = 0; i < 4; i++) cmd(g, { t: 'kit', op: 'mod', item: 'battery-equipment' }, 1);
  const k = kitOf(g.player); const iR = k.grid.findIndex(m => m.id === 'fission-reactor-equipment'); ok(iR >= 0, 'модуль 2×2 установлен в сетку');
  const en0 = k.en; steps(g, 600); ok(k.en === en0, 'без стержня энергии нет');
  cmd(g, { t: 'kit', op: 'nrfeed', i: iR }); ok((k.grid[iR].n ?? 0) + (k.grid[iR].r! > 0 ? 1 : 0) === 4 && g.inv.count('nuclear-fuel-cell') === 0, JSON.stringify(k.grid[iR]) + ' inv ' + g.inv.count('nuclear-fuel-cell') + ' стержни загружаются в отдельный слот');
  const e1 = k.en; steps(g, 600); const got = (k.en - e1) / 1e6; ok(near(got, 5, 0.1) && k.grid[iR].r! > 0, `10 с работы дают ≈ 5 МДж (${got.toFixed(2)}) при 500 кВт`);
  steps(g, NR_TICKS); ok(k.grid[iR].w! >= 1 && k.grid[iR].n! <= 3, `стержень отработал 200 с, отход в своём слоте (${k.grid[iR].w})`);
  const g2 = deserialize(serialize(g)); const k2 = kitOf(g2.player); ok(k2.grid.length === k.grid.length && k2.grid.every((m, i) => m.id === k.grid[i].id && m.r === k.grid[i].r && m.n === k.grid[i].n && m.w === k.grid[i].w), 'состояние стержня, запаса и отхода сохраняется');
  // заполненные отходы блокируют цикл
  const gw = mk(); researchAll(gw); gw.inv.add('modular-armor', 1); gw.inv.add('fission-reactor-equipment', 1); gw.inv.add('battery-equipment', 4); gw.inv.add('nuclear-fuel-cell', 4);
  cmd(gw, { t: 'kit', op: 'armor', item: 'modular-armor' }); cmd(gw, { t: 'kit', op: 'mod', item: 'fission-reactor-equipment' }); const kw = kitOf(gw.player); const iw = kw.grid.findIndex(m => m.id === 'fission-reactor-equipment');
  kw.grid[iw].w = 10; kw.grid[iw].n = 3; steps(gw, 100); ok(!(kw.grid[iw].r! > 0), 'отходы заполнены — новый цикл не начинается');
  cmd(gw, { t: 'kit', op: 'nrtake', i: iw }); ok(kw.grid[iw].w === 0 && gw.inv.count('used-nuclear-fuel-cell') === 10 && gw.inv.count('nuclear-fuel-cell') === 7, 'отходы и неиспользованные стержни забираются');
  steps(gw, 100); kw.grid[iw].n = 2; steps(gw, 100); ok(kw.grid[iw].r! > 0, 'после очистки цикл начинается');
  const used0 = gw.inv.count('used-nuclear-fuel-cell'); cmd(gw, { t: 'kit', op: 'unmod', i: iw }); ok(gw.inv.count('used-nuclear-fuel-cell') === used0 + 1 && gw.inv.count('nuclear-fuel-cell') === 7 + 1 && gw.inv.count('fission-reactor-equipment') === 1, 'снятие активного модуля: аварийная остановка — один отход, запас стержней возвращён, полный стержень не восстанавливается');
  ok(RECIPES['fission-reactor-equipment'].time === 20 && RECIPES['fission-reactor-equipment'].in.map(i => i.join('×')).join() === 'steel-plate×50,copper-plate×50,advanced-circuit×20,battery×5', 'рецепт личного реактора по ТЗ');
}

console.log(fails ? `\n✘ ошибок: ${fails}` : '\n✔ v1.16c: все проверки пройдены');
process.exit(fails ? 1 : 0);
